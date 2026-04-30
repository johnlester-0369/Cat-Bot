import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve packages/database/ regardless of whether this module is executed from
// src/ (dev via tsx) or dist/database/src/ (compiled build via tsc).
//
// Dev path:      …/packages/database/src/          → .. → packages/database/
// Compiled path: …/packages/database/dist/database/src/ → .. → dist/database/
//                 dist/database/ has basename "database" and parent basename "dist"
//                 → go up two more levels to exit dist/ → packages/database/
let pkgRoot = path.resolve(__dirname, '..');
if (
  path.basename(pkgRoot) === 'database' &&
  path.basename(path.dirname(pkgRoot)) === 'dist'
) {
  pkgRoot = path.resolve(pkgRoot, '../..');
}

// Idempotent: recursive:true is a no-op when the directory already exists.
// Synchronous: guarantees the directory is ready before any downstream module
// (store.ts, client.ts) attempts a filesystem read or write on its first import.
mkdirSync(path.resolve(pkgRoot, 'database'), { recursive: true });