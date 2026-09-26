#!/usr/bin/env node
/**
 * 构建产物检查：体积上限 + 产物完整性。
 *
 * 用法：node scripts/check-dist.mjs [distDir] [budgetsFile]
 *   默认 distDir = dist，budgetsFile = budgets.json（均相对仓库根）。
 *
 * 检查项：
 *   1. 列出产物中每个脚本(.js)/样式(.css)文件的 raw / gzip / brotli 大小，
 *      任一维度超过 budgets.json 中对应上限即失败，并指出超了多少。
 *   2. 产物中不得出现超过 audioSampleMaxBytes 的音频采样文件（默认 0 = 不允许）。
 *   3. 入口 index.html 引用的本地脚本/样式必须是带内容哈希的文件名（Vite 风格 name-[hash].ext）。
 *   4. index.html 引用的每个本地资源必须真实存在于产物目录中。
 *
 * 只使用 Node 内置模块，本地离线运行，退出码 0 = 全部通过，1 = 有失败项。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, process.argv[2] ?? 'dist');
const budgetsPath = resolve(root, process.argv[3] ?? 'budgets.json');

const failures = [];
const fail = (msg) => failures.push(msg);

// ---------- 读取上限 ----------
if (!existsSync(budgetsPath)) {
  console.error(`找不到上限文件：${budgetsPath}`);
  process.exit(1);
}
const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'));
if (!existsSync(distDir)) {
  console.error(`找不到产物目录：${distDir}（请先运行 npm run build）`);
  process.exit(1);
}

// ---------- 遍历产物 ----------
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const files = walk(distDir);
const rel = (p) => relative(distDir, p).split('\\').join('/');

const gzipOf = (buf) => gzipSync(buf, { level: 9 }).length;
const brotliOf = (buf) =>
  brotliCompressSync(buf, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;

const fmt = (n) => `${n.toLocaleString('en-US')} B`;

// ---------- 检查 1：脚本/样式体积 ----------
console.log('== 脚本与样式文件体积 ==');
console.log('文件'.padEnd(36) + 'raw'.padStart(12) + 'gzip'.padStart(12) + 'brotli'.padStart(12));
const kindOf = (p) => (p.endsWith('.js') ? 'script' : p.endsWith('.css') ? 'style' : null);
let measured = 0;
for (const p of files) {
  const kind = kindOf(p);
  if (!kind) continue;
  const limits = budgets[kind];
  if (!limits) continue;
  measured++;
  const buf = readFileSync(p);
  const size = { raw: buf.length, gzip: gzipOf(buf), brotli: brotliOf(buf) };
  const name = rel(p);
  console.log(
    name.padEnd(36) +
      fmt(size.raw).padStart(12) +
      fmt(size.gzip).padStart(12) +
      fmt(size.brotli).padStart(12),
  );
  for (const dim of ['raw', 'gzip', 'brotli']) {
    if (limits[dim] != null && size[dim] > limits[dim]) {
      fail(`${name} 的 ${dim} 大小 ${fmt(size[dim])} 超出上限 ${fmt(limits[dim])}（超了 ${fmt(size[dim] - limits[dim])}）`);
    }
  }
}
if (measured === 0) fail('产物中没有找到任何 .js/.css 文件，构建可能不完整');

// ---------- 检查 2：音频采样类大文件 ----------
console.log('\n== 音频采样文件检查 ==');
const audioExts = new Set(
  (budgets.audioSampleExtensions ?? []).map((e) => '.' + e.toLowerCase()),
);
const audioMax = budgets.audioSampleMaxBytes ?? 0;
const audioHits = files.filter((p) => {
  const lower = p.toLowerCase();
  for (const ext of audioExts) if (lower.endsWith(ext)) return statSync(p).size > audioMax;
  return false;
});
if (audioHits.length === 0) {
  console.log(`通过：未发现超过 ${fmt(audioMax)} 的音频采样文件`);
} else {
  for (const p of audioHits) {
    const msg = `产物中出现音频采样文件 ${rel(p)}（${fmt(statSync(p).size)}，允许上限 ${fmt(audioMax)}）`;
    console.log(`✘ ${msg}`);
    fail(msg);
  }
}

// ---------- 检查 3 & 4：入口页面引用 ----------
console.log('\n== 入口页面资源引用检查 ==');
const indexPath = join(distDir, 'index.html');
if (!existsSync(indexPath)) {
  fail('产物中缺少 index.html');
} else {
  const html = readFileSync(indexPath, 'utf8');
  const refs = [];
  for (const m of html.matchAll(/<script\b[^>]*?\bsrc="([^"]+)"/g)) refs.push(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*?\bhref="([^"]+)"/g)) refs.push(m[1]);
  const local = refs.filter((r) => !/^(https?:)?\/\//.test(r) && !r.startsWith('data:'));
  if (local.length === 0) fail('index.html 没有引用任何本地脚本/样式资源');

  // Vite 哈希资源名：name-[8位以上base64url字符].ext
  const hashed = /-[A-Za-z0-9_-]{8,}\.[^./]+$/;
  for (const r of local) {
    const clean = r.split(/[?#]/)[0];
    const base = clean.split('/').pop();
    if (/\.(js|css)$/.test(base) && !hashed.test(base)) {
      fail(`index.html 引用的 ${base} 不是带内容哈希的文件名`);
    }
    const onDisk = join(distDir, clean.replace(/^\.\//, '').replace(/^\//, ''));
    if (!existsSync(onDisk)) {
      fail(`index.html 引用的 ${clean} 在产物目录中不存在`);
    } else {
      console.log(`通过：${clean} -> ${rel(onDisk)}（存在${hashed.test(base) ? '，文件名带哈希' : ''}）`);
    }
  }
}

// ---------- 汇总 ----------
console.log('\n== 检查结果 ==');
if (failures.length === 0) {
  console.log('全部通过 ✔');
  process.exit(0);
} else {
  for (const f of failures) console.error(`✘ ${f}`);
  console.error(`\n共 ${failures.length} 项未通过`);
  process.exit(1);
}
