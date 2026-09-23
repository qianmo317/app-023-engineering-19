// 工厂：默认数据 → 可编辑对象
import instrumentsData from '../data/instruments.json';
import patternsData from '../data/patterns.json';
import { TICKS_PER_BEAT, type AppSettings, type Bar, type Instrument, type Score, type Step } from '../types';
import { barTicks } from './grid';
import { lookupGlyph } from './glyphs';
import { newId } from './storage';

export const DEFAULT_INSTRUMENTS: Instrument[] = instrumentsData.instruments as unknown as Instrument[];

export function defaultSettings(): AppSettings {
  return {
    keyMap: instrumentsData.keyMap as AppSettings['keyMap'],
    durationKeys: instrumentsData.durationKeys,
    showHighlight: true,
    currentBeatStretch: 1,
  };
}

export interface PatternDef {
  id: string;
  name: string;
  style: string;
  bpm: number;
  beatsPerBar: number;
  desc: string;
  bars: [string[], number][];
}

export const PATTERNS: PatternDef[] = patternsData.patterns as unknown as PatternDef[];

/** 空小节：整小节用「整拍空 step」铺满 */
export function emptyBar(index: number, beatsPerBar: number): Bar {
  const steps: Step[] = [];
  for (let i = 0; i < beatsPerBar; i++) steps.push({ beats: TICKS_PER_BEAT, hits: [] });
  return { index, beatsPerBar, steps };
}

function stepFromGlyphs(glyphs: string[], ticks: number, instruments: Instrument[]): Step {
  const hits = glyphs.map((g) => {
    const lu = lookupGlyph(g, instruments);
    if (!lu) throw new Error(`曲牌含未知拟音字：${g}`);
    return { instrumentId: lu.instrumentId, velocity: 2 as const, glyph: g, tech: lu.tech ? [...lu.tech] : undefined };
  });
  return { beats: ticks, hits };
}

/** 曲牌骨架 → 完整 Score（一键载入再改）。跨小节条目自动切分（tie 连打），末尾补休止。 */
export function scoreFromPattern(p: PatternDef, instruments: Instrument[] = DEFAULT_INSTRUMENTS): Score {
  const barT = barTicks(p.beatsPerBar);
  const bars: Bar[] = [{ index: 0, beatsPerBar: p.beatsPerBar, steps: [] }];
  let acc = 0;
  const pushStep = (step: Step) => {
    let cur = bars[bars.length - 1];
    let s = step;
    if (acc + s.beats > barT) {
      const remain = barT - acc;
      if (remain > 0) {
        cur.steps.push({ ...s, beats: remain, tie: true }); // 跨小节延续：前段连线
        s = { ...s, beats: s.beats - remain, hits: [] };
      }
      cur = { index: bars.length, beatsPerBar: p.beatsPerBar, steps: [] };
      bars.push(cur);
      acc = 0;
    }
    cur.steps.push(s);
    acc += s.beats;
    if (acc === barT) {
      bars.push({ index: bars.length, beatsPerBar: p.beatsPerBar, steps: [] });
      acc = 0;
    }
  };
  for (const [glyphs, ticks] of p.bars) pushStep(stepFromGlyphs(glyphs, ticks, instruments));
  if (acc > 0) bars[bars.length - 1].steps.push({ beats: barT - acc, hits: [], rest: true });
  else if (bars.length > 1 && bars[bars.length - 1].steps.length === 0) bars.pop();
  bars.forEach((b, i) => (b.index = i));
  return {
    id: newId(),
    title: p.name,
    style: p.style,
    bpm: p.bpm,
    bars,
    instruments,
    freeMeter: false,
    updatedAt: Date.now(),
  };
}

export function newEmptyScore(title: string, beatsPerBar = 4, barCount = 4, instruments = DEFAULT_INSTRUMENTS): Score {
  const bars: Bar[] = Array.from({ length: barCount }, (_, i) => emptyBar(i, beatsPerBar));
  return {
    id: newId(),
    title: title || '未命名锣鼓段',
    bpm: 100,
    bars,
    instruments,
    freeMeter: false,
    updatedAt: Date.now(),
  };
}
