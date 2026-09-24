import { config } from './config.js';
import { build } from './server.js';
import { scan, watch } from './indexer.js';
import { activate, loadConnection } from './library.js';
import { initAuth } from './auth.js';
import { initRules } from './rules.js';

initAuth();
initRules();
const app = await build();
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`[exposure] http://localhost:${config.port}`);

const saved = loadConnection();
if (saved) {
  activate(saved);
  console.log(`[exposure] library: ${saved.name} ${saved.libraryPath}`);
  void scan().then(watch);
} else console.log('[exposure] not connected yet — open the app to connect your storage');
