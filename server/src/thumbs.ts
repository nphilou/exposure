import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import exifr from 'exifr';
import { config } from './config.js';
import type { Storage } from './storage.js';

const dir = path.join(config.dataDir, 'thumbs');
await fs.mkdir(dir, { recursive: true });

/** Returns a cached JPEG of `rel` scaled to `width`. RAW-only photos fall back to the embedded preview. */
export async function render(cacheKey: string, storage: Storage, rel: string, width: number, isRaw: boolean): Promise<string | null> {
  const out = path.join(dir, `${cacheKey}-${width}.jpg`);
  try { await fs.access(out); return out; } catch { /* miss */ }
  try {
    let input: string | Buffer;
    if (isRaw) {
      const buf = await exifr.thumbnail(await storage.read(rel, 8_000_000));
      if (!buf) return null;
      input = Buffer.from(buf);
    } else input = storage.localPath ? storage.localPath(rel) : await storage.read(rel);
    await sharp(input).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(out);
    return out;
  } catch (err) {
    console.warn('[exposure] thumb failed', rel, (err as Error).message);
    return null;
  }
}

export async function clearThumbs() { await fs.rm(dir, { recursive: true, force: true }); await fs.mkdir(dir, { recursive: true }); }
