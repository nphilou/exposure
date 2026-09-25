import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, type Album, type ShareLink } from './api';
import { useStore } from './store';

const EXPIRY = [{ label: 'Never', days: null }, { label: '1 day', days: 1 }, { label: '1 week', days: 7 }, { label: '1 month', days: 30 }];
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
const until = (t: number) => { const d = Math.ceil((t - Date.now()) / 86400_000); return d <= 0 ? 'expired' : d === 1 ? 'expires tomorrow' : `expires in ${d} days`; };
const isPrivateHost = (h: string) => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(h) || h.endsWith('.local');

/** Album → Share: read-only links for people without a paired device. */
export function ShareDialog({ album, onClose }: { album: Album; onClose: () => void }) {
  const publicUrl = useStore(s => s.session?.publicUrl);
  const base = publicUrl || location.origin;
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [name, setName] = useState(''), [days, setDays] = useState<number | null>(null), [originals, setOriginals] = useState(false);
  const [made, setMade] = useState<{ url: string; qr: string } | null>(null);
  const [copied, setCopied] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState('');

  const load = () => api.shares(album.id).then(setLinks).catch(e => setErr((e as Error).message));
  useEffect(() => { void load(); }, [album.id]); // eslint-disable-line
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(''); setCopied(false);
    try {
      const r = await api.createShare(album.id, { name, expiresInDays: days, allowOriginals: originals });
      const url = base + r.path;
      setMade({ url, qr: await QRCode.toDataURL(url, { margin: 2, width: 240, color: { dark: '#1b1a18', light: '#ffffff' } }) });
      setName(''); void load();
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const copy = async () => { if (!made) return; try { await navigator.clipboard.writeText(made.url); setCopied(true); } catch { /* not allowed: the link is selectable */ } };
  const revoke = async (l: ShareLink) => {
    if (!confirm(`Stop “${l.name}” from working? Anyone with that link loses access.`)) return;
    try { await api.deleteShare(l.id); void load(); } catch (x) { setErr((x as Error).message); }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
          <div>
            <h2 id="share-title">Share “{album.title}”</h2>
            <p className="muted" style={{ margin: '4px 0 0' }}>Anyone with a link can view this album, without an account. Photos you add later are shared too.</p>
          </div>
          <button className="ob-open" aria-label="Close" onClick={onClose}>×</button>
        </div>

        {made ? (
          <div className="pair-card">
            <img src={made.qr} width={140} height={140} alt="QR code for the share link" />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="mono small share-url">{made.url}</div>
              <div style={{ display: 'flex', gap: 8, margin: '10px 0 6px' }}>
                <button className="btn sm" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</button>
                <button className="btn sm ghost" onClick={() => setMade(null)}>Done</button>
              </div>
              <div className="muted small">Copy it now: for safety, Exposure can’t show this link again.</div>
            </div>
          </div>
        ) : (
          <form className="share-form" onSubmit={create}>
            <label className="ob-field" style={{ margin: 0 }}><span>Who is it for?</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Family, Wedding guests…" maxLength={60} />
            </label>
            <div className="share-opts">
              <label>Expires <select className="preset" value={days ?? ''} onChange={e => setDays(e.target.value ? Number(e.target.value) : null)}>
                {EXPIRY.map(x => <option key={x.label} value={x.days ?? ''}>{x.label}</option>)}
              </select></label>
              <label className="check" style={{ alignItems: 'center' }}><input type="checkbox" checked={originals} onChange={e => setOriginals(e.target.checked)} /> Allow full-resolution downloads</label>
            </div>
            <div><button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button></div>
          </form>
        )}
        {!publicUrl && isPrivateHost(location.hostname) && (
          <p className="muted small" style={{ margin: 0 }}>This server’s address only works on your home network. To share with people elsewhere, make Exposure reachable over HTTPS and set <span className="mono">EXPOSURE_PUBLIC_URL</span>.</p>
        )}
        {err && <p className="ob-err" style={{ margin: 0 }}>{err}</p>}

        {links.length > 0 && <>
          <h4 className="share-h">Links</h4>
          <div className="ob-box" style={{ padding: 4 }}>
            {links.map(l => (
              <div key={l.id} className="ob-row" style={{ cursor: 'default', paddingLeft: 12 }}>
                <span style={{ flex: 1, minWidth: 0 }}>{l.name}
                  <span className="muted small"> · {l.lastSeen ? `opened ${ago(l.lastSeen)}` : 'not opened yet'}{l.expiresAt ? ` · ${until(l.expiresAt)}` : ''}{l.allowOriginals ? ' · downloads on' : ''}</span>
                </span>
                <button className="ob-open" title="Stop sharing" aria-label={`Stop sharing with ${l.name}`} onClick={() => void revoke(l)}>×</button>
              </div>
            ))}
          </div>
        </>}
      </div>
    </div>
  );
}
