import crypto from 'node:crypto';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import { db } from './db.js';
import { progress, scan, watch, SHOOT_RE } from './indexer.js';
import { activate, disconnect, getLibrary, saveConnection, type Connection } from './library.js';
import { DavStorage, LocalStorage, davCandidates, hostGateway, type Storage } from './storage.js';
import dns from 'node:dns/promises';
import { clearThumbs } from './thumbs.js';

interface Pending { storage: Storage; conn: Omit<Connection, 'libraryPath'>; password?: string; at: number }
const pending = new Map<string, Pending>();
const sweep = () => { for (const [k, v] of pending) if (Date.now() - v.at > 30 * 60_000) pending.delete(k); };

const timeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const hidden = (n: string) => n.startsWith('@') || n.startsWith('#') || n.startsWith('.') || n === '$RECYCLE.BIN';

async function folderInfo(storage: Storage, p: string) {
  const dirs = (await storage.list(p).catch(() => [])).filter(e => e.isDir && !hidden(e.name));
  let kids = dirs.filter(e => SHOOT_RE.test(e.name)).map(e => e.name);
  // Shoots grouped in year folders: Images/2016/2016-01-25 Paris
  for (const d of dirs.filter(d => /^\d{4}/.test(d.name) && !SHOOT_RE.test(d.name)).slice(0, 40)) {
      const inner = (await storage.list(`${p.replace(/\/$/, '')}/${d.name}`).catch(() => [])).filter(e => e.isDir && SHOOT_RE.test(e.name));
    kids.push(...inner.map(e => `${d.name}/${e.name}`));
  }
  kids = kids.sort((a, b) => b.split('/').pop()!.localeCompare(a.split('/').pop()!));
  return { looksLikePhotos: kids.length > 0, kids: [...kids.slice(0, 4), ...(kids.length > 4 ? [`and ${kids.length - 4} more`] : [])] };
}

async function listFolders(storage: Storage, p: string) {
  const dirs = (await storage.list(p)).filter(e => e.isDir && !hidden(e.name)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60);
  const out: { name: string; note: string; kids: string[] }[] = [];
  for (let i = 0; i < dirs.length; i += 8) {
    out.push(...await Promise.all(dirs.slice(i, i + 8).map(async d => {
      const info = await folderInfo(storage, `${p.replace(/\/$/, '')}/${d.name}`);
      return { name: d.name, note: info.looksLikePhotos ? 'Looks like your photos' : '', kids: info.kids };
    })));
  }
  return out.sort((a, b) => Number(!!b.note) - Number(!!a.note));
}

export function setupRoutes(app: FastifyInstance) {
  app.get('/api/setup/state', async () => {
    const lib = getLibrary();
    return {
      configured: !!lib,
      connection: lib && { name: lib.conn.name, kind: lib.conn.kind, libraryPath: lib.base, host: lib.conn.url ? new URL(lib.conn.url).host : null },
      localAvailable: !!config.localRoot && fs.existsSync(config.localRoot),
      // Address the container can use to reach the NAS it runs on (for the "This NAS" shortcut).
      nasAddress: hostGateway(),
    };
  });

  app.post<{ Body: { kind: 'local' | 'webdav'; address?: string; username?: string; password?: string; port?: number; protocol?: 'auto' | 'http' | 'https'; name?: string } }>(
    '/api/setup/connect', async (req, reply) => {
      sweep();
      const b = req.body;
      let storage: Storage, conn: Pending['conn'];
      if (b.kind === 'local') {
        if (!config.localRoot || !fs.existsSync(config.localRoot)) return reply.code(400).send({ error: 'No folder is mounted on this server.' });
        storage = new LocalStorage(config.localRoot);
        conn = { kind: 'local', name: b.name || 'This server', root: config.localRoot };
      } else {
        if (!b.address?.trim()) return reply.code(400).send({ error: 'Enter your NAS address.' });
        const hostOnly = b.address.trim().replace(/^https?:\/\//i, '').replace(/[:/].*$/, '');
        if (!/^[\d.]+$/.test(hostOnly) && !/^localhost$/i.test(hostOnly)) {
          try { await dns.lookup(hostOnly); }
          catch {
            const gw = hostGateway();
            return reply.code(400).send({ error: `Exposure can’t find “${hostOnly}” from inside Docker (.local names usually don’t work there). Use the NAS’s IP address${gw ? `, or choose “This NAS”` : ''}.` });
          }
        }
        let found: DavStorage | null = null, url = '', denied = false;
        const tried: string[] = [];
        for (const u of davCandidates(b.address, b.port || undefined, b.protocol)) {
          const s = new DavStorage(u, b.username ?? '', b.password ?? '');
          try { await timeout(s.list('/'), 6000); found = s; url = u; break; }
          catch (e: any) {
            const status = e?.status ?? e?.response?.status;
            tried.push(`${u} → ${status ?? e?.cause?.code ?? e?.code ?? e?.message}`);
            if (status === 401 || status === 403) { denied = true; break; }   // reached WebDAV; credentials are the problem
          }
        }
        if (!found) {
          req.log.warn({ tried }, 'webdav connect failed');
          console.warn('[exposure] webdav connect failed:\n  ' + tried.join('\n  '));
          return reply.code(400).send({
            error: denied ? 'The username or password is not right.' : `Couldn’t reach WebDAV at ${b.address}. Check that WebDAV is turned on for your NAS.`,
            details: tried,
          });
        }
        storage = found;
        conn = { kind: 'webdav', name: b.name || 'Home NAS', url, username: b.username };
      }
      const id = crypto.randomUUID();
      pending.set(id, { storage, conn, password: b.password, at: Date.now() });
      try { return { pendingId: id, name: conn.name, folders: await listFolders(storage, '/'), here: await folderInfo(storage, '/') }; }
      catch (e) { return reply.code(400).send({ error: `Connected, but couldn’t list folders: ${(e as Error).message}` }); }
    });

  app.post<{ Body: { pendingId: string; path: string } }>('/api/setup/folders', async (req, reply) => {
    const p = pending.get(req.body.pendingId);
    if (!p) return reply.code(410).send({ error: 'Connection expired. Please connect again.' });
    return { folders: await listFolders(p.storage, req.body.path || '/'), here: await folderInfo(p.storage, req.body.path || '/') };
  });

  app.post<{ Body: { pendingId: string; path: string } }>('/api/setup/use', async (req, reply) => {
    const p = pending.get(req.body.pendingId);
    if (!p) return reply.code(410).send({ error: 'Connection expired. Please connect again.' });
    db.exec('DELETE FROM photos; DELETE FROM shoots;'); await clearThumbs();
    const conn: Connection = { ...p.conn, libraryPath: '/' + req.body.path.replace(/^\/+|\/+$/g, '') };
    activate(saveConnection(conn, p.password));
    pending.delete(req.body.pendingId);
    Object.assign(progress, { phase: 'scanning', count: 0, current: '', shoots: 0, shootsDone: 0, error: '' });
    void scan().then(watch);
    return { ok: true };
  });

  app.get('/api/setup/progress', async () => ({
    ...progress,
    photos: (db.prepare('SELECT COUNT(*) n FROM photos').get() as any).n,
    shootsFound: (db.prepare('SELECT COUNT(*) n FROM shoots').get() as any).n,
    cameras: (db.prepare('SELECT COUNT(DISTINCT camera) n FROM photos').get() as any).n,
  }));

  app.post('/api/setup/reset', async () => { disconnect(); await clearThumbs(); await watch(); Object.assign(progress, { phase: 'idle', count: 0 }); return { ok: true }; });
}
