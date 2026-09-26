#!/usr/bin/env node
/**
 * 构建后产物检查（纯 Node 内置模块、零依赖、可离线运行）。
 *
 * 检查内容：
 *   1. 列出产物目录内每个 .js/.css 的「原始 / gzip / brotli」体积；
 *   2. 与仓库内预算文件（bundle-budget.json）逐文件、逐压缩方式比对，
 *      任一项超限即以非零状态退出，并指出文件与超出字节数；
 *   3. 禁止音频采样类文件进入产物（扩展名 + 文件头双重识别），并限制单文件上限；
 *   4. 入口 HTML 引用的本地 JS/CSS 必须带内容哈希，且文件在产物目录中真实存在。
 *
 * 用法：
 *   node scripts/check-bundle.mjs [--dist dist] [--budget bundle-budget.json]
 *                                 [--report dist/bundle-report.txt | --no-report]
 *
 * 退出码：0 全部通过（允许有警告）；1 存在失败项；2 用法/前置条件错误。
 */

import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, basename, extname } from 'node:path';
import zlib from 'node:zlib';

// ────────────────────────────── 参数解析 ──────────────────────────────

function parseArgs(argv) {
  const opts = { dist: 'dist', budget: 'bundle-budget.json', report: null, writeReport: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-report') {
      opts.writeReport = false;
    } else if (arg.startsWith('--')) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`参数 ${arg} 缺少取值`);
      opts[arg.slice(2)] = value;
    }
  }
  if (opts.report === null) opts.report = join(opts.dist, 'bundle-report.txt');
  return opts;
}

// ───────────────────────────── 通用小工具 ─────────────────────────────

function fmt(n) {
  return String(n).toLocaleString('en-US');
}

function bytes(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`预算项 ${label} 必须是非负数字（字节），实际为 ${JSON.stringify(value)}`);
  }
  return value;
}

/** 递归列出目录下全部文件，顺序固定以保证报告可复现。 */
function listFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const p = join(current, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else out.push(p);
    }
  }
  return out.sort();
}

/** 展开单层 {a,b,c} 花括号，便于在一个 glob 里写多种扩展名。 */
function expandBraces(pattern) {
  const m = /\{([^{}]*)\}/.exec(pattern);
  if (!m) return [pattern];
  return m[1].split(',').flatMap((option) =>
    expandBraces(pattern.slice(0, m.index) + option + pattern.slice(m.index + m[0].length)),
  );
}

const GLOB_META = new Set(['.', '+', '^', '$', '(', ')', '|', '[', ']', '\\']);

/**
 * glob 逐字符转正则：** 可跨零到多个目录段、* 不跨路径分隔符、? 单字符。
 * 用扫描器而非链式 replace，避免各种通配符互相误伤。
 */
