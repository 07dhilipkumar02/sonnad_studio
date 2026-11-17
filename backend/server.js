// Sonnad Studio: Express server (API + frontend in /frontend)
import "./env.js"; // must be first: loads backend/.env
import express from "express";
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { fileURLToPath } from "node:url";
import { connectDb } from "./db.js";
import { attachUser } from "./auth.js";
import catalogRoutes from "./routes/catalog.js";
import authRoutes from "./routes/auth.js";
import cartRoutes from "./routes/cart.js";
import orderRoutes from "./routes/orders.js";
import adminRoutes from "./routes/admin.js";
import uploadRoutes from "./routes/uploads.js";
import reviewRoutes from "./routes/reviews.js";
import downloadRoutes from "./routes/downloads.js";

const app = express();
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "frontend");

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(attachUser);

// API
app.use("/api", catalogRoutes);
app.use("/api", reviewRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/downloads", downloadRoutes);
app.use("/api/admin/uploads", uploadRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// Website settings from frontend/.env. Only keys starting with PUBLIC_ are sent to the browser.
app.get("/env.js", (_req, res) => {
  let vars = {};
  try { vars = util.parseEnv(fs.readFileSync(path.join(publicDir, ".env"), "utf8")); } catch {}
  const pub = Object.fromEntries(Object.entries(vars).filter(([k]) => k.startsWith("PUBLIC_")));
  res.type("application/javascript").set("Cache-Control", "no-cache").send(`window.ENV = ${JSON.stringify(pub)};`);
});
// Never serve the .env file itself
app.use((req, res, next) => (/\/\.env/i.test(req.path) ? res.status(404).end() : next()));

// Frontend: separate sign-in pages for the website and the admin panel
const page = (file) => (_req, res) => res.sendFile(path.join(publicDir, file));
app.get("/login", page("login.html"));
app.get("/admin/login", page("admin-login.html"));
app.get("/admin", page("admin.html"));
app.get("/orders", page("index.html"));
app.get("/downloads", page("index.html"));
app.get("/checkout", page("index.html"));
app.use(express.static(publicDir, { dotfiles: "deny" }));

// Errors → JSON
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Something went wrong. Please try again." : err.message });
});

const PORT = Number(process.env.PORT) || 3000;
try {
  const db = await connectDb();
  console.log(`Connected to MongoDB (database "${db.databaseName}")`);
} catch (err) {
  console.error("\nCould not connect to MongoDB.");
  console.error(`  ${err.message}`);
  console.error("  Check MONGODB_URI in backend/.env, your internet connection, and that your IP is allowed in MongoDB Atlas → Network Access.\n");
  process.exit(1);
}
app.listen(PORT, (err) => {
  if (err) {
    console.error(err.code === "EADDRINUSE"
      ? `Port ${PORT} is already in use. Stop the other server first, or change PORT in backend/.env.`
      : err);
    process.exit(1);
  }
  console.log(`Sonnad Studio running at http://localhost:${PORT}`);
  console.log(`Customer login:         http://localhost:${PORT}/login`);
  console.log(`Admin login:            http://localhost:${PORT}/admin/login`);
});
