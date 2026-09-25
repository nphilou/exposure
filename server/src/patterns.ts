/**
 * Name patterns used by library rules.
 *  - Shoot folders: "{date} {title}" matches "2016-01-25 Paris".
 *  - Versions: a path relative to the photo's folder, e.g. "{name}.*", "Export*\/{name}.jpg", "{name}-{n}.{jpg,jpeg}".
 * Case is ignored, "-", "_" and spaces are interchangeable, "*" matches anything and "{a,b}" either text.
 * Shoot folder patterns can also be "/…/", a regular expression using the token names as named groups.
 */
export interface Compiled { src: string; re?: RegExp; error?: string }

export const RAW_EXT: Record<string, string> = {
  arw: 'Sony RAW', raf: 'Fujifilm RAW', cr3: 'Canon RAW', cr2: 'Canon RAW', nef: 'Nikon RAW', dng: 'DNG',
  orf: 'Olympus RAW', rw2: 'Panasonic RAW', pef: 'Pentax RAW', srw: 'Samsung RAW',
};
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp'];
/** Every extension the indexer records, so changing rules never needs a rescan. */
export const KNOWN_EXT = new Set([...IMAGE_EXT, ...Object.keys(RAW_EXT)]);

const DATE_SRC = '(?<year>\\d{4})[-_.]?(?<month>\\d{2})(?:[-_.]?(?<day>\\d{2}))?';
const DATE_RE = new RegExp(`^${DATE_SRC}$`);
const EVENT_TOKENS: Record<string, string> = {
  date: DATE_SRC, year: '(?<year>\\d{4})', month: '(?<month>\\d{2})', day: '(?<day>\\d{2})', title: '(?<title>.+?)',
};
const NAME_TOKENS: Record<string, string> = { name: '(?<name>.+?)', n: '\\d{1,3}' };

/** Common conventions, offered as suggestions when the library has folders or files named like them. */
export const EVENT_CANDIDATES = ['{date} {title}', '{title} {date}'];
export const EDIT_CANDIDATES = ['{name}-{n}.*', '{name}-Edit*.*'];

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\/]/g, '\\$&');
const literal = (s: string) => s.replace(/[-_\s]+|\*|[^-_\s*]+/g, m => /^[-_\s]/.test(m) ? '[-_\\s]+' : m === '*' ? '.*' : escape(m));
const list = (xs: string[]) => xs.map(x => `{${x}}`).join(', ');

/** Literal text + {tokens} + {a,b} alternatives → regex pieces, or an error. */
function template(src: string, known: Record<string, string>): { parts: string[]; pieces: string[]; tokens: string[] } | { error: string } {
  const parts = src.split(/\{([^{}]*)\}/);   // even indexes: literal text, odd: what's between braces
  if (parts.some((p, i) => i % 2 === 0 && /[{}]/.test(p))) return { error: 'A “{” or “}” is missing.' };
  const tokens: string[] = [];
  const pieces = parts.map((p, i) => {
    if (i % 2 === 0) return literal(p);
    if (p.includes(',')) return `(?:${p.split(',').map(o => literal(o.trim())).join('|')})`;
    tokens.push(p.trim().toLowerCase());
    return known[p.trim().toLowerCase()] ?? '';
  });
  const bad = tokens.find(t => !(t in known));
  if (bad !== undefined) return { error: Object.keys(known).length ? `Unknown token {${bad}}. Use ${list(Object.keys(known))}.` : `{${bad}} can’t be used here.` };
  const dup = tokens.find((t, i) => tokens.indexOf(t) !== i);
  if (dup) return { error: `{${dup}} is used twice.` };
  return { parts, pieces, tokens };
}

// ── Shoot folders ───────────────────────────────────────────────────────────

export function compileEvent(src: string): Compiled {
  if (src.length > 200) return { src, error: 'Too long.' };
  if (src.length > 1 && src.startsWith('/') && src.endsWith('/')) {
    let re: RegExp;
    try { re = new RegExp(src.slice(1, -1), 'i'); } catch (e) { return { src, error: `Invalid regular expression: ${(e as Error).message.replace(/^Invalid regular expression: /, '')}` }; }
    if (!src.includes('(?<date>') && !src.includes('(?<year>')) return { src, error: 'Needs a (?<date>…) or (?<year>…) group.' };
    return { src, re };
  }
  if (src.includes('/')) return { src, error: 'A pattern matches one folder name, so it can’t contain “/”.' };
  const t = template(src, EVENT_TOKENS);
  if ('error' in t) return { src, error: t.error };
  const has = (x: string) => t.tokens.includes(x);
  if (!has('date') && !has('year')) return { src, error: 'Add {date} (or {year}) so the shoot gets a date.' };
  if (has('date') && (has('year') || has('month') || has('day'))) return { src, error: 'Use either {date} or {year}/{month}/{day}, not both.' };
  if (has('day') && !has('month')) return { src, error: '{day} needs {month}.' };
  // A title at either end is optional together with its separator: "{date} {title}" also matches "2026-01-01".
  const { parts, pieces } = t;
  const ti = parts.findIndex((p, i) => i % 2 && p.trim().toLowerCase() === 'title');
  if (ti !== -1 && parts.slice(ti + 1).join('') === '') pieces.splice(ti - 1, 2, `(?:${pieces[ti - 1]}${pieces[ti]})?`);
  else if (ti !== -1 && parts.slice(0, ti).join('') === '') pieces.splice(ti, 2, `(?:${pieces[ti]}${pieces[ti + 1]})?`);
  return { src, re: new RegExp(`^${pieces.join('')}$`, 'i') };
}

