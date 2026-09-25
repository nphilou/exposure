import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, savedToken, type Device } from './api';
import { useStore } from './store';

export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}`;
}

/** First run: the person who can read the container logs proves they own the server. */
export function Claim() {
  const boot = useStore(s => s.boot);
  const [code, setCode] = useState(''), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api.claim(code, deviceName()); await boot(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="ob">
      <div className="ob-top"><div className="logo" style={{ padding: 0 }}>exposure</div></div>
      <form className="ob-page" style={{ maxWidth: 420 }} onSubmit={submit}>
        <h1>Set up your server</h1>
        <p className="lead">Enter the setup code printed in the server’s log. This proves you own it.</p>
        <label className="ob-field"><span>Setup code</span>
          <input className="mono" autoFocus value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        </label>
        {err && <p className="ob-err">{err}</p>}
        <button className="btn big" style={{ marginTop: 20, width: '100%' }} disabled={busy || code.replace(/[^A-Za-z0-9]/g, '').length < 8}>{busy ? 'Checking…' : 'Continue'}</button>
        <p className="ob-foot">Find it with <span className="mono">docker logs exposure</span>, or in your NAS’s container log view.</p>
      </form>
    </div>
  );
}

// iPadOS Safari reports itself as a Mac; touch support tells them apart.
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/**
 * A new browser/phone joins: scanning the QR lands here with ?code=… and pairs automatically.
 * On iPhone/iPad the Camera app opens the QR in Safari, so the code isn't spent here right away:
 * the person picks the Exposure app (via its exposure://pair link) or this browser.
 */
export function Pair() {
  const boot = useStore(s => s.boot);
  const initial = new URLSearchParams(location.search).get('code') ?? '';
  const [code, setCode] = useState(initial), [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(!!initial && isIOS());
  const [noApp, setNoApp] = useState(false);
  const tried = useRef(false);
  const redeem = async (c: string) => {
    setBusy(true); setErr('');
    try { await api.redeem(c, deviceName()); history.replaceState(null, '', '/'); await boot(); }
    catch (x) { setErr((x as Error).message); history.replaceState(null, '', '/'); } finally { setBusy(false); }
  };
  useEffect(() => { if (initial && !choosing && !tried.current) { tried.current = true; void redeem(initial); } }, []); // eslint-disable-line
  const appLink = `exposure://pair?server=${encodeURIComponent(location.origin)}&code=${encodeURIComponent(initial)}`;
  // If the page is still in front a moment after the tap, iOS had no app to open the link with.
  const openApp = () => setTimeout(() => { if (document.visibilityState === 'visible') setNoApp(true); }, 1500);
  if (choosing) return (
    <div className="ob">
      <div className="ob-top"><div className="logo" style={{ padding: 0 }}>exposure</div></div>
      <div className="ob-page" style={{ maxWidth: 420 }}>
        <h1>Add this device</h1>
        <p className="lead">Open your library in the Exposure app, or keep using it in this browser.</p>
        <a className="btn big" style={{ marginTop: 20, width: '100%', textDecoration: 'none', display: 'grid', placeItems: 'center' }} href={appLink} onClick={openApp}>Open in Exposure app</a>
        <button className="btn big ghost" style={{ marginTop: 10, width: '100%' }} onClick={() => { setChoosing(false); tried.current = true; void redeem(initial); }}>Use in this browser</button>
        {noApp && <p className="ob-foot">Nothing happened? The Exposure app may not be installed on this device. You can use Exposure in this browser instead.</p>}
      </div>
    </div>
  );
  return (
    <div className="ob">
      <div className="ob-top"><div className="logo" style={{ padding: 0 }}>exposure</div></div>
      <form className="ob-page" style={{ maxWidth: 420 }} onSubmit={e => { e.preventDefault(); void redeem(code); }}>
        <h1>{busy && initial ? 'Adding this device…' : 'Add this device'}</h1>
        <p className="lead">On a device that’s already connected, open Settings → Devices → Add a device, then scan the QR code or type the code here.</p>
        <label className="ob-field"><span>Pairing code</span>
          <input className="mono" autoFocus value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX" autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
        </label>
        {err && <p className="ob-err">{err}</p>}
        <button className="btn big" style={{ marginTop: 20, width: '100%' }} disabled={busy || code.replace(/[^A-Za-z0-9]/g, '').length < 8}>{busy ? 'Adding…' : 'Add device'}</button>
      </form>
    </div>
  );
}

/** Settings → Devices: list, revoke, and mint a QR/code for adding another device. */
export function Devices() {
  const publicUrl = useStore(s => s.session?.publicUrl);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pair, setPair] = useState<{ code: string; expiresAt: number; qr: string; link: string; base: string } | null>(null);
  const [left, setLeft] = useState(0), [err, setErr] = useState('');

  const load = () => api.devices().then(setDevices).catch(() => {});
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!pair) return;
    const t = setInterval(() => { const s = Math.round((pair.expiresAt - Date.now()) / 1000); setLeft(s); if (s <= 0) { setPair(null); void load(); } }, 1000);
    return () => clearInterval(t);
  }, [pair]);

  const add = async () => {
    setErr('');
    try {
      const r = await api.pairNew();
      // A phone can't reach "localhost", so fall back to the server's LAN address.
      const isLocal = /^(localhost|127\.|\[::1\])/.test(location.hostname);
      const base = publicUrl || (isLocal && r.lanUrls[0]) || location.origin;
      const link = base + r.path;
      const qr = await QRCode.toDataURL(link, { margin: 2, width: 240, color: { dark: '#1b1a18', light: '#ffffff' } });
      setPair({ code: r.code, expiresAt: r.expiresAt, qr, link, base }); setLeft(Math.round((r.expiresAt - Date.now()) / 1000));
    } catch (e) { setErr((e as Error).message); }
  };
  const revoke = async (d: Device) => {
    if (!confirm(d.current ? 'Remove this device? You will need a new pairing code to come back.' : `Remove “${d.name}”?`)) return;
    try { await api.revoke(d.id); if (d.current) { savedToken.clear(); location.reload(); } else void load(); } catch (e) { setErr((e as Error).message); }
  };
  const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

  return (
    <>
      <h2 style={{ marginTop: 18 }}>Devices</h2>
      <div className="ob-box" style={{ padding: 4 }}>
        {devices.map(d => (
          <div key={d.id} className="ob-row" style={{ cursor: 'default', paddingLeft: 12 }}>
            <span style={{ flex: 1 }}>{d.name}{d.current && <span className="muted"> · this device</span>}</span>
            <span className="muted small">{ago(d.lastSeen)}</span>
            <button className="ob-open" title="Remove" onClick={() => void revoke(d)}>×</button>
          </div>
        ))}
      </div>
      {err && <p className="ob-err">{err}</p>}
      {!pair
        ? <div><button className="btn ghost" onClick={() => void add()}>Add a device…</button></div>
        : <div className="pair-card">
            <img src={pair.qr} width={180} height={180} alt="Pairing QR code" />
            <div>
              <p style={{ margin: '0 0 6px' }}>Scan with your phone’s camera, or open this address and type the code:</p>
              <div className="mono muted small" style={{ wordBreak: 'break-all' }}>{pair.base}/pair</div>
              <div className="mono pair-code">{pair.code}</div>
              <div className="muted small">Works once · expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</div>
              {!publicUrl && /^(localhost|127\.|192\.168\.|10\.|172\.)/.test(new URL(pair.base).hostname) && <p className="muted small">This is a local address; it only works from devices on the same network.</p>}
            </div>
          </div>}
    </>
  );
}
