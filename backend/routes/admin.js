// Admin: manage products, categories, customers, reviews, settings and orders. Requires a user with role = 'admin'.
import { Router } from "express";
import { col, nextId, now, PRODUCT_DEFAULTS } from "../db.js";
import { requireAuth, requireAdmin } from "../auth.js";
import { HttpError, str, int, bad, parseList, colorName } from "../validate.js";
import { withProductInfo, restock, takeStock } from "./orders.js";
import fs from "node:fs";
import path from "node:path";
import { UPLOAD_DIR } from "./uploads.js";
import { fileExists, fileSize, deleteFile } from "../files.js";
import { isCloudinaryUrl, deleteImage } from "../cloudinary.js";
import { getSettings, saveSettings } from "./settings.js";

const router = Router();
router.use(requireAuth, requireAdmin);

const ORDER_STATUSES = ["placed", "confirmed", "shipped", "delivered", "cancelled"];

const IMG_RE = /^(\/[\w./-]+|https?:\/\/\S+)$/;
function parseJson(v, fallback) {
  if (typeof v !== "string") return v ?? fallback;
  try { return JSON.parse(v || "null") ?? fallback; } catch { return fallback; }
}
// Extra photos (max 8)
function readGallery(v) {
  const arr = parseJson(v, []);
  if (!Array.isArray(arr)) bad("Gallery must be a list of images.");
  const out = arr.map((x) => String(x).trim()).filter(Boolean);
  if (out.length > 8) bad("You can add up to 8 extra photos.");
  if (out.some((u) => u.length > 500 || !IMG_RE.test(u))) bad("Each gallery photo must be an uploaded image or a link.");
  return out;
}
// { "Black": "/uploads/..", ... } — only for colours the product actually has
function readColorImages(v, colors) {
  const obj = parseJson(v, {});
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) bad("Colour photos are not valid.");
  const names = parseList(colors).map(colorName);
  const out = {};
  for (const [k, url] of Object.entries(obj)) {
    const name = names.find((n) => n.toLowerCase() === String(k).trim().toLowerCase());
    if (!name || !url) continue;
    if (String(url).length > 500 || !IMG_RE.test(String(url))) bad(`The photo for "${name}" is not valid.`);
    out[name] = String(url);
  }
  return out;
}

// ISBN-10 or ISBN-13 (hyphens/spaces allowed), checked with its check digit
function readIsbn(v) {
  const raw = str(v ?? "", "ISBN", { min: 0, max: 20 });
  if (!raw) return "";
  const d = raw.replace(/[\s-]/g, "").toUpperCase();
  let ok = false;
  if (/^\d{13}$/.test(d)) ok = [...d].reduce((s, c, i) => s + +c * (i % 2 ? 3 : 1), 0) % 10 === 0;
  else if (/^\d{9}[\dX]$/.test(d)) ok = [...d].reduce((s, c, i) => s + (c === "X" ? 10 : +c) * (10 - i), 0) % 11 === 0;
  if (!ok) bad("That ISBN doesn't look right. Check the 10 or 13 digits.");
  return raw;
}

// Book-only fields (subtitle, series, publisher, release date, length, file size)
async function readBookFields(body, digitalFile) {
  const date = str(body.releaseDate ?? "", "Release date", { min: 0, max: 10 });
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) bad("Release date must be a valid date.");
  const num = (v, label, max) => (v === "" || v == null ? 0 : int(v, label, { min: 0, max }));
  const size = digitalFile ? await fileSize(digitalFile) : 0;
  return {
    subtitle: str(body.subtitle ?? "", "Subtitle", { min: 0, max: 120 }),
    series: str(body.series ?? "", "Series", { min: 0, max: 80 }),
    seriesNo: num(body.seriesNo, "Book number in series", 999),
    publisher: str(body.publisher ?? "", "Publisher", { min: 0, max: 100 }),
    releaseDate: date,
    pages: num(body.pages, "Pages", 100000),
    words: num(body.words, "Total words", 10_000_000),
    fileSize: size,
  };
}