function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        // ** 后紧跟 /：可吃掉零到多个目录段
        if (pattern[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if (GLOB_META.has(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

function matchGlob(relPath, pattern) {
  return expandBraces(pattern).some((p) => globToRegExp(p).test(relPath));
}

// ────────────────────────────── 体积测量 ──────────────────────────────

function measureSizes(buffer, compression) {
  return {
    raw: buffer.length,
    gzip: zlib.gzipSync(buffer, { level: compression.gzipLevel }).length,
    brotli: zlib.brotliCompressSync(buffer, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: compression.brotliQuality },
    }).length,
  };
}

const METRICS = [
  ['raw', '原始'],
  ['gzip', 'gzip'],
  ['brotli', 'brotli'],
];

function limitFieldFor(key) {
  return `max${key[0].toUpperCase()}${key.slice(1)}Bytes`;
}

/** 常见音频容器文件头识别（扩展名被改也能发现）。 */
function sniffAudio(buffer) {
  const ascii = (start, end) => buffer.toString('ascii', start, end);
  if (buffer.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'WAV（文件头）';
  if (buffer.length >= 4 && ascii(0, 4) === 'OggS') return 'OGG/Opus（文件头）';
  if (buffer.length >= 4 && ascii(0, 4) === 'fLaC') return 'FLAC（文件头）';
  if (buffer.length >= 3 && ascii(0, 3) === 'ID3') return 'MP3（文件头）';
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'MPEG 音频（文件头）';
  if (buffer.length >= 12 && ascii(4, 8) === 'ftyp' && ['M4A ', 'M4P ', 'M4B ', 'AACP'].includes(ascii(8, 12))) {
    return 'M4A/AAC（文件头）';
  }
  return null;
}

// ──────────────────────── 入口 HTML 引用解析 ──────────────────────────

function getAttr(tag, attr) {
  const m = new RegExp(`\\b${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

function isLocalUrl(url) {
  return !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//');
}

function extractReferences(html) {
  const refs = [];
  for (const m of html.matchAll(/<script\b[^>]*>/gis)) {
    const src = getAttr(m[0], 'src');
    if (src) refs.push({ kind: 'script', url: src });
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gis)) {
    const href = getAttr(m[0], 'href');
    const rel = (getAttr(m[0], 'rel') ?? '').toLowerCase();
    if (href && (/\.(?:m?js|css)(?:[?#]|$)/i.test(href) || /stylesheet|modulepreload|preload/.test(rel))) {
      refs.push({ kind: `link[${rel || '?'}]`, url: href });
    }
  }
  return refs;
}

// ────────────────────────────── 主流程 ────────────────────────────────

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const distDir = resolve(opts.dist);
  const budgetPath = resolve(opts.budget);
  const reportPath = resolve(opts.report);

  if (!existsSync(distDir)) {
    console.error(`✗ 产物目录不存在：${opts.dist}（请先执行 npm run build）`);
    process.exit(2);
  }
  let config;
  try {
    config = JSON.parse(readFileSync(budgetPath, 'utf8'));
  } catch (err) {
    console.error(`✗ 无法读取预算文件 ${opts.budget}：${err.message}`);
    process.exit(2);
  }

  const compression = {
    gzipLevel: config.compression?.gzipLevel ?? zlib.constants.Z_BEST_COMPRESSION,
    brotliQuality: config.compression?.brotliQuality ?? 11,
  };
  const trackedExts = config.trackedExtensions ?? ['.js', '.css', '.mjs'];
  const forbiddenExts = (config.forbiddenAudioExtensions ?? []).map((e) => e.toLowerCase());
  const hashRegExp = new RegExp(config.hashPattern ?? '^.+[-_.][A-Za-z0-9_-]{8,}\\.(?:m?js|css)$');
  const entryRel = config.entry ?? 'index.html';
  const requireBudgetFor = (config.requireBudgetFor ?? trackedExts).map((e) => e.toLowerCase());
  const maxAssetBytes = config.maxAssetBytes ?? 512 * 1024;

  /** 每个检查块：title + 若干行（纯文本行或 {status,text}）。 */
  const blocks = [];

  // 扫描产物（报告文件自身不参与检查，避免污染下一次结果）
  const allFiles = listFiles(distDir).filter((p) => resolve(p) !== reportPath);
  const relOf = (p) => relative(distDir, p).split('\\').join('/');

  const assets = [];
  for (const file of allFiles) {
    const ext = extname(file).toLowerCase();
    const buffer = readFileSync(file);
    const tracked = trackedExts.includes(ext);
    assets.push({
      file,
      rel: relOf(file),
      ext,
      buffer,
      tracked,
      sizes: tracked ? measureSizes(buffer, compression) : null,
    });
  }
  const trackedAssets = assets.filter((a) => a.tracked).sort((a, b) => a.rel.localeCompare(b.rel));

  // ── 块 1：体积清单（人看的表，无通过/失败） ──
  const width = Math.max(36, ...trackedAssets.map((a) => a.rel.length + 2));
  const sizeLines = [
    `  ${'文件'.padEnd(width)}${'原始 (B)'.padStart(14)}${`gzip(${compression.gzipLevel}) (B)`.padStart(16)}${`brotli(${compression.brotliQuality}) (B)`.padStart(18)}`,
  ];
  const totals = { raw: 0, gzip: 0, brotli: 0 };
  for (const a of trackedAssets) {
    for (const [key] of METRICS) totals[key] += a.sizes[key];
    sizeLines.push(
      `  ${a.rel.padEnd(width)}${fmt(a.sizes.raw).padStart(14)}${fmt(a.sizes.gzip).padStart(16)}${fmt(a.sizes.brotli).padStart(18)}`,
    );
  }
  sizeLines.push(
    `  ${`合计（${trackedAssets.length} 个）`.padEnd(width)}${fmt(totals.raw).padStart(14)}${fmt(totals.gzip).padStart(16)}${fmt(totals.brotli).padStart(18)}`,
  );
  blocks.push({ title: '脚本与样式体积清单（原始 / 两种常见压缩方式）', lines: sizeLines });

  // ── 块 2：单文件预算 ──
  const fileRules = config.files ?? [];
  const ruleFor = (rel) => fileRules.find((rule) => matchGlob(rel, rule.pattern));
  const perFileLines = [];
  for (const a of trackedAssets) {
    const rule = ruleFor(a.rel);
    if (!rule) {
      if (requireBudgetFor.includes(a.ext)) {
        perFileLines.push({
          status: 'fail',
          text: `✗ ${a.rel}：没有匹配的单文件预算规则（新增产物必须在 ${basename(budgetPath)} 登记）`,
        });
      } else {
        perFileLines.push({ status: 'pass', text: `· ${a.rel}：非预算管控类型，跳过` });
      }
      continue;
    }
    for (const [key, label] of METRICS) {
      const field = limitFieldFor(key);
      if (rule[field] === undefined) continue;
      const limit = bytes(rule[field], `${rule.pattern}.${field}`);
      const actual = a.sizes[key];
      const pct = Math.round((actual / limit) * 100);
      if (actual > limit) {
        perFileLines.push({
          status: 'fail',
          text: `✗ ${a.rel} · ${label} ${fmt(actual)} B > 预算 ${fmt(limit)} B，超出 ${fmt(actual - limit)} B（预算的 ${pct}%）`,
        });
      } else {
        perFileLines.push({
          status: 'pass',
          text: `✓ ${a.rel} · ${label} ${fmt(actual)} / ${fmt(limit)} B（${pct}%）`,
        });
      }
    }
  }
  if (trackedAssets.length === 0) {
    perFileLines.push({ status: 'fail', text: '✗ 产物中没有任何 .js/.css 文件，构建结果异常' });
  }
  blocks.push({ title: '单文件预算比对（超预算即失败）', lines: perFileLines });

  // ── 块 3：分组合计预算 ──
  const totalLines = [];
  for (const rule of config.totals ?? []) {
    const group = trackedAssets.filter((a) => matchGlob(a.rel, rule.pattern));
    if (group.length === 0) {
      totalLines.push({ status: 'warn', text: `! 合计规则 ${rule.pattern} 未匹配到任何文件` });
      continue;
    }
    for (const [key, label] of METRICS) {
      const field = limitFieldFor(key);
      if (rule[field] === undefined) continue;
      const limit = bytes(rule[field], `totals ${rule.pattern}.${field}`);
      const sum = group.reduce((acc, a) => acc + a.sizes[key], 0);
      const pct = Math.round((sum / limit) * 100);
      if (sum > limit) {
        totalLines.push({
          status: 'fail',
          text: `✗ 合计 [${rule.pattern}]（${group.length} 个文件）· ${label} ${fmt(sum)} B > 预算 ${fmt(limit)} B，超出 ${fmt(sum - limit)} B（预算的 ${pct}%）`,
        });
      } else {
        totalLines.push({
          status: 'pass',
          text: `✓ 合计 [${rule.pattern}]（${group.length} 个文件）· ${label} ${fmt(sum)} / ${fmt(limit)} B（${pct}%）`,
        });
      }
    }
  }
  blocks.push({ title: '分组合计预算比对', lines: totalLines });

  // ── 块 4：音频采样与超大文件 ──
  const mediaLines = [];
  let mediaFailed = 0;
  for (const a of assets) {
    if (forbiddenExts.includes(a.ext)) {
      mediaFailed++;
      mediaLines.push({
        status: 'fail',
        text: `✗ ${a.rel}：禁止的音频采样文件（${a.ext}，${fmt(a.buffer.length)} B）；本项目运行时全部走 Web Audio 合成`,
      });
    }
    const sniffed = sniffAudio(a.buffer);
    if (sniffed) {
      mediaFailed++;
      mediaLines.push({
        status: 'fail',
        text: `✗ ${a.rel}：疑似音频采样文件（${sniffed}，${fmt(a.buffer.length)} B），即使改了扩展名也不允许进入产物`,
      });
    }
  }
  if (mediaFailed === 0) {
    mediaLines.push({
      status: 'pass',
      text: `✓ 未发现音频采样文件（扩展名黑名单 ${forbiddenExts.join(' / ')} + 文件头双重检查）`,
    });
  }
  const largest = assets.reduce((max, a) => (a.buffer.length > max.buffer.length ? a : max), assets[0]);
  if (largest && largest.buffer.length > maxAssetBytes) {
    mediaLines.push({
      status: 'fail',
      text: `✗ ${largest.rel}：单文件 ${fmt(largest.buffer.length)} B > 上限 ${fmt(maxAssetBytes)} B，超出 ${fmt(largest.buffer.length - maxAssetBytes)} B`,
    });
  } else if (largest) {
    mediaLines.push({
      status: 'pass',
      text: `✓ 最大单文件 ${largest.rel} ${fmt(largest.buffer.length)} B ≤ 上限 ${fmt(maxAssetBytes)} B`,
    });
  }
  blocks.push({ title: '禁止内容：音频采样文件 / 单文件大小上限', lines: mediaLines });

  // ── 块 5：入口页面引用与哈希一致性 ──
  const refLines = [];
  const entryPath = join(distDir, entryRel);
  if (!existsSync(entryPath)) {
    refLines.push({ status: 'fail', text: `✗ 入口页面不存在：${entryRel}` });
  } else {
    const html = readFileSync(entryPath, 'utf8');
    const refs = extractReferences(html);
    const localRefs = refs.filter((r) => isLocalUrl(r.url));
    const externalRefs = refs.filter((r) => !isLocalUrl(r.url));

    let badHash = 0;
    let missing = 0;
    const referencedRels = new Set();
    for (const ref of localRefs) {
      const pathPart = ref.url.split('#')[0].split('?')[0];
      let decoded;
      try {
        decoded = decodeURIComponent(pathPart);
      } catch {
        decoded = pathPart;
      }
      const target = resolve(join(distDir, entryRel), '..', decoded);
      const targetRel = relative(distDir, target).split('\\').join('/');
      const ext = extname(targetRel.split('?')[0]).toLowerCase();
      const isTracked = trackedExts.includes(ext);

      if (!target.startsWith(distDir)) {
        badHash++;
        refLines.push({ status: 'fail', text: `✗ ${entryRel} 引用 ${ref.url} 解析到产物目录之外` });
        continue;
      }
      if (isTracked && !hashRegExp.test(basename(targetRel))) {
        badHash++;
        refLines.push({
          status: 'fail',
          text: `✗ ${entryRel} 引用的 ${ref.url} 文件名不带内容哈希（要求匹配 ${hashRegExp}），会破坏 immutable 缓存策略`,
        });
      }
      if (!existsSync(target)) {
        missing++;
        refLines.push({ status: 'fail', text: `✗ ${entryRel} 引用的 ${ref.url} 在产物目录中不存在（${targetRel}）` });
      } else {
        referencedRels.add(targetRel);
        if (isTracked && hashRegExp.test(basename(targetRel))) {
          refLines.push({ status: 'pass', text: `✓ ${ref.url} 带哈希且与产物文件一致 → ${targetRel}` });
        }
      }
    }
    if (localRefs.length === 0) {
      refLines.push({ status: 'fail', text: `✗ ${entryRel} 没有引用任何本地脚本/样式资源` });
    }
    if (badHash === 0 && localRefs.length > 0) {
      refLines.push({ status: 'pass', text: `✓ 入口页面引用的 ${localRefs.length} 个本地资源全部带内容哈希` });
    }
    if (missing === 0 && localRefs.length > 0) {
      refLines.push({ status: 'pass', text: '✓ 入口页面引用的资源在产物目录中全部能对上实际文件' });
    }
    // 反向核对：未被入口直接引用的 JS/CSS（动态 import 产物属预期，只给警告）
    const orphans = trackedAssets.filter((a) => !referencedRels.has(a.rel));
    if (orphans.length > 0) {
      for (const a of orphans) {
        refLines.push({
          status: 'warn',
          text: `! ${a.rel} 未被 ${entryRel} 直接引用（若为动态 import 产物则属预期，仍受预算规则约束）`,
        });
      }
    } else {
      refLines.push({
        status: 'pass',
        text: `✓ 产物中的 ${trackedAssets.length} 个 JS/CSS 均被入口页面引用，无孤立哈希资源`,
      });
    }
    for (const ref of externalRefs) {
      refLines.push({ status: 'warn', text: `! 外部引用不做本地核对：${ref.url}` });
    }
  }
  blocks.push({ title: '入口页面哈希引用与产物文件一致性', lines: refLines });

  // ── 汇总输出 ──
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const { lines } of blocks) {
    for (const line of lines) if (line.status) counts[line.status]++;
  }

  const out = [];
  out.push('构建产物检查报告');
  out.push('========================================');
  out.push(`产物目录 : ${distDir}`);
  out.push(`预算文件 : ${budgetPath}`);
  out.push(`生成时间 : ${new Date().toISOString()}`);
  out.push(`压缩方式 : gzip -${compression.gzipLevel} / brotli quality ${compression.brotliQuality}（本地离线计算）`);
  out.push('');
  blocks.forEach(({ title, lines }, index) => {
    out.push(`[${index + 1}/${blocks.length}] ${title}`);
    for (const line of lines) out.push(typeof line === 'string' ? line : line.text);
    out.push('');
  });

  const passed = counts.fail === 0;
  out.push(
    passed
      ? `结论：PASS — ${counts.pass} 项通过，${counts.warn} 项警告，0 项失败`
      : `结论：FAIL — ${counts.fail} 项失败（见上方 ✗），${counts.pass} 项通过，${counts.warn} 项警告`,
  );

  const report = out.join('\n') + '\n';
  process.stdout.write('\n' + report);

  if (opts.writeReport) {
    mkdirSync(join(reportPath, '..'), { recursive: true });
    writeFileSync(reportPath, report, 'utf8');
    process.stdout.write(`报告已写入：${reportPath}\n`);
  }

  process.exit(passed ? 0 : 1);
}

try {
  main();
} catch (err) {
  console.error(`✗ 检查脚本异常：${err.stack ?? err.message}`);
  process.exit(2);
}
