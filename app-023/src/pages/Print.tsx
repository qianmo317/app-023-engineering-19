// 打印视图 /score/:id/print —— A4 横排、可选简谱对照、导出 PNG（PDF 走浏览器打印）
import { useEffect, useMemo, useState } from 'react';
import type { Score } from '../types';
import { getScore } from '../lib/storage';
import { barsPerRow } from '../lib/grid';
import { ScoreGrid } from '../components/ScoreGrid';

const A4_LANDSCAPE_PX = 1047; // 297mm 减页边距 @96dpi

export function Print({ scoreId }: { scoreId: string }) {
  const [score, setScore] = useState<Score | null>(null);
  const [jianpu, setJianpu] = useState(false);

  useEffect(() => {
    getScore(scoreId).then((s) => setScore(s ?? null));
  }, [scoreId]);

  const pxPerTick = useMemo(() => {
    if (!score) return 8;
    const bpb = score.bars[0]?.beatsPerBar ?? 4;
    // 目标：一行最多 16 小节（2/4）；4/4 自然折半。先按 16 小节算，若放不下 4 小节再放宽。
    let n = barsPerRow(A4_LANDSCAPE_PX, bpb, 8);
    if (n > 16) n = 16;
    if (n < 4) n = Math.min(4, score.bars.length);
    const usable = A4_LANDSCAPE_PX - 40;
    const px = Math.floor(usable / (n * bpb * 4 + (n - 1) * 1.2));
    return Math.max(6, Math.min(px, 14));
  }, [score]);

  const barsPerRowVal = useMemo(() => {
    if (!score) return 8;
    const bpb = score.bars[0]?.beatsPerBar ?? 4;
    return barsPerRow(A4_LANDSCAPE_PX, bpb, pxPerTick);
  }, [score, pxPerTick]);

  const exportPng = async () => {
    if (!score) return;
    const svg = document.querySelector<SVGSVGElement>('.score-svg');
    if (!svg) return;
    const ser = new XMLSerializer().serializeToString(svg);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ser);
    const img = new Image();
    await new Promise<void>((r) => {
      img.onload = () => r();
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = svg.width.baseVal.value * 2;
    canvas.height = svg.height.baseVal.value * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${score.title}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  };

  if (!score) return <div className="page dim">加载中…</div>;

  return (
    <div className="print-page" data-testid="print-page">
      <div className="print-toolbar no-print">
        <a className="btn" href={`#/score/${score.id}`}>
          ← 返回编辑
        </a>
        <label className="dim">
          <input type="checkbox" data-testid="chk-jianpu" checked={jianpu} onChange={(e) => setJianpu(e.target.checked)} />
          简谱对照行
        </label>
        <button className="btn primary" data-testid="btn-do-print" onClick={() => window.print()}>
          打印 / 导出 PDF
        </button>
        <button className="btn" data-testid="btn-export-png" onClick={exportPng}>
          导出 PNG
        </button>
        <span className="dim">A4 横向 · 每行 {barsPerRowVal} 小节</span>
      </div>
      <h1 className="print-title">{score.title}</h1>
      <p className="print-sub">
        {score.style ? `${score.style} · ` : ''}
        {score.freeMeter ? '散板（自由时值，宽度为相对表达）' : `${score.bars[0]?.beatsPerBar ?? 4}/4 · ${score.bpm} BPM`}
      </p>
      <div className="print-score" data-testid="print-score">
        <ScoreGrid score={score} pxPerTick={pxPerTick} rowHeight={40} barsPerRow={barsPerRowVal} showJianpu={jianpu} testIdPrefix="print" />
      </div>
      <p className="print-foot no-print dim">打印建议：A4 横向、边距 10mm、勾选「背景图形」。</p>
    </div>
  );
}
