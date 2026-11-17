// Moves pictures that are still in frontend/uploads to Cloudinary and updates every link to them
// (product photos, hover photos, gallery, colour photos, "look inside" pages, logo, banner).
//   npm run images-to-cloudinary
// Needs CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET in backend/.env.
// Safe to run again: pictures already on Cloudinary are skipped. Local files are not deleted.
import "../env.js";
import fs from "node:fs";
import path from "node:path";
import { connectDb, closeDb, col } from "../db.js";
import { cloudinaryReady, uploadImage } from "../cloudinary.js";
import { UPLOAD_DIR } from "../routes/uploads.js";

if (!cloudinaryReady()) {
  console.error("Cloudinary is not set up. Fill in CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in backend/.env.");
  process.exit(1);
}
await connectDb();

const moved = new Map(); // "/uploads/x.jpg" -> "https://res.cloudinary.com/..."
async function cloudUrl(local) {
  if (moved.has(local)) return moved.get(local);
  const file = path.join(UPLOAD_DIR, path.basename(local));
  if (!fs.existsSync(file)) { console.warn(`  missing on disk, left as is: ${local}`); moved.set(local, local); return local; }
  const ext = path.extname(file).slice(1).toLowerCase().replace("jpeg", "jpg");
  const url = await uploadImage(fs.readFileSync(file), ext);
  console.log(`  uploaded ${local}`);
  moved.set(local, url);
  return url;
}
// Replace every "/uploads/..." inside a text (plain link or JSON list)
async function swap(text) {
  if (typeof text !== "string" || !text.includes("/uploads/")) return text;
  let out = text;
  for (const m of new Set(text.match(/\/uploads\/[\w.-]+/g) || [])) out = out.split(m).join(await cloudUrl(m));
  return out;
}

let changed = 0;
for (const p of await col("products").find().toArray()) {
  const set = {};
  for (const k of ["imageUrl", "hoverImage", "gallery", "colorImages", "previewPages"]) {
    const v = await swap(p[k]);
    if (v !== p[k]) set[k] = v;
  }
  if (Object.keys(set).length) { await col("products").updateOne({ _id: p._id }, { $set: set }); changed++; console.log(`product #${p._id} ${p.name}: updated`); }
}
for (const key of ["logoImage", "bannerImage"]) {
  const s = await col("settings").findOne({ _id: key });
  const v = await swap(s?.value);
  if (s && v !== s.value) { await col("settings").updateOne({ _id: key }, { $set: { value: v } }); changed++; console.log(`setting ${key}: updated`); }
}
console.log(`\nDone: ${moved.size} picture(s) moved to Cloudinary, ${changed} product(s)/setting(s) updated.`);
console.log("The old copies in frontend/uploads were kept; you can delete them once you've checked the shop.");
await closeDb();
