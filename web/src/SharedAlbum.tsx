import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { guest, type GuestPhoto, type SharedAlbum as Album } from './api';
import { PhotoRows } from './Grid';

const PAGE = 300;

/** /s/<token>: one album, read-only, for someone who got a share link. No pairing, no library. */
export function SharedAlbum({ token }: { token: string }) {
  const g = useMemo(() => guest(token), [token]);
  const [album, setAlbum] = useState<Album | null>(null);
  const [photos, setPhotos] = useState<GuestPhoto[]>([]);
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const more = useRef({ has: false, busy: false });

  useEffect(() => {
    Promise.all([g.album(), g.photos(PAGE, 0)])
      .then(([a, p]) => { setAlbum(a); setPhotos(p); more.current.has = p.length === PAGE; document.title = `${a.title} · Exposure`; })
      .catch(e => setErr((e as Error).message));
  }, [g]);

  const loadMore = useCallback(async () => {
    if (!more.current.has || more.current.busy) return;
    more.current.busy = true;
    try {
      const next = await g.photos(PAGE, photos.length);
      more.current.has = next.length === PAGE;
      setPhotos(p => [...p, ...next]);
    } finally { more.current.busy = false; }
  }, [g, photos.length]);

  if (err) return (
    <div className="ob">
      <div className="ob-top"><div className="logo" style={{ padding: 0 }}>exposure</div></div>
      <div className="ob-page" style={{ maxWidth: 420 }}>
        <h1>Album unavailable</h1>
        <p className="lead">{err}</p>
      </div>
    </div>
  );
  if (!album) return null;

  return (
    <div className="shared">
      <header className="top">
        <div className="logo" style={{ padding: 0, fontSize: 18 }}>exposure</div>
        <h1>{album.title} <small className="muted">{album.count} {album.count === 1 ? 'photo' : 'photos'}</small></h1>
      </header>
      {photos.length === 0
        ? <div className="empty">This album is empty.</div>
        : <PhotoRows photos={photos} thumb={g.thumb} onOpen={setOpenId} onEnd={loadMore} />}
      {openId && <GuestViewer photos={photos} openId={openId} open={setOpenId} g={g} allowOriginals={album.allowOriginals} onNearEnd={loadMore} />}
    </div>
  );
}

function GuestViewer({ photos, openId, open, g, allowOriginals, onNearEnd }: {
  photos: GuestPhoto[]; openId: string; open: (id: string | null) => void; g: ReturnType<typeof guest>; allowOriginals: boolean; onNearEnd: () => void;
}) {
  const idx = photos.findIndex(p => p.id === openId), p = photos[idx];
  useEffect(() => { if (idx >= photos.length - 5) void onNearEnd(); }, [idx, photos.length, onNearEnd]);
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
  const exif = [p.camera, p.lens, p.focal && `${Math.round(p.focal)}mm`, p.fnum && `f/${p.fnum}`, p.shutter, p.iso && `ISO ${p.iso}`].filter(Boolean);

  return (
    <div className="viewer">
      <div className="stage" onClick={() => open(null)}>
        <img src={g.preview(p.id)} alt={p.name} onClick={e => e.stopPropagation()} />
      </div>
      <aside className="info">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div><h2>{p.shootTitle}</h2><small className="muted">{idx + 1} of {photos.length}</small></div>
          <button className="btn ghost" onClick={() => open(null)}>Close</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" style={{ flex: 1 }} disabled={idx === 0} onClick={() => open(photos[idx - 1].id)}>← Previous</button>
          <button className="btn ghost" style={{ flex: 1 }} disabled={idx === photos.length - 1} onClick={() => open(photos[idx + 1].id)}>Next →</button>
        </div>
        <dl className="kv">
          <dt>Taken</dt><dd>{new Date(p.takenAt).toLocaleString(undefined, { timeZone: 'UTC' })}</dd>
          {exif.length > 0 && <><dt>Camera</dt><dd>{exif.join(' · ')}</dd></>}
        </dl>
        {allowOriginals && <a className="btn" href={g.original(p.id)} style={{ textDecoration: 'none' }}>Download</a>}
      </aside>
    </div>
  );
}
