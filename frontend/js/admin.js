/* Sonnad Studio: admin panel (products + orders) */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const STATUSES = ["placed", "confirmed", "shipped", "delivered", "cancelled"];
  let categories = [], products = [];
  let allOrders = [], allCustomers = [], lastStats = null;
  let currentTab = location.hash.slice(1) || "dashboard", searchQuery = "", productPage = 1;
  const PAGE_SIZE = 10;

  // ---------- Auth gate: not signed in as admin → the admin login page ----------
  const LOGIN_URL = "/admin/login";
  function showShell(on) {
    $("#admSide").hidden = !on;
    $("#admTop").hidden = !on;
  }
  async function start() {
    const user = await api.get("/api/auth/me").catch(() => null);
    $("#admYear").textContent = new Date().getFullYear();
    if (user?.role !== "admin") {
      location.replace(`${LOGIN_URL}${location.hash ? `?next=${encodeURIComponent(location.hash)}` : ""}`);
      return;
    }
    const first = (user.name || "Admin").trim().split(/\s+/)[0];
    $("#adminUser").textContent = user.email;
    $("#admUserName").textContent = first;
    $("#admAvatar").textContent = $("#profileAvatar").textContent = first.charAt(0).toUpperCase();
    $("#profileName").textContent = user.name || "Admin";
    $("#profileEmail").textContent = user.email;
    $("#adminApp").hidden = false;
    showShell(true);
    showTab(currentTab);
    categories = await api.get("/api/categories");
    await Promise.all([loadProducts(), loadOrders(), loadCategories(), loadSettings(), loadCustomers(), loadAdminReviews()]);
    loadStats();
  }

  async function logout() {
    await api.post("/api/auth/logout").catch(() => {});
    location.replace(`${LOGIN_URL}?signedout=1`);
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-logout]")) { logout(); return; }
    const go = e.target.closest("[data-goto]");
    if (go) { showTab(go.dataset.goto); $("#admUserMenu").hidden = true; }
    // close the user menu when clicking anywhere else
    if (!e.target.closest(".adm-user")) { $("#admUserMenu").hidden = true; $("#admUserBtn").setAttribute("aria-expanded", "false"); }
  });
  $("#admUserBtn").addEventListener("click", () => {
    const m = $("#admUserMenu");
    m.hidden = !m.hidden;
    $("#admUserBtn").setAttribute("aria-expanded", String(!m.hidden));
  });
  $("#admBell").addEventListener("click", () => showTab("orders"));
  document.addEventListener("keydown", (e) => {
    const go = e.target.closest?.('[data-goto][role="button"]');
    if (go && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showTab(go.dataset.goto); }
  });
  const closeMenu = () => { document.body.classList.remove("adm-menu-open"); $("#admOverlay").hidden = true; };
  $("#admMenu").addEventListener("click", () => { document.body.classList.add("adm-menu-open"); $("#admOverlay").hidden = false; });
  $("#admOverlay").addEventListener("click", closeMenu);


  // ---------- Tabs ----------
  const TAB_INFO = {
    dashboard: ["Dashboard", "Welcome back! Here's what's happening today."],
    products: ["Products", "Add, edit, hide or delete the products in your store."],
    orders: ["Orders", "Every order placed in your store."],
    customers: ["Customers", "People who have an account in your store."],
    categories: ["Categories", "The sections shown in your shop's menu bar."],
    reviews: ["Reviews", "What customers are saying about your products."],
    settings: ["Settings", "Store details, home banner, policies and footer."],
    profile: ["Profile", "Your admin account and password."],
  };
  function showTab(tab) {
    if (!TAB_INFO[tab]) tab = "dashboard";
    currentTab = tab;
    // leaving an editor page
    document.querySelectorAll(".adm-editor").forEach((x) => (x.hidden = true));
    $("#adminApp").hidden = false;
    history.replaceState(null, "", tab === "dashboard" ? location.pathname : `#${tab}`);
    document.querySelectorAll("#adminTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    ["orders", "categories", "customers", "reviews", "settings", "profile"].forEach((t) => ($(`#tab-${t}`).hidden = tab !== t));
    $("#tab-products").hidden = !(tab === "dashboard" || tab === "products");
    $("#stats").hidden = tab !== "dashboard";
    $("#admRangeWrap").hidden = tab !== "dashboard";
    $("#pageTitle").textContent = TAB_INFO[tab][0];
    if (tab === "customers") loadCustomers();
    if (tab === "reviews") loadAdminReviews();
    closeMenu();
    applySearch();
    window.scrollTo({ top: 0 });
  }
  // Add/edit forms open as their own page inside the admin panel (not a popup)
  let editorBack = "products";
  function openEditor(el) {
    editorBack = currentTab;
    $("#adminApp").hidden = true;
    document.querySelectorAll(".adm-editor").forEach((x) => (x.hidden = x !== el));
    closeMenu();
    window.scrollTo({ top: 0 });
    el.querySelector("input:not([type=hidden]), select, textarea")?.focus({ preventScroll: true });
  }
  const closeEditor = () => showTab(editorBack);

  $("#adminTabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]")?.dataset.tab;
    if (tab) showTab(tab);
  });

  // ---------- Search (filters the table you are looking at) ----------
  $("#admSearch").addEventListener("submit", (e) => e.preventDefault());
  $("#admSearchInput").addEventListener("input", (e) => { searchQuery = e.target.value.trim().toLowerCase(); productPage = 1; applySearch(); });
  function applySearch() {
    if (currentTab === "dashboard" || currentTab === "products") { renderProducts(); return; }
    if (currentTab === "orders") { adminOrders.q = searchQuery; $("#orderSearch").value = searchQuery; drawOrders(); return; }
    const body = document.querySelector(`#tab-${currentTab} tbody`);
    if (!body) return;
    body.querySelectorAll("tr").forEach((tr) => { tr.hidden = !!searchQuery && !tr.textContent.toLowerCase().includes(searchQuery); });
  }

  // ---------- Stats ----------
  const DAY = 86400000;
  const toTime = (d) => (d ? new Date(String(d).replace(" ", "T") + "Z").getTime() : 0);
  // ---------- Date filter (dashboard) ----------
  const RANGE_KEY = "sonnad_admin_range";
  const RANGE_LABELS = { today: "Today", 7: "Last 7 Days", 30: "Last 30 Days", 90: "Last 90 Days", month: "This Month", year: "This Year" };
  let range = { key: "30" };
  try { range = JSON.parse(localStorage.getItem(RANGE_KEY)) || range; } catch {}
  const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const fmtDay = (t) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const isoDay = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
  // The chosen period as start/end times (local time)
  function period() {
    const now = Date.now(), today = midnight(now);
    let start;
    if (range.key === "custom" && range.from && range.to) {
      const s = midnight(range.from + "T00:00"), e = midnight(range.to + "T00:00").getTime() + DAY;
      return { start: s.getTime(), end: Math.min(e, now), label: `${fmtDay(s)} – ${fmtDay(e - DAY)}` };
    }
    if (range.key === "today") start = today;
    else if (range.key === "month") start = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (range.key === "year") start = new Date(today.getFullYear(), 0, 1);
    else { const n = +range.key || 30; start = new Date(today); start.setDate(start.getDate() - (n - 1)); }
    return { start: start.getTime(), end: now, label: RANGE_LABELS[range.key] || RANGE_LABELS[30] };
  }
  // One value per day (per hour for a single day) in the period. cumulative = running total (e.g. products in the store).
  function series(items, p, valueOf, cumulative) {
    const step = p.end - p.start <= DAY ? DAY / 24 : DAY;
    const n = Math.max(2, Math.ceil((p.end - p.start) / step));
    const buckets = new Array(n).fill(0);
    let before = 0, inPeriod = 0;
    for (const it of items) {
      const t = toTime(it.createdAt);
      if (!t || t > p.end) continue;
      if (t < p.start) { before += valueOf(it); continue; }
      buckets[Math.min(n - 1, Math.floor((t - p.start) / step))] += valueOf(it);
      inPeriod += valueOf(it);
    }
    let run = before;
    return { values: cumulative ? buckets.map((v) => (run += v)) : buckets, added: inPeriod };
  }

  function renderRange() {
    const p = period();
    $("#admRangeLabel").textContent = p.label;
    document.querySelectorAll("#admRangeMenu [data-range]").forEach((b) => b.classList.toggle("on", b.dataset.range === range.key));
    // calendar starts on the current selection
    cal.from = range.from || isoDay(p.start);
    cal.to = range.to || isoDay(p.end);
    const m = new Date(cal.to + "T00:00");
    cal.month = new Date(m.getFullYear(), m.getMonth(), 1);
    cal.hover = null;
    renderCal();
  }

  // ---------- Range calendar: click a start day, then an end day ----------
  const cal = { from: null, to: null, month: new Date(), hover: null };
  const niceDay = (iso) => new Date(iso + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  function renderCal() {
    const y = cal.month.getFullYear(), mo = cal.month.getMonth();
    const todayIso = isoDay(Date.now());
    $("#admCalTitle").textContent = cal.month.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    // can't go past the current month
    $('[data-cal="next"]').disabled = y > new Date().getFullYear() || (y === new Date().getFullYear() && mo >= new Date().getMonth());
    const first = new Date(y, mo, 1), startPad = first.getDay(), daysIn = new Date(y, mo + 1, 0).getDate();
    // the end shown while choosing: the hovered day previews the range
    const end = cal.to || (cal.hover && cal.hover >= cal.from ? cal.hover : null);
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push(`<span class="adm-cal-blank"></span>`);
    for (let d = 1; d <= daysIn; d++) {
      const iso = isoDay(new Date(y, mo, d));
      const cls = [
        iso === todayIso && "today",
        iso === cal.from && "start",
        iso === end && "end",
        cal.from && end && iso > cal.from && iso < end && "mid",
        cal.from && end && cal.from !== end && "ranged",
      ].filter(Boolean).join(" ");
      const future = iso > todayIso;
      cells.push(`<button type="button" class="adm-cal-day ${cls}" data-day="${iso}" ${future ? "disabled" : ""}
        aria-label="${niceDay(iso)}" ${iso === cal.from || iso === end ? 'aria-pressed="true"' : ""}><span>${d}</span></button>`);
    }
    $("#admCalGrid").innerHTML = cells.join("");
    $("#admCalFrom").textContent = cal.from ? niceDay(cal.from) : "Pick a day";
    $("#admCalTo").textContent = cal.to ? niceDay(cal.to) : cal.from ? "Pick a day" : "Pick a day";
    $("#admCalFromBox").classList.toggle("active", !cal.from || !!cal.to);
    $("#admCalToBox").classList.toggle("active", !!cal.from && !cal.to);
  }
  $("#admCal").addEventListener("click", (e) => {
    e.stopPropagation();
    const nav = e.target.closest("[data-cal]");
    if (nav && !nav.disabled) {
      cal.month = new Date(cal.month.getFullYear(), cal.month.getMonth() + (nav.dataset.cal === "next" ? 1 : -1), 1);
      return renderCal();
    }
    const day = e.target.closest("[data-day]")?.dataset.day;
    if (!day) return;
    // first click = start, second click = end (clicking before the start restarts)
    if (!cal.from || cal.to || day < cal.from) { cal.from = day; cal.to = null; }
    else cal.to = day;
    $("#admRangeError").hidden = true;
    renderCal();
  });
  $("#admCalGrid").addEventListener("mouseover", (e) => {
    const day = e.target.closest("[data-day]")?.dataset.day;
    if (!cal.from || cal.to || !day || day === cal.hover) return;
    cal.hover = day;
    renderCal();
  });
  function setRange(r) {
    range = r;
    try { localStorage.setItem(RANGE_KEY, JSON.stringify(r)); } catch {}
    toggleRangeMenu(false);
    renderRange();
    loadStats();
  }
  // "Custom range" opens/closes the calendar
  function toggleCustom(open) {
    $("#admCustomBody").hidden = !open;
    $("#admCustomToggle").setAttribute("aria-expanded", String(open));
    $("#admCustomHint").textContent = range.key === "custom" ? period().label : "Pick your own dates";
  }
  $("#admCustomToggle").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleCustom($("#admCustomBody").hidden);
  });
  function toggleRangeMenu(open) {
    // the calendar starts open only when a custom range is in use
    if (open) toggleCustom(range.key === "custom");
    $("#admRangeMenu").hidden = !open;
    $("#admRangeBtn").setAttribute("aria-expanded", String(open));
    $("#admRangeError").hidden = true;
  }
  $("#admRangeBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleRangeMenu($("#admRangeMenu").hidden); });
  $("#admRangeMenu").addEventListener("click", (e) => {
    e.stopPropagation();
    const key = e.target.closest("[data-range]")?.dataset.range;
    if (key) setRange({ key });
  });
  $("#admApply").addEventListener("click", () => {
    const err = $("#admRangeError");
    if (!cal.from) { err.textContent = "Click a start day on the calendar."; err.hidden = false; return; }
    // only a start day picked → that single day
    setRange({ key: "custom", from: cal.from, to: cal.to || cal.from });
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#admRangeWrap")) toggleRangeMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") toggleRangeMenu(false); });
  // Rolling average so a few orders on separate days read as a smooth trend instead of spikes
  const smooth = (v, k) => v.map((_, i) => { const a = v.slice(Math.max(0, i - k), i + k + 1); return a.reduce((s, x) => s + x, 0) / a.length; });
  function sparkline(raw, color, id) {
    const values = smooth(raw, Math.max(1, Math.round(raw.length / 8)));
    const W = 200, H = 64, max = Math.max(...values), min = Math.min(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * W, max === min ? H * 0.62 : H - 6 - ((v - min) / span) * (H - 14)]);
    // smooth curve through the points
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2;
      d += ` C${cx.toFixed(1)},${y0.toFixed(1)} ${cx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    return `<svg class="adm-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${W},${H} L0,${H} Z" fill="url(#${id})"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>`;
  }
  const STAT_ICONS = {
    products: '<path d="M3 4h2l2.4 11h11L21 7H6.2"/><circle cx="9" cy="20" r="1.6"/><circle cx="17" cy="20" r="1.6"/>',
    customers: '<circle cx="12" cy="7.5" r="3.2" fill="currentColor"/><circle cx="5" cy="9.5" r="2.4" fill="currentColor"/><circle cx="19" cy="9.5" r="2.4" fill="currentColor"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0zM.8 18.5a4.6 4.6 0 0 1 6.4-4.2M23.2 18.5a4.6 4.6 0 0 0-6.4-4.2" fill="currentColor" stroke="none"/>',
    orders: '<path d="M5 8h14l-1.2 13H6.2z" fill="currentColor"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/><path d="M12 17.5s-2.6-1.6-2.6-3.3a1.4 1.4 0 0 1 2.6-.6 1.4 1.4 0 0 1 2.6.6c0 1.7-2.6 3.3-2.6 3.3z" fill="#fff" stroke="none"/>',
    revenue: '<path d="M6 4h12M6 9h12M6 4h3.5a5 5 0 0 1 0 10H6l8 7"/>',
  };
  async function loadStats() {
    const s = lastStats = await api.get("/api/admin/stats").catch(() => lastStats);
    if (!s) return;
    const p = period();
    const live = products.filter((x) => x.active);
    const counted = allOrders.filter((o) => o.status !== "cancelled");
    const prod = series(live, p, () => 1, true), cust = series(allCustomers, p, () => 1, true);
    const ord = series(allOrders, p, () => 1, false), rev = series(counted, p, (o) => o.total, false);
    // [key, label, all-time total, colour, chart, change in the chosen period]
    const cards = [
      ["products", "Total Products", s.products, "#3b82f6", prod.values, prod.added ? `+${prod.added} new` : "No new products"],
      ["customers", "Total Customers", s.customers, "#22a06b", cust.values, cust.added ? `+${cust.added} new` : "No new customers"],
      ["orders", "Total Orders", s.orders, "#f97316", ord.values, ord.added ? `+${ord.added} order${ord.added > 1 ? "s" : ""}` : "No orders"],
      ["revenue", "Total Revenue", rupee(s.revenue), "#8b5cf6", rev.values, rev.added ? `+${rupee(rev.added)}` : "No sales"],
    ];
    const when = range.key === "custom" ? "in this period" : p.label.toLowerCase();
    $("#stats").innerHTML = cards.map(([key, label, value, color, values, change]) => `
      <div class="adm-stat adm-stat-${key}" data-goto="${key === "revenue" ? "orders" : key}" role="button" tabindex="0">
        <span class="adm-stat-ic"><svg viewBox="0 0 24 24">${STAT_ICONS[key]}</svg></span>
        <div class="adm-stat-txt"><small>${label}</small><strong>${value}</strong>
          <span class="adm-delta ${change.startsWith("+") ? "up" : ""}">${escapeHtml(change)}<em>${escapeHtml(when)}</em></span></div>
        ${sparkline(values, color, `sg-${key}`)}
      </div>`).join("");
    // Bell + sidebar badge: orders still waiting for you to confirm
    const waiting = allOrders.filter((o) => o.status === "placed").length;
    $("#admBellN").textContent = $("#navOrders").textContent = waiting;
    $("#admBellN").hidden = $("#navOrders").hidden = !waiting;
    $("#admBell").title = waiting ? `${waiting} new order${waiting > 1 ? "s" : ""} to confirm` : "No new orders";
  }
  renderRange();

  // ---------- Products ----------
  const ICON_TRASH = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>';
  const ICON_PEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>';
  const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c5.5 0 9 6 9 6a16 16 0 0 1-2.6 3.3M6.6 6.6C4.2 8.2 3 12 3 12s3.5 6 9 6a9 9 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  const ICON_EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="3"/></svg>';
  const catLabel = (id) => categories.find((c) => c.id === id)?.label || id;

  async function loadProducts() {
    products = await api.get("/api/admin/products");
    renderProducts();
  }
  function renderProducts() {
    const list = searchQuery
      ? products.filter((p) => `${p.id} ${p.name} ${catLabel(p.category)} ${p.active ? "visible" : "hidden"}`.toLowerCase().includes(searchQuery))
      : products;
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    productPage = Math.min(Math.max(1, productPage), pages);
    const from = (productPage - 1) * PAGE_SIZE, shown = list.slice(from, from + PAGE_SIZE);
    $("#productRows").innerHTML = shown.length ? shown.map((p) => `
      <tr class="adm-row-link ${p.active ? "" : "row-inactive"}" data-row-product="${p.id}" tabindex="0" title="Click to edit ${escapeHtml(p.name)}">
        <td>${p.id}</td>
        <td><div class="adm-prod">
          <span class="adm-thumb">${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy" />` : ""}</span>
          <span>${escapeHtml(p.name)}</span>
        </div></td>
        <td>${escapeHtml(catLabel(p.category))}</td>
        <td>${rupee(p.price)}</td>
        <td>${p.stock}</td>
        <td><span class="adm-status ${p.active ? "" : "off"}">${p.active ? "Visible" : "Hidden"}</span></td>
        <td class="adm-actions">
          <button class="adm-act adm-act-edit" data-edit="${p.id}">${ICON_PEN}Edit</button>
          ${p.active
            ? `<button class="adm-act adm-act-hide" data-hide="${p.id}">${ICON_EYE_OFF}Hide</button>`
            : `<button class="adm-act adm-act-show" data-show="${p.id}">${ICON_EYE}Show</button>`}
          <button class="adm-act adm-act-del" data-delete-product="${p.id}" title="Delete product" aria-label="Delete ${escapeHtml(p.name)}">${ICON_TRASH}</button>
        </td>
      </tr>`).join("") : `<tr><td colspan="7" class="muted">${searchQuery ? "No products match your search." : "No products yet. Click Add Product to create one."}</td></tr>`;
    // Pager
    const btn = (label, page, opts = "") => `<button type="button" data-page="${page}" ${opts}>${label}</button>`;
    $("#productPager").innerHTML = `
      <span>Showing ${list.length ? from + 1 : 0} to ${from + shown.length} of ${list.length} entries</span>
      <div class="adm-pages">
        ${btn("‹", productPage - 1, `aria-label="Previous page" ${productPage === 1 ? "disabled" : ""}`)}
        ${Array.from({ length: pages }, (_, i) => btn(i + 1, i + 1, i + 1 === productPage ? 'class="on" aria-current="page"' : "")).join("")}
        ${btn("›", productPage + 1, `aria-label="Next page" ${productPage === pages ? "disabled" : ""}`)}
      </div>`;
  }
  $("#productPager").addEventListener("click", (e) => {
    const b = e.target.closest("[data-page]");
    if (!b || b.disabled) return;
    productPage = +b.dataset.page;
    renderProducts();
  });

  const modal = $("#productModal"), form = $("#productForm");
  const catSelect = $("#pfCategory");

  // ---------- Show only the boxes that fit the category ----------
  // The category's icon (Admin → Categories) decides the kind: Book → book, T-shirt → apparel, Briefcase → pack.
  // Categories with other icons (gift, tag, box) show every box.
  const KIND_BY_ICON = { book: "book", shirt: "apparel", briefcase: "pack" };
  const KIND_TEXT = {
    book: { hint: "Showing book fields: book details, digital download (e-book) and \"look inside\" pages.",
      legend: "Book details. Tip: use a portrait cover (about 2 : 3) as the main image",
      inside: "What you will learn (optional, one point per line)", upload: "book file",
      desc: "A short summary of the book, one point per line" },
    apparel: { hint: "Showing clothing fields: sizes, colours, colour photos, hover photo, minimum order and size chart.",
      desc: "100% cotton fabric\n180 GSM breathable fabric\nRibbed collar and sleeves" },
    pack: { hint: "Showing pack fields: the ZIP download file and the list of files inside.",
      legend: "Pack details: the ZIP file customers download and what's inside it",
      inside: "Files inside the pack (one per line, e.g. \"Startup checklist (PDF)\")", upload: "pack ZIP",
      desc: "What the pack helps with, one point per line" },
  };
  const productKind = () => KIND_BY_ICON[categories.find((c) => c.id === catSelect.value)?.icon] || "all";
  function applyProductKind() {
    const kind = productKind(), t = KIND_TEXT[kind] || {};
    form.querySelectorAll("[data-kinds]").forEach((el) => {
      el.classList.toggle("kind-off", kind !== "all" && !el.dataset.kinds.split(" ").includes(kind));
    });
    // packs are always digital downloads
    if (kind === "pack" && !form.elements.isDigital.checked) { form.elements.isDigital.checked = true; renderDigital(); }
    $("#pfKindHint").textContent = t.hint || "";
    $("#pfKindHint").hidden = !t.hint;
    $("#pfDetailsLegend").textContent = t.legend || "Book & download details";
    $("#pfInsideLabel").textContent = t.inside || "What you will learn / what's inside (optional, one point per line)";
    form.elements.description.placeholder = t.desc || "One point per line";
    renderDigital();
  }
  catSelect.addEventListener("change", applyProductKind);

  function openProduct(p) {
    form.reset();
    $("#productError").hidden = true;
    $("#productTitle").textContent = p ? `Edit product #${p.id}` : "Add product";
    catSelect.innerHTML = categories.map((c) => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join("");
    catSelect.value = p?.category || categories[0].id;
    form.elements.id.value = p?.id || "";
    form.elements.name.value = p?.name || "";
    form.elements.price.value = p?.price ?? "";
    form.elements.stock.value = p?.stock ?? 100;
    form.elements.mrp.value = p?.mrp || "";
    form.elements.minQty.value = p?.minQty || 1;
    form.elements.badge.value = p?.badge || "";
    form.elements.sizes.value = p?.sizes || "";
    form.elements.colors.value = p?.colors || "";
    form.elements.highlight.value = p?.highlight || "";
    form.elements.author.value = p?.author || "";
    form.elements.isbn.value = p?.isbn || "";
    form.elements.specs.value = p?.specs || "";
    form.elements.learnPoints.value = p?.learnPoints || "";
    for (const k of ["subtitle", "series", "publisher", "releaseDate"]) form.elements[k].value = p?.[k] || "";
    for (const k of ["seriesNo", "pages", "words"]) form.elements[k].value = p?.[k] || "";
    form.elements.isDigital.checked = !!p?.isDigital;
    form.elements.digitalFile.value = p?.digitalFile || "";
    form.elements.digitalName.value = p?.digitalName || "";
    previewPages = parseJsonSafe(p?.previewPages, []);
    renderPreviewPages();
    renderDigital();
    form.elements.sizeChart.value = p?.sizeChart || "";
    galleryList = parseJsonSafe(p?.gallery, []);
    colorImages = parseJsonSafe(p?.colorImages, {});
    $("#pfGalleryStatus").textContent = "You can pick several photos at once.";
    renderGalleryAdmin();
    renderColorPhotos();
    form.elements.imageUrl.value = p?.imageUrl || "";
    form.elements.hoverImage.value = p?.hoverImage || "";
    $("#pfStatus").textContent = "JPG, PNG, WebP or GIF, up to 5 MB.";
    $("#pfStatus2").textContent = "Without a second image, the photo zooms on hover instead.";
    showPreview();
    showPreview2();
    form.elements.description.value = p?.description || "";
    form.elements.active.checked = p ? !!p.active : true;
    applyProductKind();
    openEditor(modal);
  }

  // ---------- Shared upload helper ----------
  async function uploadImage(file) {
    if (file.size > 5 * 1024 * 1024) throw new Error(`"${file.name}" is over 5 MB.`);
    const res = await fetch("/api/admin/uploads", {
      method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file, credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    return data.url;
  }
  function parseJsonSafe(v, fb) { try { return typeof v === "string" ? JSON.parse(v || "null") ?? fb : v ?? fb; } catch { return fb; } }

  // ---------- Gallery (extra photos) ----------
  let galleryList = [];
  function renderGalleryAdmin() {
    $("#pfGalleryValue").value = JSON.stringify(galleryList);
    $("#pfGallery").innerHTML = galleryList.map((url, i) => `
      <figure class="g-item">
        <img src="${escapeHtml(url)}" alt="" />
        <button type="button" data-g-remove="${i}" aria-label="Remove photo">×</button>
      </figure>`).join("") || `<span class="muted" style="font-size:13px">No extra photos yet.</span>`;
    $("#pfGalleryAdd").disabled = galleryList.length >= 8;
  }
  $("#pfGalleryAdd").addEventListener("click", () => $("#pfGalleryFile").click());
  $("#pfGallery").addEventListener("click", (e) => {
    const i = e.target.closest("[data-g-remove]")?.dataset.gRemove;
    if (i !== undefined) { galleryList.splice(+i, 1); renderGalleryAdmin(); }
  });
  $("#pfGalleryFile").addEventListener("change", async (e) => {
    const files = [...e.target.files].slice(0, 8 - galleryList.length);
    e.target.value = "";
    const status = $("#pfGalleryStatus");
    for (const [n, file] of files.entries()) {
      status.textContent = `Uploading ${n + 1} of ${files.length}…`;
      try { galleryList.push(await uploadImage(file)); renderGalleryAdmin(); }
      catch (err) { status.textContent = err.message; return; }
    }
    status.textContent = files.length ? "Uploaded. Click Save to keep them." : status.textContent;
  });

  // ---------- "Look inside" preview pages ----------
  let previewPages = [];
  function renderPreviewPages() {
    $("#pfPreviewValue").value = JSON.stringify(previewPages);
    $("#pfPreviewPages").innerHTML = previewPages.map((url, i) => `
      <figure class="g-item">
        <img src="${escapeHtml(url)}" alt="Page ${i + 1}" />
        <span class="g-num">${i + 1}</span>
        <button type="button" data-pp-remove="${i}" aria-label="Remove page">×</button>
      </figure>`).join("") || `<span class="muted" style="font-size:13px">No preview pages yet.</span>`;
    $("#pfPreviewAdd").disabled = previewPages.length >= 8;
  }
  $("#pfPreviewAdd").addEventListener("click", () => $("#pfPreviewFile").click());
  $("#pfPreviewPages").addEventListener("click", (e) => {
    const i = e.target.closest("[data-pp-remove]")?.dataset.ppRemove;
    if (i !== undefined) { previewPages.splice(+i, 1); renderPreviewPages(); }
  });
  $("#pfPreviewFile").addEventListener("change", async (e) => {
    const files = [...e.target.files].slice(0, 8 - previewPages.length);
    e.target.value = "";
    const status = $("#pfPreviewStatus");
    for (const [n, file] of files.entries()) {
      status.textContent = `Uploading ${n + 1} of ${files.length}…`;
      try { previewPages.push(await uploadImage(file)); renderPreviewPages(); }
      catch (err) { status.textContent = err.message; return; }
    }
    if (files.length) status.textContent = "Uploaded. Click Save to keep them.";
  });

  // ---------- Digital book file ----------
  function renderDigital() {
    const on = form.elements.isDigital.checked;
    $("#pfDigitalWrap").hidden = !on;
    const name = form.elements.digitalName.value, file = form.elements.digitalFile.value;
    $("#pfDigitalStatus").textContent = file ? `Current file: ${name || file}` : "No file yet.";
    const what = (KIND_TEXT[productKind()] || {}).upload || "download file";
    $("#pfDigitalUpload").textContent = file ? `Replace ${what}` : `Upload ${what}`;
  }
  form.elements.isDigital.addEventListener("change", renderDigital);
  $("#pfDigitalUpload").addEventListener("click", () => $("#pfDigitalFile").click());
  $("#pfDigitalFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const status = $("#pfDigitalStatus");
    if (file.size > 50 * 1024 * 1024) { status.textContent = "That file is over 50 MB."; return; }
    status.textContent = `Uploading ${file.name} (${(file.size / 1048576).toFixed(1)} MB)…`;
    try {
      const res = await fetch("/api/admin/uploads/file", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
        body: file, credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      form.elements.digitalFile.value = data.file;
      form.elements.digitalName.value = data.name;
      renderDigital();
      status.textContent = `Uploaded ${data.name}. Click Save to keep it.`;
    } catch (err) { status.textContent = err.message; }
  });

  // ---------- Photo per colour ----------
  let colorImages = {};
  const colorNames = () => form.elements.colors.value.split(",").map((c) => c.trim().replace(/\s*#[0-9a-f]{3,8}$/i, "").trim()).filter(Boolean);
  function renderColorPhotos() {
    const names = [...new Set(colorNames())];
    $("#pfColorPhotosWrap").hidden = !names.length;
    $("#pfColorImagesValue").value = JSON.stringify(Object.fromEntries(names.filter((n) => colorImages[n]).map((n) => [n, colorImages[n]])));
    $("#pfColorPhotos").innerHTML = names.map((n) => `
      <div class="cp-row">
        <div class="cp-thumb">${colorImages[n] ? `<img src="${escapeHtml(colorImages[n])}" alt="" />` : ""}</div>
        <span class="cp-name">${escapeHtml(n)}</span>
        <button type="button" class="btn-ghost" data-cp-upload="${escapeHtml(n)}">${colorImages[n] ? "Change" : "Upload"}</button>
        ${colorImages[n] ? `<button type="button" class="btn-ghost" data-cp-remove="${escapeHtml(n)}">Remove</button>` : ""}
      </div>`).join("");
  }
  form.elements.colors.addEventListener("input", renderColorPhotos);
  $("#pfColorPhotos").addEventListener("click", (e) => {
    const up = e.target.closest("[data-cp-upload]"), rm = e.target.closest("[data-cp-remove]");
    if (rm) { delete colorImages[rm.dataset.cpRemove]; renderColorPhotos(); }
    if (up) {
      const picker = document.createElement("input");
      picker.type = "file";
      picker.accept = "image/jpeg,image/png,image/webp,image/gif";
      picker.onchange = async () => {
        const file = picker.files[0];
        if (!file) return;
        up.textContent = "Uploading…";
        try { colorImages[up.dataset.cpUpload] = await uploadImage(file); }
        catch (err) { toast(err.message); }
        renderColorPhotos();
      };
      picker.click();
    }
  });

  // ---------- Second (hover) image ----------
  const hoverInput = $("#pfHoverImage");
  function showPreview2() {
    const url = hoverInput.value.trim();
    $("#pfPreview2").innerHTML = url ? `<img src="${escapeHtml(url)}" alt="" />` : "None";
    $("#pfRemove2").hidden = !url;
  }
  $("#pfUpload2").addEventListener("click", () => $("#pfFile2").click());
  $("#pfRemove2").addEventListener("click", () => { hoverInput.value = ""; showPreview2(); });
  $("#pfFile2").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const status = $("#pfStatus2");
    if (file.size > 5 * 1024 * 1024) { status.textContent = "That file is over 5 MB. Choose a smaller image."; return; }
    status.textContent = `Uploading ${file.name}…`;
    try {
      const res = await fetch("/api/admin/uploads", {
        method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file, credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      hoverInput.value = data.url;
      showPreview2();
      status.textContent = "Uploaded. Click Save to keep it.";
    } catch (err) { status.textContent = err.message; }
  });

  // ---------- Image upload ----------
  const urlInput = $("#pfImageUrl"), fileInput = $("#pfFile"), uploadBtn = $("#pfUpload");

  function showPreview() {
    const url = urlInput.value.trim();
    $("#pfPreview").innerHTML = url ? `<img src="${escapeHtml(url)}" alt="" />` : "No image";
    $("#pfRemove").hidden = !url;
  }
  urlInput.addEventListener("input", showPreview);
  uploadBtn.addEventListener("click", () => fileInput.click());
  $("#pfRemove").addEventListener("click", () => { urlInput.value = ""; showPreview(); });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    const status = $("#pfStatus");
    if (file.size > 5 * 1024 * 1024) { status.textContent = "That file is over 5 MB. Choose a smaller image."; return; }
    uploadBtn.disabled = true;
    status.textContent = `Uploading ${file.name}…`;
    try {
      const res = await fetch("/api/admin/uploads", {
        method: "POST",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      urlInput.value = data.url;
      showPreview();
      status.textContent = "Uploaded. Click Save to keep it.";
    } catch (err) {
      status.textContent = err.message;
    } finally {
      uploadBtn.disabled = false;
    }
  });

  $("#newProduct").addEventListener("click", () => openProduct(null));
  // Click (or Enter) anywhere on a product row, except its buttons, to open the Edit page
  $("#productRows").addEventListener("click", (e) => {
    if (e.target.closest("button, a, input, select")) return;
    const row = e.target.closest("[data-row-product]");
    if (row) openProduct(products.find((p) => p.id === +row.dataset.rowProduct));
  });
  $("#productRows").addEventListener("keydown", (e) => {
    const row = e.target.closest?.("[data-row-product]");
    if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openProduct(products.find((p) => p.id === +row.dataset.rowProduct)); }
  });
  $("#productRows").addEventListener("click", async (e) => {
    const delId = e.target.closest("[data-delete-product]")?.dataset.deleteProduct;
    if (delId) {
      const p = products.find((x) => x.id === +delId);
      const ok = await confirmPopup({
        title: `Delete "${p?.name ?? "product"}"?`,
        message: "This permanently removes the product, its image and its reviews. Past orders keep their details. To take it off the store temporarily, use Hide instead.",
        confirmText: "Delete", danger: true,
      });
      if (!ok) return;
      try {
        await api.del(`/api/admin/products/${delId}`);
        toast("Product deleted");
        loadProducts(); loadStats();
      } catch (err) { toast(err.message); }
      return;
    }
    const b = e.target.closest("button")?.dataset || {};
    const editId = b.edit, hideId = b.hide;
    if (editId) openProduct(products.find((p) => p.id === +editId));
    if (b.show) {
      // Opens the editor with "Visible in store" ticked; Save makes it visible again
      openProduct(products.find((p) => p.id === +b.show));
      form.elements.active.checked = true;
      toast("Click Save to show this product in the store again");
    }
    if (hideId) {
      try {
        await api.post(`/api/admin/products/${hideId}/hide`);
        toast("Product hidden. Click Show to put it back in the store.");
        loadProducts(); loadStats();
      } catch (err) { toast(err.message); }
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = formData(form);
    data.isDigital = form.elements.isDigital.checked;
    data.active = form.elements.active.checked;
    const id = data.id; delete data.id;
    try {
      if (id) await api.put(`/api/admin/products/${id}`, data);
      else await api.post("/api/admin/products", data);
      closeEditor();
      toast("Product saved");
      loadProducts(); loadStats();
    } catch (err) {
      $("#productError").textContent = err.message;
      $("#productError").hidden = false;
    }
  });

  document.querySelectorAll(".adm-editor [data-close]").forEach((b) => b.addEventListener("click", closeEditor));

  // ---------- Orders: status tiles, search, one card per order with quick actions ----------
  const OS = {
    placed: { label: "New", tone: "amber", text: "Waiting for you to confirm" },
    confirmed: { label: "Confirmed", tone: "blue", text: "Confirmed · pack and ship it" },
    shipped: { label: "Shipped", tone: "indigo", text: "On the way to the customer" },
    delivered: { label: "Delivered", tone: "green", text: "Completed" },
    cancelled: { label: "Cancelled", tone: "red", text: "Cancelled · stock returned" },
  };
  const OS_TILES = [["all", "All orders"], ["placed", "New"], ["confirmed", "Confirmed"], ["shipped", "Shipped"], ["delivered", "Delivered"], ["cancelled", "Cancelled"]];
  const COURIERS = ["India Post", "Delhivery", "Blue Dart", "DTDC", "Ekart", "Xpressbees", "Shadowfax", "Professional Couriers", "Shiprocket", "Self delivery"];
  const adminOrders = { filter: "all", q: "", sort: "new", open: new Set() };
  const isDigitalOnly = (o) => o.items.length > 0 && o.items.every((i) => i.isDigital);
  const odate = (d, opts = { dateStyle: "medium", timeStyle: "short" }) => (d ? new Date(String(d).replace(" ", "T") + "Z").toLocaleString("en-IN", opts) : "");
  const AI = {
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    truck: '<path d="M2 6h11v10H2zM13 9h4.5l3.5 3.5V16h-8z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    home: '<path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z"/>',
    bag: '<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/>',
    clip: '<path d="M9 4h6v3H9z"/><path d="M8 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-2"/><path d="m9 14 2 2 4-4"/>',
    phone: '<path d="M5 3h3.5l1.7 4.3-2.2 1.5a11 11 0 0 0 6.2 6.2l1.5-2.2L20 14.5V18a2 2 0 0 1-2.2 2A16 16 0 0 1 3 5.2 2 2 0 0 1 5 3z"/>',
    wa: '<path d="M3 21l1.6-4.7A9 9 0 1 1 8 19.6z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 1c-1.2-.5-2.5-1.8-3-3l1-1-1-2z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    dl: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  };
  const aic = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;

  // The obvious next step for each order
  function nextStep(o) {
    const dig = isDigitalOnly(o);
    if (o.status === "placed") return { to: "confirmed", label: dig ? "Confirm & unlock download" : "Confirm order", icon: AI.check };
    if (dig) return o.status === "confirmed" ? { to: "delivered", label: "Mark completed", icon: AI.check } : null;
    if (o.status === "confirmed") return { to: "shipped", label: "Mark as shipped", icon: AI.truck };
    if (o.status === "shipped") return { to: "delivered", label: "Mark as delivered", icon: AI.home };
    return null;
  }

  function adminTracker(o) {
    if (o.status === "cancelled") return `<div class="ao-cancel-note">${aic(AI.x)}Cancelled${o.updatedAt ? ` on ${odate(o.updatedAt, { dateStyle: "medium" })}` : ""}. Items went back into stock.</div>`;
    const dig = isDigitalOnly(o);
    const steps = dig ? [["placed", "Ordered", AI.bag], ["confirmed", "Download unlocked", AI.dl]]
      : [["placed", "Ordered", AI.bag], ["confirmed", "Confirmed", AI.clip], ["shipped", "Shipped", AI.truck], ["delivered", "Delivered", AI.home]];
    const order = ["placed", "confirmed", "shipped", "delivered"];
    const reached = dig ? (o.status === "placed" ? 0 : 1) : order.indexOf(o.status);
    // Each step is a button: click it to move the order to that status
    return `<ol class="ao-track${dig ? " is-digital" : ""}" style="--done:${reached / (steps.length - 1)}">
      ${steps.map(([key, label, ic], i) => `<li class="${i < reached ? "done" : i === reached ? "current" : ""}">
        <button type="button" data-step="${key}" ${i === reached ? 'aria-current="step" disabled' : ""} title="${i === reached ? `Current status: ${label}` : `Set status to ${label}`}">
          <span>${aic(i <= reached ? AI.check : ic)}</span><em>${label}</em>
        </button></li>`).join("")}
    </ol>`;
  }

  const waLink = (phone, text) => {
    let d = String(phone || "").replace(/\D/g, "");
    if (d.length === 10) d = "91" + d;
    return d ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : "";
  };

  function orderCard(o) {
    const st = OS[o.status] || OS.placed;
    const dig = isDigitalOnly(o);
    const open = adminOrders.open.has(o.id);
    const next = nextStep(o);
    const count = o.items.reduce((n, i) => n + i.qty, 0);
    const hello = `Hi ${o.name || ""}, this is about your order #${o.id}`;
    return `
    <article class="ao-card tone-${st.tone}" data-oid="${o.id}">
      <header class="ao-head">
        <div class="ao-id">
          <strong>#${o.id}</strong>
          <span class="ao-pill">${st.label}</span>
          ${dig ? `<span class="ao-tag">Digital</span>` : ""}
        </div>
        <div class="ao-cust">
          <strong>${escapeHtml(o.name || o.account || "")}</strong>
          <small>${escapeHtml(o.email || "")}${o.phone ? ` · ${escapeHtml(o.phone)}` : ""}</small>
        </div>
        <div class="ao-cell"><small>Placed</small><span>${odate(o.createdAt)}</span></div>
        <div class="ao-cell ao-tot"><small>${count} item${count === 1 ? "" : "s"}</small><strong>${rupee(o.total)}</strong></div>
      </header>

      <div class="ao-progress">
        <p class="ao-state">${dig && o.status === "confirmed" ? "Confirmed · the customer can download it now"
          : dig && o.status === "placed" ? "Waiting for you to confirm payment · then the download unlocks" : st.text}${o.updatedAt && o.status !== "placed" ? ` <span class="muted">· updated ${odate(o.updatedAt)}</span>` : ""}</p>
        ${adminTracker(o)}
      </div>

      <ul class="ao-items">
        ${o.items.map((i) => `
          <li>
            <span class="ao-thumb">${i.imageUrl ? `<img src="${escapeHtml(i.imageUrl)}" alt="" loading="lazy" />` : aic(AI.box)}</span>
            <div class="ao-item-main">
              <strong>${escapeHtml(i.name)}</strong>
              <small>${i.options ? `${escapeHtml(i.options)} · ` : ""}Qty ${i.qty} × ${rupee(i.price)}${i.isDigital ? ` · <b class="ao-dl">Download</b>` : ""}</small>
            </div>
            <span class="ao-line">${rupee(i.price * i.qty)}</span>
          </li>`).join("")}
      </ul>

      ${o.courier || o.tracking ? `<p class="ao-trk-line">${aic(AI.truck)}${o.courier ? escapeHtml(o.courier) : "Tracking"}${o.tracking ? ` · <code>${escapeHtml(o.tracking)}</code>` : ""}</p>` : ""}

      <div class="ao-actions">
        ${next ? `<button type="button" class="ao-btn ao-primary" data-step="${next.to}">${aic(next.icon)}${next.label}</button>` : ""}
        ${["placed", "confirmed"].includes(o.status) ? `<button type="button" class="ao-btn ao-warn" data-step="cancelled">${aic(AI.x)}Cancel order</button>` : ""}
        ${o.status === "cancelled" ? `<button type="button" class="ao-btn" data-step="placed">${aic(AI.undo)}Re-open order</button>` : ""}
        <button type="button" class="ao-btn" data-toggle aria-expanded="${open}">${aic(AI.clip)}${open ? "Hide details" : dig ? "Details" : "Details & tracking"}<span class="ao-chev">${aic(AI.chev)}</span></button>
        <label class="ao-status-sel">Status
          <select data-status-select aria-label="Change status of order #${o.id}">
            ${Object.entries(OS).map(([k, v]) => `<option value="${k}" ${k === o.status ? "selected" : ""}>${v.label}</option>`).join("")}
          </select>
        </label>
        <button type="button" class="ao-del" data-delete-order="${o.id}" title="Delete order #${o.id}" aria-label="Delete order #${o.id}">${ICON_TRASH}</button>
      </div>

      <div class="ao-more" ${open ? "" : "hidden"}>
        <section class="ao-box">
          <h4>${aic(dig ? AI.dl : AI.pin)}${dig ? "Delivery" : "Ship to"}</h4>
          ${dig ? `<p>Digital order: the customer downloads it from <strong>My Downloads</strong> once confirmed.</p>`
            : `<p><strong>${escapeHtml(o.name || "")}</strong><br>${escapeHtml(o.address || "")}<br>${escapeHtml(o.city || "")}${o.pincode ? ` – ${escapeHtml(o.pincode)}` : ""}</p>`}
          <div class="ao-contact">
            ${o.phone ? `<a class="ao-chip" href="tel:${escapeHtml(o.phone)}">${aic(AI.phone)}Call</a>` : ""}
            ${waLink(o.phone, hello) ? `<a class="ao-chip ao-wa" href="${waLink(o.phone, hello)}" target="_blank" rel="noopener">${aic(AI.wa)}WhatsApp</a>` : ""}
            ${o.email ? `<a class="ao-chip" href="mailto:${escapeHtml(o.email)}?subject=${encodeURIComponent(`Your order #${o.id}`)}">${aic(AI.mail)}Email</a>` : ""}
          </div>
        </section>
        <section class="ao-box">
          <h4>${aic(AI.truck)}Tracking & message</h4>
          ${dig ? "" : `
          <div class="ao-form-row">
            <label>Courier<input data-f="courier" list="courierList" maxlength="60" value="${escapeHtml(o.courier || "")}" placeholder="e.g. Delhivery" /></label>
            <label>Tracking number<input data-f="tracking" maxlength="80" value="${escapeHtml(o.tracking || "")}" placeholder="e.g. 1234567890" /></label>
          </div>`}
          <label>Message for the customer (shown on their order)<textarea data-f="note" rows="2" maxlength="300" placeholder="e.g. Printing takes 2 days, we'll ship on Monday.">${escapeHtml(o.note || "")}</textarea></label>
          <button type="button" class="ao-btn ao-primary ao-save" data-save>${aic(AI.save)}Save</button>
        </section>
        <section class="ao-box">
          <h4>${aic(AI.clip)}Summary</h4>
          ${o.items.map((i) => `<div class="ao-sum"><span>${escapeHtml(i.name)} × ${i.qty}</span><span>${rupee(i.price * i.qty)}</span></div>`).join("")}
          <div class="ao-sum"><span>Delivery</span><span>${dig ? "Not needed" : o.deliveryFee ? rupee(o.deliveryFee) : "Free"}</span></div>
          <div class="ao-sum ao-sum-total"><span>Total</span><span>${rupee(o.total)}</span></div>
          <p class="muted ao-small">Account: ${escapeHtml(o.account || "")} (${escapeHtml(o.email || "")})</p>
        </section>
      </div>
    </article>`;
  }

  function filteredOrders() {
    const q = adminOrders.q.trim().toLowerCase().replace(/^#/, "");
    let list = allOrders.filter((o) => adminOrders.filter === "all" || o.status === adminOrders.filter);
    if (q) list = list.filter((o) => String(o.id) === q
      || [o.name, o.email, o.phone, o.city, o.account, o.tracking].some((v) => String(v || "").toLowerCase().includes(q))
      || o.items.some((i) => i.name.toLowerCase().includes(q)));
    const by = { new: (a, b) => b.id - a.id, old: (a, b) => a.id - b.id, high: (a, b) => b.total - a.total, low: (a, b) => a.total - b.total }[adminOrders.sort];
    return list.sort(by);
  }

  function drawOrders() {
    const counts = { all: allOrders.length };
    for (const k of Object.keys(OS)) counts[k] = allOrders.filter((o) => o.status === k).length;
    const sales = allOrders.filter((o) => o.status !== "cancelled").reduce((n, o) => n + o.total, 0);
    $("#orderTiles").innerHTML = OS_TILES.map(([k, label]) => `
      <button type="button" class="ao-tile tile-${k === "all" ? "all" : OS[k].tone}${adminOrders.filter === k ? " on" : ""}" data-filter="${k}" aria-pressed="${adminOrders.filter === k}">
        <small>${label}</small><strong>${counts[k]}</strong>
        ${k === "all" ? `<em>${rupee(sales)} in sales</em>` : k === "placed" && counts.placed ? `<em>Needs action</em>` : ""}
      </button>`).join("");
    const list = filteredOrders();
    $("#orderRows").innerHTML = list.length ? list.map(orderCard).join("")
      : `<div class="ao-empty">${aic(AI.bag)}<p>${allOrders.length ? "No orders match this filter or search." : "No orders yet. They'll appear here as soon as customers check out."}</p></div>`;
  }

  async function loadOrders() {
    allOrders = await api.get("/api/admin/orders");
    if (!$("#courierList")) document.body.insertAdjacentHTML("beforeend", `<datalist id="courierList">${COURIERS.map((c) => `<option value="${c}">`).join("")}</datalist>`);
    drawOrders();
  }

  async function updateOrder(id, body, message) {
    try {
      await api.patch(`/api/admin/orders/${id}`, body);
      toast(message);
      await loadOrders();
      loadStats();
      if (body.status) loadProducts(); // stock may have changed
    } catch (err) { toast(err.message); }
  }

  $("#orderTiles").addEventListener("click", (e) => {
    const t = e.target.closest("[data-filter]");
    if (!t) return;
    adminOrders.filter = t.dataset.filter;
    drawOrders();
  });
  $("#orderSearch").addEventListener("input", (e) => { adminOrders.q = e.target.value; drawOrders(); });
  $("#orderSort").addEventListener("change", (e) => { adminOrders.sort = e.target.value; drawOrders(); });

  $("#orderRows").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-status-select]");
    if (!sel) return;
    const id = +sel.closest("[data-oid]").dataset.oid;
    updateOrder(id, { status: sel.value }, `Order #${id} → ${OS[sel.value].label}`);
  });

  $("#orderRows").addEventListener("click", async (e) => {
    const card = e.target.closest("[data-oid]");
    if (!card) return;
    const id = +card.dataset.oid;
    const o = allOrders.find((x) => x.id === id);
    const step = e.target.closest("[data-step]");
    if (step) {
      if (step.disabled || step.dataset.step === o.status) return;
      return updateOrder(id, { status: step.dataset.step }, `Order #${id} → ${OS[step.dataset.step].label}`);
    }
    if (e.target.closest("[data-toggle]")) {
      adminOrders.open.has(id) ? adminOrders.open.delete(id) : adminOrders.open.add(id);
      card.outerHTML = orderCard(o);
      return;
    }
    if (e.target.closest("[data-save]")) {
      const body = {};
      card.querySelectorAll("[data-f]").forEach((f) => (body[f.dataset.f] = f.value.trim()));
      return updateOrder(id, body, `Order #${id} saved. The customer can see it on their order.`);
    }
    if (e.target.closest("[data-delete-order]")) {
      if (!await confirmPopup({ title: `Delete order #${id}?`, message: "This permanently removes the order. This cannot be undone.", confirmText: "Delete", danger: true })) return;
      try {
        await api.del(`/api/admin/orders/${id}`);
        toast(`Order #${id} deleted`);
        adminOrders.open.delete(id);
        loadOrders(); loadStats(); loadProducts();
      } catch (err) { toast(err.message); }
    }
  });

  // ---------- Categories ----------
  const ICON_NAMES = { book: "Book", shirt: "T-shirt", briefcase: "Briefcase", gift: "Gift", tag: "Tag", box: "Box" };
  let adminCategories = [];
  async function loadCategories() {
    adminCategories = await api.get("/api/admin/categories");
    categories = await api.get("/api/categories"); // keeps the product form's list in sync
    const last = adminCategories.length - 1;
    $("#categoryRows").innerHTML = adminCategories.map((c, i) => `
      <tr>
        <td style="white-space:nowrap">
          <button class="btn-ghost" data-move="up" data-cat="${escapeHtml(c.id)}" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
          <button class="btn-ghost" data-move="down" data-cat="${escapeHtml(c.id)}" ${i === last ? "disabled" : ""} aria-label="Move down">↓</button>
        </td>
        <td>${escapeHtml(c.label)}</td>
        <td>${ICON_NAMES[c.icon] || c.icon}</td>
        <td>${c.productCount}</td>
        <td style="white-space:nowrap">
          <button class="btn-ghost" data-edit-cat="${escapeHtml(c.id)}">Edit</button>
          <button class="icon-btn icon-danger" data-delete-cat="${escapeHtml(c.id)}" title="Delete category" aria-label="Delete ${escapeHtml(c.label)}">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>`).join("") || `<tr><td colspan="5" class="muted">No categories yet.</td></tr>`;
  }

  const catModal = $("#categoryModal"), catForm = $("#categoryForm");
  function openCategory(c) {
    catForm.reset();
    $("#categoryError").hidden = true;
    $("#categoryTitle").textContent = c ? "Edit category" : "Add category";
    catForm.elements.id.value = c?.id || "";
    catForm.elements.label.value = c?.label || "";
    catForm.elements.icon.value = c?.icon || "tag";
    catForm.elements.tagline.value = c?.tagline || "";
    openEditor(catModal);
  }
  $("#newCategory").addEventListener("click", () => openCategory(null));

  catForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { id, label, icon, tagline } = formData(catForm);
    try {
      if (id) await api.put(`/api/admin/categories/${encodeURIComponent(id)}`, { label, icon, tagline });
      else await api.post("/api/admin/categories", { label, icon, tagline });
      closeEditor();
      toast("Category saved");
      await loadCategories(); loadProducts();
    } catch (err) {
      $("#categoryError").textContent = err.message;
      $("#categoryError").hidden = false;
    }
  });

  $("#categoryRows").addEventListener("click", async (e) => {
    const move = e.target.closest("[data-move]");
    const edit = e.target.closest("[data-edit-cat]");
    const del = e.target.closest("[data-delete-cat]");
    try {
      if (move) {
        await api.post(`/api/admin/categories/${encodeURIComponent(move.dataset.cat)}/move`, { direction: move.dataset.move });
        await loadCategories();
      } else if (edit) {
        openCategory(adminCategories.find((c) => c.id === edit.dataset.editCat));
      } else if (del) {
        const c = adminCategories.find((x) => x.id === del.dataset.deleteCat);
        if (c.productCount) {
          await showPopup({ title: "Can't delete yet", message: `"${c.label}" still has ${c.productCount} product${c.productCount === 1 ? "" : "s"}. Move them to another category or delete them first.`, cancelText: null });
          return;
        }
        if (!await confirmPopup({ title: `Delete "${c.label}"?`, message: "It will disappear from the shop's menu.", confirmText: "Delete", danger: true })) return;
        await api.del(`/api/admin/categories/${encodeURIComponent(c.id)}`);
        toast("Category deleted");
        await loadCategories();
      }
    } catch (err) { toast(err.message); }
  });

  // ---------- Settings ----------
  const settingsForm = $("#settingsForm");
  const DEFAULT_BANNER = ""; // empty = collage of product photos
  const bannerField = settingsForm.elements.bannerImage;
  function showBanner() {
    $("#bannerPreview").innerHTML = bannerField.value
      ? `<img src="${escapeHtml(bannerField.value)}" alt="" />`
      : `<span class="muted" style="padding:12px;text-align:center">Product photos: the banner shows a collage of your product pictures</span>`;
  }
  async function loadSettings() {
    const s = await api.get("/api/admin/settings");
    $("#bannerLink").innerHTML = `<option value="">All products</option>` +
      categories.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join("");
    for (const el of settingsForm.elements) {
      if (!el.name || !(el.name in s)) continue;
      if (el.type === "checkbox") el.checked = !!s[el.name];
      else el.value = s[el.name] ?? "";
    }
    showBanner();
    showLogo();
    applyAdminIdentity(s);
  }
  function applyAdminIdentity(s) {
    const name = s.storeName || "Store";
    document.title = `${name} Admin`;
    document.querySelectorAll(".adm-store-name").forEach((el) => (el.textContent = name));
    const a = $("#admLogo");
    if (!builtInAdminLogo) builtInAdminLogo = a.innerHTML;
    if (s.logoImage) a.innerHTML = `<img class="logo-img" src="${escapeHtml(s.logoImage)}" alt="${escapeHtml(name)}" />`;
    else if (name.toLowerCase() === "sonnad studio") a.innerHTML = builtInAdminLogo;
    else {
      const [first, ...rest] = name.toUpperCase().split(/\s+/);
      a.innerHTML = `<span class="logo-word">${escapeHtml(first)}</span>${rest.length ? `<span class="logo-sub">${escapeHtml(rest.join(" "))}</span>` : ""}`;
    }
  }
  let builtInAdminLogo = "";
  $("#bannerUpload").addEventListener("click", () => $("#bannerFile").click());
  $("#bannerReset").addEventListener("click", () => { bannerField.value = DEFAULT_BANNER; showBanner(); });
  $("#bannerFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const status = $("#bannerStatus");
    if (file.size > 5 * 1024 * 1024) { status.textContent = "That file is over 5 MB. Choose a smaller image."; return; }
    status.textContent = `Uploading ${file.name}…`;
    try {
      const res = await fetch("/api/admin/uploads", {
        method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file, credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      bannerField.value = data.url;
      showBanner();
      status.textContent = "Uploaded. Click Save settings to use it.";
    } catch (err) { status.textContent = err.message; }
  });

  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#settingsError").hidden = true;
    const body = {};
    for (const el of settingsForm.elements) {
      if (!el.name) continue;
      body[el.name] = el.type === "checkbox" ? el.checked : el.value;
    }
    try {
      await api.put("/api/admin/settings", body);
      toast("Settings saved");
    } catch (err) {
      $("#settingsError").textContent = err.message;
      $("#settingsError").hidden = false;
    }
  });

  // ---------- Customers ----------
  async function loadCustomers() {
    const rows = allCustomers = await api.get("/api/admin/customers");
    const date = (d) => (d ? new Date(d.replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "–");
    $("#customerRows").innerHTML = rows.length ? rows.map((c) => `
      <tr>
        <td>${c.id}</td>
        <td>${escapeHtml(c.name)}</td>
        <td><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></td>
        <td>${date(c.createdAt)}</td>
        <td>${c.orders}</td>
        <td>${rupee(c.spent)}</td>
        <td>${date(c.lastOrder)}</td>
      </tr>`).join("") : `<tr><td colspan="7" class="muted">No customers yet.</td></tr>`;
    if (currentTab === "customers") applySearch();
  }

  // ---------- Reviews ----------
  let adminReviews = [];
  async function loadAdminReviews() {
    adminReviews = await api.get("/api/admin/reviews");
    $("#reviewRows").innerHTML = adminReviews.length ? adminReviews.map((r, i) => `
      <tr>
        <td>${escapeHtml(r.product)}</td>
        <td>${escapeHtml(r.customer)}<br><small class="muted">${escapeHtml(r.email)}</small></td>
        <td style="white-space:nowrap;color:#f5b301">${"★".repeat(r.rating)}<span style="color:#d6cfc2">${"★".repeat(5 - r.rating)}</span></td>
        <td>${r.comment ? escapeHtml(r.comment) : `<span class="muted">(no comment)</span>`}</td>
        <td>${new Date(r.createdAt.replace(" ", "T") + "Z").toLocaleDateString("en-IN")}</td>
        <td>
          <button class="icon-btn icon-danger" data-delete-review="${i}" title="Delete review" aria-label="Delete review">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
          </button>
        </td>
      </tr>`).join("") : `<tr><td colspan="6" class="muted">No reviews yet.</td></tr>`;
    if (currentTab === "reviews") applySearch();
  }
  $("#reviewRows").addEventListener("click", async (e) => {
    const i = e.target.closest("[data-delete-review]")?.dataset.deleteReview;
    if (i === undefined) return;
    const r = adminReviews[+i];
    const ok = await confirmPopup({
      title: "Delete this review?",
      message: `${r.customer}'s ${r.rating}-star review of "${r.product}" will be removed from the store.`,
      confirmText: "Delete", danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/admin/reviews/${r.userId}/${r.productId}`);
      toast("Review deleted");
      loadAdminReviews();
    } catch (err) { toast(err.message); }
  });

  // ---------- Store logo ----------
  const logoField = () => settingsForm.elements.logoImage;
  function showLogo() {
    const url = logoField().value;
    $("#logoPreview").innerHTML = url ? `<img src="${escapeHtml(url)}" alt="" />` : `<span class="muted" style="font-size:12px;text-align:center">Built-in logo</span>`;
    $("#logoRemove").hidden = !url;
  }
  $("#logoUpload").addEventListener("click", () => $("#logoFile").click());
  $("#logoRemove").addEventListener("click", () => { logoField().value = ""; showLogo(); });
  $("#logoFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    $("#logoStatus").textContent = "Uploading…";
    try {
      logoField().value = await uploadImage(file);
      showLogo();
      $("#logoStatus").textContent = "Uploaded. Click Save settings to use it.";
    } catch (err) { $("#logoStatus").textContent = err.message; }
  });

  // ---------- Change password ----------
  $("#passwordForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, err = $("#passwordError");
    err.hidden = true;
    if (f.elements.next.value !== f.elements.confirm.value) {
      err.textContent = "The two new passwords don't match.";
      err.hidden = false;
      return;
    }
    try {
      await api.post("/api/auth/password", { current: f.elements.current.value, next: f.elements.next.value });
      f.reset();
      toast("Password changed");
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  // ---------- Policy sample texts ----------
  // Drafts based on how this store works (India, made-to-order personalised products,
  // cash on delivery, accounts + orders + reviews). Anything only the owner knows is in [brackets].
  function policySamples() {
    const f = settingsForm.elements;
    const store = f.storeName.value.trim() || "[Store name]";
    const email = f.footerEmail.value.trim() || "[email address]";
    const phone = f.footerPhone.value.trim() || "[phone number]";
    const address = f.footerAddress.value.trim() || "[business address]";
    const pay = f.paymentNote.value.trim() || "cash on delivery";
    const contact = `Email: ${email}\nPhone: ${phone}\nAddress: ${address}`;
    return {
      policyPrivacy: `Last updated: [date]

${store} ("we", "us") runs this website. This policy explains what personal information we collect, why we collect it and how we protect it.

What we collect
- Account details: your name, email address and password. Your password is stored only in a scrambled (hashed) form, so nobody at ${store} can read it.
- Order details: the name, mobile number, delivery address, city and PIN code you enter at checkout, and the products, sizes and colours you order.
- Reviews you choose to write. Reviews are shown with your first name only.
- One small cookie that keeps you signed in. We do not use advertising or tracking cookies.

How we use your information
- To process, make and deliver your orders, including contacting you to confirm your design and delivery.
- To show your order history and let you review products you have received.
- To answer your questions and complaints.
We do not sell or rent your personal information to anyone.

Who we share it with
- Delivery partners, who receive only the details needed to deliver your order.
- Government authorities, only when the law requires it.

How long we keep it
We keep order records for as long as needed for accounting, tax and legal purposes. You can ask us to delete your account at any time; we will delete or anonymise your information unless the law requires us to keep it.

Payments
Orders are currently paid by ${pay}. We do not collect or store card or bank details on this website.

Your rights
You can ask us to see, correct or delete your personal information, or withdraw your consent, by contacting us using the details below.

Grievance officer
Name: [name of the person who handles complaints]
${contact}
We will acknowledge your complaint within 48 hours and try to resolve it within [15] days.`,

      policyDelivery: `Where we deliver
We deliver to addresses across [India / list the states or cities you deliver to].

Making your order
Most of our products are personalised and made to order. After you place an order, we contact you to collect your logo or design and confirm it with you. Production starts only after you approve the design and usually takes [X–Y] working days.

Delivery time
After dispatch, delivery usually takes [X–Y] working days depending on your location. Remote areas may take longer. Bulk and business orders may need extra time; we will tell you the expected date when we confirm your order.

Delivery charges
[Delivery is free on all orders. / Delivery costs ₹[amount] per order; free on orders above ₹[amount].]

Payment on delivery
Orders are paid by ${pay}. Please keep the exact amount ready when your order arrives.

Tracking
When your order is dispatched, we will share the tracking details with you by [SMS / WhatsApp / email].

Failed delivery
Please make sure your address, PIN code and mobile number are correct. If a delivery fails because the address is wrong or nobody is available to receive it, we will contact you to arrange a new delivery; extra delivery charges may apply.

Delays
Delays can sometimes happen because of weather, holidays or courier issues. If your order is late, please contact us and we will help.

Contact
${contact}`,

      policyTerms: `Last updated: [date]

These terms apply when you use the ${store} website or place an order with us. By using the website you agree to them.

Your account
You are responsible for keeping your password safe and for all activity on your account. Please give us accurate details when you sign up and order.

Products and prices
- We try to show products as accurately as possible, but colours can look slightly different on different screens, and printed or embroidered designs may vary slightly in size and position.
- Prices are in Indian Rupees (₹) [and include GST / plus applicable taxes].
- We may change prices and products at any time. The price you pay is the price shown when you place your order.

Orders
- Placing an order is an offer to buy. We may cancel an order, for example if a product is out of stock or a price was shown incorrectly; if that happens we will tell you and refund any amount paid.
- Products with a minimum order quantity can only be ordered in at least that quantity (sizes and colours can be mixed).
- Orders are paid by ${pay}.

Your designs and logos
- When you send us a logo, image or text to print, you confirm that you own it or have permission to use it.
- We may refuse to print designs that are offensive or illegal or that copy someone else's trademark or copyright.
- We will ask you to approve your design before printing. Please check spelling and details carefully; we print exactly what you approve.

Reviews
Reviews must be honest and about the product. We may remove reviews that are abusive, false, spam or unrelated.

Our content
The website's text, photos and logo belong to ${store} and may not be copied without permission.

Liability
We are responsible for delivering the products you order as described. We are not responsible for indirect losses or delays caused by events outside our control. Nothing in these terms limits your rights under Indian consumer law.

Governing law
These terms are governed by the laws of India. Any dispute will be handled by the courts in [your city].

Changes
We may update these terms. The latest version is always on this website.

Contact
${contact}`,

      policyRefund: `Personalised products
Products printed or made with your name, logo or design are made specially for you. They cannot be returned or exchanged for change of mind, or if you chose the wrong size or approved a design with a mistake.

Damaged, faulty or wrong items
If your order arrives damaged or faulty, or is not what you ordered:
- Contact us within [48 hours] of delivery.
- Send photos of the product and the packaging (an unboxing video helps).
- We will check and then reprint or replace the item, or refund you.

Products that are not personalised
[Plain, non-personalised products can be returned within [7] days of delivery if unused and in their original packaging. / Delete this section if you only sell personalised products.]

Cancellations
- You can cancel free of charge before you approve your design.
- After you approve the design and production starts, the order cannot be cancelled.

Refunds
Because orders are paid by ${pay}, approved refunds are sent by [UPI / bank transfer] to the account you give us, within [7] working days of approval.

How to ask for a return or refund
${contact}
Please include your order number.`,
    };
  }

  // A small "Insert sample text" button above each policy box
  document.querySelectorAll('#settingsForm textarea[name^="policy"]').forEach((ta) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-ghost sample-btn";
    btn.textContent = "Insert sample text";
    btn.addEventListener("click", async () => {
      if (ta.value.trim() && !await confirmPopup({
        title: "Delete the current text?", message: "The text already in this box will be deleted and replaced by the sample.", confirmText: "Delete & insert sample", danger: true,
      })) return;
      ta.value = policySamples()[ta.name];
      ta.rows = 14;
      ta.focus();
      ta.setSelectionRange(0, 0);
      toast("Sample added. Fill in the [brackets], then click Save settings.");
    });
    ta.closest("label").insertBefore(btn, ta);
  });

  start();
})();
