// Digital products: customers download files they have bought or claimed for free.
// A paid file unlocks once the admin marks the order Confirmed, Shipped or Delivered (i.e. payment received).
// Free downloads are NOT orders: they are saved in the customer's "library" (collection: library).
import { Router } from "express";
import path from "node:path";
import { col, now } from "../db.js";
import { requireAuth } from "../auth.js";
import { HttpError, int } from "../validate.js";
import { readZipEntry, shortName } from "../zipfiles.js";
import { fileExists, fileSize, fileStream } from "../files.js";

export const UNLOCKED = ["confirmed", "shipped", "delivered"];
const router = Router();
router.use(requireAuth);

// Owned = in the free library, or in a paid order that has been confirmed
const ownsProduct = async (userId, productId) =>
  !!(await col("library").findOne({ userId, productId }, { projection: { _id: 1 } })
    || await col("orders").findOne({ userId, status: { $in: UNLOCKED }, "items.productId": productId }, { projection: { _id: 1 } }));

// Which digital products can this customer download?
router.get("/", async (req, res) => {
  const [paid, free] = await Promise.all([
    col("orders").distinct("items.productId", { userId: req.user.id, status: { $in: UNLOCKED } }),
    col("library").distinct("productId", { userId: req.user.id }),
  ]);
  const digital = await col("products").find({ _id: { $in: [...new Set([...paid, ...free])] }, isDigital: 1 }, { projection: { _id: 1 } }).toArray();
  res.json(digital.map((p) => p._id));
});

// Free e-book or pack: add it to the customer's library (no order is created)
router.post("/:productId/claim", async (req, res) => {
  const productId = int(req.params.productId, "productId", { min: 1 });
  const p = await col("products").findOne({ _id: productId });
  if (!p || !p.active || !p.isDigital) throw new HttpError(404, "This download is not available.");
  if (p.price > 0) throw new HttpError(400, "This item is not free. Please add it to your cart.");
  await col("library").updateOne({ userId: req.user.id, productId }, { $setOnInsert: { createdAt: now() } }, { upsert: true });
  res.json({ ok: true });
});

// Remove a free download from the customer's library (they can get it again any time while it is free)
router.delete("/:productId", async (req, res) => {
  const productId = int(req.params.productId, "productId", { min: 1 });
  const { deletedCount } = await col("library").deleteOne({ userId: req.user.id, productId });
  if (!deletedCount) throw new HttpError(404, "This item is not in your free downloads.");
  res.json({ ok: true });
});

// One file from inside a ZIP pack:  /api/downloads/:id/file?path=<path inside the zip>
router.get("/:productId/file", async (req, res) => {
  const productId = int(req.params.productId, "productId", { min: 1 });
  const p = await col("products").findOne({ _id: productId });
  if (!p || !p.isDigital || !/\.zip$/i.test(p.digitalFile || "")) throw new HttpError(404, "This download is not available.");
  if (!await ownsProduct(req.user.id, productId) && req.user.role !== "admin") throw new HttpError(403, "You can download this after your order is confirmed.");
  if (!await fileExists(p.digitalFile)) throw new HttpError(404, "The file is missing. Please contact us.");
  const data = await readZipEntry(p.digitalFile, String(req.query.path || ""));
  if (!data) throw new HttpError(404, "That file is not in this pack.");
  const name = shortName(String(req.query.path)).replace(/[^\w .()-]/g, "").trim() || "file";
  res.set("Cache-Control", "private, no-store");
  res.attachment(name).send(data);
});

router.get("/:productId", async (req, res) => {
  const productId = int(req.params.productId, "productId", { min: 1 });
  const p = await col("products").findOne({ _id: productId });
  if (!p || !p.isDigital || !p.digitalFile) throw new HttpError(404, "This download is not available.");
  if (!await ownsProduct(req.user.id, productId) && req.user.role !== "admin") {
    throw new HttpError(403, "You can download this after your order is confirmed.");
  }
  if (!await fileExists(p.digitalFile)) throw new HttpError(404, "The file is missing. Please contact us.");
  const ext = path.extname(p.digitalFile).toLowerCase();
  const niceName = (p.digitalName || p.name).replace(/\.(pdf|epub|zip)$/i, "").replace(/[^\w .()-]/g, "").trim() + ext;
  res.set("Cache-Control", "private, no-store");
  res.set("Content-Length", String(await fileSize(p.digitalFile)));
  res.type({ ".pdf": "application/pdf", ".epub": "application/epub+zip", ".zip": "application/zip" }[ext] || "application/octet-stream");
  // ?view=1 opens a PDF in the reader instead of saving it
  res.set("Content-Disposition", `${req.query.view === "1" && ext === ".pdf" ? "inline" : "attachment"}; filename="${niceName}"`);
  await new Promise((resolve, reject) => fileStream(p.digitalFile).on("error", reject).pipe(res).on("finish", resolve));
});

export default router;
