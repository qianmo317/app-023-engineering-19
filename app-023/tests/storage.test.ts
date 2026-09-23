// 持久化用例 —— IndexedDB 读写往返（fake-indexeddb）
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteScore, getScore, listScores, loadSettings, saveScore, saveSettings } from '../src/lib/storage';
import { scoreFromPattern, PATTERNS, defaultSettings } from '../src/lib/factory';

beforeEach(async () => {
  // 清空所有库
  const dbs = await indexedDB.databases();
  for (const d of dbs) {
    if (d.name) indexedDB.deleteDatabase(d.name);
  }
});

describe('曲目 CRUD', () => {
  it('保存后能读回且内容一致（刷新不丢）', async () => {
    const score = scoreFromPattern(PATTERNS[0]);
    await saveScore(score);
    const got = await getScore(score.id);
    expect(got).toBeDefined();
    expect(got!.title).toBe(score.title);
    expect(got!.bars.length).toBe(score.bars.length);
    expect(JSON.stringify(got!.bars)).toBe(JSON.stringify(score.bars));
  });

  it('列表按更新时间倒序', async () => {
    const a = scoreFromPattern(PATTERNS[0]);
    await saveScore(a);
    await new Promise((r) => setTimeout(r, 20));
    const b = scoreFromPattern(PATTERNS[1]);
    await saveScore(b);
    const list = await listScores();
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it('删除后读不到', async () => {
    const score = scoreFromPattern(PATTERNS[2]);
    await saveScore(score);
    await deleteScore(score.id);
    expect(await getScore(score.id)).toBeUndefined();
  });

  it('覆盖保存即更新', async () => {
    const score = scoreFromPattern(PATTERNS[0]);
    await saveScore(score);
    score.title = '改名';
    score.bpm = 140;
    await saveScore(score);
    const got = await getScore(score.id);
    expect(got!.title).toBe('改名');
    expect(got!.bpm).toBe(140);
  });
});

describe('设置持久化', () => {
  it('默认设置可保存读回', async () => {
    await saveSettings(defaultSettings());
    const got = await loadSettings();
    expect(got).toBeDefined();
    expect(got!.keyMap.length).toBeGreaterThan(0);
    expect(got!.durationKeys['1']).toBe(4);
  });
});
