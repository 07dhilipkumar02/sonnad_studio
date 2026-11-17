// Admin image uploads: the browser sends the raw file; we check it really is an image,
// save it on Cloudinary (or in frontend/uploads if Cloudinary isn't set up) and return its URL.
import { Router, raw } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { requireAuth, requireAdmin } from "../auth.js";
import { bad, HttpError } from "../validate.js";
import { saveFile } from "../files.js";
import { cloudinaryReady, uploadImage } from "../cloudinary.js";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const UPLOAD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "frontend", "uploads");
// Digital products (e-books, ZIP packs) are stored privately inside MongoDB (GridFS); they are only sent by /api/downloads
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB
const FILE_TYPES = { pdf: "application/pdf", epub: "application/epub+zip", zip: "application/zip" };

// PDF starts with "%PDF-"; EPUB is a ZIP whose first entry is "mimetype" = application/epub+zip
function detectBookExt(buf) {
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "pdf";
  if (buf.length >= 58 && buf[0] === 0x50 && buf[1] === 0x4b && buf.toString("ascii", 30, 58).includes("application/epub+zip")) return "epub";
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return "zip"; // ZIP pack
  return null;
}

// Identify the format from the file's first bytes, not from its name or the browser's claim.
function detectExt(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString("ascii", 0, 6))) return "gif";
  return null;
}

const router = Router();

router.post(
  "/",
  requireAuth,
  requireAdmin,
  raw({ type: "image/*", limit: MAX_BYTES }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) bad("Choose an image file to upload.");
    const ext = detectExt(req.body);
    if (!ext) bad("Only JPG, PNG, WebP or GIF images are allowed.");
    // Saved on Cloudinary when it is set up in backend/.env; otherwise in frontend/uploads
    if (cloudinaryReady()) {
      try { return res.status(201).json({ url: await uploadImage(req.body, ext) }); }
      catch (err) { throw new HttpError(502, `${err.message}. Check the Cloudinary settings in backend/.env.`); }
    }
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), req.body);
    res.status(201).json({ url: `/uploads/${name}` });
  },
);

// Admin: upload the file customers will download (PDF, EPUB or ZIP, max 50 MB)
router.post(
  "/file",
  requireAuth,
  requireAdmin,
  raw({ type: () => true, limit: MAX_FILE_BYTES }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) bad("Choose a PDF, EPUB or ZIP file to upload.");
    const ext = detectBookExt(req.body);
    if (!ext) bad("Only PDF, EPUB or ZIP files can be sold as digital downloads.");
    const file = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
    await saveFile(file, req.body, FILE_TYPES[ext]);
    let original = "";
    try { original = decodeURIComponent(String(req.get("X-File-Name") || "")); } catch {}
    res.status(201).json({ file, name: original.replace(/[^\w .()-]/g, "").slice(0, 120) || `book.${ext}`, size: req.body.length });
  },
);

export default router;
