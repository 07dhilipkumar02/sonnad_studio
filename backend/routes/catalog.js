// Public catalog: categories and products.
import { Router } from "express";
import { col } from "../db.js";
import { HttpError } from "../validate.js";
import { getSettings } from "./settings.js";
import { listZip, shortName } from "../zipfiles.js";

const router = Router();

export async function getCategories() {
  const cats = await col("categories").find().sort({ sort: 1, label: 1 }).toArray();
  return cats.map((c) => ({ id: c._id, label: c.label, icon: c.icon, tagline: c.tagline || "", subcategories: c.subcategories || [] }));
}

const fileType = (f) => (/\.epub$/i.test(f || "") ? "EPUB" : /\.zip$/i.test(f || "") ? "ZIP" : f ? "PDF" : "");

/** Average rating and review count per product id. */
export async function ratingsFor(ids) {
  const rows = await col("reviews").aggregate([
    { $match: { productId: { $in: ids } } },
    { $group: { _id: "$productId", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]).toArray();
  return new Map(rows.map((r) => [r._id, r]));
}

/** A product as the website sees it. */
export function publicProduct(p, cat, r) {
  return {
    id: p._id, name: p.name, category: p.category, categoryLabel: cat?.label ?? "", sub: p.sub,
    price: p.price, mrp: p.mrp, badge: p.badge, minQty: p.minQty, description: p.description,
    imageUrl: p.imageUrl, hoverImage: p.hoverImage, sizes: p.sizes, colors: p.colors, gallery: p.gallery, colorImages: p.colorImages,
    highlight: p.highlight, sizeChart: p.sizeChart, stock: p.stock,
    isDigital: p.isDigital, fileType: fileType(p.digitalFile),
    author: p.author, isbn: p.isbn, specs: p.specs, previewPages: p.previewPages, learnPoints: p.learnPoints,
    subtitle: p.subtitle, series: p.series, seriesNo: p.seriesNo, publisher: p.publisher, releaseDate: p.releaseDate,
    pages: p.pages, words: p.words, fileSize: p.fileSize,
    rating: r ? Math.round(r.avg * 10) / 10 : null,
    reviewCount: r?.count || 0,
  };
}
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

router.get("/settings", async (_req, res) => {
  res.json(await getSettings());
});

router.get("/categories", async (_req, res) => {
  res.json(await getCategories());
});

// GET /api/products?category=books&sub=Journals&q=leather&limit=8
router.get("/products", async (req, res) => {
  const { category, sub, q } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 100);
  const cats = await col("categories").find().toArray();
  const catById = new Map(cats.map((c) => [c._id, c]));
  const filter = { active: 1, category: { $in: [...catById.keys()] } };
  if (category && category !== "all") filter.category = String(category);
  if (sub) filter.sub = String(sub);
  if (q) {
    const re = new RegExp(escapeRegex(String(q).trim()), "i");
    const labelMatch = cats.filter((c) => re.test(c.label)).map((c) => c._id);
    filter.$or = [{ name: re }, { sub: re }, { category: { $in: labelMatch } }];
  }
  const products = await col("products").find(filter).toArray();
  // follow the category order set in Admin → Categories, then oldest product first
  products.sort((a, b) => (catById.get(a.category)?.sort ?? 0) - (catById.get(b.category)?.sort ?? 0) || a._id - b._id);
  const shown = products.slice(0, limit);
  const ratings = await ratingsFor(shown.map((p) => p._id));
  res.json(shown.map((p) => publicProduct(p, catById.get(p.category), ratings.get(p._id))));
});

router.get("/products/:id", async (req, res) => {
  const p = await col("products").findOne({ _id: Number(req.params.id), active: 1 });
  const cat = p && await col("categories").findOne({ _id: p.category });
  if (!p || !cat) throw new HttpError(404, "Product not found.");
  const ratings = await ratingsFor([p._id]);
  res.json(publicProduct(p, cat, ratings.get(p._id)));
});

// Files inside a downloadable ZIP pack (names and sizes only, no contents)
router.get("/products/:id/files", async (req, res) => {
  const p = await col("products").findOne({ _id: Number(req.params.id), active: 1, isDigital: 1 });
  if (!p || !/\.zip$/i.test(p.digitalFile || "")) return res.json([]);
  try {
    res.json((await listZip(p.digitalFile)).map((e) => ({ name: shortName(e.name), path: e.name, size: e.size })));
  } catch { res.json([]); }
});

export default router;
