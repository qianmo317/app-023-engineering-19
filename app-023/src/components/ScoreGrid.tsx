// 谱面 = SVG 二维网格（时间 × 乐器）
// 每拍一列、每行一乐器；同拍多乐器在同一列垂直对齐 → 一眼看出齐奏。
// 汉字下方画时值线（横线长度=时值，tie 连打则跨步延伸）——符合锣鼓经书写习惯。
import { useMemo } from 'react';
import { TICKS_PER_BEAT, type Instrument, type Score } from '../types';
import { barTicks, stepOffsets, tieLine } from '../lib/grid';
import { TECH_NAMES } from '../lib/glyphs';

export interface Selection {
  bar: number;
  tick: number;
}

interface Props {
  score: Score;
  pxPerTick: number;
  rowHeight?: number;
  barGap?: number;
  barsPerRow?: number;
  selection?: Selection | null;
  highlight?: Selection | null;
  selectedInstrument?: string | null;
  showJianpu?: boolean;
  showBeatHighlightBg?: boolean;
  onCellClick?: (bar: number, tick: number) => void;
  testIdPrefix?: string;
}

const FONT_STACK = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif";

export function ScoreGrid({
  score,
  pxPerTick,
  rowHeight = 46,
  barGap = 10,
  barsPerRow = 8,
  selection = null,
  highlight = null,
  selectedInstrument = null,
  showJianpu = false,
  showBeatHighlightBg = true,
  onCellClick,
  testIdPrefix = 'grid',
}: Props) {
  const instruments: Instrument[] = score.instruments;
  const rows = instruments.length;
  const jianpuH = showJianpu ? 26 : 0;
  const labelW = 64; // 左侧行标（乐器名）
  const barNumH = 16;
  const sysH = barNumH + rows * rowHeight + 14 + jianpuH; // 一行小节(系统)高度
  const gridTop = barNumH;

  // 布局：小节分行（每行 barsPerRow 个）
  const layout = useMemo(() => {
    const out: { barIndex: number; x: number; y: number; w: number }[] = [];
    let row = 0;
    let col = 0;
    score.bars.forEach((bar, bi) => {
      const w = barTicks(bar.beatsPerBar) * pxPerTick;
      if (col >= barsPerRow) {
        row += 1;
        col = 0;
      }
      out.push({ barIndex: bi, x: col * (w + barGap), y: row * sysH, w });
      col += 1;
    });
    return out;
  }, [score.bars, pxPerTick, barGap, barsPerRow, sysH]);

  const totalW = Math.max(...layout.map((l) => l.x + l.w), 100);
  const totalRows = layout.length ? layout[layout.length - 1].y / sysH + 1 : 1;
  const totalH = totalRows * sysH;

  const cell = (bar: number, tick: number) =>
    onCellClick ? () => onCellClick(bar, tick) : undefined;

  return (
    <svg
      data-testid={testIdPrefix}
      xmlns="http://www.w3.org/2000/svg"
      width={totalW + labelW}
      height={totalH}
      viewBox={`0 0 ${totalW + labelW} ${totalH}`}
      className="score-svg"
      fontFamily={FONT_STACK}
      data-bars={score.bars.length}
    >
      {layout.map(({ barIndex, x, y, w }) => {
        const bar = score.bars[barIndex];
        const offsets = stepOffsets(bar);
        const gx = x + labelW;
        const selHere = selection?.bar === barIndex ? selection : null;
        const hiHere = highlight?.bar === barIndex ? highlight : null;
        return (
          <g key={barIndex} data-testid={`${testIdPrefix}-bar-${barIndex}`}>
            {/* 小节号 */}
            <text x={gx} y={y + 12} fontSize={12} fill="#666">
              {barIndex + 1}
              {bar.tempoNote ? `（${bar.tempoNote}）` : ''}
            </text>
            {/* 每行乐器 */}
            {instruments.map((inst, r) => {
              const rowY = y + gridTop + r * rowHeight;
              const isSelRow = selectedInstrument === inst.id;
              return (
                <g key={inst.id} data-testid={`${testIdPrefix}-row-${inst.id}`}>
                  <text
                    x={x}
                    y={rowY + rowHeight / 2 + 5}
                    fontSize={14}
                    fill={isSelRow ? '#b30000' : '#333'}
                    fontWeight={isSelRow ? 700 : 400}
                  >
                    {inst.name}
                  </text>
                  {/* 行底色 */}
                  <rect
                    x={gx}
                    y={rowY}
                    width={w}
                    height={rowHeight}
                    fill={isSelRow ? '#fff7f2' : (r % 2 === 0 ? '#ffffff' : '#fafafa')}
                  />
                  {/* 步骤：字 + 时值线 */}
                  {bar.steps.map((step, si) => {
                    if (step.rest || step.hits.length === 0) {
                      const ox = gx + offsets[si] * pxPerTick;
                      const ow = step.beats * pxPerTick;
                      return (
                        <g key={si}>
                          {step.rest && (
                            <text
                              x={ox + ow / 2}
                              y={rowY + rowHeight / 2 + 6}
                              fontSize={15}
                              fill="#bbb"
                              textAnchor="middle"
                            >
                              0
                            </text>
                          )}
                          <line
                            x1={ox + 1}
                            y1={rowY + rowHeight - 8}
                            x2={ox + ow - 1}
                            y2={rowY + rowHeight - 8}
                            stroke="#ddd"
                            strokeWidth={1.5}
                          />
                        </g>
                      );
                    }
                    const hitForThisRow = step.hits.find((h) => h.instrumentId === inst.id);
                    if (!hitForThisRow) return null;
                    const cx = gx + offsets[si] * pxPerTick + (step.beats * pxPerTick) / 2;
                    const glyph = hitForThisRow.glyph ?? inst.glyphs[0];
                    const techs = hitForThisRow.tech ?? [];
                    const line = step.tie
                      ? tieLine(bar, si, pxPerTick)
                      : { x: gx + offsets[si] * pxPerTick + 1, w: Math.max(step.beats * pxPerTick - 2, 2) };
                    return (
                      <g key={si} data-testid={`${testIdPrefix}-glyph-${barIndex}-${offsets[si]}-${inst.id}`}>
                        <text
                          x={cx}
                          y={rowY + rowHeight / 2 - 2}
                          fontSize={Math.min(pxPerTick * 2.1, 30)}
                          textAnchor="middle"
                          fill={inst.color ?? '#111'}
                          fontWeight={600}
                        >
                          {glyph}
                        </text>
                        {techs.length > 0 && (
                          <text x={cx} y={rowY + 11} fontSize={9} textAnchor="middle" fill="#c96a00">
                            {techs.map((t) => TECH_NAMES[t]).join('')}
                          </text>
                        )}
                        {/* 力度点：强=实心大点 弱=空心小点 */}
                        <circle
                          cx={cx + step.beats * pxPerTick / 2 - 5}
                          cy={rowY + rowHeight / 2 - 8}
                          r={hitForThisRow.velocity === 3 ? 3 : 2}
                          fill={hitForThisRow.velocity === 1 ? 'none' : '#333'}
                          stroke="#333"
                          strokeWidth={1}
                        />
                        {/* 时值线（长度=时值；tie 跨步连打） */}
                        <line
                          x1={line.x}
                          y1={rowY + rowHeight - 8}
                          x2={line.x + line.w}
                          y2={rowY + rowHeight - 8}
                          stroke="#b30000"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                        />
                        {step.tie && (
                          <path
                            d={`M ${line.x + line.w} ${rowY + rowHeight - 12} q 4 -5 8 0`}
                            fill="none"
                            stroke="#b30000"
                            strokeWidth={1.2}
                          />
                        )}
                      </g>
                    );
                  })}
                </g>
              );
            })}
            {/* 简谱对照行 */}
            {showJianpu && (
              <g data-testid={`${testIdPrefix}-jianpu-${barIndex}`}>
                {bar.steps.map((step, si) => {
                  const ox = gx + offsets[si] * pxPerTick;
                  const ow = step.beats * pxPerTick;
                  return (
                    <g key={si}>
                      <text
                        x={ox + ow / 2}
                        y={y + gridTop + rows * rowHeight + 16}
                        fontSize={11}
                        textAnchor="middle"
                        fill="#444"
                      >
                        {step.rest || step.hits.length === 0 ? '0' : 'x'}
                      </text>
                      {[1, 2, 3].map((k) =>
                        step.beats >= k + 1 ? (
                          <line
                            key={k}
                            x1={ox + ow / 2 - 5}
                            y1={y + gridTop + rows * rowHeight + 19 + k * 2.5}
                            x2={ox + ow / 2 + 5}
                            y2={y + gridTop + rows * rowHeight + 19 + k * 2.5}
                            stroke="#444"
                            strokeWidth={0.8}
                          />
                        ) : null,
                      )}
                    </g>
                  );
                })}
              </g>
            )}
            {/* 拍线（灰）与格线（浅灰） */}
            {Array.from({ length: barTicks(bar.beatsPerBar) + 1 }, (_, t) => {
              const lx = gx + t * pxPerTick;
              const isBeat = t % TICKS_PER_BEAT === 0;
              const isBar = t === barTicks(bar.beatsPerBar);
              return (
                <line
                  key={t}
                  x1={lx}
                  y1={y + gridTop}
                  x2={lx}
                  y2={y + gridTop + rows * rowHeight}
                  stroke={isBar ? '#c0392b' : isBeat ? '#c9c9c9' : '#eee'}
                  strokeWidth={isBar ? 2 : isBeat ? 1 : 0.5}
                />
              );
            })}
            {/* 外框 */}
            <rect
              x={gx}
              y={y + gridTop}
              width={w}
              height={rows * rowHeight}
              fill="none"
              stroke="#c0392b"
              strokeWidth={1.5}
            />
            {/* 播放高亮列（当前拍，可关） */}
            {showBeatHighlightBg && hiHere && (
              <rect
                x={gx + Math.floor(hiHere.tick / TICKS_PER_BEAT) * TICKS_PER_BEAT * pxPerTick}
                y={y + gridTop}
                width={TICKS_PER_BEAT * pxPerTick}
                height={rows * rowHeight}
                fill="#ffe9a8"
                opacity={0.55}
                data-testid={`${testIdPrefix}-highlight`}
              />
            )}
            {/* 选中光标列 */}
            {selHere && (
              <rect
                x={gx + selHere.tick * pxPerTick}
                y={y + gridTop}
                width={pxPerTick}
                height={rows * rowHeight}
                fill="rgba(179,0,0,0.14)"
                stroke="#b30000"
                strokeWidth={1}
                data-testid={`${testIdPrefix}-cursor`}
              />
            )}
            {/* 点击热区（每格） */}
            {onCellClick &&
              Array.from({ length: barTicks(bar.beatsPerBar) }, (_, t) => (
                <rect
                  key={t}
                  x={gx + t * pxPerTick}
                  y={y + gridTop}
                  width={pxPerTick}
                  height={rows * rowHeight}
                  fill="transparent"
                  data-testid={`${testIdPrefix}-cell-${barIndex}-${t}`}
                  onClick={cell(barIndex, t)}
                  style={{ cursor: 'pointer' }}
                />
              ))}
          </g>
        );
      })}
    </svg>
  );
}
