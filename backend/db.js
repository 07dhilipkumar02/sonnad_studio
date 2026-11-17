// MongoDB connection, indexes and first-run sample data.
// The connection link comes from MONGODB_URI in backend/.env (e.g. your MongoDB Atlas link).
//
// Collections:
//   categories  { _id: "books", label, icon, tagline, sort, subcategories: [] }
//   products    { _id: 1, name, category, sub, price, ... }        (number ids, so shop links stay the same)
//   users       { _id: 1, name, email, passwordHash, role, createdAt }
//   sessions    { _id: token, userId, expiresAt }                   (expired sessions are removed automatically)
//   cart_items  { userId, productId, options, qty }
//   orders      { _id: 1, userId, total, status, ..., items: [{ productId, name, price, qty, options }] }
//   reviews     { userId, productId, rating, comment, createdAt }
//   library     { userId, productId, createdAt }                     (free downloads a customer claimed; not orders)
//   settings    { _id: "storeName", value }
//   counters    { _id: "products", seq }                             (next number id per collection)
//   files.files / files.chunks                                       (download files, stored with GridFS: see files.js)
import { MongoClient } from "mongodb";
import { hashPassword } from "./auth.js";

let client, database;

/** The connected database (for GridFS file storage). */
export const getDb = () => {
  if (!database) throw new Error("The database is not connected yet.");
  return database;
};

/** A collection by name, e.g. col("products"). */
export const col = (name) => {
  if (!database) throw new Error("The database is not connected yet.");
  return database.collection(name);
};

/** Current time as "YYYY-MM-DD HH:MM:SS" (UTC), the format the website expects. */
export const now = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** Next number id for a collection (1, 2, 3, ...). */
export async function nextId(name) {
  const r = await col("counters").findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return r.seq;
}

/** Every product field with its default value (new products start from this). */
export const PRODUCT_DEFAULTS = {
  name: "", category: "", sub: "", price: 0, mrp: 0, badge: "", minQty: 1, description: "", imageUrl: "", hoverImage: "",
  sizes: "", colors: "", gallery: "[]", colorImages: "{}", highlight: "", sizeChart: "", stock: 100, active: 1,
  isDigital: 0, digitalFile: "", digitalName: "", author: "", isbn: "", specs: "", previewPages: "[]", learnPoints: "",
  subtitle: "", series: "", seriesNo: 0, publisher: "", releaseDate: "", pages: 0, words: 0, fileSize: 0, createdAt: "",
};

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is missing. Put your MongoDB connection link in backend/.env");
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  database = client.db(process.env.MONGODB_DB || "sonnad");
  await database.command({ ping: 1 });
  await createIndexes();
  await seed();
  return database;
}

export const closeDb = () => client?.close();

async function createIndexes() {
  await Promise.all([
    col("users").createIndex({ email: 1 }, { unique: true }),
    col("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }), // MongoDB deletes expired sessions itself
    col("sessions").createIndex({ userId: 1 }),
    col("cart_items").createIndex({ userId: 1, productId: 1, options: 1 }, { unique: true }),
    col("reviews").createIndex({ userId: 1, productId: 1 }, { unique: true }),
    col("reviews").createIndex({ productId: 1, createdAt: -1 }),
    col("orders").createIndex({ userId: 1, _id: -1 }),
    col("orders").createIndex({ "items.productId": 1 }),
    col("products").createIndex({ category: 1, active: 1 }),
    col("library").createIndex({ userId: 1, productId: 1 }, { unique: true }), // free downloads a customer has claimed
  ]);
}

// ---------- First run ----------
// No built-in products or categories: everything in the shop is added in the admin panel and stored in MongoDB.
// Only the first admin account is created, so you can sign in to Admin.
async function seed() {
  if (!await col("users").findOne({ role: "admin" })) {
    const email = (process.env.ADMIN_EMAIL || "admin@sonnad.studio").toLowerCase();
    const password = process.env.ADMIN_PASSWORD || "admin123";
    await col("users").insertOne({ _id: await nextId("users"), name: "Admin", email, passwordHash: hashPassword(password), role: "admin", createdAt: now() });
    console.log(`Created admin user ${email} (password from ADMIN_PASSWORD in backend/.env). Change it in Admin → Profile.`);
  }
}
