// Private download files (book PDFs/EPUBs and pack ZIPs) stored inside MongoDB with GridFS,
// so the whole store lives in the database. Files are kept in the "files.files" / "files.chunks" collections
// and are only sent to customers by /api/downloads after their order is confirmed.
import { GridFSBucket } from "mongodb";
import { col, getDb } from "./db.js";

const bucket = () => new GridFSBucket(getDb(), { bucketName: "files" });
const info = (name) => col("files.files").findOne({ filename: name });

/** Save a file under a name (e.g. "1794...-abc.pdf"). */
export function saveFile(name, buffer, contentType = "application/octet-stream") {
  return new Promise((resolve, reject) => {
    const up = bucket().openUploadStream(name, { metadata: { contentType } });
    up.on("finish", resolve).on("error", reject);
    up.end(buffer);
  });
}

export const fileExists = async (name) => !!name && !!await info(name);
export const fileSize = async (name) => (await info(name))?.length || 0;

/** The whole file as a Buffer (null if missing). Packs and books are small (max 50 MB). */
export async function readFile(name) {
  if (!await info(name)) return null;
  const parts = [];
  for await (const chunk of bucket().openDownloadStreamByName(name)) parts.push(chunk);
  return Buffer.concat(parts);
}

/** Stream a file to the browser. */
export const fileStream = (name) => bucket().openDownloadStreamByName(name);

export async function deleteFile(name) {
  const f = await info(name);
  if (f) await bucket().delete(f._id);
}
