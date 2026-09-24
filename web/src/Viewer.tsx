import { useEffect, useState } from 'react';
import { api } from './api';
import { useStore } from './store';

const fmtSize = (b: number) => (b / 1e6).toFixed(1) + ' MB';

export function Viewer() {
  const { photos, openId, open, toggleFav } = useStore();
  const idx = photos.findIndex(p => p.id === openId);
  const p = photos[idx];
  const [ver, setVer] = useState<string | undefined>();

  useEffect(() => setVer(undefined), [openId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open(null);
      if (e.key === 'ArrowRight' && photos[idx + 1]) open(photos[idx + 1].id);
      if (e.key === 'ArrowLeft' && photos[idx - 1]) open(photos[idx - 1].id);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [idx, photos, open]);

  if (!p) return null;
  const cur = ver ?? p.best;
  const exif = [p.camera, p.lens, p.focal && `${Math.round(p.focal)}mm`, p.fnum && `f/${p.fnum}`, p.shutter, p.iso && `ISO ${p.iso}`];

  return (
    <div className="viewer">
      <div className="stage" onClick={() => open(null)}>
        <img src={api.preview(p.id, cur)} alt={p.name} onClick={e => e.stopPropagation()} />
      </div>
      <aside className="info">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div><h2>{p.shootTitle}</h2><small className="mono" style={{ color: 'var(--tx3)' }}>{p.name}</small></div>
          <button className="btn ghost" onClick={() => open(null)}>Close</button>
        </div>
        <div className="seg">
          {p.versions.map(v => <button key={v.key} className={cur === v.key ? 'on' : ''} onClick={() => setVer(v.key)}>{v.label}</button>)}
        </div>
        <dl className="kv">
          <dt>Taken</dt><dd>{new Date(p.takenAt).toLocaleString()}</dd>
          {exif.filter(Boolean).length > 0 && <><dt>Camera</dt><dd>{exif.filter(Boolean).join(' · ')}</dd></>}
          {p.versions.map(v => <><dt key={v.key + 'k'}>{v.label}</dt><dd key={v.key}>{v.fmt} · {fmtSize(v.size)}</dd></>)}
        </dl>
        <button className="btn ghost" onClick={() => void toggleFav(p)}>{p.fav ? '★ Favorited' : '☆ Favorite'}</button>
        <a className="btn" href={api.file(p.id, cur)} style={{ textDecoration: 'none' }}>Download {p.versions.find(v => v.key === cur)?.fmt}</a>
      </aside>
    </div>
  );
}
