// Loads backend/.env into process.env before anything else runs.
// (Imported first in server.js. Uses Node's built-in .env reader, so no extra package is needed.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
if (fs.existsSync(file)) process.loadEnvFile(file);
else console.warn("backend/.env not found. Copy backend/.env.example to backend/.env and fill it in.");
