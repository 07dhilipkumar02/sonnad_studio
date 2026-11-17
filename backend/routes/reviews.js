// Product reviews. Only customers who received the product (a delivered order) can rate it.
import { Router } from "express";
import { col, now } from "../db.js";
import { requireAuth } from "../auth.js";
import { HttpError, int, str } from "../validate.js";

const router = Router();

// Public: reviews for one product, newest first
router.get("/products/:id/reviews", async (req, res) => {
  const id = int(req.params.id, "id", { min: 1 });
  const all = await col("reviews").find({ productId: id }).sort({ createdAt: -1 }).toArray();
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of all) dist[r.rating]++;
  const count = all.length;
  const avg = count ? all.reduce((s, r) => s + r.rating, 0) / count : 0;
  const shown = all.slice(0, 50);
  const users = new Map((await col("users").find({ _id: { $in: shown.map((r) => r.userId) } }, { projection: { name: 1 } }).toArray())
    .map((u) => [u._id, u.name]));
  res.json({
    summary: { count, avg: Math.round(avg * 10) / 10, dist },
    reviews: shown.filter((r) => users.has(r.userId))
      .map((r) => ({ rating: r.rating, comment: r.comment, createdAt: r.createdAt, name: users.get(r.userId).split(" ")[0] })),
  });
});

// Add or update your own review
router.post("/reviews", requireAuth, async (req, res) => {
  const productId = int(req.body.productId, "productId", { min: 1 });
  const rating = int(req.body.rating, "Rating", { min: 1, max: 5 });
  if (!await col("products").findOne({ _id: productId }, { projection: { _id: 1 } })) {
    throw new HttpError(404, "This product is no longer sold, so it can't be rated.");
  }
  const comment = str(req.body.comment ?? "", "Comment", { min: 0, max: 500 });
  const received = await col("orders").findOne({ userId: req.user.id, status: "delivered", "items.productId": productId }, { projection: { _id: 1 } });
  if (!received) throw new HttpError(403, "You can rate a product after it has been delivered to you.");
  await col("reviews").updateOne({ userId: req.user.id, productId },
    { $set: { rating, comment, createdAt: now() } }, { upsert: true });
  res.json({ productId, rating, comment });
});

export default router;
