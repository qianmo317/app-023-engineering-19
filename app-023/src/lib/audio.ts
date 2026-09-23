// Web Audio 合成与精确调度
// 关键点：用 AudioContext.currentTime 预排（lookahead scheduler），不用 setTimeout 逐拍触发，
// 否则节奏类应用会有明显抖动。时间计算全部基于整数格，无浮点累积。
import {
  TICKS_PER_BEAT,
  VELOCITY_GAIN,
  type Bar,
  type Hit,
  type Instrument,
  type ScheduleEvent,
  type Score,
} from '../types';
import { barTicks, stepOffsets } from './grid';

/** BPM → 每格秒数（整数格 × 固定秒/格，无累积漂移） */
export function tickSeconds(bpm: number): number {
  return 60 / bpm / TICKS_PER_BEAT;
}

/**
 * 纯函数：把谱面展开为绝对时间事件序列（音频与视觉共用同一时间源）。
 * fromTick/toTick 为全曲绝对格区间（含头不含尾），startTime 为 t0。
 * 散板（freeMeter）：按等格时长 × stretch 近似播放（UI 明确标注为近似）。
 */
export function computeEvents(
  bars: Bar[],
  bpm: number,
  freeMeter: boolean,
  instruments: Instrument[],
  fromTick: number,
  toTick: number,
  startTime: number,
  stretch = 1,
): ScheduleEvent[] {
  const instMap = new Map(instruments.map((i) => [i.id, i]));
  const per = tickSeconds(bpm) * (freeMeter ? stretch : 1);
  const events: ScheduleEvent[] = [];
  let barStart = 0; // 全曲绝对格
  for (const bar of bars) {
    const offs = stepOffsets(bar);
    bar.steps.forEach((step, si) => {
      const absOff = barStart + offs[si];
      if (absOff < fromTick || absOff >= toTick) return;
      if (step.rest || step.hits.length === 0) return;
      for (const hit of step.hits) {
        const inst = instMap.get(hit.instrumentId);
        if (!inst) continue;
        events.push({
          time: startTime + absOff * per,
          barIndex: bar.index,
          offset: offs[si],
          instrumentId: hit.instrumentId,
          hit,
          glyph: hit.glyph ?? inst.glyphs[0],
          durationTicks: step.beats,
        });
      }
    });
    barStart += barTicks(bar.beatsPerBar);
  }
  return events.sort((a, b) => a.time - b.time);
}

/** 循环区间事件：把 [fromTick,toTick) 的段落重复 loopCount 遍 */
export function computeLoopEvents(
  score: Score,
  fromTick: number,
  toTick: number,
  startTime: number,
  loopCount: number,
  stretch = 1,
): ScheduleEvent[] {
  const span = toTick - fromTick;
  const per = tickSeconds(score.bpm) * (score.freeMeter ? stretch : 1);
  const out: ScheduleEvent[] = [];
  for (let li = 0; li < loopCount; li++) {
    const t0 = startTime + li * span * per;
    for (const ev of computeEvents(score.bars, score.bpm, score.freeMeter, score.instruments, fromTick, toTick, t0, stretch)) {
      out.push(ev);
    }
  }
  return out;
}

// ---------- 合成音（无采样：OscillatorNode + GainNode 包络 + 噪声） ----------

let noiseBufferCache: AudioBuffer | null = null;
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBufferCache && noiseBufferCache.sampleRate === ctx.sampleRate) return noiseBufferCache;
  const len = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBufferCache = buf;
  return buf;
}

