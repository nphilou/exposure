import fsSync from 'node:fs';
import path from 'node:path';
import type { FastifyReply } from 'fastify';
import { db } from './db.js';
import { getRules } from './rules.js';
import { render } from './thumbs.js';
import { getLibrary } from './library.js';

// Images: /thumb (grid) and /preview (viewer) are resized JPEGs; /original is full resolution; /file streams the file as stored.
// Without a version key, the preferred version from the library rules.
const CACHE = 'private, max-age=31536000, immutable';

export const versionRow = (id: string, v?: string) => {
  const order = getRules().preferred;
  return db.prepare(`SELECT * FROM versions WHERE photo_id = ? ${v ? 'AND key = ?' : ''}
    ORDER BY CASE key WHEN '${order[0]}' THEN 0 WHEN '${order[1]}' THEN 1 ELSE 2 END LIMIT 1`).get(...(v ? [id, v] : [id])) as any;
};
const cacheKey = (v: any) => `${v.photo_id}-${v.key}-${(v.size + v.mtime).toString(36)}`;

export async function sendResized(reply: FastifyReply, id: string, v: string | undefined, width: number) {
  const lib = getLibrary(), row = versionRow(id, v);
  if (!lib || !row) return reply.code(404).send();
  const out = await render(cacheKey(row), lib.storage, path.posix.join(lib.base, row.file), width, row.key === 'raw');
  if (!out) return reply.code(404).send();
  return reply.header('cache-control', CACHE).type('image/jpeg').send(fsSync.createReadStream(out));
}

/** Full resolution for pinch-zoom: JPEG/PNG originals are streamed untouched, anything else (HEIC, TIFF, RAW) is rendered at full size. */
export async function sendOriginal(reply: FastifyReply, id: string, v: string | undefined, filename?: string) {
  const lib = getLibrary(), row = versionRow(id, v);
  if (!lib || !row) return reply.code(404).send();
  const file = path.posix.join(lib.base, row.file);
  const ext = path.posix.extname(file).toLowerCase();
  const plain = ext === '.jpg' || ext === '.jpeg' || ext === '.png';
  reply.header('cache-control', CACHE);
  if (filename) reply.header('content-disposition', `attachment; filename="${filename.replace(/["\\\r\n]/g, '')}${plain ? ext : '.jpg'}"`);
  if (plain) return reply.type(ext === '.png' ? 'image/png' : 'image/jpeg').send(await lib.storage.stream(file));
  const out = await render(cacheKey(row), lib.storage, file, 100_000, row.key === 'raw');
  if (!out) return reply.code(404).send();
  return reply.type('image/jpeg').send(fsSync.createReadStream(out));
}

export async function sendFile(reply: FastifyReply, id: string, v: string | undefined) {
  const lib = getLibrary(), row = versionRow(id, v);
  if (!lib || !row) return reply.code(404).send();
  return reply.header('content-disposition', `attachment; filename="${path.basename(row.file)}"`)
    .send(await lib.storage.stream(path.posix.join(lib.base, row.file)));
}
