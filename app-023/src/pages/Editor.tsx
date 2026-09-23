// 编辑器：上=谱面网格 | 下=试听控制台 | 左=乐器与拟音字面板
// 键盘录入：字母=拟音字落字，数字=时值，方向键移动，Space 播放，+/- 调 BPM
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { TICKS_PER_BEAT, type Hit, type Score, type Step, type Tech } from '../types';
import { barTicks, setStepAt, stepAtOffset } from '../lib/grid';
import { resolveKey, TECH_NAMES } from '../lib/glyphs';
import { emptyBar } from '../lib/factory';
import { getScore, saveScore } from '../lib/storage';
import { useAudio } from '../hooks/useAudio';
import { ScoreGrid, type Selection } from '../components/ScoreGrid';
import { Transport } from '../components/Transport';
import { useSettings } from '../settingsContext';
import { DURATIONS } from '../lib/grid';

interface Props {
  scoreId: string;
  onNavigate: (hash: string) => void;
}

export function Editor({ scoreId, onNavigate }: Props) {
  const { s: settings, setShowHighlight } = useSettings();
  const [score, setScore] = useState<Score | null>(null);
  const [selection, setSelection] = useState<Selection>({ bar: 0, tick: 0 });
  const [duration, setDuration] = useState(TICKS_PER_BEAT);
  const [selectedInst, setSelectedInst] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string>('');
  const [err, setErr] = useState<string>('');
  const audio = useAudio(score ?? ({ bars: [] } as unknown as Score));

  useEffect(() => {
    getScore(scoreId).then((s) => {
      if (s) {
        setScore(s);
        setSelectedInst(s.instruments[0]?.id ?? null);
      } else {
        setErr('未找到该曲目');
      }
    });
  }, [scoreId]);

  // 自动保存（防抖）
  const saveTimer = useRef<number>(0);
  useEffect(() => {
    if (!score) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveScore({ ...score, updatedAt: Date.now() }).then(() =>
        setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })),
      );
    }, 400);
    return () => window.clearTimeout(saveTimer.current);
  }, [score]);

  const instId = selectedInst ?? score?.instruments[0]?.id ?? null;

  const patch = useCallback((fn: (s: Score) => Score) => {
    setScore((s) => (s ? fn(s) : s));
  }, []);

  const editBar = useCallback(
    (barIdx: number, fn: (steps: Step[]) => Step[] | null) => {
      patch((s) => {
        const bars = [...s.bars];
        const steps = fn(bars[barIdx].steps);
        if (steps) bars[barIdx] = { ...bars[barIdx], steps };
        return { ...s, bars };
      });
    },
    [patch],
  );

  /** 在 (bar,tick) 放一个 hit（含拆格重建），返回是否成功 */
  const placeHit = useCallback(
    (barIdx: number, tick: number, hit: Hit) => {
      patch((s) => {
        const bar = s.bars[barIdx];
        const si = stepAtOffset(bar, tick);
        if (si < 0) return s;
        const steps =
          bar.steps[si].beats === duration
            ? bar.steps.map((st, i) =>
                i === si
                  ? {
                      ...st,
                      rest: false,
                      hits: [...st.hits.filter((h) => h.instrumentId !== hit.instrumentId), hit],
                    }
                  : st,
              )
            : (setStepAt(bar, tick, { beats: duration, hits: [hit] }) ?? bar.steps);
        return { ...s, bars: s.bars.map((b, i) => (i === barIdx ? { ...b, steps } : b)) };
      });
      advance(tick);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [patch, duration],
  );

  const advance = useCallback(
    (tick: number) => {
      setSelection((sel) => {
        const s = scoreRef.current;
        if (!s) return sel;
        const bt = barTicks(s.bars[sel.bar].beatsPerBar);
        let bar = sel.bar;
        let t = tick + durationRef.current;
        while (t >= bt) {
          t -= bt;
          bar = (bar + 1) % s.bars.length;
        }
        return { bar, tick: t };
      });
    },
    [],
  );
  const scoreRef = useRef<Score | null>(null);
  scoreRef.current = score;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  const toggleRest = useCallback(
    (barIdx: number, tick: number) => {
      editBar(barIdx, (steps) => {
        const si = stepAtOffset({ steps }, tick);
        if (si < 0) return null;
        const st = steps[si];
        if (st.beats === duration) {
          return steps.map((s2, i) => (i === si ? { ...s2, rest: !s2.rest, hits: s2.rest ? s2.hits : [] } : s2));
        }
        return setStepAt(scoreRef.current!.bars[barIdx], tick, { beats: duration, hits: [], rest: true });
      });
    },
    [editBar, duration],
  );

  const toggleTie = useCallback(
    (barIdx: number, tick: number) => {
      editBar(barIdx, (steps) => {
        const si = stepAtOffset({ steps }, tick);
        if (si < 0 || si === steps.length - 1) return null;
        return steps.map((s2, i) => (i === si ? { ...s2, tie: !s2.tie } : s2));
      });
    },
    [editBar],
  );

  const toggleTech = useCallback(
    (barIdx: number, tick: number, tech: Tech) => {
      editBar(barIdx, (steps) => {
        const si = stepAtOffset({ steps }, tick);
        if (si < 0) return null;
        return steps.map((s2, i) =>
          i === si
            ? {
                ...s2,
                hits: s2.hits.map((h) => {
                  const cur = h.tech ?? [];
                  const next = cur.includes(tech) ? cur.filter((t) => t !== tech) : [...cur, tech];
                  return { ...h, tech: next.length ? next : undefined };
                }),
              }
            : s2,
        );
      });
    },
    [editBar],
  );

  const clearStep = useCallback(
    (barIdx: number, tick: number) => {
      editBar(barIdx, (steps) => {
        const si = stepAtOffset({ steps }, tick);
        if (si < 0) return null;
        return steps.map((s2, i) => (i === si ? { ...s2, hits: [], rest: false, tie: false } : s2));
      });
    },
    [editBar],
  );

  // 键盘录入
  const onKey = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!score) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      const k = e.key;
      if (k === ' ') {
        e.preventDefault();
        audio.playing ? audio.stop() : audio.play();
        return;
      }
      if (k === '+' || k === '=') {
        patch((s) => ({ ...s, bpm: Math.min(240, s.bpm + 2) }));
        return;
      }
      if (k === '-' || k === '_') {
        patch((s) => ({ ...s, bpm: Math.max(30, s.bpm - 2) }));
        return;
      }
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
        const bt = barTicks(score.bars[selection.bar].beatsPerBar);
        if (k === 'ArrowLeft') setSelection((s) => ({ ...s, tick: (s.tick - 1 + bt) % bt }));
        else if (k === 'ArrowRight') setSelection((s) => ({ ...s, tick: (s.tick + 1) % bt }));
        else if (k === 'ArrowDown' || k === 'ArrowUp') {
          const idx = score.instruments.findIndex((i) => i.id === instId);
          const dir = k === 'ArrowDown' ? 1 : -1;
          const next = (idx + dir + score.instruments.length) % score.instruments.length;
          setSelectedInst(score.instruments[next].id);
        }
        return;
      }
      if (k === 'Backspace' || k === 'Delete') {
        e.preventDefault();
        clearStep(selection.bar, selection.tick);
        return;
      }
      if (k === '0') {
        toggleRest(selection.bar, selection.tick);
        return;
      }
      if (k === 't' || k === 'T') {
        toggleTie(selection.bar, selection.tick);
        return;
      }
      if (k === 'e' || k === 'E') return toggleTech(selection.bar, selection.tick, 'roll');
      if (k === 'r' || k === 'R') return toggleTech(selection.bar, selection.tick, 'mute');
      if (k === 'y' || k === 'Y') return toggleTech(selection.bar, selection.tick, 'flam');
      const dk = settings.durationKeys[k];
      if (dk) {
        setDuration(dk);
        return;
      }
      const hit = resolveKey(k, settings, score.instruments);
      if (hit) {
        e.preventDefault();
        placeHit(selection.bar, selection.tick, { ...hit, velocity: hit.velocity });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [score, selection, settings, instId, placeHit, toggleRest, toggleTie, toggleTech, clearStep, audio],
  );

  const onCellClick = useCallback(
    (bar: number, tick: number) => {
      setSelection({ bar, tick });
    },
    [],
  );

  const changeBeatsPerBar = useCallback(
    (bpb: number) => {
      patch((s) => {
        const bars = s.bars.map((bar, i) => {
          // 保留原 hit 的绝对位置
          const offsets: number[] = [];
          let acc = 0;
          for (const st of bar.steps) {
            offsets.push(acc);
            acc += st.beats;
          }
          const hitsByTick = new Map<number, Hit[]>();
          bar.steps.forEach((st, si) => {
            if (st.hits.length) hitsByTick.set(offsets[si], st.hits);
          });
          const nb = emptyBar(i, bpb);
          const newOffsets: number[] = [];
          acc = 0;
          for (const st of nb.steps) {
            newOffsets.push(acc);
            acc += st.beats;
          }
          nb.steps = nb.steps.map((st, si) =>
            hitsByTick.has(newOffsets[si]) ? { ...st, hits: hitsByTick.get(newOffsets[si])! } : st,
          );
          return nb;
        });
        return { ...s, bars, freeMeter: bpb === 0 ? s.freeMeter : s.freeMeter };
      });
    },
    [patch],
  );

  const addBars = useCallback(() => {
    patch((s) => {
      const bpb = s.bars[0]?.beatsPerBar ?? 4;
      const bars = [...s.bars];
      for (let i = 0; i < 4; i++) bars.push(emptyBar(bars.length, bpb));
      return { ...s, bars };
    });
  }, [patch]);

  const removeLastBar = useCallback(() => {
    patch((s) => (s.bars.length <= 1 ? s : { ...s, bars: s.bars.slice(0, -1) }));
  }, [patch]);

  const durationLabel = useMemo(
    () => DURATIONS.find((d) => d.ticks === duration)?.name ?? `${duration} 格`,
    [duration],
  );

  if (err) return <div className="page">{err}</div>;
  if (!score) return <div className="page dim">加载中…</div>;

  return (
    <div className="editor-page" data-testid="editor-page" tabIndex={0} onKeyDown={onKey}>
      <header className="editor-header">
        <button className="btn" onClick={() => onNavigate('#/')}>
          ← 曲目
        </button>
        <input
          className="title-input"
          data-testid="score-title"
          value={score.title}
          onChange={(e) => patch((s) => ({ ...s, title: e.target.value }))}
        />
        <input
          className="style-input"
          placeholder="流派/剧种"
          value={score.style ?? ''}
          onChange={(e) => patch((s) => ({ ...s, style: e.target.value }))}
        />
        <label>
          拍号
          <select data-testid="beats-per-bar" value={score.bars[0]?.beatsPerBar ?? 4} onChange={(e) => changeBeatsPerBar(Number(e.target.value))}>
            <option value={2}>2/4</option>
            <option value={3}>3/4</option>
            <option value={4}>4/4</option>
          </select>
        </label>
        <label className="dim">
          <input type="checkbox" data-testid="chk-freemeter" checked={score.freeMeter} onChange={(e) => patch((s) => ({ ...s, freeMeter: e.target.checked }))} />
          散板
        </label>
        <button className="btn" onClick={addBars}>
          +4 小节
        </button>
        <button className="btn" onClick={removeLastBar}>
          −末小节
        </button>
        <button className="btn" data-testid="btn-print" onClick={() => onNavigate(`#/score/${score.id}/print`)}>
          出谱打印
        </button>
        <span className="dim saved-at" data-testid="saved-at">
          {savedAt ? `已保存 ${savedAt}` : ''}
        </span>
      </header>

      <div className="editor-body">
        <aside className="inst-panel" data-testid="inst-panel">
          <h3>乐器</h3>
          {score.instruments.map((inst) => (
            <div
              key={inst.id}
              className={`inst-row ${instId === inst.id ? 'sel' : ''}`}
              data-testid={`inst-${inst.id}`}
              onClick={() => setSelectedInst(inst.id)}
            >
              <span className="inst-name" style={{ color: inst.color }}>
                {inst.name}
              </span>
              <span className="glyphs">
                {inst.glyphs.map((g) => (
                  <span key={g} className="glyph-chip" title={(inst.techMap?.[g] ?? []).map((t) => TECH_NAMES[t]).join(',') || '常规'}>
                    {g}
                  </span>
                ))}
              </span>
              <button
                className={`mini ${audio.soloMute.solo.has(inst.id) ? 'on' : ''}`}
                data-testid={`solo-${inst.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  audio.toggleSolo(inst.id);
                }}
                title="独奏"
              >
                独
              </button>
              <button
                className={`mini ${audio.soloMute.muted.has(inst.id) ? 'on' : ''}`}
                data-testid={`mute-${inst.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  audio.toggleMute(inst.id);
                }}
                title="静音"
              >
                默
              </button>
            </div>
          ))}
          <div className="hint">
            <p>
              <b>录入</b>：字母落字（见设置键位表）；数字 1/2/4/6/8 = 整/半/¼/附点/附点半
            </p>
            <p>0=休止 T=连线 E=滚 R=闷 Y=双打 Backspace=清除</p>
            <p>←→ 移格 ↑↓ 换乐器 Space 播放 +/− 调速</p>
            <p>
              当前时值：<b data-testid="cur-duration">{durationLabel}</b>
            </p>
          </div>
        </aside>

        <main className="score-area">
          <div className="duration-bar" data-testid="duration-bar">
            {DURATIONS.map((d) => (
              <button
                key={d.ticks}
                className={`btn-sm ${duration === d.ticks ? 'on' : ''}`}
                data-testid={`dur-${d.ticks}`}
                onClick={() => setDuration(d.ticks)}
              >
                {d.abbr} {d.name}
              </button>
            ))}
            <button className="btn-sm" data-testid="btn-rest" onClick={() => toggleRest(selection.bar, selection.tick)}>
              休止(0)
            </button>
            <button className="btn-sm" data-testid="btn-tie" onClick={() => toggleTie(selection.bar, selection.tick)}>
              连线(T)
            </button>
            <button className="btn-sm" data-testid="btn-tech-roll" onClick={() => toggleTech(selection.bar, selection.tick, 'roll')}>
              滚(E)
            </button>
            <button className="btn-sm" data-testid="btn-tech-mute" onClick={() => toggleTech(selection.bar, selection.tick, 'mute')}>
              闷(R)
            </button>
            <button className="btn-sm" data-testid="btn-tech-flam" onClick={() => toggleTech(selection.bar, selection.tick, 'flam')}>
              双(Y)
            </button>
          </div>
          <div className="score-scroll" data-testid="score-scroll">
            <ScoreGrid
              score={score}
              pxPerTick={14}
              barsPerRow={8}
              selection={selection}
              highlight={audio.playing && settings.showHighlight ? audio.position : null}
              selectedInstrument={instId}
              onCellClick={onCellClick}
            />
          </div>
        </main>
      </div>

      <Transport
        score={score}
        playing={audio.playing}
        bpm={score.bpm}
        onBpmChange={(bpm) => patch((s) => ({ ...s, bpm }))}
        onPlay={() => audio.play()}
        onStop={audio.stop}
        loop={audio.loop}
        onSetLoop={audio.setLoop}
        selectionBar={selection.bar}
        showHighlight={settings.showHighlight}
        onToggleHighlight={() => setShowHighlight(!settings.showHighlight)}
        position={audio.position}
      />
    </div>
  );
}
