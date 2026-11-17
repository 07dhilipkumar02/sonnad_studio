// Sets the admin login to ADMIN_EMAIL / ADMIN_PASSWORD from backend/.env.
//   npm run reset-admin
// Use it when you forget the admin password, or after changing ADMIN_PASSWORD in backend/.env.
// Creates the admin account if there is none. Signs the admin out everywhere.
import "../env.js";
import { connectDb, closeDb, col, nextId, now } from "../db.js";
import { hashPassword } from "../auth.js";

const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || "");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error("Set a valid ADMIN_EMAIL in backend/.env"); process.exit(1); }
if (password.length < 6) { console.error("Set ADMIN_PASSWORD (at least 6 characters) in backend/.env"); process.exit(1); }

await connectDb();
const users = col("users");
// the admin with this email, or else the first admin account
const admin = await users.findOne({ email, role: "admin" }) || await users.findOne({ role: "admin" });
const other = await users.findOne({ email, role: { $ne: "admin" } });
if (other) { console.error(`${email} is a customer account. Use a different ADMIN_EMAIL.`); await closeDb(); process.exit(1); }

if (admin) {
  await users.updateOne({ _id: admin._id }, { $set: { email, passwordHash: hashPassword(password) } });
  await col("sessions").deleteMany({ userId: admin._id });
  console.log(`Admin login updated: ${email} with the password from backend/.env`);
} else {
  await users.insertOne({ _id: await nextId("users"), name: "Admin", email, passwordHash: hashPassword(password), role: "admin", createdAt: now() });
  console.log(`Admin account created: ${email} with the password from backend/.env`);
}
await closeDb();
