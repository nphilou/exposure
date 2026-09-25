import { useEffect, useRef, useState } from 'react';
import { api, ApiError, mergeRules, type Rules, type Suggestion, type FolderHere, type FolderRow, type Progress, type SetupState } from './api';
import { useStore } from './store';

type Step = 'welcome' | 'source' | 'connect' | 'folder' | 'analyze';
type Src = 'nas' | 'local' | 'ugreen' | 'synology' | 'network' | 'webdav';
const SRC_NAME: Record<Src, string> = { nas: 'this NAS', local: 'This server', ugreen: 'UGREEN NAS', synology: 'Synology', network: 'network storage', webdav: 'WebDAV' };
const SOURCES: [Src, string, string][] = [['ugreen', 'UGREEN NAS', 'UGOS'], ['synology', 'Synology', 'DSM'], ['network', 'Network storage', 'Any NAS or shared drive'], ['webdav', 'WebDAV', 'Server address']];

// Stand-ins for photographs on the welcome screen (same striped look as the design prototype).
const strip = Array.from({ length: 14 }, (_, i) => {
  const ar = [1.5, 0.67, 1.5, 1, 1.5, 0.67, 1.25][i % 7], h = (i * 47) % 360;
  return { ar, bg: `repeating-linear-gradient(135deg, oklch(.5 .06 ${h}) 0 7px, oklch(.46 .06 ${h}) 7px 14px)` };
});

