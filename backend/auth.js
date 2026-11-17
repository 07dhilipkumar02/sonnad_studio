// Password hashing, sessions and auth middleware (Node's built-in crypto only).
import crypto from "node:crypto";
import { col } from "./db.js";

const SESSION_DAYS = Number(process.env.SESSION_DAYS) || 7;
// The shop and the admin panel sign in separately, each with its own cookie,
// so signing in to one never signs you in to the other.
export const COOKIE_NAME = "sid";        // website (customers)
export const ADMIN_COOKIE = "asid";      // admin panel

/** Requests from the admin panel: /api/admin/* or any call the admin page marks with "X-Panel: admin". */
export const isAdminPanel = (req) => req.originalUrl.startsWith("/api/admin") || req.get("x-panel") === "admin";
export const cookieFor = (req) => (isAdminPanel(req) ? ADMIN_COOKIE : COOKIE_NAME);

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(password, salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export async function createSession(res, userId, cookieName = COOKIE_NAME) {
  const token = crypto.randomBytes(32).toString("hex");
  const maxAge = SESSION_DAYS * 86400_000;
  await col("sessions").insertOne({ _id: token, userId, expiresAt: new Date(Date.now() + maxAge) });
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge,
  });
}

export async function destroySession(req, res) {
  const name = cookieFor(req);
  const token = readCookie(req, name);
  if (token) await col("sessions").deleteOne({ _id: token });
  res.clearCookie(name);
}

/** The session token this request is using (shop or admin cookie). */
export const currentToken = (req) => readCookie(req, cookieFor(req)) || "";

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) {
      try { return decodeURIComponent(v.join("=")); } catch { return null; }
    }
  }
  return null;
}

/** Sets req.user if a valid session cookie is present.
 *  Admin panel requests use the admin cookie and only accept admin accounts;
 *  website requests use the shop cookie and only accept customer accounts. */
export async function attachUser(req, _res, next) {
  const admin = isAdminPanel(req);
  const token = readCookie(req, admin ? ADMIN_COOKIE : COOKIE_NAME);
  if (token) {
    const session = await col("sessions").findOne({ _id: token });
    if (session && session.expiresAt > new Date()) {
      const u = await col("users").findOne({ _id: session.userId });
      if (u && (u.role === "admin") === admin) req.user = { id: u._id, name: u.name, email: u.email, role: u.role };
    } else if (session) {
      await col("sessions").deleteOne({ _id: token });
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Please sign in first." });
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Admin access only." });
  next();
}
