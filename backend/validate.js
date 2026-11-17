// Small input-validation helpers. Throwing HttpError sends that status + message to the client.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const bad = (msg) => { throw new HttpError(400, msg); };

export function str(value, field, { min = 1, max = 200 } = {}) {
  const s = typeof value === "string" ? value.trim() : "";
  if (s.length < min) bad(`${field} is required.`);
  if (s.length > max) bad(`${field} is too long (max ${max} characters).`);
  return s;
}

export function int(value, field, { min = 0, max = 1e9 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) bad(`${field} must be a whole number from ${min} to ${max}.`);
  return n;
}

export function email(value) {
  const s = str(value, "Email", { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) bad("Please enter a valid email address.");
  return s;
}

// A person's name: letters (any language), spaces, dots, apostrophes, hyphens. No digits.
export function personName(value, field = "Name") {
  const s = str(value, field, { min: 2, max: 60 }).replace(/\s+/g, " ");
  if (!/^\p{L}[\p{L}\p{M} .'-]*$/u.test(s)) bad(`${field} can only contain letters, spaces, dots and hyphens.`);
  return s;
}

// Indian mobile number: 10 digits starting 6-9. Accepts +91 / 91 / 0 prefixes and spaces or dashes.
export function mobile(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) bad("Mobile number is required.");
  let digits = raw.replace(/[\s-]/g, "");
  if (!/^\+?\d+$/.test(digits)) bad("Mobile number can only contain digits.");
  digits = digits.replace(/^\+?91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(digits)) bad("Enter a valid 10-digit mobile number (starting with 6, 7, 8 or 9).");
  return digits;
}

// Place names (city): letters, spaces, dots, hyphens
export function placeName(value, field) {
  const s = str(value, field, { min: 2, max: 60 }).replace(/\s+/g, " ");
  if (!/^\p{L}[\p{L}\p{M} .'-]*$/u.test(s)) bad(`${field} can only contain letters.`);
  return s;
}

// "S, M, L" -> ["S","M","L"] (trimmed, no duplicates, max 20 items of 30 chars)
export function parseList(value) {
  const seen = new Set();
  return String(value ?? "").split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter((s) => {
    if (!s || s.length > 30 || seen.has(s.toLowerCase())) return false;
    seen.add(s.toLowerCase());
    return true;
  }).slice(0, 20);
}

// Colour entries look like "Black" or "Navy #1d2a4a"; the name is what the customer picks
export const colorName = (entry) => entry.replace(/\s*#[0-9a-f]{3,8}$/i, "").trim();

// Checks the chosen size/colour against the product and returns e.g. "Size: M · Colour: Black"
export function productOptions(product, body) {
  const sizes = parseList(product.sizes), colors = parseList(product.colors).map(colorName);
  const parts = [];
  if (sizes.length) {
    const size = sizes.find((s) => s.toLowerCase() === String(body.size ?? "").trim().toLowerCase());
    if (!size) bad(`Please choose a size for "${product.name}".`);
    parts.push(`Size: ${size}`);
  }
  if (colors.length) {
    const color = colors.find((c) => c.toLowerCase() === String(body.color ?? "").trim().toLowerCase());
    if (!color) bad(`Please choose a colour for "${product.name}".`);
    parts.push(`Colour: ${color}`);
  }
  return parts.join(" · ");
}
