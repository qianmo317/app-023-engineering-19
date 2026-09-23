// 谱面网格换算 —— 最小时间单位为「格」，每拍 4 格。
// 一律用整数格存谱，绝不用浮点时间（避免渲染/打印 1px 抖动与累积误差）。
import { TICKS_PER_BEAT, type Bar, type Score, type Step } from '../types';

/** 常用时值 → 格数 */
export const DURATIONS: { name: string; ticks: number; abbr: string }[] = [
  { name: '整拍', ticks: 4, abbr: '1' },
  { name: '半拍', ticks: 2, abbr: '½' },
  { name: '1/4拍', ticks: 1, abbr: '¼' },
  { name: '附点(1.5拍)', ticks: 6, abbr: '1·' },
  { name: '附点半拍(¾拍)', ticks: 3, abbr: '½·' },
];

/** 小节总格数 */
export function barTicks(beatsPerBar: number): number {
  return beatsPerBar * TICKS_PER_BEAT;
}

/** 校验小节内所有 step 的 beats 之和恰好铺满整小节 */
export function isBarFull(bar: Pick<Bar, 'steps' | 'beatsPerBar'>): boolean {
  return bar.steps.reduce((s, st) => s + st.beats, 0) === barTicks(bar.beatsPerBar);
}

/** 计算每个 step 在小节内的起始格偏移（假定 isBarFull） */
export function stepOffsets(bar: Pick<Bar, 'steps'>): number[] {
  const offsets: number[] = [];
  let acc = 0;
  for (const st of bar.steps) {
    offsets.push(acc);
    acc += st.beats;
  }
  return offsets;
}

/** 某格偏移所在 step 的下标；格空隙（不允许）返回 -1 */
export function stepAtOffset(bar: Pick<Bar, 'steps'>, offset: number): number {
  const offsets = stepOffsets(bar);
  for (let i = 0; i < bar.steps.length; i++) {
    if (offset >= offsets[i] && offset < offsets[i] + bar.steps[i].beats) return i;
  }
  return -1;
}

/** 一行乐器的时值线起点/长度（px），用于谱面与打印共用 —— 保证宽度一致 */
export function durationLine(
  step: Step,
  offset: number,
  pxPerTick: number,
): { x: number; w: number } {
  const x = offset * pxPerTick;
  const w = Math.max(step.beats * pxPerTick - 2, 2); // 留 2px 间隙
  return { x, w };
}

/** 连线（tie）延伸：向后连接后续连续 tie 的 step，返回总宽 */
export function tieLine(
  bar: Pick<Bar, 'steps'>,
  stepIndex: number,
  pxPerTick: number,
): { x: number; w: number } {
  const offsets = stepOffsets(bar);
  let start = offsets[stepIndex];
  let w = bar.steps[stepIndex].beats;
  let i = stepIndex;
  while (bar.steps[i].tie && i + 1 < bar.steps.length) {
    i += 1;
    w += bar.steps[i].beats;
  }
  return { x: start * pxPerTick, w: Math.max(w * pxPerTick - 2, 2) };
}

/** 谱面（含打印）一行总宽：小节宽 = beatsPerBar*TICKS*pxPerTick，含小节线 */
export function scoreWidthPx(bars: Bar[], pxPerTick: number, barGap = 8): number {
  if (bars.length === 0) return 0;
  const last = bars[bars.length - 1];
  return (barTicks(last.beatsPerBar) * pxPerTick) * bars.length + barGap * (bars.length - 1) + 2;
}

/** 一行放下的最大小节数（A4 横排 16 小节/行用） */
export function barsPerRow(pageWidthPx: number, beatsPerBar: number, pxPerTick: number, barGap = 8): number {
  const barW = barTicks(beatsPerBar) * pxPerTick;
  return Math.max(1, Math.floor((pageWidthPx - 40) / (barW + barGap)));
}

/** 全曲拍总数（散板时为相对格数） */
export function totalTicks(bars: Bar[]): number {
  return bars.reduce((s, b) => s + barTicks(b.beatsPerBar), 0);
}

/** 全曲 step 展开为绝对格位置 */
export function absoluteOffsets(bars: Bar[]): { barIndex: number; stepIndex: number; absOffset: number; step: Step }[] {
  const out: { barIndex: number; stepIndex: number; absOffset: number; step: Step }[] = [];
  let abs = 0;
  for (const bar of bars) {
    const offsets = stepOffsets(bar);
    bar.steps.forEach((step, i) => {
      out.push({ barIndex: bar.index, stepIndex: i, absOffset: abs + offsets[i], step });
    });
    abs += barTicks(bar.beatsPerBar);
  }
  return out;
}

/** 把新 step 插入：在 offset 处替换/合并，保持小节铺满。返回新 steps；失败返回 null */
export function setStepAt(
  bar: Pick<Bar, 'steps' | 'beatsPerBar'>,
  offset: number,
  step: Step,
): Step[] | null {
  const total = barTicks(bar.beatsPerBar);
  const offsets = stepOffsets(bar);
  if (offset < 0 || offset >= total) return null;
  const si = stepAtOffset(bar, offset);
  if (si < 0) return null;
  const old = bar.steps[si];
  const localOffset = offset - offsets[si];
  const next = [...bar.steps];
  if (localOffset === 0 && old.beats === step.beats) {
    next[si] = step; // 等长替换：只改 hits/tech
    return next;
  }
  // 不等长：拆开重建该格
  const rebuilt: Step[] = [];
  let acc = 0;
  bar.steps.forEach((st, i) => {
    if (i === si) {
      if (localOffset > 0) {
        rebuilt.push({ ...st, hits: [], tie: false, beats: localOffset });
        acc += localOffset;
      }
      rebuilt.push(step);
      acc += step.beats;
      const after = st.beats - localOffset - step.beats;
      if (after > 0) {
        rebuilt.push({ ...st, hits: [], tie: false, beats: after });
        acc += after;
      }
    } else {
      rebuilt.push(st);
      acc += st.beats;
    }
  });
  if (acc !== total) return null;
  return rebuilt;
}

/** 全曲是否结构有效（每小节铺满、格数为正整数） */
export function validateScore(score: Score): string[] {
  const errs: string[] = [];
  score.bars.forEach((bar) => {
    if (bar.steps.some((s) => !Number.isInteger(s.beats) || s.beats <= 0)) {
      errs.push(`第 ${bar.index + 1} 小节存在非法格数`);
    }
    if (!isBarFull(bar)) errs.push(`第 ${bar.index + 1} 小节时值不完整`);
  });
  return errs;
}