export function Onboarding({ setup }: { setup: SetupState }) {
  const finish = useStore(s => s.finishOnboarding);
  const [step, setStep] = useState<Step>('welcome');
  const [src, setSrc] = useState<Src>('webdav');
  const [addr, setAddr] = useState(''), [user, setUser] = useState(''), [pass, setPass] = useState('');
  const [adv, setAdv] = useState(false), [proto, setProto] = useState<'auto' | 'http' | 'https'>('auto'), [port, setPort] = useState('');
  const [busy, setBusy] = useState(false), [err, setErr] = useState(''), [details, setDetails] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState(''), [connName, setConnName] = useState('');
  const [trail, setTrail] = useState<string[]>([]), [rows, setRows] = useState<FolderRow[]>([]), [sel, setSel] = useState('');
  const [here, setHere] = useState<FolderHere>({ looksLikePhotos: false, kids: [] });
  // When the current folder is itself the library (e.g. Images mounted as the root), preselect it rather than a child.
  const show = (folders: FolderRow[], h: FolderHere) => { setRows(folders); setHere(h); setSel(h.looksLikePhotos ? '' : folders.find(f => f.note)?.name ?? ''); };

  const back = () => {
    setErr('');
    if (step === 'analyze') setStep('folder');
    else if (step === 'folder') setStep(src === 'local' ? 'source' : 'connect');
    else if (step === 'connect') setStep('source');
    else if (step === 'source') setStep('welcome');
  };

  const connect = async (kind: 'local' | 'webdav') => {
    setBusy(true); setErr(''); setDetails([]);
    try {
      const r = await api.connect(kind === 'local' ? { kind } : { kind, address: addr, username: user, password: pass, protocol: proto, port: port ? Number(port) : undefined, name: src === 'nas' ? 'This NAS' : src === 'ugreen' ? 'UGREEN NAS' : src === 'synology' ? 'Synology' : 'Home NAS' });
      setPendingId(r.pendingId); setConnName(r.name); setTrail([]); show(r.folders, r.here);
      setStep('folder');
    } catch (e) { setErr((e as Error).message); setDetails(e instanceof ApiError ? e.details ?? [] : []); } finally { setBusy(false); }
  };

  const openDir = async (name: string) => {
    const next = [...trail, name];
    setBusy(true);
    try { const r = await api.folders(pendingId, '/' + next.join('/')); setTrail(next); show(r.folders, r.here); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const goUp = async (to: number) => {
    const next = trail.slice(0, to);
    const r = await api.folders(pendingId, '/' + next.join('/'));
    setTrail(next); show(r.folders, r.here);
  };

  const chosen = sel ? [...trail, sel] : trail;
  const useFolder = async () => {
    setBusy(true); setErr('');
    try { await api.useFolder(pendingId, '/' + chosen.join('/')); setStep('analyze'); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="ob">
      <div className="ob-top">
        <div className="logo" style={{ padding: 0 }}>exposure</div>
        {step !== 'welcome' && step !== 'analyze' && <button className="ob-link" onClick={back}>Back</button>}
      </div>

      {step === 'welcome' && (
        <div className="ob-welcome">
          <div className="ob-hero">
            <h1>Your photos.<br />Your storage.</h1>
            <p>Browse your photography beautifully,<br />without uploading it anywhere.</p>
            <div className="ob-cta"><button className="btn big" onClick={() => setStep('source')}>Connect storage</button><span>Nothing is moved, renamed or uploaded.</span></div>
          </div>
          <div className="ob-strip">{strip.map((t, i) => <div key={i} style={{ flex: `0 0 ${t.ar * 210}px`, background: t.bg }} />)}</div>
        </div>
      )}

      {step === 'source' && (
        <div className="ob-page" style={{ maxWidth: 520 }}>
          <h1>Where are your photos?</h1>
          {setup.nasAddress && <>
            <div className="ob-cap">Found on your network</div>
            <button className="ob-card" onClick={() => { setSrc('nas'); setAddr(setup.nasAddress!); setErr(''); setStep('connect'); }}>
              <span className="dot" /><span style={{ flex: 1 }}><b>This NAS</b><small>The NAS Exposure is running on · WebDAV</small></span><span className="muted">Connect</span>
            </button>
          </>}
          {setup.localAvailable && <>
            <div className="ob-cap" style={{ marginTop: setup.nasAddress ? 20 : 0 }}>Mounted into Exposure</div>
            <button className="ob-card" disabled={busy} onClick={() => { setSrc('local'); void connect('local'); }}>
              <span className="dot" /><span style={{ flex: 1 }}><b>This server</b><small>A folder mounted into Exposure</small></span><span className="muted">{busy ? 'Connecting…' : 'Connect'}</span>
            </button>
          </>}
          <div className="ob-cap" style={{ marginTop: setup.localAvailable || setup.nasAddress ? 36 : 0 }}>{setup.localAvailable || setup.nasAddress ? 'Or choose' : 'Choose'}</div>
          {SOURCES.map(([k, name, sub]) => (
            <button key={k} className="ob-item" onClick={() => { setSrc(k); setErr(''); setStep('connect'); }}>
              <span style={{ flex: 1 }}>{name}</span><span className="muted">{sub}</span><span className="muted">›</span>
            </button>
          ))}
          {err && <p className="ob-err">{err}</p>}
        </div>
      )}

      {step === 'connect' && (
        <form className="ob-page" style={{ maxWidth: 420 }} onSubmit={e => { e.preventDefault(); void connect('webdav'); }}>
          <h1>Connect to {SRC_NAME[src]}</h1>
          <p className="lead">Use the same account you sign in to your NAS with. Exposure connects over WebDAV, so it needs to be switched on in your NAS settings.</p>
          {src !== 'nas' && <label className="ob-field"><span>Address</span><input autoFocus value={addr} onChange={e => setAddr(e.target.value)} placeholder="192.168.1.20" autoCapitalize="none" autoCorrect="off" /></label>}
          <label className="ob-field"><span>Username</span><input autoFocus={src === 'nas'} value={user} onChange={e => setUser(e.target.value)} autoCapitalize="none" autoCorrect="off" /></label>
          <label className="ob-field"><span>Password</span><input type="password" value={pass} onChange={e => setPass(e.target.value)} /></label>
          <button type="button" className="ob-link" style={{ padding: '4px 0' }} onClick={() => setAdv(!adv)}>Advanced settings {adv ? '▾' : '▸'}</button>
          {adv && (
            <div className="ob-adv">
              <span>Connect using</span>
              <select value={proto} onChange={e => setProto(e.target.value as any)}>
                <option value="auto">Automatic · HTTPS, then HTTP</option><option value="https">HTTPS</option><option value="http">HTTP</option>
              </select>
              <span>Port</span>
              <input className="mono" value={port} onChange={e => setPort(e.target.value.replace(/\D/g, ''))} placeholder="Default (5006, 5005, 443, 80)" />
              <span>Shared folder</span><span className="mono muted">Choose in next step</span>
            </div>
          )}
          {err && <p className="ob-err">{err}</p>}
          {details.length > 0 && <details className="muted small" style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer' }}>What Exposure tried</summary>
            <div className="mono" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>{details.map(d => <span key={d}>{d}</span>)}</div></details>}
          <button className="btn big" style={{ marginTop: 28, width: '100%' }} disabled={busy || !addr.trim()}>{busy ? 'Connecting…' : 'Connect'}</button>
          <p className="ob-foot">Your password is stored encrypted on this server, never sent anywhere else.</p>
        </form>
      )}

      {step === 'folder' && (
        <div className="ob-page" style={{ maxWidth: 560 }}>
          <h1>Choose your photo library</h1>
          <p className="lead">Pick the folder where your photos live. Nothing inside it will be changed.</p>
          <div className="ob-box">
            <div className="ob-crumbs">
              <span className="dot small" />
              <button onClick={() => void goUp(0)} disabled={!trail.length}>{connName}</button>
              {trail.map((t, i) => <span key={i}>/ <button onClick={() => void goUp(i + 1)} disabled={i === trail.length - 1}>{t}</button></span>)}
            </div>
            {here.looksLikePhotos && <div>
              <div className={`ob-row ${sel === '' ? 'sel' : ''}`} onClick={() => setSel('')}>
                <span style={{ flex: 1 }}>This folder</span><span className="muted small">Looks like your photos</span>{sel === '' && <span>✓</span>}
              </div>
              {sel === '' && <div className="ob-kids mono">{here.kids.map(k => <span key={k}>{k}</span>)}</div>}
            </div>}
            {rows.length === 0 && <div className="ob-row muted">No folders here.</div>}
            {rows.map(f => (
              <div key={f.name}>
                <div className={`ob-row ${sel === f.name ? 'sel' : ''}`} onClick={() => setSel(f.name)} onDoubleClick={() => void openDir(f.name)}>
                  <span style={{ flex: 1 }}>{f.name}</span>
                  <span className="muted small">{f.note}</span>
                  <button className="ob-open" title="Open folder" onClick={e => { e.stopPropagation(); void openDir(f.name); }}>›</button>
                  {sel === f.name && <span>✓</span>}
                </div>
                {sel === f.name && f.kids.length > 0 && <div className="ob-kids mono">{f.kids.map(k => <span key={k}>{k}</span>)}</div>}
              </div>
            ))}
          </div>
          {err && <p className="ob-err">{err}</p>}
          <button className="btn big" style={{ marginTop: 28 }} disabled={busy || (chosen.length === 0 && !here.looksLikePhotos)} onClick={() => void useFolder()}>
            {chosen.length ? `Use “${chosen[chosen.length - 1]}”` : here.looksLikePhotos ? 'Use this folder' : 'Choose a folder'}
          </button>
        </div>
      )}

      {step === 'analyze' && <Analyze onDone={finish} onRetry={() => setStep('folder')} />}
    </div>
  );
}

function Analyze({ onDone, onRetry }: { onDone: () => void; onRetry: () => void }) {
  const [p, setP] = useState<Progress | null>(null);
  const seenScan = useRef(false);
  useEffect(() => {
    const t = setInterval(async () => { try { const r = await api.progress(); if (r.phase === 'scanning') seenScan.current = true; setP(r); } catch { /* keep polling */ } }, 350);
    return () => clearInterval(t);
  }, []);
  const done = p?.phase === 'done' && (seenScan.current || p.photos > 0);
  const pct = p && p.shoots ? Math.min(1, p.shootsDone / p.shoots) : 0;

  return (
    <div className="ob-page" style={{ maxWidth: 620 }}>
      {!done && !p?.error && <>
        <h1>Reading your library…</h1>
        <p className="lead">Finding your photos and reading their details. This can take a few minutes for a large library.</p>
        <div className="ob-count">{(p?.count ?? 0).toLocaleString('en-US')}</div>
        <div className="muted">photos found</div>
        <div className="ob-bar"><div style={{ width: `${(pct * 100).toFixed(1)}%` }} /></div>
        <div className="mono muted small ob-cur">{p?.current}</div>
      </>}
      {p?.error && <><h1>Something went wrong</h1><p className="ob-err">{p.error}</p><button className="btn big" onClick={onRetry}>Choose another folder</button></>}
      {done && p && p.photos === 0 && <>
        <h1>No photos found there</h1>
        <p className="lead">There are no JPEG, PNG, TIFF or RAW files in that folder or its subfolders. Try a different folder.</p>
        <button className="btn big" onClick={onRetry}>Choose another folder</button>
      </>}
      {done && p && p.photos > 0 && <>
        <h1>We found your library.</h1>
        <div className="ob-stats">
          <div><b>{p.photos.toLocaleString('en-US')}</b><span>photos</span></div>
          <div><b>{p.shootsFound}</b><span>{p.shootsFound === 1 ? 'folder' : 'folders'}</span></div>
          {p.cameras > 0 && <div><b>{p.cameras}</b><span>{p.cameras === 1 ? 'camera' : 'cameras'}</span></div>}
        </div>
        <Suggestions />
        <button className="btn big" onClick={onDone}>Open my library</button>
      </>}
    </div>
  );
}

/** "We noticed 337 folders named Export…" — each Yes becomes a visible rule in Settings → Library. */
function Suggestions() {
  const [rules, setRules] = useState<Rules | null>(null);
  const [list, setList] = useState<Suggestion[]>([]);
  const [applied, setApplied] = useState<string[]>([]);
  useEffect(() => { void api.rules().then(r => { setRules(r.rules); setList(r.suggestions); }).catch(() => {}); }, []);
  const yes = async (s: Suggestion) => {
    if (!rules) return;
    const next = mergeRules(rules, s.apply);
    setRules(next); setApplied(a => [...a, s.id]);
    await api.saveRules(next).catch(() => {});
  };
  return (
    <div style={{ marginTop: 28 }}>
      {list.length > 0 && <>
        <p className="lead" style={{ marginBottom: 12 }}>We noticed a few things about how your photos are organised:</p>
        <div className="rules-sugg" style={{ marginBottom: 20 }}>
          {list.map(s => <div key={s.id}><span>{s.text}</span>
            {applied.includes(s.id) ? <span style={{ flex: 'none' }} className="muted">✓ Done</span> : <button className="btn ghost sm" onClick={() => void yes(s)}>Yes</button>}</div>)}
        </div>
      </>}
      <p className="lead">You can change how files are grouped at any time in Settings → Library.</p>
    </div>
  );
}
