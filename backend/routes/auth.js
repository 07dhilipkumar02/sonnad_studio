// Account: register, sign in, sign out, current user.
import { Router } from "express";
import { col, nextId, now } from "../db.js";
import { hashPassword, verifyPassword, createSession, destroySession, currentToken, ADMIN_COOKIE } from "../auth.js";
import { HttpError, str, email, personName } from "../validate.js";

const router = Router();

router.post("/register", async (req, res) => {
  const name = personName(req.body.name);
  const mail = email(req.body.email);
  const password = str(req.body.password, "Password", { min: 6, max: 128 });

  if (await col("users").findOne({ email: mail })) {
    throw new HttpError(409, "An account with this email already exists.");
  }
  const id = await nextId("users");
  try {
    await col("users").insertOne({ _id: id, name, email: mail, passwordHash: hashPassword(password), role: "customer", createdAt: now() });
  } catch (err) {
    if (err.code === 11000) throw new HttpError(409, "An account with this email already exists.");
    throw err;
  }
  await createSession(res, id);
  res.status(201).json({ id, name, email: mail, role: "customer" });
});

async function checkLogin(req) {
  const mail = email(req.body.email);
  const password = str(req.body.password, "Password", { max: 128 });
  const user = await col("users").findOne({ email: mail });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new HttpError(401, "Wrong email or password.");
  }
  return user;
}

// Website sign in (customers only)
router.post("/login", async (req, res) => {
  const user = await checkLogin(req);
  if (user.role === "admin") throw new HttpError(403, "This is an admin account. Please sign in on the admin login page.");
  await createSession(res, user._id);
  res.json({ id: user._id, name: user.name, email: user.email, role: user.role });
});

// Admin panel sign in (admins only, separate cookie)
router.post("/admin/login", async (req, res) => {
  const user = await checkLogin(req);
  if (user.role !== "admin") throw new HttpError(403, "This account does not have admin access.");
  await createSession(res, user._id, ADMIN_COOKIE);
  res.json({ id: user._id, name: user.name, email: user.email, role: user.role });
});

router.post("/password", async (req, res) => {
  if (!req.user) throw new HttpError(401, "Please sign in first.");
  const current = str(req.body.current, "Current password", { max: 128 });
  const next = str(req.body.next, "New password", { max: 128 });
  if (next.length < 8) throw new HttpError(400, "New password must be at least 8 characters.");
  const user = await col("users").findOne({ _id: req.user.id });
  if (!verifyPassword(current, user?.passwordHash)) throw new HttpError(400, "Your current password is not correct.");
  if (current === next) throw new HttpError(400, "Choose a password that's different from the current one.");
  await col("users").updateOne({ _id: req.user.id }, { $set: { passwordHash: hashPassword(next) } });
  // sign out other devices
  await col("sessions").deleteMany({ userId: req.user.id, _id: { $ne: currentToken(req) } });
  res.json({ ok: true });
});

router.post("/logout", async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  res.json(req.user || null);
});

export default router;
