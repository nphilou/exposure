import path from 'node:path';

// npm workspaces run scripts from server/, so resolve relative paths against where `npm` was invoked.
const base = process.env.INIT_CWD ?? process.cwd();
const abs = (p: string) => path.resolve(base, p);

export const config = {
  // Folder on this server that the "Found on this server" source browses (a Docker bind mount, usually).
  localRoot: process.env.EXPOSURE_LOCAL_ROOT || process.env.EXPOSURE_PHOTOS_DIR ? abs((process.env.EXPOSURE_LOCAL_ROOT || process.env.EXPOSURE_PHOTOS_DIR)!) : '',
  dataDir: abs(process.env.EXPOSURE_DATA_DIR ?? './data'),
  port: Number(process.env.PORT ?? 8787),
  publicUrl: (process.env.EXPOSURE_PUBLIC_URL || '').replace(/\/+$/, ''),
  resetAuth: process.env.EXPOSURE_RESET_AUTH === '1',
  webDir: process.env.EXPOSURE_WEB_DIR ? abs(process.env.EXPOSURE_WEB_DIR) : '',
};