async function readProduct(body) {
  const category = str(body.category, "Category", { max: 40 });
  if (!await col("categories").findOne({ _id: category }, { projection: { _id: 1 } })) bad("Choose a valid category.");
  // Subcategory is no longer edited in the admin form; null = keep the product's current one
  const sub = typeof body.sub === "string" ? str(body.sub, "Subcategory", { min: 0, max: 60 }) : null;
  const imageUrl = str(body.imageUrl ?? "", "Image URL", { min: 0, max: 500 });
  if (imageUrl && !/^(https?:\/\/|\/)/.test(imageUrl)) bad("Image URL must start with http(s):// or /");
  const hoverImage = str(body.hoverImage ?? "", "Second image URL", { min: 0, max: 500 });
  if (hoverImage && !/^(https?:\/\/|\/)/.test(hoverImage)) bad("Second image URL must start with http(s):// or /");
  const price = int(body.price, "Price", { min: 0, max: 10_000_000 });
  const mrp = body.mrp === "" || body.mrp == null ? 0 : int(body.mrp, "Original price (MRP)", { min: 0, max: 10_000_000 });
  if (mrp && mrp <= price) bad("Original price (MRP) must be higher than the selling price, or left empty.");
  const digitalFile = String(body.digitalFile ?? "").trim();
  if (digitalFile && (!/^[\w.-]+\.(pdf|epub|zip)$/.test(digitalFile) || !await fileExists(digitalFile))) {
    bad("The digital file was not found. Please upload it again.");
  }
  if ((body.isDigital === true || body.isDigital === "on") && !digitalFile) bad("Upload the PDF, EPUB or ZIP file customers will download.");
  return {
    name: str(body.name, "Name", { max: 120 }),
    category, sub,
    price, mrp,
    badge: str(body.badge ?? "", "Badge", { min: 0, max: 20 }),
    minQty: int(body.minQty || 1, "Minimum order", { min: 1, max: 99 }),
    description: str(body.description ?? "", "Description", { min: 0, max: 2000 }),
    highlight: str(body.highlight ?? "", "Highlight", { min: 0, max: 200 }),
    sizeChart: str(body.sizeChart ?? "", "Size chart", { min: 0, max: 2000 }),
    gallery: JSON.stringify(readGallery(body.gallery)),
    previewPages: JSON.stringify(readGallery(body.previewPages)),
    isDigital: body.isDigital === true || body.isDigital === "on" || body.isDigital === 1 ? 1 : 0,
    digitalFile,
    digitalName: str(body.digitalName ?? "", "File name", { min: 0, max: 120 }),
    author: str(body.author ?? "", "Author / brand", { min: 0, max: 100 }),
    isbn: readIsbn(body.isbn),
    specs: str(body.specs ?? "", "Specifications", { min: 0, max: 1500 }),
    learnPoints: str(body.learnPoints ?? "", "What you will learn", { min: 0, max: 1500 }),
    colorImages: JSON.stringify(readColorImages(body.colorImages, body.colors)),
    imageUrl, hoverImage,
    sizes: parseList(body.sizes).join(", "),
    colors: parseList(body.colors).join(", "),
    stock: int(body.stock ?? 100, "Stock", { min: 0, max: 1_000_000 }),
    active: body.active === false || body.active === 0 ? 0 : 1,
  };
}

// The product as the admin panel expects it
const adminProduct = ({ _id, ...p }) => ({ id: _id, ...PRODUCT_DEFAULTS, ...p });

router.get("/stats", async (_req, res) => {
  const [products, customers, orders, revenue] = await Promise.all([
    col("products").countDocuments({ active: 1 }),
    col("users").countDocuments({ role: "customer" }),
    col("orders").countDocuments(),
    col("orders").aggregate([{ $match: { status: { $ne: "cancelled" } } }, { $group: { _id: null, n: { $sum: "$total" } } }]).toArray(),
  ]);
  res.json({ products, customers, orders, revenue: revenue[0]?.n || 0 });
});

