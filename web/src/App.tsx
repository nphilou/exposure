import { useEffect, useState } from 'react';
import { api } from './api';
import { useStore } from './store';
import { Grid } from './Grid';
import { Viewer } from './Viewer';
import { Onboarding } from './Onboarding';
import { Claim, Pair, Devices } from './Pairing';
import { LibraryRules } from './Rules';
import { ShareDialog } from './Share';

export function App() {
  const { view, setView, q, setQuery, stats, albums, photos, shoots, loading, session, openId, refresh, boot, setup, onboarding, startOver } = useStore();

  const [sharing, setSharing] = useState(false);
  useEffect(() => { void boot(); }, [boot]);
  // Without edited photos "Edited" would just be an empty Library, so it's hidden (and left if the library opened on it).
  const hasEdits = stats?.edited !== 0;
  useEffect(() => { if (!hasEdits && view.kind === 'edited') setView({ kind: 'all' }); }, [hasEdits, view.kind, setView]);
  // Live updates when the server finishes re-indexing new photos (needs the device cookie).
  const authed = !!session?.authenticated;
  useEffect(() => {
    if (!authed) return;
    const es = new EventSource('/api/events');
    es.addEventListener('indexed', () => void refresh());
    return () => es.close();
  }, [authed, refresh]);

  if (!session) return null;
  if (!session.claimed) return <Claim />;
  if (!session.authenticated) return <Pair />;
  if (loading && !setup) return null;
  if (onboarding && setup) return <Onboarding setup={setup} />;

  const is = (k: string, id?: number) => view.kind === k && (id === undefined || (view as any).id === id);
  const title = view.kind === 'settings' ? 'Settings' : view.kind === 'all' ? 'Library' : view.kind === 'edited' ? 'Edited' : view.kind === 'fav' ? 'Favorites'
    : albums.find(a => a.id === (view as any).id)?.title ?? 'Album';
  const album = view.kind === 'album' ? albums.find(a => a.id === view.id) : undefined;

  return (
    <div className="app">
      <nav className="side">
        <div className="logo">exposure</div>
        <button className={`nav ${is('all') ? 'on' : ''}`} onClick={() => setView({ kind: 'all' })}>Library <small>{stats?.photos}</small></button>
        {hasEdits && <button className={`nav ${is('edited') ? 'on' : ''}`} onClick={() => setView({ kind: 'edited' })}>Edited <small>{stats?.edited}</small></button>}
        <button className={`nav ${is('fav') ? 'on' : ''}`} onClick={() => setView({ kind: 'fav' })}>Favorites</button>
        <h4>Albums</h4>
        {albums.map(a => <button key={a.id} className={`nav ${is('album', a.id) ? 'on' : ''}`} onClick={() => setView({ kind: 'album', id: a.id })}>{a.title} <small>{a.count}</small></button>)}
        <div style={{ flex: 1 }} />
        <button className="nasbtn" onClick={() => setView({ kind: 'settings' })}><span className="dot small" />{setup?.connection?.name ?? 'Library'}</button>
        <button className={`nav ${is('settings') ? 'on' : ''}`} onClick={() => setView({ kind: 'settings' })}>Settings</button>
      </nav>
      <main className="main">
        <header className="top">
          <h1>{title}</h1>
          {album && <button className="btn ghost" onClick={() => setSharing(true)}>Share…</button>}
          {view.kind !== 'settings' && <input className="search" type="search" placeholder="Search place, camera, lens, month…" value={q} onChange={e => setQuery(e.target.value)} />}
        </header>
        {view.kind === 'settings' ? (
          <div className="scroll"><div className="settings">
            <h2>Connection</h2>
            <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
              <dt>Storage</dt><dd>{setup?.connection?.name}{setup?.connection?.host ? ` · ${setup.connection.host}` : ' · mounted folder'}</dd>
              <dt>Library folder</dt><dd className="mono">{setup?.connection?.libraryPath}</dd>
              <dt>Library</dt><dd>{stats?.photos} photos · {stats?.shoots} events · {stats?.cameras} cameras</dd>
            </dl>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn ghost" onClick={() => void api.rescan()}>Rescan now</button>
              <button className="btn ghost" onClick={() => { if (confirm('Disconnect and choose a different library? Your favorites and albums are kept.')) void startOver(); }}>Change library…</button>
            </div>
            <LibraryRules />
            <Devices />
          </div></div>
        ) : loading ? null : photos.length === 0
          ? <div className="empty">{q || view.kind !== 'all' ? 'No photos match.' : shoots.length ? 'Nothing here yet.' : 'No photos yet. Exposure is watching your photo folder — new photos will appear here automatically.'}</div>
          : <Grid photos={photos} />}
      </main>
      {openId && <Viewer />}
      {sharing && album && <ShareDialog album={album} onClose={() => setSharing(false)} />}
    </div>
  );
}
