import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import { config } from './config.js';
import { findPreviews } from './rawpreview.js';
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
      const buf = await rawPreview(storage, rel, width);
      if (!buf) return null;
      input = buf;
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

/**
 * The JPEG the camera embedded in a RAW file. Grid thumbnails take the smallest preview that is still
 * sharp enough, so a CR2's full-size JPEG isn't pulled over WebDAV for a 480 px tile; the viewer takes the largest.
 */
async function rawPreview(storage: Storage, rel: string, width: number): Promise<Buffer | null> {
  const head = await storage.read(rel, 512_000);
  const all = findPreviews(head).filter(p => p.length < 40_000_000);
  const enough = all.filter(p => p.length >= 150_000);
  const order = width <= 1200 && enough.length ? [...enough].reverse() : all;
  for (const p of order) {
    const buf = p.offset + p.length <= head.length ? head.subarray(p.offset, p.offset + p.length) : await storage.readRange(rel, p.offset, p.length);
    if (buf[0] !== 0xff || buf[1] !== 0xd8) continue;
    const m = await sharp(buf).metadata().catch(() => null);  // skips lossless-JPEG sensor data sharp can't decode
    if (m?.format === 'jpeg' && m.width) return buf;
  }
  const t = await exifr.thumbnail(head).catch(() => undefined);
  return t ? Buffer.from(t) : null;
}

export async function clearThumbs() { await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true }); }
