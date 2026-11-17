// Store-wide settings the admin can change: announcement, payment note, home banner, footer.
import { col } from "../db.js";
import { bad } from "../validate.js";

// type: text | bool | image (site path or https URL) | url (https link) | email | phone | category
// No built-in store text: every value comes from MongoDB (Admin → Settings). Empty means "not shown".
export const SETTINGS = {
  storeName:       { type: "text", max: 60, def: "", label: "Store name" },
  metaDescription: { type: "text", max: 160, def: "", label: "Store description" },
  logoImage:       { type: "image", def: "", label: "Logo" }, // empty = the built-in drawn logo
  announcement:   { type: "text", max: 160, def: "", label: "Announcement" },
  announcementOn: { type: "bool", def: false },
  paymentNote:    { type: "text", max: 80, def: "", label: "Payment note" },
  digitalPaymentNote: { type: "text", max: 160, def: "", label: "Digital payment note" },
  paymentMethodTitle: { type: "text", max: 80, def: "", label: "Payment method name" },
  deliveryCharge:     { type: "money", def: 0, label: "Delivery charge" },          // 0 = free delivery
  freeDeliveryAbove:  { type: "money", def: 0, label: "Free delivery above" },      // 0 = no free-delivery limit
  digitalCheckoutNote: { type: "text", max: 300, def: "", label: "Digital-only checkout note" },

  // Business pack download page
  packIntro:        { type: "text", max: 300, def: "", label: "Pack page: line under the description" },
  packCompleteText: { type: "text", max: 300, def: "", label: "Pack page: complete pack text" },
  packSingleText:   { type: "text", max: 300, def: "", label: "Pack page: single file text" },
  packSingleHelp:   { type: "longtext", max: 800, def: "", label: "Pack page: before you download a single file" },
  packHowToOpen:    { type: "longtext", max: 800, def: "", label: "Pack page: more download options" },

  bannerOn:     { type: "bool", def: false },
  bannerImage:  { type: "image", def: "", label: "Banner image" }, // empty = showcase of product photos
  bannerTag:    { type: "text", max: 40, def: "", label: "Small line above heading" },
  bannerTitle:  { type: "text", max: 80, def: "", label: "Banner heading" },
  bannerText:   { type: "text", max: 160, def: "", label: "Banner text" },
  bannerButton: { type: "text", max: 30, def: "", label: "Button text" },
  bannerLink:   { type: "category", def: "", label: "Button link" },

  footerAbout:   { type: "text", max: 300, def: "", label: "About text" },
  footerAddress: { type: "text", max: 200, def: "", label: "Address" },
  footerPhone:   { type: "phone", def: "", label: "Phone" },
  footerEmail:   { type: "email", def: "", label: "Email" },
  instagram:     { type: "url", def: "", label: "Instagram link" },
  paymentMethods: { type: "text", max: 200, def: "", label: "Payment methods" },

  // Product page
  trust1:      { type: "text", max: 40, def: "", label: "Promise 1" },
  trust2:      { type: "text", max: 40, def: "", label: "Promise 2" },
  trust3:      { type: "text", max: 40, def: "", label: "Promise 3" },
  offerNote:   { type: "text", max: 120, def: "", label: "Offer line" },
  customizeInfo: { type: "longtext", max: 1500, label: "Customise options text", def: "" },
  howItWorks: { type: "longtext", max: 800, label: "How it works", def: "" },
  whyChoose: { type: "longtext", max: 1200, label: "Why choose us", def: "" },
  faqs: { type: "longtext", max: 4000, label: "FAQs", def: "" },

  // Policies (footer). Empty = not shown.
  policyPrivacy:  { type: "longtext", max: 6000, def: "", label: "Privacy policy" },
  policyDelivery: { type: "longtext", max: 6000, def: "", label: "Delivery policy" },
  policyTerms:    { type: "longtext", max: 6000, def: "", label: "Terms and conditions" },
  policyRefund:   { type: "longtext", max: 6000, def: "", label: "Return & refund policy" },
  facebook:      { type: "url", def: "", label: "Facebook link" },
  whatsapp:      { type: "url", def: "", label: "WhatsApp link" },
  youtube:       { type: "url", def: "", label: "YouTube link" },
  twitter:       { type: "url", def: "", label: "X (Twitter) link" },
  linkedin:      { type: "url", def: "", label: "LinkedIn link" },
  pinterest:     { type: "url", def: "", label: "Pinterest link" },
};

export async function getSettings() {
  const stored = Object.fromEntries((await col("settings").find().toArray()).map((r) => [r._id, r.value]));
  const out = {};
  for (const [key, spec] of Object.entries(SETTINGS)) {
    const v = stored[key];
    out[key] = spec.type === "bool" ? (v === undefined ? spec.def : v === "1")
      : spec.type === "money" ? (v === undefined || v === "" ? spec.def : Number(v) || 0)
      : (v ?? spec.def);
  }
  if (out.bannerImage === "/images/banner-default.svg") out.bannerImage = "";
  return out;
}

function clean(key, spec, value, categoryIds) {
  if (spec.type === "bool") return value === true || value === "on" || value === "1" ? "1" : "0";
  if (spec.type === "money") {
    const n = value === "" || value == null ? 0 : Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) bad(`${spec.label || key} must be a whole number of rupees (0 or more).`);
    return String(n);
  }
  const s = typeof value === "string"
    ? (spec.type === "longtext" ? value.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim() : value.trim().replace(/\s+/g, " "))
    : "";
  const name = spec.label || key;
  if (s.length > (spec.max || 200)) bad(`${name} is too long (max ${spec.max || 200} characters).`);
  if (!s) return "";
  switch (spec.type) {
    case "image": if (!/^(\/[\w./-]+|https:\/\/\S+)$/.test(s)) bad(`${name} must be an uploaded image or an https:// link.`); break;
    case "url":   if (!/^https:\/\/\S+$/.test(s)) bad(`${name} must start with https://`); break;
    case "email": if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) bad(`${name} is not a valid email address.`); break;
    case "phone": if (!/^\+?[\d\s-]{7,16}$/.test(s)) bad(`${name} can only contain digits, spaces and +.`); break;
    case "category": if (!categoryIds.has(s)) bad("Choose a valid category for the banner button."); break;
  }
  return s;
}

// Saves only the keys present in body; returns the full settings
export async function saveSettings(body) {
  const categoryIds = new Set((await col("categories").find({}, { projection: { _id: 1 } }).toArray()).map((c) => c._id));
  const changes = [];
  for (const [key, spec] of Object.entries(SETTINGS)) {
    if (key in body) changes.push([key, clean(key, spec, body[key], categoryIds)]);
  }
  const next = { ...await getSettings(), ...Object.fromEntries(changes.map(([k, v]) => [k, SETTINGS[k].type === "bool" ? v === "1" : v])) };
  if (!next.storeName) bad("Store name can't be empty.");
  if (next.announcementOn && !next.announcement) bad("Write the announcement text, or turn the bar off.");
  if (changes.length) {
    await col("settings").bulkWrite(changes.map(([k, v]) => ({ updateOne: { filter: { _id: k }, update: { $set: { value: v } }, upsert: true } })));
  }
  return getSettings();
}