router.get("/products", async (_req, res) => {
  res.json((await col("products").find().sort({ _id: -1 }).toArray()).map(adminProduct));
});

router.post("/products", async (req, res) => {
  const p = await readProduct(req.body);
  const book = await readBookFields(req.body, p.digitalFile);
  const doc = { ...PRODUCT_DEFAULTS, ...p, sub: p.sub ?? "", ...book, _id: await nextId("products"), createdAt: now() };
  await col("products").insertOne(doc);
  res.status(201).json(adminProduct(doc));
});

router.put("/products/:id", async (req, res) => {
  const id = int(req.params.id, "id", { min: 1 });
  const old = await col("products").findOne({ _id: id }, { projection: { category: 1, sub: 1 } });
  if (!old) throw new HttpError(404, "Product not found.");
  const p = await readProduct(req.body);
  // keep the subcategory unless the category changed
  const sub = p.sub ?? (old.category === p.category ? old.sub : "");
  const book = await readBookFields(req.body, p.digitalFile);
  await col("products").updateOne({ _id: id }, { $set: { ...p, sub, ...book } });
  res.json(adminProduct(await col("products").findOne({ _id: id })));
});

// Hide: removes the product from the store but keeps it in the admin list
router.post("/products/:id/hide", async (req, res) => {
  const id = int(req.params.id, "id", { min: 1 });
  const { matchedCount } = await col("products").updateOne({ _id: id }, { $set: { active: 0 } });
  if (!matchedCount) throw new HttpError(404, "Product not found.");
  await col("cart_items").deleteMany({ productId: id });
  res.json({ ok: true });
});

// Delete permanently. Past orders keep their own copy of the name and price,
// so order history is unaffected. Cart entries and reviews go with the product.
router.delete("/products/:id", async (req, res) => {
  const id = int(req.params.id, "id", { min: 1 });
  const product = await col("products").findOne({ _id: id });
  if (!product) throw new HttpError(404, "Product not found.");
  await col("products").deleteOne({ _id: id });
  await col("cart_items").deleteMany({ productId: id });
  await col("reviews").deleteMany({ productId: id });

  // Remove its uploaded images if no other product uses them
  const urls = [product.imageUrl, product.hoverImage, ...parseJson(product.gallery, []), ...Object.values(parseJson(product.colorImages, {})), ...parseJson(product.previewPages, [])];
  for (const url of new Set(urls)) {
    const m = /^\/uploads\/([\w.-]+)$/.exec(url || "");
    if (!m && !isCloudinaryUrl(url)) continue;
    const quoted = JSON.stringify(url).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const inUse = await col("products").findOne({ $or: [{ imageUrl: url }, { hoverImage: url },
      { gallery: { $regex: quoted } }, { colorImages: { $regex: quoted } }, { previewPages: { $regex: quoted } }] }, { projection: { _id: 1 } });
    if (inUse) continue;
    if (m) fs.rm(path.join(UPLOAD_DIR, m[1]), { force: true }, () => {});
    else await deleteImage(url); // picture stored on Cloudinary
  }
  if (product.digitalFile && !await col("products").findOne({ digitalFile: product.digitalFile }, { projection: { _id: 1 } })) {
    await deleteFile(product.digitalFile);
  }
  res.json({ ok: true });
});

// ---------------- Categories ----------------
const CATEGORY_ICONS = ["book", "shirt", "briefcase", "gift", "tag", "box"];
const sameLabel = (label) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

router.get("/categories", async (_req, res) => {
  const [cats, counts] = await Promise.all([
    col("categories").find().sort({ sort: 1, label: 1 }).toArray(),
    col("products").aggregate([{ $group: { _id: "$category", n: { $sum: 1 } } }]).toArray(),
  ]);
  const count = new Map(counts.map((c) => [c._id, c.n]));
  res.json(cats.map((c) => ({ id: c._id, label: c.label, icon: c.icon, tagline: c.tagline || "", sort: c.sort, productCount: count.get(c._id) || 0 })));
});

