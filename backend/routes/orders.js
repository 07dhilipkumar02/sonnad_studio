// Checkout and order history for signed-in users.
import { Router } from "express";
import { col, nextId, now } from "../db.js";
import { requireAuth } from "../auth.js";
import { HttpError, str, bad, personName, mobile, placeName } from "../validate.js";
import { getCart } from "./cart.js";
import { getSettings } from "./settings.js";

/** Delivery charge for an order (Admin → Settings → Checkout). Downloads-only orders have no delivery. */
export async function deliveryFeeFor(subtotal, digitalOnly) {
  if (digitalOnly) return 0;
  const s = await getSettings();
  if (!s.deliveryCharge) return 0;
  if (s.freeDeliveryAbove && subtotal >= s.freeDeliveryAbove) return 0;
  return s.deliveryCharge;
}

const router = Router();
router.use(requireAuth);

/** Order lines with each product's current picture and digital flag (deleted products keep their saved name/price). */
export async function withProductInfo(items) {
  const products = new Map((await col("products").find({ _id: { $in: items.map((i) => i.productId) } },
    { projection: { imageUrl: 1, isDigital: 1 } }).toArray()).map((p) => [p._id, p]));
  return items.map((i) => {
    const p = products.get(i.productId);
    return { productId: i.productId, name: i.name, price: i.price, qty: i.qty, options: i.options || "",
      imageUrl: p?.imageUrl ?? null, isDigital: !!p?.isDigital, exists: !!p };
  });
}

/** Put physical items back in stock (digital items have no stock). */
export async function restock(items) {
  for (const i of items) await col("products").updateOne({ _id: i.productId, isDigital: { $ne: 1 } }, { $inc: { stock: i.qty } });
}

/** Take physical items out of stock. Fails (and undoes itself) if any product doesn't have enough. */
export async function takeStock(items) {
  const done = [];
  for (const i of items) {
    const p = await col("products").findOne({ _id: i.productId }, { projection: { isDigital: 1, stock: 1, name: 1 } });
    if (!p || p.isDigital) continue;
    const r = await col("products").updateOne({ _id: i.productId, stock: { $gte: i.qty } }, { $inc: { stock: -i.qty } });
    if (!r.modifiedCount) {
      await restock(done);
      throw new HttpError(409, `Only ${p.stock} left of "${p.name}".`);
    }
    done.push(i);
  }
}

const publicOrder = (o) => ({
  id: o._id, total: o.total, deliveryFee: o.deliveryFee || 0, status: o.status, name: o.name, phone: o.phone, address: o.address, city: o.city, pincode: o.pincode,
  courier: o.courier || "", tracking: o.tracking || "", note: o.note || "", updatedAt: o.updatedAt || "", createdAt: o.createdAt,
});

// Place an order from the current cart
router.post("/", async (req, res) => {
  const name = personName(req.body.name, "Full name");
  const phone = mobile(req.body.phone);
  const cart = await getCart(req.user.id);
  if (!cart.items.length) throw new HttpError(400, "Your cart is empty.");
  // Orders with only digital books are downloaded, so no delivery address is needed
  const digitalOnly = cart.items.every((i) => i.isDigital);
  let address = "Digital download", city = "-", pincode = "";
  if (!digitalOnly) {
    address = str(req.body.address, "Address", { min: 5, max: 300 });
    city = placeName(req.body.city, "City");
    pincode = str(req.body.pincode, "PIN code", { max: 6 });
    if (!/^[1-9]\d{5}$/.test(pincode)) bad("Enter a valid 6-digit PIN code.");
  }

  // Minimum order and stock apply to the product's total across sizes/colours
  const perProduct = new Map();
  for (const i of cart.items) {
    const t = perProduct.get(i.productId) || { ...i, qty: 0 };
    t.qty += i.qty;
    perProduct.set(i.productId, t);
  }
  for (const i of perProduct.values()) {
    if (i.isDigital) continue; // digital books: one copy, no stock
    if (i.qty < i.minQty) throw new HttpError(400, `"${i.name}" has a minimum order of ${i.minQty} pieces in total.`);
    if (i.qty > i.stock) throw new HttpError(409, `Only ${i.stock} left of "${i.name}".`);
  }
  await takeStock([...perProduct.values()].filter((i) => !i.isDigital));

  const deliveryFee = await deliveryFeeFor(cart.total, digitalOnly);
  const total = cart.total + deliveryFee;
  const id = await nextId("orders");
  try {
    await col("orders").insertOne({
      _id: id, userId: req.user.id, total, deliveryFee, status: "placed", name, phone, address, city, pincode,
      courier: "", tracking: "", note: "", updatedAt: "", createdAt: now(),
      items: cart.items.map((i) => ({ productId: i.productId, name: i.name, price: i.price, qty: i.qty, options: i.options })),
    });
  } catch (err) {
    await restock([...perProduct.values()].filter((i) => !i.isDigital));
    throw err;
  }
  await col("cart_items").deleteMany({ userId: req.user.id });
  res.status(201).json({ id, total, deliveryFee, status: "placed" });
});

router.get("/", async (req, res) => {
  const orders = await col("orders").find({ userId: req.user.id }).sort({ _id: -1 }).toArray();
  const ratings = new Map((await col("reviews").find({ userId: req.user.id }).toArray()).map((r) => [r.productId, r.rating]));
  res.json(await Promise.all(orders.map(async (o) => ({
    ...publicOrder(o),
    items: (await withProductInfo(o.items)).map(({ exists, ...i }) => ({
      ...i,
      myRating: ratings.get(i.productId) || 0,
      canRate: exists, // false once the product has been deleted
    })),
  }))));
});

// Customers can cancel their own order while it is still waiting for confirmation
router.post("/:id/cancel", async (req, res) => {
  const id = Number(req.params.id);
  const order = await col("orders").findOne({ _id: id, userId: req.user.id });
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.status !== "placed") {
    throw new HttpError(400, order.status === "cancelled" ? "This order is already cancelled."
      : "This order has already been confirmed, so it can't be cancelled here. Please contact us.");
  }
  // only cancel if it is still "placed" (in case the admin confirmed it a moment ago)
  const r = await col("orders").updateOne({ _id: id, status: "placed" }, { $set: { status: "cancelled", updatedAt: now() } });
  if (!r.modifiedCount) throw new HttpError(409, "This order was just updated. Please refresh the page.");
  await restock(order.items);
  res.json({ ok: true, status: "cancelled" });
});

export default router;
