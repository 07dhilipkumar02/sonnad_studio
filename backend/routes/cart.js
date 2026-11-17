// Cart for signed-in users. (Guests keep a cart in the browser; it is merged on sign-in.)
// A cart line is one product with one choice of size/colour ("options").
import { Router } from "express";
import { col } from "../db.js";
import { requireAuth } from "../auth.js";
import { HttpError, int, productOptions } from "../validate.js";

const router = Router();
router.use(requireAuth);

export async function getCart(userId) {
  const lines = await col("cart_items").find({ userId }).toArray();
  const products = new Map((await col("products").find({ _id: { $in: [...new Set(lines.map((l) => l.productId))] }, active: 1 }).toArray())
    .map((p) => [p._id, p]));
  const items = lines.filter((l) => products.has(l.productId)).map((l) => {
    const p = products.get(l.productId);
    return { productId: l.productId, options: l.options, qty: l.qty, name: p.name, price: p.price, minQty: p.minQty,
      isDigital: p.isDigital, sub: p.sub, category: p.category, stock: p.stock, imageUrl: p.imageUrl };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.options.localeCompare(b.options));
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const count = items.reduce((sum, i) => sum + i.qty, 0);
  return { items, total, count };
}

async function assertProduct(productId) {
  const p = await col("products").findOne({ _id: productId, active: 1 });
  if (!p) throw new HttpError(404, "Product not found.");
  return p;
}
const optionsOf = (req) => String(req.body?.options ?? req.query.options ?? "").slice(0, 120);

/** Add qty to a cart line (creating it if needed), never above 99. */
async function addLine(userId, productId, options, qty) {
  const key = { userId, productId, options };
  const line = await col("cart_items").findOne(key);
  if (line) await col("cart_items").updateOne(key, { $set: { qty: Math.min(line.qty + qty, 99) } });
  else await col("cart_items").updateOne(key, { $setOnInsert: { qty: Math.min(qty, 99) } }, { upsert: true });
}

router.get("/", async (req, res) => res.json(await getCart(req.user.id)));

// Add qty to a line. Body: { productId, qty, size?, color? }
router.post("/", async (req, res) => {
  const productId = int(req.body.productId, "productId", { min: 1 });
  const qty = int(req.body.qty ?? 1, "qty", { min: 1, max: 99 });
  const p = await assertProduct(productId);
  if (p.isDigital) { // a digital book is bought once
    await col("cart_items").updateOne({ userId: req.user.id, productId, options: "" }, { $setOnInsert: { qty: 1 } }, { upsert: true });
    return res.json(await getCart(req.user.id));
  }
  const options = productOptions(p, req.body);
  // First line of a product starts at its minimum order
  const already = await col("cart_items").countDocuments({ userId: req.user.id, productId });
  await addLine(req.user.id, productId, options, already ? qty : Math.max(qty, p.minQty));
  res.json(await getCart(req.user.id));
});

// Set exact qty of a line (0 removes). Body: { qty, options }
router.put("/:productId", async (req, res) => {
  const productId = int(req.params.productId, "productId", { min: 1 });
  const qty = int(req.body.qty, "qty", { min: 0, max: 99 });
  const options = optionsOf(req);
  const key = { userId: req.user.id, productId, options };
  if (qty === 0) {
    await col("cart_items").deleteOne(key);
  } else {
    const p = await assertProduct(productId);
    const { matchedCount } = await col("cart_items").updateOne(key, { $set: { qty: p.isDigital ? 1 : qty } });
    if (!matchedCount) throw new HttpError(404, "That item is not in your cart.");
  }
  res.json(await getCart(req.user.id));
});

router.delete("/:productId", async (req, res) => {
  await col("cart_items").deleteOne({ userId: req.user.id, productId: Number(req.params.productId), options: optionsOf(req) });
  res.json(await getCart(req.user.id));
});

// Merge a guest cart [{productId, qty, options}] into the account cart
router.post("/merge", async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 100) : [];
  for (const item of items) {
    const productId = Number(item.productId), qty = Number(item.qty);
    if (!Number.isInteger(productId) || !Number.isInteger(qty) || qty <= 0) continue;
    const p = await col("products").findOne({ _id: productId, active: 1 });
    if (!p) continue;
    if (p.isDigital) await col("cart_items").updateOne({ userId: req.user.id, productId, options: "" }, { $setOnInsert: { qty: 1 } }, { upsert: true });
    else await addLine(req.user.id, productId, String(item.options ?? "").slice(0, 120), Math.max(qty, p.minQty));
  }
  res.json(await getCart(req.user.id));
});

export default router;