function readCategory(body) {
  const label = str(body.label, "Category name", { min: 2, max: 40 }).replace(/\s+/g, " ");
  const icon = CATEGORY_ICONS.includes(body.icon) ? body.icon : "tag";
  const tagline = str(body.tagline ?? "", "Tagline", { min: 0, max: 120 }).replace(/\s+/g, " ");
  return { label, icon, tagline };
}

router.post("/categories", async (req, res) => {
  const { label, icon, tagline } = readCategory(req.body);
  if (await col("categories").findOne({ label: sameLabel(label) })) bad("A category with this name already exists.");
  // URL-friendly id from the name, made unique
  const base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "category";
  let id = base, n = 2;
  while (id === "all" || await col("categories").findOne({ _id: id })) id = `${base}-${n++}`;
  const last = await col("categories").find().sort({ sort: -1 }).limit(1).toArray();
  const sort = (last[0]?.sort || 0) + 1;
  await col("categories").insertOne({ _id: id, label, icon, tagline, sort, subcategories: [] });
  res.status(201).json({ id, label, icon, tagline, sort, productCount: 0 });
});

router.put("/categories/:id", async (req, res) => {
  const { label, icon, tagline } = readCategory(req.body);
  if (await col("categories").findOne({ label: sameLabel(label), _id: { $ne: req.params.id } })) {
    bad("A category with this name already exists.");
  }
  const { matchedCount } = await col("categories").updateOne({ _id: req.params.id }, { $set: { label, icon, tagline } });
  if (!matchedCount) throw new HttpError(404, "Category not found.");
  res.json({ id: req.params.id, label, icon, tagline });
});

// Move a category one place up or down in the menu
router.post("/categories/:id/move", async (req, res) => {
  const dir = req.body.direction === "up" ? -1 : 1;
  const list = (await col("categories").find().sort({ sort: 1, label: 1 }).toArray()).map((c) => c._id);
  const i = list.indexOf(req.params.id);
  if (i < 0) throw new HttpError(404, "Category not found.");
  const j = i + dir;
  if (j >= 0 && j < list.length) [list[i], list[j]] = [list[j], list[i]];
  await col("categories").bulkWrite(list.map((id, k) => ({ updateOne: { filter: { _id: id }, update: { $set: { sort: k + 1 } } } })));
  res.json({ ok: true });
});

router.delete("/categories/:id", async (req, res) => {
  const cat = await col("categories").findOne({ _id: req.params.id });
  if (!cat) throw new HttpError(404, "Category not found.");
  const n = await col("products").countDocuments({ category: cat._id });
  if (n) bad(`This category still has ${n} product${n === 1 ? "" : "s"}. Move them to another category or delete them first.`);
  await col("categories").deleteOne({ _id: cat._id });
  res.json({ ok: true });
});

// ---------------- Customers ----------------
router.get("/customers", async (_req, res) => {
  const [users, stats] = await Promise.all([
    col("users").find({ role: "customer" }).sort({ _id: -1 }).limit(500).toArray(),
    col("orders").aggregate([{ $group: {
      _id: "$userId", orders: { $sum: 1 }, lastOrder: { $max: "$createdAt" },
      spent: { $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, "$total", 0] } },
    } }]).toArray(),
  ]);
  const by = new Map(stats.map((s) => [s._id, s]));
  res.json(users.map((u) => {
    const s = by.get(u._id);
    return { id: u._id, name: u.name, email: u.email, createdAt: u.createdAt, orders: s?.orders || 0, spent: s?.spent || 0, lastOrder: s?.lastOrder || null };
  }));
});

