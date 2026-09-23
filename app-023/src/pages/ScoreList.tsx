// 曲目列表 /
import { useEffect, useState } from 'react';
import type { Score } from '../types';
import { deleteScore, listScores, saveScore } from '../lib/storage';
import { newEmptyScore, PATTERNS } from '../lib/factory';

export function ScoreList() {
  const [scores, setScores] = useState<Score[]>([]);
  const [title, setTitle] = useState('');
  const [bpb, setBpb] = useState(4);
  const [free, setFree] = useState(false);

  const refresh = () => listScores().then(setScores);
  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    const s = newEmptyScore(title.trim() || '未命名锣鼓段', bpb, 4);
    if (free) s.freeMeter = true;
    await saveScore(s);
    setTitle('');
    window.location.hash = `#/score/${s.id}`;
  };

  return (
    <div className="page" data-testid="score-list">
      <h1>曲目</h1>
      <div className="create-box">
        <input data-testid="new-title" placeholder="曲目名，如：开道锣" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select data-testid="new-bpb" value={bpb} onChange={(e) => setBpb(Number(e.target.value))}>
          <option value={2}>2/4</option>
          <option value={3}>3/4</option>
          <option value={4}>4/4</option>
        </select>
        <label className="dim">
          <input type="checkbox" data-testid="new-free" checked={free} onChange={(e) => setFree(e.target.checked)} />
          散板
        </label>
        <button className="btn primary" data-testid="btn-create" onClick={create}>
          新建空白谱
        </button>
        <button
          className="btn"
          data-testid="btn-from-library"
          onClick={() => (window.location.hash = '#/library')}
        >
          从曲牌库创建
        </button>
      </div>

      {scores.length === 0 ? (
        <p className="dim">还没有曲目。可新建空白谱，或从曲牌库载入「急急风」「四击头」等骨架再改。</p>
      ) : (
        <table className="list" data-testid="score-table">
          <thead>
            <tr>
              <th>曲名</th>
              <th>流派</th>
              <th>拍号</th>
              <th>小节</th>
              <th>BPM</th>
              <th>更新</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => (
              <tr key={s.id} data-testid={`score-row-${s.id}`}>
                <td>
                  <a href={`#/score/${s.id}`} className="score-link">
                    {s.title}
                  </a>
                </td>
                <td className="dim">{s.style ?? '—'}</td>
                <td>{s.freeMeter ? '散板' : `${s.bars[0]?.beatsPerBar ?? 4}/4`}</td>
                <td>{s.bars.length}</td>
                <td>{s.bpm}</td>
                <td className="dim">{new Date(s.updatedAt).toLocaleString('zh-CN')}</td>
                <td>
                  <a href={`#/score/${s.id}/print`}>打印</a>
                  <button
                    className="mini danger"
                    data-testid={`del-${s.id}`}
                    onClick={async () => {
                      if (confirm(`删除「${s.title}」？`)) {
                        await deleteScore(s.id);
                        void refresh();
                      }
                    }}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="dim">内置曲牌：{PATTERNS.map((p) => p.name).join(' / ')}</p>
    </div>
  );
}
