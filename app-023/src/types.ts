// 数据模型 —— 与 README §7 保持一致（允许向后兼容扩展字段）

export type Tech = 'roll' | 'mute' | 'flam';
export type SynthType = 'drum' | 'metal' | 'wood';

export interface Synth {
  type: SynthType;
  baseHz: number;
  decay: number; // 秒
  noise: boolean;
}

export interface Instrument {
  id: string;
  name: string;
  glyphs: string[]; // 拟音字，如 ['咚','八']
  synth: Synth;
  /** 同一乐器不同拟音字 → 不同技法（反查表依据），如 { '八': ['flam'] } */
  techMap?: Record<string, Tech[]>;
  color?: string;
}

export interface Hit {
  instrumentId: string;
  velocity: 1 | 2 | 3; // 1=弱(p) 2=中(mf) 3=强(f)
  glyph?: string;
  tech?: Tech[];
}

export interface Step {
  beats: number; // 格数（每拍 4 格）：整拍 4、半拍 2、1/4 拍 1、附点 6、附点半拍 3
  hits: Hit[];
  tie?: boolean; // 与下一步连线（连打）
  rest?: boolean; // 休止
}

export interface Bar {
  index: number;
  beatsPerBar: number; // 每小节拍数（散板仍给默认 4）
  steps: Step[];
  tempoNote?: string; // 渐快/渐慢等文字标记
}

export interface Score {
  id: string;
  title: string;
  style?: string;
  bpm: number;
  bars: Bar[];
  instruments: Instrument[];
  freeMeter: boolean; // 散板
  updatedAt: number;
}

/** 键位绑定：键盘字符 → 某乐器的第几个拟音字 */
export interface KeyBinding {
  key: string; // 小写字母或符号
  instrumentId: string;
  glyphIndex: number;
}

export interface AppSettings {
  keyMap: KeyBinding[];
  durationKeys: Record<string, number>; // 数字键 → 格数
  showHighlight: boolean; // 试听时当前拍高亮（可关闭）
  currentBeatStretch: number; // 散板近似播放伸缩系数
}

/** 一个待调度的事件（音频/视觉共用） */
export interface ScheduleEvent {
  time: number; // AudioContext 时间轴上的绝对秒
  barIndex: number;
  offset: number; // 小节内格偏移
  instrumentId: string;
  hit: Hit;
  glyph: string;
  durationTicks: number;
}

export const TICKS_PER_BEAT = 4;
export const VELOCITY_GAIN: Record<Hit['velocity'], number> = { 1: 0.4, 2: 0.7, 3: 1.0 };
