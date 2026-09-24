import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db } from './db.js';
import { open, seal } from './secret.js';
import { DavStorage, LocalStorage, type Storage } from './storage.js';

export interface Connection {
  kind: 'local' | 'webdav';
  name: string;               // shown in the UI, e.g. "Home NAS"
  url?: string;               // webdav base URL (resolved)
  username?: string;
  password?: string;          // sealed
  root?: string;              // local root
  libraryPath: string;        // folder inside the source that holds the shoot folders, e.g. "/Images"
}
export interface Library { storage: Storage; base: string; conn: Connection }

const file = path.join(config.dataDir, 'connection.json');
let current: Library | null = null;

export const getLibrary = () => current;
export const loadConnection = (): Connection | null => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};
export function makeStorage(c: Connection): Storage {
  return c.kind === 'local' ? new LocalStorage(c.root!) : new DavStorage(c.url!, c.username ?? '', c.password ? open(c.password) : '');
}
export function activate(c: Connection) { current = { storage: makeStorage(c), base: c.libraryPath, conn: c }; return current; }
export function saveConnection(c: Connection, plainPassword?: string) {
  const stored = { ...c, password: plainPassword ? seal(plainPassword) : c.password };
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(stored, null, 2), { mode: 0o600 });
  return stored;
}
export function disconnect() {
  current = null;
  fs.rmSync(file, { force: true });
  db.exec('DELETE FROM photos; DELETE FROM shoots; DELETE FROM files;'); // favorites/albums are kept and re-attach if the same folders return
}
