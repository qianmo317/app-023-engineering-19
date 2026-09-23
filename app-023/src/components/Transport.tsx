// 试听控制台：播放/停止、BPM 调节、段落循环、当前拍高亮开关、位置显示
import type { Score } from '../types';

interface Props {
  score: Score;
  playing: boolean;
  bpm: number;
  onBpmChange: (bpm: number) => void;
  onPlay: () => void;
  onStop: () => void;
  loop: { fromBar: number; toBar: number } | null;
  onSetLoop: (loop: { fromBar: number; toBar: number } | null) => void;
  selectionBar: number;
  showHighlight: boolean;
  onToggleHighlight: () => void;
  position: { bar: number; tick: number } | null;
}

export function Transport({
  score,
  playing,
  bpm,
  onBpmChange,
  onPlay,
  onStop,
  loop,
  onSetLoop,
  selectionBar,
  showHighlight,
  onToggleHighlight,
  position,
}: Props) {
  return (
    <div className="transport" data-testid="transport">
      <button
        className="btn primary"
        data-testid="btn-play"
        onClick={() => (playing ? onStop() : onPlay())}
        title="播放/停止 (Space)"
      >
        {playing ? '■ 停止' : '▶ 播放'}
      </button>
      <div className="bpm-box">
        <button data-testid="bpm-down" onClick={() => onBpmChange(Math.max(30, bpm - 2))} title="BPM-">
          −
        </button>
        <span data-testid="bpm-value">{bpm}</span>
        <span className="dim">BPM</span>
        <button data-testid="bpm-up" onClick={() => onBpmChange(Math.min(240, bpm + 2))} title="BPM+">
          +
        </button>
      </div>
      <div className="loop-box">
        {loop ? (
          <>
            <span className="dim">
              循环 {loop.fromBar + 1}–{loop.toBar + 1} 小节
            </span>
            <button data-testid="btn-loop-clear" onClick={() => onSetLoop(null)}>
              取消循环
            </button>
          </>
        ) : (
          <>
            <button data-testid="btn-loop-set" onClick={() => onSetLoop({ fromBar: selectionBar, toBar: Math.min(selectionBar + 3, score.bars.length - 1) })}>
              循环选中起 4 小节
            </button>
          </>
        )}
      </div>
      <label className="dim">
        <input type="checkbox" data-testid="chk-highlight" checked={showHighlight} onChange={onToggleHighlight} />
        当前拍高亮
      </label>
      <span className="pos dim" data-testid="pos-display">
        {position ? `第 ${position.bar + 1} 小节` : '—'}
      </span>
      {score.freeMeter && <span className="free-note">散板：按等格近似播放，可于设置调整伸缩</span>}
    </div>
  );
}
