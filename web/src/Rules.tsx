import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mergeRules, type Role, type Rules, type RulesPreview, type Suggestion } from './api';

const ROLE_NAME: Record<Role, string> = { edited: 'Edited', camera: 'Camera', raw: 'Original' };
const IMAGE_TYPES: [string, string[]][] = [['JPEG', ['jpg', 'jpeg']], ['PNG', ['png']], ['TIFF', ['tif', 'tiff']], ['WebP', ['webp']]];
const RAW_TYPES = ['arw', 'raf', 'cr3', 'cr2', 'nef', 'dng', 'orf', 'rw2', 'pef', 'srw'];

/** Settings → Library rules: every convention Exposure applies to your folders, editable, with a live preview. */
export function LibraryRules() {
  const [saved, setSaved] = useState<Rules | null>(null);
  const [draft, setDraft] = useState<Rules | null>(null);
  const [presets, setPresets] = useState<{ generic: Rules; photographer: Rules } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [preview, setPreview] = useState<RulesPreview | null>(null);
  const [folder, setFolder] = useState<string | undefined>();
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  const [excludeText, setExcludeText] = useState('');

  const load = async () => {
    const r = await api.rules();
    setSaved(r.rules); setDraft(r.rules); setPresets(r.presets); setSuggestions(r.suggestions); setExcludeText(r.rules.exclude.join(', '));
  };
  useEffect(() => { void load(); }, []);

  // Live preview, debounced while typing.
  const seq = useRef(0);
  useEffect(() => {
    if (!draft) return;
    const n = ++seq.current;
    const t = setTimeout(() => api.previewRules(draft, folder).then(p => { if (n === seq.current) setPreview(p); }).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [draft, folder]);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);
  if (!draft || !saved) return null;
  const set = (patch: Partial<Rules>) => setDraft({ ...draft, ...patch });
  const setFolderRule = (i: number, patch: Partial<Rules['folders'][number]>) => set({ folders: draft.folders.map((f, j) => j === i ? { ...f, ...patch } : f) });
  const hasTypes = (ts: string[]) => ts.every(t => draft.types.includes(t));
  const toggleTypes = (ts: string[], on: boolean) => set({ types: on ? [...new Set([...draft.types, ...ts])] : draft.types.filter(t => !ts.includes(t)) });
  const move = (i: number, d: number) => { const p = [...draft.preferred]; [p[i], p[i + d]] = [p[i + d], p[i]]; set({ preferred: p }); };
  const pending = suggestions.filter(s => JSON.stringify(mergeRules(draft, s.apply)) !== JSON.stringify(draft));

  const save = async () => {
    setBusy(true); setMsg('');
    try { const r = await api.saveRules(draft); setSaved(r.rules); setDraft(r.rules); setMsg('Saved. Your library is being regrouped.'); void api.rules().then(x => setSuggestions(x.suggestions)); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  const s = preview?.summary;
  return (
    <>
      <h2 style={{ marginTop: 18 }}>Library rules</h2>
      <p className="muted" style={{ margin: '-8px 0 0' }}>How Exposure turns the files in your folder into photos. Nothing in your folder is changed.</p>

      {pending.length > 0 && <div className="rules-sugg">
        {pending.map(x => <div key={x.id}><span>{x.text}</span><button className="btn ghost sm" onClick={() => setDraft(mergeRules(draft, x.apply))}>Yes</button></div>)}
      </div>}

      <div className="rules">
        <section>
          <h3>Versions</h3>
          <p className="muted">Files that belong to the same photo are shown as one photo with several versions.</p>
          <div className="rule fixed"><span>RAW files <span className="mono muted">(ARW, RAF, CR3, NEF, DNG…)</span></span><span className="role">Original</span></div>
          {draft.folders.map((f, i) => (
            <div className="rule" key={i}>
              <span>Files in folders named <input className="mono" value={f.name} onChange={e => setFolderRule(i, { name: e.target.value })} placeholder="Export" /></span>
              <select value={f.role} onChange={e => setFolderRule(i, { role: e.target.value as Role })}>
                {(['edited', 'camera', 'raw'] as Role[]).map(r => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
              </select>
              <button className="x" title="Remove rule" onClick={() => set({ folders: draft.folders.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          <button className="ob-link" onClick={() => set({ folders: [...draft.folders, { name: '', role: 'edited' }] })}>+ Add folder rule</button>
          <label className="check"><input type="checkbox" checked={draft.editSuffix} onChange={e => set({ editSuffix: e.target.checked })} />
            <span>A JPEG named like <span className="mono">DSC1-1.jpg</span> next to <span className="mono">DSC1.ARW</span> is its <b>Edited</b> version</span></label>
          <label className="check"><input type="checkbox" checked={draft.pairSameName} onChange={e => set({ pairSameName: e.target.checked })} />
            <span>Files with the same name are one photo <span className="mono muted">(DSC1.ARW + DSC1.JPG)</span></span></label>
          <div className="rule fixed"><span>Any other image</span><span className="role">Camera</span></div>
        </section>

        <section>
          <h3>What the grid shows</h3>
          <p className="muted">Each photo is shown with the first version it has, in this order.</p>
          <ol className="order">
            {draft.preferred.map((r, i) => <li key={r}><span>{ROLE_NAME[r]}</span>
              <button disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button disabled={i === 2} onClick={() => move(i, 1)}>↓</button></li>)}
          </ol>
          <div className="row"><span>Open the library on</span>
            <div className="seg" style={{ width: 200 }}>
              {(['all', 'edited'] as const).map(v => <button key={v} className={draft.defaultView === v ? 'on' : ''} onClick={() => set({ defaultView: v })}>{v === 'all' ? 'All photos' : 'Edited only'}</button>)}
            </div></div>
        </section>

        <section>
          <h3>Events</h3>
          <label className="check"><input type="checkbox" checked={draft.datedFolders} onChange={e => set({ datedFolders: e.target.checked, onlyDated: e.target.checked && draft.onlyDated })} />
            <span>A folder named like <span className="mono">2016-01-25 Paris</span> is an event called “Paris” on that date</span></label>
          <label className={`check ${draft.datedFolders ? '' : 'off'}`}><input type="checkbox" disabled={!draft.datedFolders} checked={draft.onlyDated} onChange={e => set({ onlyDated: e.target.checked })} />
            <span>Only include photos that are inside a dated folder</span></label>
        </section>

        <section>
          <h3>Include</h3>
          <div className="types">
            {IMAGE_TYPES.map(([label, ts]) => <label key={label} className="check"><input type="checkbox" checked={hasTypes(ts)} onChange={e => toggleTypes(ts, e.target.checked)} />{label}</label>)}
            <label className="check"><input type="checkbox" checked={hasTypes(RAW_TYPES)} onChange={e => toggleTypes(RAW_TYPES, e.target.checked)} />RAW</label>
          </div>
          <label className="ob-field" style={{ marginTop: 12 }}><span>Skip folders named <span className="muted">(comma separated, * allowed)</span></span>
            <input value={excludeText} placeholder="Wallpaper, Screenshots" onChange={e => { setExcludeText(e.target.value); set({ exclude: e.target.value.split(',').map(x => x.trim()).filter(Boolean) }); }} /></label>
        </section>
      </div>

      <div className="rules-preview">
        <div className="rules-sum">
          {s ? <><b>{s.photos.toLocaleString()}</b> photos · <b>{s.edited.toLocaleString()}</b> edited · <b>{s.events.toLocaleString()}</b> events
            {s.skipped > 0 && <span className="muted"> · {s.skipped.toLocaleString()} of {s.files.toLocaleString()} files not shown</span>}</> : 'Previewing…'}
        </div>
        {preview && preview.folders.length > 0 && <>
          <select className="mono" value={preview.folder} onChange={e => setFolder(e.target.value)}>
            {preview.folders.map(f => <option key={f} value={f}>{f || '(library folder)'}</option>)}
          </select>
          <div className="rules-sample">
            {preview.sample.map(p => (
              <div key={p.name} className="rs-row"><span className="rs-name">{p.name}</span>
                <span className="rs-vers">{p.versions.map((v, i) => <span key={v.file} className={`chip ${i === 0 ? 'best' : ''}`} title={v.file}>{v.label} <span className="mono">{v.file}</span></span>)}</span></div>
            ))}
          </div>
        </>}
      </div>

      <div className="rules-actions">
        <button className="btn" disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save rules'}</button>
        {dirty && <button className="btn ghost" onClick={() => { setDraft(saved); setExcludeText(saved.exclude.join(', ')); }}>Discard changes</button>}
        {presets && <select className="preset" value="" onChange={e => { const p = presets[e.target.value as 'generic' | 'photographer']; if (p) { setDraft(p); setExcludeText(p.exclude.join(', ')); } }}>
          <option value="">Start from a preset…</option>
          <option value="generic">Plain gallery</option>
          <option value="photographer">Photographer (Export, RAW, dated folders)</option>
        </select>}
        {msg && <span className="muted">{msg}</span>}
      </div>
    </>
  );
}
