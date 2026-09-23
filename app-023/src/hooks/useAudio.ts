// 播放状态集中管理：AudioContext / 调度 / 循环 / 高亮位置 / 独奏静音
// UI 组件只负责显示与用户动作（保持状态逻辑集中在此 hook）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleEvent, Score } from '../types';
import { barTicks, totalTicks } from '../lib/grid';
import { playRange, tickSeconds, type SchedulerHandle } from '../lib/audio';

export interface SoloMute {
  solo: Set<string>;
  muted: Set<string>;
}

export function useAudio(score: Score) {
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const handleRef = useRef<SchedulerHandle | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState<{ bar: number; tick: number } | null>(null);
  const [loop, setLoop] = useState<{ fromBar: number; toBar: number } | null>(null); // toBar 含
  const [soloMute, setSoloMute] = useState<SoloMute>({ solo: new Set(), muted: new Set() });
  const [debugEvents, setDebugEvents] = useState<ScheduleEvent[]>([]);
  const scoreRef = useRef(score);
  scoreRef.current = score;
  const soloMuteRef = useRef(soloMute);
  soloMuteRef.current = soloMute;

  const ensureCtx = useCallback((): { ctx: AudioContext; master: GainNode } => {
    if (!ctxRef.current) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
      ctxRef.current = ctx;
      masterRef.current = master;
      (window as unknown as { __audioCtx?: AudioContext }).__audioCtx = ctx;
    }
    return { ctx: ctxRef.current, master: masterRef.current! };
  }, []);

  const audible = useCallback((ev: ScheduleEvent): boolean => {
    const { solo, muted } = soloMuteRef.current;
    if (solo.size > 0) return solo.has(ev.instrumentId);
    return !muted.has(ev.instrumentId);
  }, []);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setPlaying(false);
    setPosition(null);
    setDebugEvents([]);
  }, []);

  const play = useCallback(
    (fromBar?: number) => {
      handleRef.current?.stop();
      const { ctx, master } = ensureCtx();
      // 等待上下文真正运行后再排程：suspended 时 currentTime 冻结，预排会挤在 0 附近
      ctx
        .resume()
        .catch(() => undefined)
        .then(() => {
          const s = scoreRef.current;
          const total = totalTicks(s.bars);
          let fromTick = 0;
          let toTick = total;
          if (loop) {
            fromTick = loop.fromBar > 0 ? s.bars.slice(0, loop.fromBar).reduce((a, b) => a + barTicks(b.beatsPerBar), 0) : 0;
            const toBarIdx = Math.min(loop.toBar + 1, s.bars.length);
            toTick = s.bars.slice(0, toBarIdx).reduce((a, b) => a + barTicks(b.beatsPerBar), 0);
          }
          if (fromBar != null && fromBar > 0) fromTick = s.bars.slice(0, fromBar).reduce((a, b) => a + barTicks(b.beatsPerBar), 0);
          if (toTick <= fromTick) return;

          const visual = (ev: ScheduleEvent) => {
            if (!audible(ev)) return;
            const s2 = scoreRef.current;
            const before = s2.bars.slice(0, ev.barIndex).reduce((a, b) => a + barTicks(b.beatsPerBar), 0);
            setPosition({ bar: ev.barIndex, tick: before });
          };
          const handle = playRange(ctx, master, s, fromTick, toTick, 1, visual);
          handleRef.current = handle;
          setPlaying(true);
          const durS = (toTick - fromTick) * tickSeconds(s.bpm) + 0.25;
          window.setTimeout(() => {
            if (handleRef.current === handle) {
              if (loop) {
                play();
              } else {
                stop();
              }
            }
          }, durS * 1000);
          // 调试钩子：E2E 用它断言调度精度
          (window as unknown as { __scheduled?: () => ScheduleEvent[] }).__scheduled = () => handle.scheduled();
        });
    },
    [ensureCtx, loop, audible, stop],
  );

  const toggleSolo = useCallback((id: string) => {
    setSoloMute((sm) => {
      const solo = new Set(sm.solo);
      const muted = new Set(sm.muted);
      if (solo.has(id)) solo.delete(id);
      else {
        solo.add(id);
        muted.delete(id);
      }
      return { solo, muted };
    });
  }, []);

  const toggleMute = useCallback((id: string) => {
    setSoloMute((sm) => {
      const solo = new Set(sm.solo);
      const muted = new Set(sm.muted);
      if (muted.has(id)) muted.delete(id);
      else {
        muted.add(id);
        solo.delete(id);
      }
      return { solo, muted };
    });
  }, []);

  useEffect(() => () => handleRef.current?.stop(), []);

  // 独奏/静音即时生效：重触发当前区间播放
  const restartIfPlaying = useMemo(
    () => (playingRef: boolean) => {
      if (playingRef) play();
    },
    [play],
  );

  return {
    playing,
    position,
    loop,
    setLoop,
    play,
    stop,
    soloMute,
    toggleSolo,
    toggleMute,
    debugEvents,
    restartIfPlaying,
    ensureCtx,
  };
}
