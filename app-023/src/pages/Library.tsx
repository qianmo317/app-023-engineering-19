// 曲牌骨架库与拟音字表 /library
import { DEFAULT_INSTRUMENTS, PATTERNS, scoreFromPattern } from '../lib/factory';
import { saveScore } from '../lib/storage';
import { TECH_NAMES } from '../lib/glyphs';

export function Library() {
  const load = async (pid: string) => {
    const p = PATTERNS.find((x) => x.id === pid);
    if (!p) return;
    const score = scoreFromPattern(p);
    await saveScore(score);
    window.location.hash = `#/score/${score.id}`;
  };

  return (
    <div className="page" data-testid="library-page">
      <h1>曲牌库</h1>
      <p className="dim">内置通用锣鼓段骨架，一键载入再改。按流派可自行扩展（存于曲目中）。</p>
      <div className="pattern-grid">
        {PATTERNS.map((p) => (
          <div className="pattern-card" key={p.id} data-testid={`pattern-${p.id}`}>
            <h3>{p.name}</h3>
            <p className="dim">
              {p.style} · {p.beatsPerBar}/4 · {p.bpm} BPM
            </p>
            <p>{p.desc}</p>
            <button className="btn primary" data-testid={`load-${p.id}`} onClick={() => load(p.id)}>
              载入并编辑
            </button>
          </div>
        ))}
      </div>

      <h1>拟音字表</h1>
      <table className="list" data-testid="glyph-table">
        <thead>
          <tr>
            <th>乐器</th>
            <th>拟音字（打法）</th>
            <th>音色</th>
            <th>基频</th>
            <th>衰减</th>
          </tr>
        </thead>
        <tbody>
          {DEFAULT_INSTRUMENTS.map((inst) => (
            <tr key={inst.id}>
              <td style={{ color: inst.color, fontWeight: 700 }}>{inst.name}</td>
              <td>
                {inst.glyphs.map((g) => {
                  const techs = inst.techMap?.[g] ?? [];
                  return (
                    <span key={g} className="glyph-chip" title={techs.map((t) => TECH_NAMES[t]).join('、') || '常规'}>
                      {g}
                      {techs.length ? <i className="dim"> ({techs.map((t) => TECH_NAMES[t]).join('·')})</i> : null}
                    </span>
                  );
                })}
              </td>
              <td>{inst.synth.type === 'drum' ? '鼓皮' : inst.synth.type === 'metal' ? '金属' : '木'}</td>
              <td>{inst.synth.baseHz} Hz</td>
              <td>{inst.synth.decay}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
