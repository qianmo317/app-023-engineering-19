// 拟音字 ↔ 乐器/技法 反查 —— 录入按键盘字符 → 拟音字 → 反查乐器。
// 同一乐器可有多个拟音字（不同打法），反查表必须能区分同乐器的不同技法，且不串乐器。
import type { AppSettings, Bar, Hit, Instrument, KeyBinding, Tech } from '../types';

export interface GlyphLookup {
  instrumentId: string;
  glyph: string;
  glyphIndex: number;
  tech?: Tech[];
}

/** 字符 → {乐器, 拟音字, 技法} 反查表。冲突（两个乐器用同一个字）抛错，防串乐器。 */
export function buildGlyphMap(instruments: Instrument[]): Map<string, GlyphLookup> {
  const map = new Map<string, GlyphLookup>();
  for (const inst of instruments) {
    inst.glyphs.forEach((g, gi) => {
      if (map.has(g)) {
        throw new Error(`拟音字冲突：「${g}」同时属于 ${map.get(g)!.instrumentId} 与 ${inst.id}`);
      }
      map.set(g, {
        instrumentId: inst.id,
        glyph: g,
        glyphIndex: gi,
        tech: inst.techMap?.[g],
      });
    });
  }
  return map;
}

/** 键盘键位 → 候选 Hit（含技法） */
export function resolveKey(
  key: string,
  settings: AppSettings,
  instruments: Instrument[],
): Hit | null {
  const binding: KeyBinding | undefined = settings.keyMap.find(
    (b) => b.key === key.toLowerCase(),
  );
  if (!binding) return null;
  const inst = instruments.find((i) => i.id === binding.instrumentId);
  if (!inst) return null;
  const glyph = inst.glyphs[binding.glyphIndex];
  if (!glyph) return null;
  const tech = inst.techMap?.[glyph];
  return { instrumentId: inst.id, velocity: 2, glyph, tech: tech ? [...tech] : undefined };
}

/** 拟音字反查（用于导入/校验/显示） */
export function lookupGlyph(
  glyph: string,
  instruments: Instrument[],
): GlyphLookup | null {
  const map = buildGlyphMap(instruments);
  return map.get(glyph) ?? null;
}

/** 校验谱面所有 hit 的拟音字与乐器一致（防串乐器） */
export function validateHitGlyphs(score: { bars: Bar[]; instruments: Instrument[] }): string[] {
  const map = buildGlyphMap(score.instruments);
  const errs: string[] = [];
  score.bars.forEach((bar) =>
    bar.steps.forEach((step, si) =>
      step.hits.forEach((hit, hi) => {
        const lu = hit.glyph ? map.get(hit.glyph) : undefined;
        if (hit.glyph && !lu) errs.push(`小节${bar.index + 1}拍格${si + 1}hit${hi + 1}：未知拟音字「${hit.glyph}」`);
        else if (lu && lu.instrumentId !== hit.instrumentId)
          errs.push(`小节${bar.index + 1}拍格${si + 1}hit${hi + 1}：「${hit.glyph}」属于 ${lu.instrumentId}，不能挂在 ${hit.instrumentId}`);
        else if (!hit.glyph && lu) errs.push('hit 缺 glyph');
      }),
    ),
  );
  return errs;
}

export const TECH_NAMES: Record<Tech, string> = { roll: '滚奏', mute: '闷击', flam: '双打' };