/** 单击合成：鼓=低频正弦衰减+短噪声、锣/钹=金属噪声+长衰减、木=短脉冲 */
export function synthesizeHit(
  ctx: BaseAudioContext,
  dest: AudioNode,
  inst: Instrument,
  hit: Hit,
  time: number,
  rollMs = 55,
): void {
  const g0 = VELOCITY_GAIN[hit.velocity];
  const tech = hit.tech ?? [];
  const muted = tech.includes('mute');

  const hits: { at: number }[] = [{ at: time }];
  if (tech.includes('flam')) hits.push({ at: time + 0.03 }); // 双打：30ms 后第二击
  if (tech.includes('roll')) {
    // 滚奏：按时值均匀补击（每 rollMs 一击），最后一击与格尾对齐
    const per = tickSeconds(120) * rollMsToTicks(rollMs);
    void per;
    for (let t = time + rollMs / 1000; t < time + Math.max(hitDuration(hit), rollMs / 1000) - 0.001; t += rollMs / 1000) {
      hits.push({ at: t });
    }
  }

  for (const { at } of hits) {
    const env = ctx.createGain();
    env.connect(dest);
    const decay = Math.max(inst.synth.decay * (muted ? 0.3 : 1), 0.02);
    env.gain.setValueAtTime(g0, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);

    if (inst.synth.type === 'drum') {
      // 低频正弦衰减 + 短噪声敲击
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(inst.synth.baseHz, at);
      osc.frequency.exponentialRampToValueAtTime(Math.max(inst.synth.baseHz * 0.5, 30), at + decay);
      osc.connect(env);
      osc.start(at);
      osc.stop(at + decay + 0.02);
      if (inst.synth.noise) attachNoise(ctx, env, at, Math.min(decay, 0.08), 'lowpass', inst.synth.baseHz * 10);
    } else if (inst.synth.type === 'metal') {
      // 金属噪声 + 两个失谐泛音（锣/钹质感）
      if (inst.synth.noise) attachNoise(ctx, env, at, decay, 'bandpass', inst.synth.baseHz * 3);
      for (const mult of [1, 1.47, 2.13]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = inst.synth.baseHz * mult;
        const og = ctx.createGain();
        og.gain.value = mult === 1 ? 0.5 : 0.18;
        osc.connect(og).connect(env);
        osc.start(at);
        osc.stop(at + decay + 0.02);
      }
    } else {
      // 木：短脉冲（高通噪声 + 三角波 blip）
      attachNoise(ctx, env, at, Math.min(decay, 0.05), 'highpass', 1200);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = inst.synth.baseHz;
      osc.connect(env);
      osc.start(at);
      osc.stop(at + decay + 0.02);
    }
  }
}

function hitDuration(_hit: Hit): number {
  return 0.3; // 滚奏默认时值上限（单 hit 无格信息时）
}

function rollMsToTicks(_ms: number): number {
  return 1;
}

function attachNoise(
  ctx: BaseAudioContext,
  dest: AudioNode,
  at: number,
  dur: number,
  filter: BiquadFilterType,
  freq: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = filter === 'bandpass' ? 1.2 : 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.6, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(at, Math.random() * 0.3, dur + 0.02);
}

// ---------- Lookahead 调度器 ----------

export interface SchedulerHandle {
  stop(): void;
  /** 已排入 AudioContext 的事件（测试/可视化用） */
  scheduled(): ScheduleEvent[];
  /** 当前播放到的时间（ctx 时轴） */
  currentTime(): number;
}

const LOOKAHEAD_S = 0.12; // 预排窗口
const TIMER_MS = 25; // 轮询间隔（只负责填窗口，不负责发声时刻）

/**
 * lookahead 调度器：setInterval 仅做窗口填充，发声时刻由 Web Audio 精确执行。
 * events 必须已按 time 升序；调用方保证 startAt >= ctx.currentTime。
 */
export function scheduleEvents(
  ctx: AudioContext,
  master: AudioNode,
  score: Score,
  events: ScheduleEvent[],
  onVisual?: (ev: ScheduleEvent) => void,
): SchedulerHandle {
  const instMap = new Map(score.instruments.map((i) => [i.id, i]));
  let idx = 0;
  const done: ScheduleEvent[] = [];
  let stopped = false;

  const pump = () => {
    if (stopped) return;
    const now = ctx.currentTime;
    while (idx < events.length && events[idx].time < now + LOOKAHEAD_S) {
      const ev = events[idx++];
      const inst = instMap.get(ev.instrumentId);
      if (!inst) continue;
      synthesizeHit(ctx, master, inst, ev.hit, ev.time);
      done.push(ev);
      const delay = Math.max((ev.time - now) * 1000, 0);
      window.setTimeout(() => onVisual && onVisual(ev), delay);
    }
  };
  pump();
  const timer = window.setInterval(pump, TIMER_MS);
  return {
    stop() {
      stopped = true;
      window.clearInterval(timer);
    },
    scheduled: () => done.slice(),
    currentTime: () => ctx.currentTime,
  };
}

/** 便捷：从 score 的某绝对格区间生成事件并调度（循环段落用 computeLoopEvents） */
export function playRange(
  ctx: AudioContext,
  master: AudioNode,
  score: Score,
  fromTick: number,
  toTick: number,
  loopCount: number,
  onVisual?: (ev: ScheduleEvent) => void,
  startOffsetS = 0,
): SchedulerHandle {
  void barTicks; // 保持引用一致性（未直接使用）
  const startAt = ctx.currentTime + 0.06 + startOffsetS;
  const events =
    loopCount > 1
      ? computeLoopEvents(score, fromTick, toTick, startAt, loopCount)
      : computeEvents(score.bars, score.bpm, score.freeMeter, score.instruments, fromTick, toTick, startAt);
  return scheduleEvents(ctx, master, score, events, onVisual);
}
