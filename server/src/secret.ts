import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// The NAS password has to be readable by this server to reconnect after a restart.
// It is encrypted at rest with a random key kept next to it in the data volume:
// this protects against the config file leaking on its own, not against someone with the whole volume.
const keyFile = path.join(config.dataDir, 'secret.key');
function key(): Buffer {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32), { mode: 0o600 });
  return fs.readFileSync(keyFile);
}
export function seal(text: string): string {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function open(blob: string): string {
  const b = Buffer.from(blob, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
