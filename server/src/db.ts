import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'exposure.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL; -- WAL + NORMAL is crash-safe; avoids an fsync per statement (slow on NAS disks)
CREATE TABLE IF NOT EXISTS shoots (
  id TEXT PRIMARY KEY, folder TEXT NOT NULL, title TEXT NOT NULL,
  date TEXT NOT NULL, camera TEXT, count INTEGER NOT NULL DEFAULT 0, edited INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY, shoot_id TEXT NOT NULL REFERENCES shoots(id) ON DELETE CASCADE,
  name TEXT NOT NULL, taken_at TEXT NOT NULL, camera TEXT, lens TEXT, focal REAL,
  fnum REAL, shutter TEXT, iso INTEGER, width INTEGER, height INTEGER,
  has_edit INTEGER NOT NULL, has_raw INTEGER NOT NULL, sig TEXT NOT NULL, hay TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  key TEXT NOT NULL, label TEXT NOT NULL, fmt TEXT NOT NULL, size INTEGER NOT NULL, file TEXT NOT NULL,
  PRIMARY KEY (photo_id, key)
);
-- Exposure never writes to the photo folders, so user state lives here.
CREATE TABLE IF NOT EXISTS favorites (photo_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS albums (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS album_photos (
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE, photo_id TEXT NOT NULL,
  PRIMARY KEY (album_id, photo_id)
);
-- One row per paired browser/phone/app. Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
-- Every image file in the library with its metadata. Photos/versions/shoots are derived from this
-- table by the library rules, so changing a rule regroups without rescanning the NAS.
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY, dir TEXT NOT NULL, name TEXT NOT NULL, ext TEXT NOT NULL,
  size INTEGER NOT NULL, mtime INTEGER NOT NULL, meta TEXT
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS photos_taken ON photos(taken_at DESC);
CREATE INDEX IF NOT EXISTS photos_shoot ON photos(shoot_id);
CREATE INDEX IF NOT EXISTS photos_shoot_cover ON photos(shoot_id, has_edit DESC, taken_at);
`);
db.exec('PRAGMA foreign_keys = ON');

// Additive migrations for databases created by older versions.
const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map(c => c.name);
if (!cols('versions').includes('mtime')) db.exec('ALTER TABLE versions ADD COLUMN mtime INTEGER NOT NULL DEFAULT 0');
