import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// WHY: Extracted into a dedicated module to ensure ESM evaluates this config before resolving downstream imports.
// Ensures `process.env` is populated from the central `cat-bot/.env` before Prisma/MongoDB/Neon clients check it.
config({ path: path.resolve(__dirname, '../../cat-bot/.env') });
