import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, mergeRules, type PatternReport, type Role, type Rules, type RulesPreview, type Suggestion } from './api';

const ROLE_NAME: Record<Role, string> = { edited: 'Edited', camera: 'Camera', raw: 'Original' };
const VERSIONS: { role: Role; label: string; what: string; placeholder: string }[] = [
  { role: 'raw', label: 'Original', what: 'RAW files straight from the camera.', placeholder: '{name}.arw' },
  { role: 'camera', label: 'Camera', what: 'Images from the camera, or any photo when there’s no RAW.', placeholder: '{name}.jpg' },
  { role: 'edited', label: 'Edited', what: 'Your edits and exports. The grid shows these first.', placeholder: 'Export/{name}.jpg' },
];
const fmtDate = (d: string) => new Date(`${d}T00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A pattern with its {tokens} set apart, so "Export/{name}.jpg" reads at a glance. */
const Pattern = ({ src }: { src: string }) => <span className="mono">{src.split(/(\{[^{}]*\})/).map((p, i) => i % 2 ? <span key={i} className="tok">{p}</span> : p)}</span>;
const PatternList = ({ list, empty }: { list: string[]; empty: string }) => list.length
  ? <>{list.map((p, i) => <span key={p}>{i > 0 && <span className="sep"> · </span>}<Pattern src={p} /></span>)}</> : <span className="muted">{empty}</span>;

/** One setting: label, current value and a Change button that opens its editor underneath. */
function Row({ label, value, note, bad, open, onToggle, children }: {
  label: string; value: ReactNode; note?: string; bad?: boolean; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return <div className={`lr ${open ? 'open' : ''}`}>
    <button className="lr-head" onClick={onToggle} aria-expanded={open}>
      <span className="lr-label">{label}</span>
      <span className="lr-value">{value}</span>
      {note && <span className={`lr-note ${bad ? 'bad' : ''}`}>{note}</span>}
      <span className="lr-act">{open ? 'Done' : 'Change'}</span>
    </button>
    {open && <div className="lr-body">{children}</div>}
  </div>;
}

/** An editable list of patterns, each with how many folders/files it matched in the library. */
function Patterns<E>({ list, report, onChange, placeholder, unit, example, missed, help }: {
  list: string[]; report?: PatternReport<E>; onChange: (list: string[]) => void; placeholder: string; unit: string;
  example: (e: E) => ReactNode; missed: (n: number) => string; help: ReactNode;
}) {
  const at = (p: string) => report?.sources.indexOf(p.trim()) ?? -1;
  return <div className="pats">
    {list.map((p, i) => {
      const k = at(p), error = k >= 0 ? report!.errors[k] : null, n = k >= 0 ? report!.counts[k] : undefined;
      return <div className="pat" key={i}>
        <div className="pat-row">
          <input className={`mono ${error ? 'bad' : ''}`} value={p} placeholder={placeholder} spellCheck={false} autoCapitalize="off" autoFocus={!p && i === list.length - 1}
            onChange={e => onChange(list.map((x, j) => j === i ? e.target.value : x))} />
          {!error && n !== undefined && <span className={`pat-n ${n ? '' : 'none'}`}>{n ? `✓ ${plural(n, unit)}` : 'No matches'}</span>}
          <button className="x" title="Remove" onClick={() => onChange(list.filter((_, j) => j !== i))}>×</button>
        </div>
        {error && <div className="pat-err">{error}</div>}
      </div>;
    })}
    <button className="ob-link" onClick={() => onChange([...list, ''])}>+ Add pattern</button>
    {report && list.some(p => p.trim()) && (report.examples.length > 0 || report.misses.count > 0) && <div className="pat-report">
      {report.examples.map((e, i) => <div key={i}>{example(e)}</div>)}
      {report.misses.count > 0 && <div className="pat-miss"><span className="muted">{missed(report.misses.count)}</span>
        {report.misses.examples.map(m => <span key={m} className="chip mono">{m}</span>)}{report.misses.count > report.misses.examples.length && <span className="muted">…</span>}</div>}
    </div>}
    <p className="pat-help muted">{help}</p>
  </div>;
}

/** Settings → Library: every convention Exposure applies to your folders, as patterns, with a live preview. */
export function LibraryRules() {
  const [saved, setSaved] = useState<Rules | null>(null);
  const [draft, setDraft] = useState<Rules | null>(null);
  const [presets, setPresets] = useState<{ generic: Rules; photographer: Rules } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [preview, setPreview] = useState<RulesPreview | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [msg, setMsg] = useState('');
  const [excludeText, setExcludeText] = useState('');
  const [cameras, setCameras] = useState<{ camera: string; n: number }[]>([]);

  const load = async () => {
    const r = await api.rules();
    setSaved(r.rules); setDraft(r.rules); setPresets(r.presets); setSuggestions(r.suggestions); setExcludeText(r.rules.exclude.join(', ')); setCameras(r.cameras);
  };
  useEffect(() => { void load(); }, []);

  // Live preview, debounced while typing.
  const seq = useRef(0);
  useEffect(() => {
    if (!draft) return;
    const n = ++seq.current;
    const t = setTimeout(() => api.previewRules(draft).then(p => { if (n === seq.current) setPreview(p); }).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [draft]);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);
  if (!draft || !saved) return null;
  const set = (patch: Partial<Rules>) => setDraft({ ...draft, ...patch });
  const reset = (r: Rules) => { setDraft(r); setExcludeText(r.exclude.join(', ')); };
  const toggle = (k: string) => setOpen(open === k ? null : k);
  const move = (i: number, d: number) => { const p = [...draft.preferred]; [p[i], p[i + d]] = [p[i + d], p[i]]; set({ preferred: p }); };
  const pending = suggestions.filter(s => JSON.stringify(mergeRules(draft, s.apply)) !== JSON.stringify(draft));
  const pats = preview?.patterns;
  const reports = pats ? [pats.events, ...Object.values(pats.versions)] : [];
  const invalid = reports.some(r => r.errors.some(Boolean));
  const clean = (l: string[]) => l.map(p => p.trim()).filter(Boolean);
  const hasEvents = clean(draft.eventPatterns).length > 0;
  const total = (r?: PatternReport<unknown>) => r?.counts.reduce((a, b) => a + b, 0);
  const note = (r: PatternReport<unknown> | undefined, unit: string) => r?.errors.some(Boolean) ? 'Needs fixing' : total(r) ? plural(total(r)!, unit) : undefined;

  const save = async () => {
    setBusy(true); setMsg('');
    try { const r = await api.saveRules(draft); setSaved(r.rules); reset(r.rules); setOpen(null); setMsg('Saved. Your library is being regrouped.'); void api.rules().then(x => setSuggestions(x.suggestions)); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };

  const fileHelp = (role: Role) => <>
    <Pattern src="{name}" /> is the part of the file name all versions of a photo share, <Pattern src="{n}" /> a number.
    Paths start in the photo’s folder, like <Pattern src="Export/{name}.jpg" />. <Pattern src="{name}.*" /> is {role === 'raw' ? 'any RAW format' : 'any image (JPEG, PNG, TIFF, WebP)'},
    {' '}<Pattern src="{jpg,jpeg}" /> either one, <span className="mono">*</span> anything. Case is ignored; “-”, “_” and spaces are interchangeable.
  </>;

  const s = preview?.summary;
  return (
    <>
      <h2 style={{ marginTop: 18 }}>Library</h2>
      <p className="muted" style={{ margin: '-8px 0 0' }}>How Exposure turns the files in your folder into photos. Most people never need to change these. Nothing in your folder is modified.</p>

      {pending.length > 0 && <div className="rules-sugg">
        {pending.map(x => <div key={x.id}><span>{x.text}</span><button className="btn ghost sm" onClick={() => setDraft(mergeRules(draft, x.apply))}>Yes</button></div>)}
      </div>}

      <div className="lrs">
        <Row label="Shoot folders" value={<PatternList list={clean(draft.eventPatterns)} empty="Every folder is a shoot" />}
          note={note(pats?.events, 'shoot')} bad={pats?.events.errors.some(Boolean)} open={open === 'events'} onToggle={() => toggle('events')}>
          <p className="muted">A folder named like this is a shoot on that date. With no pattern, every folder is its own shoot, without a date.</p>
          <Patterns list={draft.eventPatterns} report={pats?.events} onChange={eventPatterns => set({ eventPatterns, onlyDated: draft.onlyDated && clean(eventPatterns).length > 0 })}
            placeholder="{date} {title}" unit="folder"
            missed={n => `${plural(n, 'folder')} with photos ${n === 1 ? 'doesn’t' : 'don’t'} match${draft.onlyDated ? ` and ${n === 1 ? 'is' : 'are'} skipped` : ''}:`}
            example={e => <><span className="mono">{e.folder}</span> <span className="muted">→</span> “{e.title}”, {fmtDate(e.date)}</>}
            help={<>Use <Pattern src="{date}" /> <Pattern src="{title}" />, or <Pattern src="{year}" /> <Pattern src="{month}" /> <Pattern src="{day}" />. <Pattern src="{date}" /> reads 2016-01-25, 20160125 and 2016-01.
              “-”, “_” and spaces are interchangeable, <span className="mono">*</span> matches anything, and <span className="mono">/…/</span> is a regular expression with the same names as groups.</>} />
          <label className={`check ${hasEvents ? '' : 'off'}`}><input type="checkbox" disabled={!hasEvents} checked={draft.onlyDated} onChange={e => set({ onlyDated: e.target.checked })} />
            <span>Only include photos inside a folder that matches</span></label>
        </Row>

        {VERSIONS.map(({ role, label, what, placeholder }) => (
          <Row key={role} label={label} value={<PatternList list={clean(draft.versions[role])} empty={role === 'edited' ? 'None' : 'Not shown'} />}
            note={note(pats?.versions[role], 'file')} bad={pats?.versions[role].errors.some(Boolean)} open={open === role} onToggle={() => toggle(role)}>
            <p className="muted">{what} Files named like any of these are the <b>{label}</b> version of the photo called {'{name}'}.</p>
            <Patterns list={draft.versions[role]} report={pats?.versions[role]} onChange={l => set({ versions: { ...draft.versions, [role]: l } })}
              placeholder={placeholder} unit="file" help={fileHelp(role)}
              missed={n => role === 'edited' ? `${plural(n, 'file')} ${n === 1 ? 'is' : 'are'} named like a nearby photo plus something no pattern recognises:`
                : `${plural(n, 'file')} ${n === 1 ? 'matches' : 'match'} no pattern and ${n === 1 ? 'isn’t' : 'aren’t'} shown:`}
              example={e => <><span className="mono">{e.file}</span> <span className="muted">→ {label.toLowerCase()} of</span> <span className="mono">{e.name}</span></>} />
          </Row>
        ))}

        <Row label="Camera looks" value={draft.styledCameras.length ? draft.styledCameras.join(' · ') : <span className="muted">None</span>} open={open === 'looks'} onToggle={() => toggle('looks')}>
          <p className="muted">Some cameras bake a finished look into their JPEGs, like Fujifilm’s film simulations. Count the camera JPEGs from these as <b>Edited</b>.</p>
          {cameras.length || draft.styledCameras.length ? <div className="checks">
            {[...new Set([...cameras.map(c => c.camera), ...draft.styledCameras])].map(c => {
              const on = draft.styledCameras.some(x => x.toLowerCase() === c.toLowerCase()), n = cameras.find(x => x.camera === c)?.n;
              return <label key={c} className="check"><input type="checkbox" checked={on}
                onChange={e => set({ styledCameras: e.target.checked ? [...draft.styledCameras, c] : draft.styledCameras.filter(x => x.toLowerCase() !== c.toLowerCase()) })} />
                <span>{c}{n !== undefined && <span className="muted"> · {plural(n, 'photo')}</span>}</span></label>;
            })}
          </div> : <p className="muted">No camera JPEGs in your library yet.</p>}
        </Row>

        <Row label="Grid shows" value={<>{draft.preferred.map(r => ROLE_NAME[r]).join(' → ')}<span className="muted"> · opens on {draft.defaultView === 'all' ? 'all photos' : 'edited only'}</span></>}
          open={open === 'grid'} onToggle={() => toggle('grid')}>
          <p className="muted">Each photo is shown with the first version it has, in this order.</p>
          <ol className="order">
            {draft.preferred.map((r, i) => <li key={r}><span>{ROLE_NAME[r]}</span>
              <button disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button disabled={i === 2} onClick={() => move(i, 1)}>↓</button></li>)}
          </ol>
          <div className="row"><span>Open the library on</span>
            <div className="seg" style={{ width: 200 }}>
              {(['all', 'edited'] as const).map(v => <button key={v} className={draft.defaultView === v ? 'on' : ''} onClick={() => set({ defaultView: v })}>{v === 'all' ? 'All photos' : 'Edited only'}</button>)}
            </div></div>
        </Row>

        <Row label="Skip folders" value={<PatternList list={draft.exclude} empty="None" />} open={open === 'skip'} onToggle={() => toggle('skip')}>
          <label className="ob-field"><span>Folder names to leave out <span className="muted">(comma separated, * allowed)</span></span>
            <input value={excludeText} placeholder="Wallpaper, Screenshots" autoFocus onChange={e => { setExcludeText(e.target.value); set({ exclude: e.target.value.split(',').map(x => x.trim()).filter(Boolean) }); }} /></label>
        </Row>
      </div>

      <div className="rules-actions">
        <button className="btn" disabled={!dirty || busy || invalid} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
        {dirty && <button className="btn ghost" onClick={() => reset(saved)}>Discard changes</button>}
        {presets && <select className="preset" value="" onChange={e => { const p = presets[e.target.value as 'generic' | 'photographer']; if (p) reset(p); }}>
          <option value="">Start from a preset…</option>
          <option value="generic">Plain gallery</option>
          <option value="photographer">Photographer (Export, RAW, dated folders)</option>
        </select>}
        {s && dirty && !msg && <span className="muted">{s.photos.toLocaleString()} photos · {s.edited.toLocaleString()} edited · {s.events.toLocaleString()} shoots</span>}
        {msg && <span className="muted">{msg}</span>}
      </div>
    </>
  );
}
