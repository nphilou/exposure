import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import { config } from './config.js';
import type { Storage } from './storage.js';

const dir = path.join(config.dataDir, 'thumbs');
await fs.mkdir(dir, { recursive: true });

const inflight = new Map<string, Promise<string | null>>();
/** Returns a cached JPEG of `rel` scaled to `width`. RAW-only photos fall back to the embedded preview. */
export function render(cacheKey: string, storage: Storage, rel: string, width: number, isRaw: boolean) {
  const k = `${cacheKey}-${width}`;
  let p = inflight.get(k);
  if (!p) inflight.set(k, p = build(k, storage, rel, width, isRaw).finally(() => inflight.delete(k)));
  return p;
}

async function build(key: string, storage: Storage, rel: string, width: number, isRaw: boolean): Promise<string | null> {
  const out = path.join(dir, `${key}.jpg`);
  try { await fs.access(out); return out; } catch { /* miss */ }
  const tmp = `${out}.${process.pid}.tmp`;
  try {
    let input: string | Buffer;
    if (isRaw) {
      const buf = await exifr.thumbnail(await storage.read(rel, 8_000_000));
      if (!buf) return null;
      input = Buffer.from(buf);
    } else input = storage.localPath ? storage.localPath(rel) : await storage.read(rel);
    // No mozjpeg: several times slower on NAS CPUs for ~5% smaller files.
    await sharp(input).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(tmp);
    await fs.rename(tmp, out); // atomic: readers never see a half-written thumbnail
    return out;
  } catch (err) {
    await fs.rm(tmp, { force: true });
    console.warn('[exposure] thumb failed', rel, (err as Error).message);
    return null;
  }
}

export async function clearThumbs() { await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true }); }
