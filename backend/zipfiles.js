// Reads the list of files inside a ZIP pack (stored in MongoDB), and pulls a single file out of it.
// Used so customers can download one file from a pack instead of the whole ZIP.
import zlib from "node:zlib";
import { readFile } from "./files.js";

const cache = new Map(); // stored file name -> { buf, entries }   (stored files never change; a new upload gets a new name)

function parse(buf) {
  // End-of-central-directory record: search backwards for its signature
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid ZIP file.");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (!name.endsWith("/")) entries.push({ name, size, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function load(file) {
  if (cache.has(file)) return cache.get(file);
  const buf = await readFile(file);
  if (!buf) throw new Error("The file is missing.");
  const hit = { buf, entries: parse(buf) };
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  cache.set(file, hit);
  return hit;
}

export async function listZip(file) {
  return (await load(file)).entries;
}

export async function readZipEntry(file, name) {
  const { buf, entries } = await load(file);
  const entry = entries.find((e) => e.name === name);
  if (!entry) return null;
  const head = entry.localOffset;
  const start = head + 30 + buf.readUInt16LE(head + 26) + buf.readUInt16LE(head + 28);
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error("This file uses a ZIP format that is not supported.");
}

// "Startup Business Pack/04 Pricing Calculator.csv" -> "04 Pricing Calculator.csv"
export const shortName = (name) => name.split("/").pop();
