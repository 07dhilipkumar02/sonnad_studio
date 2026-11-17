// Image storage on Cloudinary (https://cloudinary.com).
// Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in backend/.env.
// Uses Cloudinary's upload API directly (signed uploads), so no extra package is needed.
import crypto from "node:crypto";

const cfg = () => ({
  cloud: (process.env.CLOUDINARY_CLOUD_NAME || "").trim(),
  key: (process.env.CLOUDINARY_API_KEY || "").trim(),
  secret: (process.env.CLOUDINARY_API_SECRET || "").trim(),
  folder: (process.env.CLOUDINARY_FOLDER || "sonnad-studio").trim(),
  base: (process.env.CLOUDINARY_API_BASE || "https://api.cloudinary.com/v1_1").replace(/\/+$/, ""),
});

/** True when all three Cloudinary settings are filled in. */
export const cloudinaryReady = () => { const c = cfg(); return !!(c.cloud && c.key && c.secret); };

// Cloudinary signature: sha1 of the sorted "key=value&..." parameters followed by the API secret
function sign(params, secret) {
  const str = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return crypto.createHash("sha1").update(str + secret).digest("hex");
}

async function call(path, params, file) {
  const c = cfg();
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = { ...params, timestamp };
  const form = new FormData();
  for (const [k, v] of Object.entries(signed)) form.append(k, String(v));
  form.append("api_key", c.key);
  form.append("signature", sign(signed, c.secret));
  if (file) form.append("file", new Blob([file.buffer], { type: file.type }), file.name);
  const res = await fetch(`${c.base}/${encodeURIComponent(c.cloud)}/image/${path}`, { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Cloudinary: ${data.error?.message || `upload failed (${res.status})`}`);
  return data;
}

/** Upload an image buffer; returns its https URL. */
export async function uploadImage(buffer, ext) {
  const type = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" }[ext] || "application/octet-stream";
  const data = await call("upload", { folder: cfg().folder }, { buffer, type, name: `image.${ext}` });
  return data.secure_url;
}

/** Is this a picture stored in our Cloudinary account? */
export const isCloudinaryUrl = (url) => {
  const c = cfg();
  return !!c.cloud && new RegExp(`^https://res\\.cloudinary\\.com/${c.cloud.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/image/upload/`).test(String(url || ""));
};

/** Delete a picture from Cloudinary by its URL (used when a product is deleted). */
export async function deleteImage(url) {
  if (!cloudinaryReady() || !isCloudinaryUrl(url)) return;
  // .../image/upload/v1712345678/sonnad-studio/abc123.jpg  ->  public id "sonnad-studio/abc123"
  const m = /\/image\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i.exec(new URL(url).pathname);
  if (!m) return;
  try { await call("destroy", { public_id: decodeURIComponent(m[1]) }); } catch (err) { console.warn(err.message); }
}