/** The first pattern a folder name matches, with the shoot's title and date ("2016-01-25"). */
export function matchEvent(patterns: Compiled[], folder: string): { pattern: number; title: string; date: string } | null {
  for (const [i, c] of patterns.entries()) {
    let g = c.re?.exec(folder)?.groups;
    if (!g) continue;
    if (g.date !== undefined) g = { ...g, ...DATE_RE.exec(g.date.trim())?.groups };
    const y = Number(g.year), m = Number(g.month ?? 1), d = Number(g.day ?? 1);
    if (!(y >= 1800 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) continue;
    const pad = (n: number) => String(n).padStart(2, '0');
    return { pattern: i, title: g.title?.trim() || folder, date: `${y}-${pad(m)}-${pad(d)}` };
  }
  return null;
}

const CANDIDATES = EVENT_CANDIDATES.map(compileEvent);
/** Whether a folder name looks like a dated shoot under any common convention (used before rules are set). */
export const looksDated = (folder: string) => !!matchEvent(CANDIDATES, folder);

// ── Versions ────────────────────────────────────────────────────────────────

export type Role = 'edited' | 'camera' | 'raw';
export interface FilePattern {
  src: string; error?: string;
  folders: RegExp[];    // subfolders between the photo's folder and the file: "Export*/{name}.jpg" → [/^export.*$/]
  stem: RegExp;         // the file name without extension, capturing {name}
  exts: Set<string>;
  plain: boolean;       // just {name}: "{name}-{n}" isn't, so it only counts when another file has that name
}

/** "{name}.*" means any RAW format for originals, and any other image for camera files and edits. */
export function compileFile(role: Role, src: string): FilePattern {
  const fail = (error: string): FilePattern => ({ src, error, folders: [], stem: /$^/, exts: new Set(), plain: true });
  if (src.length > 200) return fail('Too long.');
  if (src.startsWith('/')) return fail('Start from the photo’s folder, e.g. Export/{name}.jpg.');
  const segs = src.split('/').map(s => s.trim());
  const file = segs.pop()!;
  if (segs.some(s => !s || s === '.' || s === '..')) return fail('Each folder needs a name, e.g. Export/{name}.jpg.');
  const folders: RegExp[] = [];
  for (const s of segs) {
    const t = template(s, {});
    if ('error' in t) return fail(t.error.includes('can’t be used') ? 'Tokens go in the file name, e.g. Export/{name}.jpg.' : t.error);
    folders.push(new RegExp(`^${t.pieces.join('')}$`, 'i'));
  }

  const lower = file.toLowerCase(), dot = lower.lastIndexOf('.');
  if (!lower.includes('{name}')) return fail('Add {name}: the part of the file name all versions of a photo share.');
  if (dot === -1 || dot < lower.lastIndexOf('{name}')) return fail('Add the format, like {name}.jpg, or {name}.* for any.');
  const stemSrc = file.slice(0, dot), extSrc = lower.slice(dot + 1).trim();
  const exts = extSrc === '*' ? (role === 'raw' ? Object.keys(RAW_EXT) : IMAGE_EXT)
    : extSrc.replace(/^\{(.*)\}$/, '$1').split(',').map(e => e.trim());
  const unknown = exts.find(e => !KNOWN_EXT.has(e));
  if (unknown !== undefined) return fail(`Unknown format “.${unknown}”. Exposure reads ${[...KNOWN_EXT].join(', ')}.`);

  const t = template(stemSrc, NAME_TOKENS);
  if ('error' in t) return fail(t.error);
  return { src, folders, stem: new RegExp(`^${t.pieces.join('')}$`, 'i'), exts: new Set(exts), plain: stemSrc.trim().toLowerCase() === '{name}' };
}

/** Where a file sits relative to a pattern: the photo's folder ("base") and name, or null. */
export function matchFile(p: FilePattern, segs: string[], stem: string, ext: string): { base: string; name: string } | null {
  if (p.error || !p.exts.has(ext) || segs.length < p.folders.length) return null;
  const k = segs.length - p.folders.length;
  if (!p.folders.every((re, i) => re.test(segs[k + i]))) return null;
  const name = p.stem.exec(stem)?.groups?.name?.trim();
  return name ? { base: segs.slice(0, k).join('/'), name } : null;
}
