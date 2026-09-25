import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import https from 'node:https';
import fsSync from 'node:fs';
import { createClient, type WebDAVClient, type FileStat } from 'webdav';

// NAS boxes serve WebDAV over HTTPS with self-signed certificates. Accept those only for
// addresses on the local network, where there's no public CA to validate against anyway.
const lanAgent = new https.Agent({ rejectUnauthorized: false });
export const isLanHost = (host: string) =>
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host)
  || /\.(local|lan|home|fritz\.box)$/i.test(host) || !host.includes('.');

/** Docker's bridge gateway = the NAS itself, as seen from inside the container. */
export function hostGateway(): string | null {
  try {
    if (!fsSync.existsSync('/.dockerenv')) return null;
    for (const line of fsSync.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1)) {
      const [, dest, gw] = line.trim().split(/\s+/);
      if (dest === '00000000' && gw) return gw.match(/../g)!.reverse().map(h => parseInt(h, 16)).join('.');
    }
  } catch { /* not linux */ }
  return null;
}

export interface Entry { name: string; isDir: boolean; size: number; mtime: number }

/** Read-only view of a photo source. Paths are '/'-separated and relative to the storage root. */
export interface Storage {
  list(p: string): Promise<Entry[]>;
  /** Read a file; with `maxBytes` only the first bytes (enough for EXIF / embedded previews). */
  read(p: string, maxBytes?: number): Promise<Buffer>;
  /** Read `length` bytes starting at `start` (an embedded preview deep inside a RAW file). */
  readRange(p: string, start: number, length: number): Promise<Buffer>;
  stream(p: string): Promise<Readable>;
  /** Absolute on-disk path, when the source is a mounted folder. */
  localPath?(p: string): string;
}

export class LocalStorage implements Storage {
  constructor(readonly root: string) {}
  localPath(p: string) {
    const abs = path.resolve(this.root, '.' + path.posix.normalize('/' + p));
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new Error('path escapes root');
    return abs;
  }
  async list(p: string) {
    const out: Entry[] = [];
    for (const e of await fsp.readdir(this.localPath(p), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      try {
        const st = await fsp.stat(path.join(this.localPath(p), e.name)); // follows symlinks
        out.push({ name: e.name, isDir: st.isDirectory(), size: st.size, mtime: Math.floor(st.mtimeMs) });
      } catch { /* broken link */ }
    }
    return out;
  }
  async read(p: string, maxBytes?: number) {
    return maxBytes ? this.readRange(p, 0, maxBytes) : fsp.readFile(this.localPath(p));
  }
  async readRange(p: string, start: number, length: number) {
    const fh = await fsp.open(this.localPath(p), 'r');
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await fh.read(buf, 0, length, start);
      return buf.subarray(0, bytesRead);
    } finally { await fh.close(); }
  }
  async stream(p: string) { return fs.createReadStream(this.localPath(p)); }
}

export class DavStorage implements Storage {
  private client: WebDAVClient;
  constructor(readonly url: string, username: string, password: string) {
    const host = new URL(url).hostname;
    this.client = createClient(url, { username, password, ...(isLanHost(host) ? { httpsAgent: lanAgent } : {}) });
  }
  async list(p: string) {
    const items = (await this.client.getDirectoryContents(p || '/')) as FileStat[];
    return items.filter(i => !i.basename.startsWith('.')).map(i => ({
      name: i.basename, isDir: i.type === 'directory', size: i.size ?? 0, mtime: Date.parse(i.lastmod) || 0,
    }));
  }
  async read(p: string, maxBytes?: number) {
    const data = await this.client.getFileContents(p, { format: 'binary', ...(maxBytes ? { headers: { Range: `bytes=0-${maxBytes - 1}` } } : {}) });
    const buf = Buffer.from(data as ArrayBuffer);
    return maxBytes ? buf.subarray(0, maxBytes) : buf; // servers that ignore Range send the whole file
  }
  async readRange(p: string, start: number, length: number) {
    const res = await this.client.customRequest(p, { method: 'GET', headers: { Range: `bytes=${start}-${start + length - 1}` } });
    const buf = Buffer.from(await res.arrayBuffer());
    return res.status === 206 ? buf.subarray(0, length) : buf.subarray(start, start + length);
  }
  async stream(p: string) { return this.client.createReadStream(p) as unknown as Readable; }
}

/** Try the address as given, then common WebDAV ports/schemes ("Automatic"). */
export function davCandidates(address: string, port?: number, protocol: 'auto' | 'http' | 'https' = 'auto'): string[] {
  let a = address.trim().replace(/\/+$/, '');
  // Inside Docker, "localhost" is the container itself; the NAS is the bridge gateway.
  const gw = hostGateway();
  if (gw) a = a.replace(/^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i, (_m, s = '') => s + gw);
  if (/^https?:\/\//i.test(a)) return [a];
  const host = a;
  const hasPort = /:\d+(\/|$)/.test(host);
  if (hasPort) return protocol === 'https' ? [`https://${host}`] : protocol === 'http' ? [`http://${host}`] : [`https://${host}`, `http://${host}`];
  if (port) return protocol === 'https' ? [`https://${host}:${port}`] : protocol === 'http' ? [`http://${host}:${port}`] : [`https://${host}:${port}`, `http://${host}:${port}`];
  const out: string[] = [];
  const add = (s: string, pt: number) => { if (protocol === 'auto' || protocol === s) out.push(`${s}://${host}:${pt}`); };
  add('https', 5006); add('http', 5005); add('https', 443); add('http', 80);
  return out;
}