// ---------------- Reviews ----------------
router.get("/reviews", async (_req, res) => {
  const reviews = await col("reviews").find().sort({ createdAt: -1 }).limit(500).toArray();
  const [users, products] = await Promise.all([
    col("users").find({ _id: { $in: reviews.map((r) => r.userId) } }, { projection: { name: 1, email: 1 } }).toArray(),
    col("products").find({ _id: { $in: reviews.map((r) => r.productId) } }, { projection: { name: 1 } }).toArray(),
  ]);
  const u = new Map(users.map((x) => [x._id, x])), p = new Map(products.map((x) => [x._id, x]));
  res.json(reviews.filter((r) => u.has(r.userId) && p.has(r.productId)).map((r) => ({
    userId: r.userId, productId: r.productId, rating: r.rating, comment: r.comment, createdAt: r.createdAt,
    customer: u.get(r.userId).name, email: u.get(r.userId).email, product: p.get(r.productId).name,
  })));
});

router.delete("/reviews/:userId/:productId", async (req, res) => {
  const { deletedCount } = await col("reviews").deleteOne({
    userId: int(req.params.userId, "userId", { min: 1 }), productId: int(req.params.productId, "productId", { min: 1 }),
  });
  if (!deletedCount) throw new HttpError(404, "Review not found.");
  res.json({ ok: true });
});

// ---------------- Settings ----------------
router.get("/settings", async (_req, res) => res.json(await getSettings()));

router.put("/settings", async (req, res) => res.json(await saveSettings(req.body || {})));

// ---------------- Orders ----------------
router.get("/orders", async (_req, res) => {
  const orders = await col("orders").find().sort({ _id: -1 }).limit(500).toArray();
  const users = new Map((await col("users").find({ _id: { $in: [...new Set(orders.map((o) => o.userId))] } },
    { projection: { name: 1, email: 1 } }).toArray()).map((u) => [u._id, u]));
  res.json(await Promise.all(orders.map(async (o) => ({
    id: o._id, total: o.total, deliveryFee: o.deliveryFee || 0, status: o.status, name: o.name, phone: o.phone, address: o.address, city: o.city, pincode: o.pincode,
    courier: o.courier || "", tracking: o.tracking || "", note: o.note || "", updatedAt: o.updatedAt || "", createdAt: o.createdAt,
    email: users.get(o.userId)?.email || "", account: users.get(o.userId)?.name || "",
    items: (await withProductInfo(o.items)).map(({ exists, ...i }) => i),
  }))));
});

// Update an order: status and/or courier, tracking number, note for the customer.
// Cancelling puts physical items back in stock; un-cancelling takes them out again.
router.patch("/orders/:id", async (req, res) => {
  const id = Number(req.params.id);
  const order = await col("orders").findOne({ _id: id });
  if (!order) throw new HttpError(404, "Order not found.");
  const b = req.body || {};
  const status = b.status === undefined ? order.status : String(b.status);
  if (!ORDER_STATUSES.includes(status)) bad(`Status must be one of: ${ORDER_STATUSES.join(", ")}`);
  const set = { status };
  if (b.courier !== undefined) set.courier = str(b.courier, "Courier", { min: 0, max: 60 });
  if (b.tracking !== undefined) set.tracking = str(b.tracking, "Tracking number", { min: 0, max: 80 });
  if (b.note !== undefined) set.note = str(b.note, "Note", { min: 0, max: 300 });
  if (status !== order.status) set.updatedAt = now();

  if (status === "cancelled" && order.status !== "cancelled") await restock(order.items);
  else if (order.status === "cancelled" && status !== "cancelled") {
    try { await takeStock(order.items); }
    catch (err) { throw new HttpError(400, `${err.message} So this order can't be re-opened.`); }
  }
  await col("orders").updateOne({ _id: id }, { $set: set });
  res.json({ ok: true, status });
});

// Delete an order. Items that never left the shop go back into stock.
router.delete("/orders/:id", async (req, res) => {
  const id = int(req.params.id, "id", { min: 1 });
  const order = await col("orders").findOne({ _id: id });
  if (!order) throw new HttpError(404, "Order not found.");
  // cancelled orders were already put back in stock
  if (!["shipped", "delivered", "cancelled"].includes(order.status)) await restock(order.items);
  await col("orders").deleteOne({ _id: id });
  res.json({ ok: true });
});

export default router;
