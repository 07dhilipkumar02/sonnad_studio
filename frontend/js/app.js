/* =========================================================
   SONNAD STUDIO: storefront
   Header (categories, search, account, cart), product grid,
   cart drawer, checkout and orders. All data comes from /api.
   ========================================================= */
(() => {
  const $ = (sel) => document.querySelector(sel);

  const ICONS = {
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M19 19v2H6"/>',
    shirt: '<path d="M8 3 3 6l2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    gift: '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M3 12h18M12 8v13M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5zm0 0s1.5-5 4-5a2.5 2.5 0 0 1 0 5z"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
  };
  const icon = (name, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[name] || ICONS.book}</svg>`;
  const pv = $("#productView"), ov = $("#ordersView"), dv = $("#downloadsView"), cv = $("#checkoutView");

  const state = {
    categories: [],
    user: null,
    cart: { items: [], total: 0, count: 0 },
    filter: { category: "all", sub: null, q: "" },
    products: new Map(), // every product seen so far, by id
    lastList: [],        // products currently shown in the grid
    view: "list",        // "list" or "product"
    genre: "all",        // genre filter on the Books page
    owned: new Set(),    // digital products this customer can download
  };
  const catById = (id) => state.categories.find((c) => c.id === id);

  // =========================================================
  // Categories
  // =========================================================
  // Store name, description and logo from Admin → Settings
  let builtInLogo = null;
  function applyIdentity(s) {
    const name = s.storeName || "Sonnad Studio";
    document.title = name;
    document.querySelector('meta[name="description"]')?.setAttribute("content", s.metaDescription || "");
    $("#footerName").textContent = name;
    document.querySelectorAll("a.logo").forEach((a) => {
      a.setAttribute("aria-label", `${name} home`);
      builtInLogo ??= a.innerHTML;
      if (s.logoImage) {
        a.innerHTML = `<img class="logo-img" src="${escapeHtml(s.logoImage)}" alt="${escapeHtml(name)}" />`;
      } else if (name.toLowerCase() === "sonnad studio") {
        a.innerHTML = builtInLogo; // the drawn compass logo
      } else {
        const [first, ...rest] = name.split(" ");
        a.innerHTML = `<span class="logo-word">${escapeHtml(first)}</span>${rest.length ? `<span class="logo-sub">${escapeHtml(rest.join(" ").toUpperCase())}</span>` : ""}`;
      }
    });
  }

  // Delivery charge (Admin → Settings → Checkout): same rule as the server uses
  function deliveryFee(subtotal, digitalOnly) {
    const s = state.settings || {};
    if (digitalOnly || !s.deliveryCharge) return 0;
    if (s.freeDeliveryAbove && subtotal >= s.freeDeliveryAbove) return 0;
    return s.deliveryCharge;
  }

  // Store settings from the admin panel
  function applySettings(s) {
    state.settings = s;
    applyIdentity(s);
    renderHero();
    renderFooter();
    // Checkout promises = the 3 promises from Admin → Settings → Product page
    const promises = [s.trust1, s.trust2, s.trust3].filter(Boolean);
    const PROMISE_ICONS = ['<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="9"/>',
      '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'];
    const box = $("#checkoutPromises");
    if (box) {
      box.innerHTML = promises.map((t, i) => `<div class="guarantee-item"><svg viewBox="0 0 24 24">${PROMISE_ICONS[i]}</svg><span>${escapeHtml(t)}</span></div>`).join("");
      box.hidden = !promises.length;
    }
    const bar = $("#announcement");
    bar.textContent = s.announcement || "";
    bar.hidden = !(s.announcementOn && s.announcement);
    $("#paymentNote").textContent = s.paymentNote ? ` · ${s.paymentNote}` : "";
  }

  // ---------- Home banner ----------
  // Up to 3 product photos for the showcase banner, one per category where possible
  let showcasePhotos = null;
  async function loadShowcase() {
    if (showcasePhotos) return showcasePhotos;
    const list = await api.get("/api/products?category=all&limit=60").catch(() => []);
    const withImg = list.filter((p) => p.imageUrl);
    const byCat = {};
    withImg.forEach((p) => (byCat[p.category] ||= []).push(p));
    const queues = Object.values(byCat), picks = [];
    while (picks.length < 6 && queues.some((q) => q.length)) {
      for (const q of queues) if (q.length && picks.length < 6) picks.push(q.shift());
    }
    return (showcasePhotos = picks.map((p) => p.imageUrl));
  }

  // ---- Moving banner cards: rotate photos through left / centre / right
  let slideIndex = 0, slideTimer = null, slidePaused = false;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function placeSlides() {
    const figs = [...document.querySelectorAll("#heroCollage .hc")];
    const n = figs.length;
    figs.forEach((fig, i) => {
      const pos = (i - slideIndex + n) % n;
      const slot = pos === 0 ? "center" : pos === 1 ? "right" : pos === n - 1 ? "left" : "back";
      fig.dataset.slot = slot;
    });
  }
  function startSlides() {
    clearInterval(slideTimer);
    const n = document.querySelectorAll("#heroCollage .hc").length;
    if (n < 2 || reduceMotion) return;
    slideTimer = setInterval(() => {
      if (slidePaused || document.hidden || $("#hero").hidden) return;
      slideIndex = (slideIndex + 1) % n;
      placeSlides();
    }, 3000);
  }
  $("#heroCollage").addEventListener("mouseenter", () => (slidePaused = true));
  $("#heroCollage").addEventListener("mouseleave", () => (slidePaused = false));
  $("#heroCollage").addEventListener("click", (e) => {
    const fig = e.target.closest(".hc");
    if (!fig || fig.dataset.slot === "center") return;
    slideIndex = +fig.dataset.i;
    placeSlides();
  });

  async function renderHero() {
    const s = state.settings || {};
    const onHome = state.filter.category === "all" && !state.filter.q && !state.filter.favs && state.view !== "product";
    const hero = $("#hero");
    hero.hidden = !(s.bannerOn && onHome);
    if (hero.hidden) return;
    const showcase = !s.bannerImage;
    hero.classList.toggle("hero-showcase", showcase);
    hero.classList.toggle("hero-image", !showcase);
    if (showcase) {
      $("#heroImg").removeAttribute("src");
      const photos = await loadShowcase();
      if ($("#heroCollage").dataset.loaded !== "1") {
        $("#heroCollage").innerHTML = photos.map((src, i) =>
          `<figure class="hc" data-i="${i}"><img src="${escapeHtml(src)}" alt="" /></figure>`).join("");
        $("#heroCollage").dataset.loaded = "1";
        slideIndex = 0;
        placeSlides();
        startSlides();
      }
      hero.classList.toggle("hero-no-photos", !photos.length);
    } else {
      $("#heroCollage").innerHTML = "";
      $("#heroCollage").dataset.loaded = "";
      clearInterval(slideTimer);
      $("#heroImg").src = s.bannerImage;
    }
    $("#heroTag").textContent = s.bannerTag || "";
    $("#heroTag").hidden = !s.bannerTag;
    $("#heroTitle").textContent = s.bannerTitle || "";
    $("#heroTitle").hidden = !s.bannerTitle;
    $("#heroText").textContent = s.bannerText || "";
    $("#heroText").hidden = !s.bannerText;
    const btn = $("#heroBtn");
    btn.textContent = s.bannerButton || "";
    btn.hidden = !s.bannerButton;
    btn.dataset.target = s.bannerLink || "";
    hero.classList.toggle("hero-plain", !s.bannerTitle && !s.bannerText && !s.bannerButton);
  }
  $("#heroBtn").addEventListener("click", (e) => {
    const target = e.currentTarget.dataset.target;
    if (target && catById(target)) setFilter({ category: target });
    else $("#productGrid").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---------- Footer ----------
  const SOCIAL = {"instagram":{"name":"Instagram","svg":"<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"5\"/><circle cx=\"12\" cy=\"12\" r=\"4\"/><circle cx=\"17.5\" cy=\"6.5\" r=\"1.2\" fill=\"currentColor\" stroke=\"none\"/>"},"facebook":{"name":"Facebook","svg":"<path d=\"M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8.5a.5.5 0 0 1 .5-.5z\"/>"},"whatsapp":{"name":"WhatsApp","svg":"<path d=\"M3 21l1.6-4.7A9 9 0 1 1 8 19.6z\"/><path d=\"M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 1c-1.2-.5-2.5-1.8-3-3l1-1-1-2z\"/>"},"youtube":{"name":"YouTube","svg":"<rect x=\"2\" y=\"5\" width=\"20\" height=\"14\" rx=\"4\"/><path d=\"m10 9 5 3-5 3z\" fill=\"currentColor\"/>"},"twitter":{"name":"X","svg":"<path d=\"M4 4l16 16M20 4 4 20\"/>"},"linkedin":{"name":"LinkedIn","svg":"<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"3\"/><path d=\"M8 10v7M8 7v.01M12 17v-4a2 2 0 0 1 4 0v4M12 10v7\"/>"},"pinterest":{"name":"Pinterest","svg":"<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M11 8.5c3.5-1 5.5 1 5 3.5-.4 2-2 3-3.5 2.5M12.5 11 10 21\"/>"}};
  const POLICIES = [["policyPrivacy", "Privacy policy"], ["policyDelivery", "Delivery policy"],
    ["policyTerms", "Terms and conditions"], ["policyRefund", "Return & refund policy"]];
  // Payment methods from Admin → Settings, shown as card-style badges (well-known ones get their colours)
  function payBadge(m) {
    const n = m.toLowerCase();
    if (/\bvisa\b/.test(n)) return `<span class="pay-badge pay-visa" title="${escapeHtml(m)}">VISA</span>`;
    if (/master/.test(n)) return `<span class="pay-badge pay-master" title="${escapeHtml(m)}"><svg viewBox="0 0 38 24" aria-hidden="true"><circle cx="15" cy="12" r="8" fill="#eb001b"/><circle cx="23" cy="12" r="8" fill="#f79e1b"/><path d="M19 5.6a8 8 0 0 1 0 12.8 8 8 0 0 1 0-12.8z" fill="#ff5f00"/></svg><span class="sr-only">${escapeHtml(m)}</span></span>`;
    if (/\bupi\b/.test(n)) return `<span class="pay-badge pay-upi" title="${escapeHtml(m)}">UPI<i>▶</i></span>`;
    if (/rupay/.test(n)) return `<span class="pay-badge pay-rupay" title="${escapeHtml(m)}">RuPay</span>`;
    if (/cash|cod/.test(n)) return `<span class="pay-badge pay-cod" title="${escapeHtml(m)}">${svgIcon('<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>')}${escapeHtml(m)}</span>`;
    return `<span class="pay-badge" title="${escapeHtml(m)}">${escapeHtml(m)}</span>`;
  }
  function renderFooter() {
    const s = state.settings || {};
    const pol = POLICIES.filter(([k]) => s[k]);
    const hasFaq = !!String(s.faqs || "").trim();
    $("#footerPolicies").innerHTML = pol.map(([k, label]) => `<li><button type="button" data-policy="${k}">${label}</button></li>`).join("")
      + (hasFaq ? `<li><button type="button" data-policy="faqs">FAQs</button></li>` : "");
    $("#footerPolicyCol").hidden = !pol.length && !hasFaq;
    $("#footerPay").innerHTML = list(s.paymentMethods).map(payBadge).join("");
    $("#footerPayRow").hidden = !list(s.paymentMethods).length;
    $("#footerYear").textContent = new Date().getFullYear();
    $("#footerAbout").textContent = s.footerAbout || "";
    $("#footerShop").innerHTML = state.categories.map((c) =>
      `<li><button type="button" data-category="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button></li>`).join("");
    const contact = [];
    const ci = (paths) => `<span class="fc-ic">${svgIcon(paths)}</span>`;
    if (s.footerPhone) contact.push(`<li class="fc-row">${ci('<path d="M5 3h3.5l1.7 4.3-2.2 1.5a11 11 0 0 0 6.2 6.2l1.5-2.2L20 14.5V18a2 2 0 0 1-2.2 2A16 16 0 0 1 3 5.2 2 2 0 0 1 5 3z"/>')}<span><span class="fc-label">Phone</span><a href="tel:${escapeHtml(s.footerPhone.replace(/[^\d+]/g, ""))}">${escapeHtml(s.footerPhone)}</a></span></li>`);
    if (s.footerEmail) contact.push(`<li class="fc-row">${ci('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>')}<span><span class="fc-label">Email</span><a href="mailto:${escapeHtml(s.footerEmail)}">${escapeHtml(s.footerEmail)}</a></span></li>`);
    if (s.footerAddress) contact.push(`<li class="fc-row">${ci('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>')}<span><span class="fc-label">Address</span>${escapeHtml(s.footerAddress)}</span></li>`);
    $("#footerContact").innerHTML = contact.join("");
    $("#footerContactCol").hidden = !contact.length;
    const links = Object.entries(SOCIAL).filter(([k]) => /^https:\/\//.test(s[k] || ""));
    $("#footerSocial").innerHTML = links.length
      ? `<span class="follow-label">Follow us</span><div class="social-row">${links.map(([k, v]) =>
          `<a class="social-${k}" href="${escapeHtml(s[k])}" target="_blank" rel="noopener noreferrer" aria-label="${v.name}" title="${v.name}"><svg viewBox="0 0 24 24" aria-hidden="true">${v.svg}</svg></a>`).join("")}</div>`
      : "";
  }
  function openDocPopup(title, html) {
    const dlg = document.createElement("dialog");
    dlg.className = "modal doc-popup";
    dlg.innerHTML = `<div class="modal-body"><h2>${escapeHtml(title)}</h2><div class="doc-body">${html}</div>
      <div class="modal-actions"><button type="button" class="btn-gold" data-x>Close</button></div></div>`;
    dlg.addEventListener("click", (e) => { if (e.target.closest("[data-x]") || e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.appendChild(dlg);
    dlg.showModal();
  }
  document.querySelector(".site-footer").addEventListener("click", (e) => {
    const policy = e.target.closest("[data-policy]")?.dataset.policy;
    if (policy === "faqs") {
      const blocks = String(state.settings.faqs || "").split(/\n\s*\n/).map((b) => b.split("\n").map((x) => x.trim()).filter(Boolean)).filter((b) => b.length);
      openDocPopup("Frequently asked questions", blocks.map(([q, ...a]) => `<h3>${escapeHtml(q)}</h3><p>${escapeHtml(a.join(" "))}</p>`).join(""));
    } else if (policy) {
      const label = POLICIES.find(([k]) => k === policy)[1];
      const paras = String(state.settings[policy] || "").split(/\n\s*\n/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
      openDocPopup(label, paras);
    }
    const action = e.target.closest("[data-footer-action]")?.dataset.footerAction;
    if (e.target.closest("[data-category]")) window.scrollTo({ top: 0, behavior: "smooth" });
    if (action === "orders") state.user ? showOrdersPage(true) : openAuth("login", "orders");
    if (action === "downloads") state.user ? showDownloadsPage(true) : openAuth("login", "downloads");
    if (action === "cart") openDrawer();
    if (action === "account" && !state.user) openAuth("login");
    if (action === "account" && state.user) toast(`You're signed in as ${state.user.email}`);
  });

  function renderCategories() {
    // Search hint lists the real categories, e.g. "Search books, t-shirts, business packs…"
    const names = state.categories.map((c) => c.label.toLowerCase());
    $("#searchInput").placeholder = names.length ? `Search ${names.join(", ")}…` : "Search products…";
    $("#categoryList").innerHTML =
      state.categories.map((c) => `
        <li class="cat-item" data-cat="${escapeHtml(c.id)}">
          <button class="cat-link" data-category="${escapeHtml(c.id)}">${escapeHtml(c.label)}</button>
        </li>`).join("");
  }

  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-category]");
    if (!el) return;
    e.preventDefault();
    $("#searchInput").value = "";
    setFilter({ category: el.dataset.category, sub: el.dataset.sub || null, q: "" });
    closeMobileMenu();
  });

  function setFilter(filter) {
    if (state.view !== "list") showListView(true);
    if (filter.category !== state.filter.category) state.genre = "all";
    state.filter = { category: "all", sub: null, q: "", ...filter };
    document.querySelectorAll(".cat-item").forEach((li) =>
      li.classList.toggle("active", li.dataset.cat === state.filter.category));
    renderHero();
    return loadProducts();
  }

  // Mobile: collapse any open subcategory list
  function closeMobileMenu() {
    document.querySelectorAll(".cat-item.expanded").forEach((i) => i.classList.remove("expanded"));
  }

  // =========================================================
  // Products
  // =========================================================
  let productsReq = 0;
  function showPageHead(title, meta) {
    $("#pageTitle").textContent = title;
    $("#pageTitle").hidden = !title;
    $("#pageMeta").textContent = meta;
    $("#pageHead").hidden = false;
  }
  // A downloadable pack: a ZIP file, or any digital product in Business Packs
  const isPack = (p) => !!p.isDigital && (p.fileType === "ZIP" || p.category === "business-packs");
  const isBook = (p) => (!!p.isDigital && !isPack(p)) || p.category === "books";
  const bookGenre = (p) => (pairs(p.specs).find(([k]) => /^(category|genre)$/i.test(k)) || [])[1] || "";

  // ---------- Favourites (heart on each card, saved in this browser) ----------
  const FAV_KEY = "sonnad_favs";
  const favs = new Set((() => { try { return (JSON.parse(localStorage.getItem(FAV_KEY)) || []).map(Number); } catch { return []; } })());
  const saveFavs = () => { try { localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); } catch {} };
  const HEART = '<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/>';
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fav]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation(); // don't open the product
    const id = +b.dataset.fav;
    const on = !favs.has(id);
    on ? favs.add(id) : favs.delete(id);
    saveFavs();
    document.querySelectorAll(`[data-fav="${id}"]`).forEach((x) => {
      x.classList.toggle("on", on);
      x.setAttribute("aria-pressed", String(on));
      x.setAttribute("aria-label", on ? "Remove from favourites" : "Add to favourites");
    });
    toast(on ? "Saved to your favourites" : "Removed from favourites");
    if (state.filter.favs) loadProducts();
  }, true);

  // Diagonal corner ribbon: the admin's badge, else FREE or the discount
  const ribbonText = (p) => p.badge || (!p.price ? "Free" : p.mrp > p.price ? `${Math.round((1 - p.price / p.mrp) * 100)}% OFF` : "");
  const CART_SVG = '<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/>';
  const ARROW_SVG = '<path d="M5 12h14m-6-6 6 6-6 6"/>';
  const DOWNLOAD_SVG = '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>';
  // Round button at the bottom-right of a card
  function cardAction(p) {
    if (isPack(p)) return `<span class="n-act n-go" aria-hidden="true">${svgIcon(ARROW_SVG)}</span>`;
    if (isBook(p)) {
      const a = bookAction(p);
      if (!a) return `<span class="n-act disabled" title="Out of stock">${svgIcon(CART_SVG)}</span>`;
      const dl = a.cls === "owned" || a.cls === "free";
      return `<button type="button" class="n-act ${a.cls}" ${a.attr} aria-label="${a.label}" title="${a.label}">${svgIcon(dl ? DOWNLOAD_SVG : CART_SVG)}</button>`;
    }
    if (p.stock <= 0) return `<span class="n-act disabled" title="Out of stock">${svgIcon(CART_SVG)}</span>`;
    const label = p.sizes || p.colors ? "Choose options" : "Add to cart";
    return `<button type="button" class="n-act" data-add="${p.id}" data-name="${escapeHtml(p.name)}" data-price="${p.price}" aria-label="${label}" title="${label}">${svgIcon(CART_SVG)}</button>`;
  }

  // One product card (home sections, category pages, search results, favourites)
  // opts.home: card shown in a home page section (business packs there have no "Free download" row)
  function cardHtml(p, opts = {}) {
    const book = isBook(p), pack = isPack(p), rib = ribbonText(p), fav = favs.has(p.id);
    const showFoot = !(pack && opts.home === true);
    const sub = book ? p.author : pack ? p.highlight : "";
    const img = p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy" />` : icon(catById(p.category)?.icon);
    return `
    <article class="card ncard ${book ? "n-book" : pack ? "n-pack" : "n-item"}" data-product="${p.id}">
      <div class="n-media${p.imageUrl && p.hoverImage && !book ? " has-hover" : ""}"${book && p.imageUrl ? ` style="--cover:url('${escapeHtml(p.imageUrl)}')"` : ""}>
        ${book ? `<div class="n-cover">${img}</div>` : img}
        ${!book && p.imageUrl && p.hoverImage ? `<img class="img-hover" src="${escapeHtml(p.hoverImage)}" alt="" loading="lazy" />` : ""}
        ${rib ? `<span class="n-ribbon">${escapeHtml(rib)}</span>` : ""}
        <button type="button" class="n-fav${fav ? " on" : ""}" data-fav="${p.id}" aria-pressed="${fav}" aria-label="${fav ? "Remove from favourites" : "Add to favourites"}">${svgIcon(HEART)}</button>
        ${p.minQty > 1 ? `<span class="n-min">Min. ${p.minQty} pcs</span>` : ""}
      </div>
      <div class="n-body">
        <h3 class="n-title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h3>
        ${sub ? `<p class="n-sub" title="${escapeHtml(sub)}">${escapeHtml(sub)}</p>` : ""}
        <div class="n-stars"><span class="stars" style="--fill:${(p.rating || 0) * 20}%" aria-label="${p.reviewCount ? `${p.rating.toFixed(1)} out of 5` : "No ratings yet"}"></span><small>(${p.reviewCount || 0})</small></div>
        ${showFoot ? `<div class="n-foot">
          ${pack ? `<span class="n-pack-note">${p.price ? rupee(p.price) : "Free download"}</span>` : `<div class="n-price">${priceLabel(p)}</div>`}
          ${cardAction(p)}
        </div>` : ""}
      </div>
    </article>`;
  }

  // Genre buttons above the Books grid (built from the books themselves)
  function renderGenreChips(books) {
    const box = $("#genreChips");
    if (!books) { box.hidden = true; state.genre = "all"; return; }
    const counts = new Map();
    books.forEach((p) => { const g = bookGenre(p) || "Other"; counts.set(g, (counts.get(g) || 0) + 1); });
    if (state.genre !== "all" && !counts.has(state.genre)) state.genre = "all";
    const chip = (g, label, n) => `<button type="button" class="genre-chip${state.genre === g ? " on" : ""}" data-genre="${escapeHtml(g)}">${escapeHtml(label)} <span>${n}</span></button>`;
    box.innerHTML = chip("all", "All books", books.length) + [...counts].map(([g, n]) => chip(g, g, n)).join("");
    box.hidden = counts.size < 2;
  }
  $("#genreChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-genre]");
    if (!b) return;
    state.genre = b.dataset.genre;
    loadProducts();
  });

  // Big solid icons for the home page section headings (chosen per category in Admin → Categories)
  const SECTION_ICONS = {
    book: '<path d="M2 5.5C4.5 4 8 4 11 5.6V20c-3-1.6-6.5-1.6-9 0z" fill="currentColor" stroke="none"/><path d="M22 5.5C19.5 4 16 4 13 5.6V20c3-1.6 6.5-1.6 9 0z" fill="currentColor" stroke="none"/>',
    shirt: '<path d="M12 6.5V5.2a1.8 1.8 0 1 1 1.8 1.8c-.6 0-1 .4-1 1v.6M12 8.5 2.8 15.2c-.9.7-.4 2.1.7 2.1h17c1.1 0 1.6-1.4.7-2.1z"/>',
    briefcase: '<path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" /><rect x="2" y="7" width="20" height="13" rx="2.5" fill="currentColor" stroke="none"/><path d="M2 12.5h20" stroke="#fff" stroke-width="1.6"/><rect x="10.5" y="11" width="3" height="3.2" rx=".8" fill="#fff" stroke="none"/>',
    gift: '<rect x="3" y="8" width="18" height="13" rx="2" fill="currentColor" stroke="none"/><path d="M12 8v13M3 12h18" stroke="#fff" stroke-width="1.6"/><path d="M12 8S10.5 3 8 3a2.5 2.5 0 0 0 0 5zm0 0s1.5-5 4-5a2.5 2.5 0 0 1 0 5z"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" fill="currentColor" stroke="none"/><circle cx="7.5" cy="7.5" r="1.6" fill="#fff" stroke="none"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z" fill="currentColor" stroke="none"/><path d="M3 8l9 5 9-5M12 13v8" stroke="#fff" stroke-width="1.4"/>',
  };
  function renderHomeSections(list) {
    return state.categories.map((c) => ({ c, items: list.filter((p) => p.category === c.id) }))
      .filter((s) => s.items.length)
      .map(({ c, items }, i) => `
      <section class="home-sec home-sec-${i % 3}">
        <header class="hs-head">
          <span class="hs-ic">${svgIcon(SECTION_ICONS[c.icon] || SECTION_ICONS.tag)}</span>
          <div class="hs-title">
            <h2>${escapeHtml(c.label)}</h2>
            ${c.tagline ? `<p>${escapeHtml(c.tagline)}</p>` : ""}
          </div>
          <button type="button" class="hs-all${i % 3 === 1 ? " dark" : ""}" data-category="${escapeHtml(c.id)}">View All ${escapeHtml(c.label)} ${svgIcon(ARROW_SVG)}</button>
        </header>
        <div class="hs-grid">${items.slice(0, 4).map((p) => cardHtml(p, { home: true })).join("")}</div>
      </section>`).join("");
  }

  async function loadProducts() {
    const { category, sub, q } = state.filter;
    const params = new URLSearchParams({ category });
    if (sub) params.set("sub", sub);
    if (q) params.set("q", q);

    const reqId = ++productsReq;
    let list;
    try {
      list = await api.get(`/api/products?${params}`);
    } catch (err) {
      showPageHead("", "Could not load products. Is the server running?");
      return;
    }
    if (reqId !== productsReq) return; // a newer request finished first

    list.forEach((p) => state.products.set(p.id, p));
    const grid = $("#productGrid");
    // Favourites page (Account → My favourites)
    if (state.filter.favs) {
      list = list.filter((p) => favs.has(p.id));
      showPageHead("My favourites", list.length ? `${list.length} saved product${list.length === 1 ? "" : "s"}` : "Tap the ♡ on any product to save it here.");
    } else if (q) showPageHead(`Results for “${q}”`, `${list.length} product${list.length === 1 ? "" : "s"}`);
    else $("#pageHead").hidden = true;
    state.lastList = list;

    // Home page: one section per category (4 products each) with a "View All" button
    const home = category === "all" && !q && !state.filter.favs;
    grid.classList.toggle("home-mode", home);
    if (home) {
      renderGenreChips(null);
      grid.classList.remove("shelves-mode");
      grid.innerHTML = renderHomeSections(list) || `<p class="muted">No products yet.</p>`;
      return;
    }
    // Books page: one grid of all books + genre buttons to filter it
    const packsPage = category === "business-packs" && !q && list.length;
    $("#productGrid").classList.toggle("shelves-mode", !!packsPage);
    renderGenreChips(null); // genre buttons above the Books grid are turned off: all books are shown
    const shown = list;
    $("#productGrid").innerHTML = packsPage ? renderPacksPage(list)
      : shown.map(cardHtml).join("") || `<p class="muted">No products found.</p>`;
  }

  function onCardClick(e) {
    const now = e.target.closest("[data-download-now]");
    if (now) return startDownload(+now.dataset.downloadNow);
    const dl = e.target.closest("[data-download]");
    if (dl) return downloadBook(+dl.dataset.download);
    const claim = e.target.closest("[data-claim]");
    if (claim) return claimFree(+claim.dataset.claim);
    const btn = e.target.closest("[data-add]");
    const card = e.target.closest(".card[data-product]");
    if (!card) return;
    const p = state.products.get(+card.dataset.product);
    if (btn && !p) { addToCart(+btn.dataset.add, { name: btn.dataset.name, price: +btn.dataset.price }); return; }
    if (btn && p && !p.sizes && !p.colors) {
      addToCart(p.id, { name: p.name, price: p.price });
      return;
    }
    openProduct(+card.dataset.product); // choose size/colour on the product page
  }
  $("#productGrid").addEventListener("click", onCardClick);

  // =========================================================
  // Product details page  (URL: /?product=ID)
  // =========================================================
  // ---------- Digital books ----------
  async function loadOwned() {
    state.owned = new Set(state.user ? await api.get("/api/downloads").catch(() => []) : []);
    if (state.view === "product" && current) renderProduct();
    else if (state.lastList.length) {
      const grid = $("#productGrid");
      if (grid.classList.contains("home-mode")) grid.innerHTML = renderHomeSections(state.lastList);
      else if (grid.classList.contains("shelves-mode")) grid.innerHTML = renderPacksPage(state.lastList);
      else if (!$("#genreChips").hidden && state.genre !== "all") grid.innerHTML = state.lastList.filter((p) => (bookGenre(p) || "Other") === state.genre).map(cardHtml).join("");
      else grid.innerHTML = state.lastList.map(cardHtml).join("");
    }
  }
  // =========================================================
  // My Downloads Page (replaces popup modal)
  // =========================================================
  async function showDownloadsPage(push = true) {
    state.view = "downloads";
    pv.hidden = true;
    if (ov) ov.hidden = true;
    if (cv) cv.hidden = true;
    $("#hero").hidden = true;
    $("#pageHead").hidden = true;
    $("#genreChips").hidden = true;
    $("#productGrid").hidden = true;
    dv.hidden = false;
    document.title = `My Downloads · ${state.baseTitle || "Sonnad Studio"}`;
    if (push) history.pushState({ view: "downloads" }, "", "/downloads");
    window.scrollTo({ top: 0, behavior: "smooth" });
    await renderDownloadsPage();
  }

  async function renderDownloadsPage() {
    if (!state.user) {
      dv.innerHTML = `
        <div class="account-page-head">
          <div class="account-page-nav">
            <button type="button" class="page-back-btn" data-back-to-shop>
              <svg viewBox="0 0 24 24"><path d="M19 12H5m6-6-6 6 6 6"/></svg> Back to shop
            </button>
            <div class="account-tabs-nav">
              <button type="button" class="account-nav-tab" data-nav="orders">My Orders</button>
              <button type="button" class="account-nav-tab active" data-nav="downloads">My Downloads</button>
            </div>
          </div>
          <div class="account-title-wrap">
            <h1>My Downloads</h1>
            <p class="account-subtitle">All your digital books, PDFs, and ZIP packs ready for download.</p>
          </div>
        </div>
        <div class="account-card account-empty-card">
          <div class="account-empty-icon">${svgIcon(ICONS.book)}</div>
          <h3>Sign in to access your downloads</h3>
          <p class="muted">Access your digital library, download ZIP packs, and read purchased books online anytime.</p>
          <div class="account-empty-actions">
            <button type="button" class="btn-gold" data-action="login">Sign in</button>
            <button type="button" class="btn-ghost" data-action="register">Create account</button>
          </div>
        </div>`;
      return;
    }

    dv.innerHTML = `
      <div class="account-page-head">
        <div class="account-page-nav">
          <button type="button" class="page-back-btn" data-back-to-shop>
            <svg viewBox="0 0 24 24"><path d="M19 12H5m6-6-6 6 6 6"/></svg> Back to shop
          </button>
          <div class="account-tabs-nav">
            <button type="button" class="account-nav-tab" data-nav="orders">My Orders</button>
            <button type="button" class="account-nav-tab active" data-nav="downloads">My Downloads</button>
          </div>
        </div>
        <div class="account-title-wrap">
          <h1>My Downloads</h1>
          <p class="account-subtitle">All your digital books, PDFs, and packs ready for instant access.</p>
        </div>
      </div>
      <div class="account-loading"><p class="muted">Loading your downloads…</p></div>`;

    try {
      const [orders, owned] = await Promise.all([
        api.get("/api/orders").catch(() => []),
        api.get("/api/downloads").catch(() => []), // everything ready to download (paid + free)
      ]);
      const books = new Map();
      // paid items (ready, or waiting for the order to be confirmed)
      for (const o of orders) for (const i of o.items) {
        if (!i.isDigital || !i.canRate) continue;
        const ready = ["confirmed", "shipped", "delivered"].includes(o.status);
        const prev = books.get(i.productId);
        if (o.status === "cancelled" && !prev) continue;
        books.set(i.productId, { id: i.productId, name: i.name, ready: ready || prev?.ready, order: o.id });
      }
      // free downloads from the library (not orders)
      for (const id of owned) {
        if (books.has(id)) books.get(id).ready = true;
        else books.set(id, { id, name: "", ready: true, order: null });
      }
      const list = [...books.values()];
      const info = await Promise.all(list.map((b) => api.get(`/api/products/${b.id}`).catch(() => ({}))));
      list.forEach((b, k) => { if (!b.name) b.name = info[k].name || "Download"; });

      if (!list.length) {
        dv.innerHTML = `
          <div class="account-page-head">
            <div class="account-page-nav">
              <button type="button" class="page-back-btn" data-back-to-shop>
                <svg viewBox="0 0 24 24"><path d="M19 12H5m6-6-6 6 6 6"/></svg> Back to shop
              </button>
              <div class="account-tabs-nav">
                <button type="button" class="account-nav-tab" data-nav="orders">My Orders</button>
                <button type="button" class="account-nav-tab active" data-nav="downloads">My Downloads</button>
              </div>
            </div>
            <div class="account-title-wrap">
              <h1>My Downloads</h1>
              <p class="account-subtitle">All your digital books, PDFs, and packs ready for instant access.</p>
            </div>
          </div>
          <div class="account-card account-empty-card">
            <div class="account-empty-icon">${svgIcon(ICONS.book)}</div>
            <h3>No downloads yet</h3>
            <p class="muted">You haven't bought or claimed any digital books or download packs yet.</p>
            <div class="account-empty-actions">
              <button type="button" class="btn-gold" data-category="books">Browse digital books</button>
            </div>
          </div>`;
        return;
      }

      dv.innerHTML = `
        <div class="account-page-head">
          <div class="account-page-nav">
            <button type="button" class="page-back-btn" data-back-to-shop>
              <svg viewBox="0 0 24 24"><path d="M19 12H5m6-6-6 6 6 6"/></svg> Back to shop
            </button>
            <div class="account-tabs-nav">
              <button type="button" class="account-nav-tab" data-nav="orders">My Orders</button>
              <button type="button" class="account-nav-tab active" data-nav="downloads">My Downloads</button>
            </div>
          </div>
          <div class="account-title-wrap">
            <h1>My Downloads</h1>
            <p class="account-subtitle">Your digital library: read books online or download your ZIP packs anytime.</p>
          </div>
        </div>
        <div class="downloads-page-grid">
          ${list.map((b, k) => `
            <article class="download-page-card ${b.ready ? "is-ready" : "is-pending"}">
              <div class="download-card-cover">
                ${info[k].imageUrl ? `<img src="${escapeHtml(info[k].imageUrl)}" alt="${escapeHtml(b.name)}" />` : `<div class="dl-cover-placeholder">${svgIcon(ICONS.book)}</div>`}
              </div>
              <div class="download-card-content">
                <span class="download-format-pill">${escapeHtml(info[k].fileType || "Digital")}</span>
                <h3 class="download-card-title">${escapeHtml(b.name)}</h3>
                ${info[k].author ? `<p class="download-card-author">By ${escapeHtml(info[k].author)}</p>` : ""}
                <div class="download-status">
                  ${b.ready
                    ? `<span class="dl-status-ready"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg> Ready to access</span>`
                    : `<span class="dl-status-pending">Order #${b.order} · Waiting for payment confirmation</span>`}
                </div>
                <div class="download-actions">
                  ${b.ready ? ((info[k].fileType || "PDF") === "PDF"
                    ? `<button type="button" class="btn-gold btn-block" data-view="${b.id}" data-title="${escapeHtml(b.name)}">
                         <svg viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg> Read online
                       </button>`
                    : `<button type="button" class="btn-gold btn-block" data-dl="${b.id}">
                         <svg viewBox="0 0 24 24"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg> ${info[k].fileType === "ZIP" ? "Download ZIP" : "Download"}
                       </button>`)
                    : `<button type="button" class="btn-ghost btn-block" disabled>Download locked</button>`}
                  ${b.order == null ? `<button type="button" class="dl-remove" data-remove-dl="${b.id}" data-title="${escapeHtml(b.name)}">
                       <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg> Remove from My Downloads
                     </button>` : ""}
                </div>
              </div>
            </article>`).join("")}
        </div>`;
    } catch (err) {
      dv.innerHTML = `
        <div class="account-page-head">
          <div class="account-page-nav">
            <button type="button" class="page-back-btn" data-back-to-shop>
              <svg viewBox="0 0 24 24"><path d="M19 12H5m6-6-6 6 6 6"/></svg> Back to shop
            </button>
          </div>
          <div class="account-title-wrap">
            <h1>My Downloads</h1>
          </div>
        </div>
        <p class="form-error">${escapeHtml(err.message)}</p>`;
    }
  }

  dv.addEventListener("click", (e) => {
    if (e.target.closest("[data-back-to-shop]")) return showListView(true);
    if (e.target.closest('[data-nav="orders"]')) return showOrdersPage(true);
    const act = e.target.closest("[data-action]")?.dataset.action;
    if (act) return openAuth(act, "downloads");
    const rm = e.target.closest("[data-remove-dl]");
    if (rm) {
      (async () => {
        const ok = await confirmPopup({ title: `Remove "${rm.dataset.title}"?`,
          message: "It will be removed from My Downloads. It's free, so you can get it again any time from the shop.",
          confirmText: "Remove", danger: true });
        if (!ok) return;
        try {
          await api.del(`/api/downloads/${rm.dataset.removeDl}`);
          toast("Removed from My Downloads");
          await loadOwned();
          renderDownloadsPage();
        } catch (err) { toast(err.message); }
      })();
      return;
    }
    const dlBtn = e.target.closest("[data-dl]");
    if (dlBtn) return startDownload(+dlBtn.dataset.dl);
    const viewBtn = e.target.closest("[data-view]");
    if (viewBtn) return openReader(+viewBtn.dataset.view, viewBtn.dataset.title);
  });

  const openDownloads = (push = true) => showDownloadsPage(push);

  // Read a PDF book inside the website. Pages are drawn by pdf.js, so the book always opens
  // here (even when the browser is set to download PDFs) and the reader has no download button.
  const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  let pdfjsReady = null;
  function loadPdfJs() {
    pdfjsReady ??= new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = PDFJS + "pdf.min.js";
      s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; resolve(window.pdfjsLib); };
      s.onerror = () => { pdfjsReady = null; reject(new Error("Could not load the book reader. Check your internet connection.")); };
      document.head.appendChild(s);
    });
    return pdfjsReady;
  }

  async function openReader(id, title) {
    const dlg = document.createElement("dialog");
    dlg.className = "reader";
    dlg.innerHTML = `
      <div class="reader-bar">
        <strong>${escapeHtml(title || "Book")}</strong>
        <span class="reader-tools">
          <button type="button" class="reader-btn" data-zoom="-1" aria-label="Zoom out">−</button>
          <span class="reader-page" aria-live="polite">Loading…</span>
          <button type="button" class="reader-btn" data-zoom="1" aria-label="Zoom in">+</button>
          <button type="button" class="btn-ghost" data-x>Close</button>
        </span>
      </div>
      <div class="reader-pages" tabindex="0"></div>`;
    dlg.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(dlg);
    dlg.showModal();
    const box = dlg.querySelector(".reader-pages"), info = dlg.querySelector(".reader-page");
    let doc = null, scale = 1, observer = null;

    const close = () => dlg.close();
    dlg.addEventListener("close", () => { observer?.disconnect(); doc?.destroy(); dlg.remove(); });

    // Draw a page only when it scrolls into view (books can have hundreds of pages)
    async function drawPage(slot) {
      if (slot.dataset.drawn === String(scale)) return;
      slot.dataset.drawn = String(scale);
      const page = await doc.getPage(+slot.dataset.page);
      const fit = Math.min(1.6, (box.clientWidth - 32) / page.getViewport({ scale: 1 }).width) * scale;
      const vp = page.getViewport({ scale: fit * (window.devicePixelRatio || 1) });
      const canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.style.width = `${vp.width / (window.devicePixelRatio || 1)}px`;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      slot.replaceChildren(canvas);
      slot.style.minHeight = "";
    }
    function buildSlots(first) {
      observer?.disconnect();
      box.innerHTML = "";
      const ratio = first.height / first.width;
      const w = Math.min(1.6 * first.width, box.clientWidth - 32) * scale;
      observer = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) {
          drawPage(en.target);
          info.textContent = `Page ${en.target.dataset.page} of ${doc.numPages}`;
        }
      }), { root: box, rootMargin: "600px 0px" });
      for (let n = 1; n <= doc.numPages; n++) {
        const slot = document.createElement("div");
        slot.className = "reader-slot";
        slot.dataset.page = n;
        slot.style.minHeight = `${w * ratio}px`;
        slot.style.width = `${w}px`;
        box.appendChild(slot);
        observer.observe(slot);
      }
    }

    dlg.addEventListener("click", (e) => {
      if (e.target.closest("[data-x]")) return close();
      const z = e.target.closest("[data-zoom]");
      if (z && doc) {
        scale = Math.max(0.6, Math.min(2.2, scale + 0.2 * +z.dataset.zoom));
        const atPage = Math.round(box.scrollTop / box.scrollHeight * doc.numPages);
        doc.getPage(1).then((p) => {
          buildSlots(p.getViewport({ scale: 1 }));
          box.scrollTop = atPage / doc.numPages * box.scrollHeight;
        });
      }
    });

    try {
      const pdfjsLib = await loadPdfJs();
      doc = await pdfjsLib.getDocument({ url: `/api/downloads/${id}?view=1`, withCredentials: true }).promise;
      buildSlots((await doc.getPage(1)).getViewport({ scale: 1 }));
      info.textContent = `Page 1 of ${doc.numPages}`;
      box.focus();
    } catch (err) {
      box.innerHTML = `<p class="reader-error">${escapeHtml(err?.status === 403 ? "This book unlocks after your order is confirmed." : err.message || "Could not open this book.")}</p>`;
      info.textContent = "";
    }
  }

  // Download a file; if the server says no (e.g. not confirmed yet, file missing), show the reason
  // on screen instead of the browser saving the error as a ".json" file.
  async function saveDownload(url) {
    try {
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || "This download is not available right now. Please try again.");
        return false;
      }
      const cd = res.headers.get("content-disposition") || "";
      const name = decodeURIComponent((/filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd) || [])[1] || "download");
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
      return true;
    } catch {
      toast("Could not reach the server. Please check your connection and try again.");
      return false;
    }
  }
  const startDownload = (id) => saveDownload(`/api/downloads/${id}`);
  async function downloadBook(id) {
    const p = state.products.get(id) || (current?.id === id ? current : null);
    if (!state.user) return openAuth("login", "downloads");
    if (state.owned.has(id)) return openDownloads();
    const buy = await showPopup({
      title: "Buy to download",
      message: `"${p?.name || "This book"}" is a digital download. After you buy it and your order is confirmed, the Download button unlocks here and in My orders.`,
      confirmText: "Buy now", cancelText: "Not now",
    });
    if (buy && p) {
      const ok = await addToCart(id, { name: p.name, price: p.price });
      if (ok) openCheckout();
    }
  }

  let current = null;               // product shown on the page
  let choice = { size: "", color: "", qty: 1, image: 0, tab: "desc", allReviews: false };

  const colorHex = (entry) => (entry.match(/#[0-9a-f]{3,8}$/i) || [])[0] || "";
  const colorLabel = (entry) => entry.replace(/\s*#[0-9a-f]{3,8}$/i, "").trim();
  const list = (str) => String(str || "").split(",").map((x) => x.trim()).filter(Boolean);
  const swatchColor = (entry) => colorHex(entry) || (CSS.supports("color", colorLabel(entry)) ? colorLabel(entry) : "");
  const json = (v, fb) => { try { return typeof v === "string" ? JSON.parse(v || "null") ?? fb : v ?? fb; } catch { return fb; } };
  const lines = (t) => String(t || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const pairs = (t) => lines(t).map((l) => { const [a, ...b] = l.split("|"); return [a.trim(), b.join("|").trim()]; });

  function showListView(updateUrl) {
    state.view = "list";
    pv.hidden = true;
    if (ov) ov.hidden = true;
    if (dv) dv.hidden = true;
    if (cv) cv.hidden = true;
    $("#productGrid").hidden = false;
    document.title = state.baseTitle;
    if (updateUrl && (location.pathname !== "/" || location.search)) history.pushState({}, "", "/");
    clearInterval(slideTimer);
    renderHero().then(() => startSlides());
  }

  async function openProduct(id, push = true) {
    let p;
    try { p = await api.get(`/api/products/${id}`); }
    catch { toast("This product is no longer available."); return showListView(true); }
    p.galleryList = json(p.gallery, []);
    p.colorImageMap = json(p.colorImages, {});
    p.previewList = json(p.previewPages, []);
    state.products.set(p.id, { ...state.products.get(p.id), ...p });
    current = p;
    choice = { size: "", color: "", qty: Math.max(1, p.minQty || 1), image: 0, tab: "desc", allReviews: false };
    const sizes = list(p.sizes), colors = list(p.colors);
    if (sizes.length === 1) choice.size = sizes[0];
    if (colors.length === 1) choice.color = colorLabel(colors[0]);
    if (push) history.pushState({ product: p.id }, "", `/?product=${p.id}`);
    state.view = "product";
    $("#hero").hidden = true;
    $("#pageHead").hidden = true;
    $("#productGrid").hidden = true;
    if (ov) ov.hidden = true;
    if (dv) dv.hidden = true;
    if (cv) cv.hidden = true;
    pv.hidden = false;
    document.title = `${p.name} · ${state.baseTitle}`;
    renderProduct();
    window.scrollTo({ top: 0, behavior: "smooth" });
    loadReviews(p.id);
    loadRelated(p);
  }

  // Main photo, second photo, gallery photos (no duplicates)
  function productImages(p) {
    return [...new Set([p.imageUrl, p.hoverImage, ...(p.galleryList || [])].filter(Boolean))];
  }

  // Size chart text: one row per line, columns separated by "|", first row is the header
  function sizeChartHtml(text) {
    const rows = lines(text).map((l) => l.split("|").map((c) => c.trim()));
    if (!rows.length) return "";
    if (rows.every((r) => r.length < 2)) {
      return `<ul class="pdp-points">${rows.map((r) => `<li>${escapeHtml(r[0])}</li>`).join("")}</ul>`;
    }
    const [head, ...body] = rows;
    return `<div class="table-scroll"><table class="size-table">
      <thead><tr>${head.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>
      <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  const STEP_ICONS = [
    '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
    '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  ];
  const TRUST_ICONS = [
    '<path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
    '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    '<path d="M1 3h15v13H1zM16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  ];
  const svgIcon = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

  function colorOption(p, c) {
    const name = colorLabel(c), photo = p.colorImageMap[name], bg = swatchColor(c), on = choice.color === name;
    const attrs = `type="button" role="radio" aria-checked="${on}" data-color="${escapeHtml(name)}"`;
    if (photo) {
      return `<button ${attrs} class="color-tile${on ? " on" : ""}"><img src="${escapeHtml(photo)}" alt="" /><span>${escapeHtml(name)}</span></button>`;
    }
    if (bg) {
      return `<button ${attrs} class="swatch${on ? " on" : ""}" title="${escapeHtml(name)}" aria-label="${escapeHtml(name)}" style="--sw:${escapeHtml(bg)}"></button>`;
    }
    return `<button ${attrs} class="chip${on ? " on" : ""}">${escapeHtml(name)}</button>`;
  }

  function renderProduct() {
    if (isPack(current)) return renderPackPage();
    if (isBook(current)) return renderBookPage();
    const p = current, set = state.settings || {};
    const sizes = list(p.sizes), colors = list(p.colors);
    const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
    const imgs = productImages(p);
    const colorImg = choice.color && p.colorImageMap[choice.color];
    const mainImg = (choice.image === -1 && colorImg) || imgs[Math.max(0, choice.image)] || colorImg || "";
    const cat = catById(p.category);
    const maxQty = Math.max(1, Math.min(99, p.stock));
    const points = lines(String(p.description || "").replace(/\.\s+(?=[A-Z0-9])/g, ".\n"));
    const trust = [set.trust1, set.trust2, set.trust3].map((t, i) => [t, TRUST_ICONS[i]]).filter(([t]) => t);
    const steps = pairs(set.howItWorks).slice(0, 4);
    const why = pairs(set.whyChoose).slice(0, 6);
    const faqs = String(set.faqs || "").split(/\n\s*\n/).map((b) => lines(b)).filter((b) => b.length)
      .map(([q, ...a]) => [q, a.join(" ")]);
    const custom = lines(set.customizeInfo);
    const specRows = [
      p.author && ["Author / brand", p.author],
      p.isbn && ["ISBN", p.isbn],
      p.isDigital && ["Format", `${p.fileType || "Digital"} download`],
      ...pairs(p.specs).filter(([k]) => k),
    ].filter(Boolean);
    const book = isBook(p);
    const learn = lines(p.learnPoints);
    const tabs = book ? [] : [["desc", "Description"], specRows.length && ["specs", "Specifications"], custom.length && !p.isDigital && ["custom", "Customise options"], p.sizeChart && ["size", "Size chart"]].filter(Boolean);
    const bookInfo = [
      ...pairs(p.specs).filter(([k]) => k),
      p.isDigital && !pairs(p.specs).some(([k]) => /^format$/i.test(k)) && ["Format", p.fileType || "Digital download"],
      p.isbn && ["ISBN", p.isbn],
    ].filter(Boolean);
    const bookDetails = book ? `
      <section class="pdp-section">
        <div class="book-details">
          ${p.description ? `<h3>Book description</h3><p>${escapeHtml(p.description).replace(/\n/g, "<br>")}</p>` : ""}
          ${bookInfo.length ? `<h3>Book information</h3><ul>${bookInfo.map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</li>`).join("")}</ul>` : ""}
          ${learn.length ? `<h3>What you will learn</h3><ul>${learn.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
        </div>
      </section>` : "";
    if (!tabs.some(([k]) => k === choice.tab)) choice.tab = "desc";

    const crumbs = `
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/" data-category="all">Home</a><span>›</span>
        ${cat ? `<a href="/" data-category="${escapeHtml(cat.id)}">${escapeHtml(cat.label)}</a><span>›</span>` : ""}
        <span aria-current="page">${escapeHtml(p.name)}</span>
      </nav>`;

    const thumbs = imgs.length > 1
      ? `<div class="pdp-thumbs">${imgs.map((src, i) => `
          <button class="pdp-thumb${i === choice.image ? " active" : ""}" data-img="${i}" aria-label="Show picture ${i + 1}">
            <img src="${escapeHtml(src)}" alt="" />
          </button>`).join("")}</div>`
      : "";

    const gallery = `
      <div class="pdp-gallery${imgs.length > 1 ? " has-thumbs" : ""}">
        ${thumbs}
        <div class="pdp-image">
          ${mainImg ? `<img id="pdpImg" src="${escapeHtml(mainImg)}" alt="${escapeHtml(p.name)}" />` : icon(cat?.icon)}
          ${p.badge ? `<span class="card-ribbon">${escapeHtml(p.badge)}</span>` : ""}
          ${p.minQty > 1 ? `<span class="card-min">Min. ${p.minQty} pcs</span>` : ""}
          ${p.previewList.length ? `<button type="button" class="look-inside" data-look-inside>${svgIcon('<path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>')}Look inside</button>` : ""}
        </div>
      </div>`;

    const colorBlock = colors.length ? `
      <div class="opt-block">
        <span class="opt-label">Colour${choice.color ? `: <b>${escapeHtml(choice.color)}</b>` : ""}</span>
        <div class="opt-chips" role="radiogroup" aria-label="Colour">${colors.map((c) => colorOption(p, c)).join("")}</div>
      </div>` : "";

    const sizeBlock = sizes.length ? `
      <div class="opt-block">
        <span class="opt-label">Size${p.sizeChart ? ` <button type="button" class="link-btn" data-tab="size">Size chart</button>` : ""}</span>
        <div class="opt-chips" role="radiogroup" aria-label="Size">
          ${sizes.map((sz) => `<button type="button" role="radio" class="chip${choice.size === sz ? " on" : ""}" aria-checked="${choice.size === sz}" data-size="${escapeHtml(sz)}">${escapeHtml(sz)}</button>`).join("")}
        </div>
      </div>` : "";

    const owned = state.owned.has(p.id);
    const pack = isPack(p);
    const digitalBlock = pack ? (owned ? `
      <div class="pdp-digital">${svgIcon('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>')}<span>This pack is yours. Download the ZIP file any time; it is also in <strong>Account → My downloads</strong>.</span></div>
      <div class="pdp-buy"><button type="button" class="pdp-now" data-download-now="${p.id}">Download now (ZIP)</button></div>`
      : !p.price ? `
      <div class="pdp-digital">${svgIcon('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>')}<span>Free download · <strong>ZIP file</strong> with everything listed below. Sign in, click the button and the download starts straight away.</span></div>
      <div class="pdp-buy"><button type="button" class="pdp-now" data-claim="${p.id}">Get free pack &amp; download</button></div>`
      : `
      <div class="pdp-digital">${svgIcon('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>')}<span>Digital download · <strong>ZIP file</strong>. After your order is confirmed, click <strong>Download now</strong> here or in <strong>Account → My downloads</strong>.</span></div>
      <div class="pdp-buy">
        <button type="button" class="pdp-add" data-buy="cart">Add to cart</button>
        <button type="button" class="pdp-now" data-buy="now">Buy now</button>
      </div>
      <p class="pdp-error" id="pdpError" hidden></p>
      <p class="pdp-note">${escapeHtml(set.digitalPaymentNote || "")}</p>`)
    : owned ? `
      <div class="pdp-digital">${svgIcon('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>')}<span>You own this ${escapeHtml(p.fileType || "digital")} book.</span></div>
      <div class="pdp-buy"><button type="button" class="pdp-now" data-open-downloads>Go to My downloads</button></div>` : `
      <div class="pdp-digital">${svgIcon('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>')}<span>Digital download · <strong>${escapeHtml(p.fileType || "PDF")}</strong>. After your order is confirmed, download it here or from <strong>Account → My downloads</strong>. No delivery needed.</span></div>
      <div class="pdp-buy">
        <button type="button" class="pdp-add" data-buy="cart">Add to cart</button>
        <button type="button" class="pdp-now" data-buy="now">Buy now</button>
      </div>
      <p class="pdp-error" id="pdpError" hidden></p>
      <p class="pdp-note">${escapeHtml(set.digitalPaymentNote || "")}</p>`;
    const buyBlock = p.isDigital ? digitalBlock : p.stock > 0 ? `
      <div class="pdp-buy">
        <div class="stepper" aria-label="Quantity">
          <button type="button" data-step="-1" aria-label="Decrease quantity">−</button>
          <input id="pdpQty" type="number" inputmode="numeric" min="1" max="${maxQty}" value="${choice.qty}" aria-label="Quantity" />
          <button type="button" data-step="1" aria-label="Increase quantity">+</button>
        </div>
        <button type="button" class="pdp-add" data-buy="cart">Add to cart</button>
        <button type="button" class="pdp-now" data-buy="now">Buy now</button>
      </div>
      <p class="pdp-error" id="pdpError" hidden></p>
      <p class="pdp-note">${[p.stock < 10 ? `Only ${p.stock} left in stock` : "In stock", set.paymentNote].filter(Boolean).map(escapeHtml).join(" · ")}</p>`
      : `<p class="pdp-out">Out of stock</p>`;

    let panel = "";
    if (choice.tab === "desc") {
      const inside = lines(p.learnPoints);
      panel = (points.length
        ? `<h3>${isPack(p) ? "About this pack" : "Product description"}</h3><ul class="pdp-points">${points.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`
        : `<p class="muted">No description yet.</p>`)
        + (inside.length ? `<h3 class="inside-title">What's inside</h3><ul class="pack-files">${inside.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "");
    } else if (choice.tab === "specs") {
      panel = `<h3>Specifications</h3><table class="spec-table">${specRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</table>`;
    } else if (choice.tab === "custom") {
      panel = `<h3>Customise options</h3><ul class="pdp-points">${custom.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
    } else if (choice.tab === "size") {
      panel = `<h3>Size chart</h3>${sizeChartHtml(p.sizeChart)}`;
    }

    const info = `
      <div class="pdp-info">
        <h1>${escapeHtml(p.name)}</h1>
        ${p.author ? `<p class="pdp-author">by <strong>${escapeHtml(p.author)}</strong></p>` : ""}
        ${isBook(p) && p.badge ? `<span class="pill-badge">${escapeHtml(p.badge)}</span>` : ""}
        <a class="pdp-rating" href="#pdpReviews">
          <span class="stars" style="--fill:${(p.rating || 0) * 20}%" aria-hidden="true"></span>
          ${p.reviewCount ? `<strong>${p.rating.toFixed(1)}</strong>` : ""}
          <span class="muted">(${p.reviewCount} review${p.reviewCount === 1 ? "" : "s"})</span>
        </a>
        <div class="pdp-price">
          ${off ? `<div class="pdp-mrp"><s class="mrp">${rupee(p.mrp)}</s><span class="save">${off}% OFF</span></div>` : ""}
          <span class="price">${p.price ? rupee(p.price) : "Free"}</span>
        </div>
        <ul class="pdp-facts">
          ${colors.length > 1 ? `<li><span class="dot-rainbow"></span>${colors.length} colour options available</li>` : ""}
          ${set.offerNote && !p.isDigital ? `<li class="fact-offer"><span class="fact-badge">%</span>${escapeHtml(set.offerNote)}</li>` : ""}
        </ul>
        ${p.highlight ? `<div class="pdp-highlight">${svgIcon('<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>')}${escapeHtml(p.highlight)}</div>` : ""}
        ${trust.length && !p.isDigital ? `<div class="pdp-trust">${trust.map(([t, ic]) => `<span>${svgIcon(ic)}${escapeHtml(t)}</span>`).join("")}</div>` : ""}
        <div class="pdp-options">${colorBlock}${sizeBlock}</div>
        ${p.minQty > 1 ? `<p class="pdp-note">Minimum order: <strong>${p.minQty} pieces</strong> (sizes and colours can be mixed)</p>` : ""}
        ${buyBlock}
        ${tabs.length ? `<div class="pdp-tabs" role="tablist">` : `<div hidden>`}
          ${tabs.map(([k, label]) => `<button type="button" role="tab" class="pdp-tab${choice.tab === k ? " on" : ""}" aria-selected="${choice.tab === k}" data-tab="${k}">${label}</button>`).join("")}
        </div>
        ${tabs.length ? `<div class="pdp-tabpanel" role="tabpanel">${panel}</div>` : ""}
      </div>`;

    const howItWorks = steps.length ? `
      <section class="pdp-section how-it-works">
        <h2>How it works</h2>
        <ol class="steps">
          ${steps.map(([t, d], i) => `
            <li>
              <span class="step-num">Step ${i + 1}</span>
              <span class="step-icon">${svgIcon(STEP_ICONS[i])}</span>
              <strong>${escapeHtml(t)}</strong>
              ${d ? `<small>${escapeHtml(d)}</small>` : ""}
            </li>`).join("")}
        </ol>
      </section>` : "";

    const faqBlock = faqs.length ? `
      <section class="pdp-section">
        <h2>Frequently asked questions</h2>
        <div class="faq-grid">
          ${faqs.map(([q, a]) => `<details class="faq"><summary>${escapeHtml(q)}</summary><p>${escapeHtml(a)}</p></details>`).join("")}
        </div>
      </section>` : "";

    const whyBlock = why.length ? `
      <section class="pdp-section">
        <h2>Why choose us</h2>
        <div class="why-grid">
          ${why.map(([t, d]) => `<div class="why"><strong>${escapeHtml(t)}</strong>${d ? `<span>${escapeHtml(d)}</span>` : ""}</div>`).join("")}
        </div>
      </section>` : "";

    pv.innerHTML = `
      ${crumbs}
      <div class="pdp-main${book ? " pdp-book" : ""}">
        <button class="pdp-nav pdp-prev" data-nav="-1" aria-label="Previous product">${svgIcon('<path d="m15 18-6-6 6-6"/>')}</button>
        ${gallery}
        ${info}
        <button class="pdp-nav pdp-next" data-nav="1" aria-label="Next product">${svgIcon('<path d="m9 18 6-6-6-6"/>')}</button>
      </div>
      ${bookDetails}
      ${book ? "" : howItWorks}
      <section class="pdp-section" id="pdpReviews">
        <h2>Ratings &amp; reviews</h2>
        <div class="reviews-wrap" id="pdpReviewList"><p class="muted">Loading reviews…</p></div>
      </section>
      ${faqBlock}
      <section class="pdp-section" id="pdpRelatedWrap" hidden>
        <h2>Similar products</h2>
        <div class="product-grid" id="pdpRelated"></div>
      </section>
      ${whyBlock}`;

    if (state.reviewCache?.id === p.id) renderReviews(state.reviewCache.data);
    if (state.relatedCache?.id === p.id) renderRelated(state.relatedCache.items);
  }

  // ---------- Look inside (preview pages) ----------
  function openLookInside(p) {
    const pages = p.previewList;
    if (!pages.length) return;
    let i = 0;
    const dlg = document.createElement("dialog");
    dlg.className = "modal look-dialog";
    dlg.innerHTML = `
      <div class="look-head"><strong>${escapeHtml(p.name)}</strong><span class="muted" id="lookCount"></span>
        <button type="button" class="icon-btn" data-x aria-label="Close">✕</button></div>
      <div class="look-stage">
        <button type="button" class="pdp-nav look-prev" data-step-page="-1" aria-label="Previous page">${svgIcon('<path d="m15 18-6-6 6-6"/>')}</button>
        <img id="lookImg" alt="" />
        <button type="button" class="pdp-nav look-next" data-step-page="1" aria-label="Next page">${svgIcon('<path d="m9 18 6-6-6-6"/>')}</button>
      </div>
      <p class="muted look-note">Preview pages · the full book is available after purchase.</p>`;
    const show = () => {
      dlg.querySelector("#lookImg").src = pages[i];
      dlg.querySelector("#lookImg").alt = `Page ${i + 1}`;
      dlg.querySelector("#lookCount").textContent = `Page ${i + 1} of ${pages.length}`;
      dlg.querySelector(".look-prev").disabled = i === 0;
      dlg.querySelector(".look-next").disabled = i === pages.length - 1;
    };
    dlg.addEventListener("click", (e) => {
      const st = e.target.closest("[data-step-page]");
      if (st) { i = Math.max(0, Math.min(pages.length - 1, i + +st.dataset.stepPage)); show(); }
      if (e.target.closest("[data-x]") || e.target === dlg) dlg.close();
    });
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { i = Math.min(pages.length - 1, i + 1); show(); }
      if (e.key === "ArrowLeft") { i = Math.max(0, i - 1); show(); }
    });
    dlg.addEventListener("close", () => dlg.remove());
    document.body.appendChild(dlg);
    show();
    dlg.showModal();
  }

  // =========================================================
  // Bookstore (Kobo-style): book cards, shelves, book page
  // =========================================================
  const fmtWords = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
  const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) : "");
  const specValue = (p, re) => (pairs(p.specs).find(([k]) => re.test(k)) || [])[1] || "";
  const bookPages = (p) => p.pages || parseInt(specValue(p, /^pages$/i), 10) || 0;
  function readingHours(p) {
    const words = p.words || bookPages(p) * 250;
    if (!words) return "";
    const h = words / 250 / 60; // ~250 words a minute
    const lo = Math.max(1, Math.floor(h)), hi = Math.max(lo + 1, Math.ceil(h));
    return h < 1 ? "Under 1" : `${lo} - ${hi}`;
  }
  function bookAction(p) {
    if (p.isDigital && state.owned.has(p.id)) return { label: "Download", attr: `data-download="${p.id}"`, cls: "owned" };
    if (p.isDigital && !p.price) return { label: "Get free eBook", attr: `data-claim="${p.id}"`, cls: "free" };
    if (p.stock <= 0 && !p.isDigital) return null;
    return { label: "Add to cart", attr: `data-add="${p.id}" data-name="${escapeHtml(p.name)}" data-price="${p.price}"`, cls: "" };
  }
  const priceLabel = (p) => (p.price
    ? `<span class="b-price">${rupee(p.price)}</span>${p.mrp > p.price ? `<s class="b-mrp">${rupee(p.mrp)}</s><span class="b-off">${Math.round((1 - p.price / p.mrp) * 100)}% OFF</span>` : ""}`
    : `<span class="b-price">Free</span>`);

  // Book card: cover, title, author, stars, price (click opens the book page to buy)
  function bookCardHtml(p) {
    return `
    <article class="card bcard" data-product="${p.id}">
      <div class="b-stage"${p.imageUrl ? ` style="--cover:url('${escapeHtml(p.imageUrl)}')"` : ""}>
        <div class="b-cover">${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy" />` : icon("book")}</div>
      </div>
      <div class="b-body">
      <h3 class="b-title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</h3>
      <p class="b-author">${escapeHtml(p.author || bookGenre(p) || "")}</p>
      <div class="b-stars"><span class="stars" style="--fill:${(p.rating || 0) * 20}%" aria-label="${p.reviewCount ? `${p.rating.toFixed(1)} out of 5` : "No ratings yet"}"></span>${p.reviewCount ? `<small>(${p.reviewCount})</small>` : ""}</div>
      <div class="b-pricebox">${priceLabel(p)}</div>
      </div>
    </article>`;
  }

  // A horizontal shelf of book cards with ‹ › arrows
  function shelfHtml(title, items, id = "") {
    if (!items.length) return "";
    return `
    <section class="shelf"${id ? ` id="${id}"` : ""}>
      <h2 class="shelf-title">${title}</h2>
      <div class="shelf-wrap">
        <button type="button" class="shelf-arrow prev" data-shelf="-1" aria-label="Scroll left">${svgIcon('<path d="m15 18-6-6 6-6"/>')}</button>
        <div class="shelf-track">${items.map(bookCardHtml).join("")}</div>
        <button type="button" class="shelf-arrow next" data-shelf="1" aria-label="Scroll right">${svgIcon('<path d="m9 18 6-6-6-6"/>')}</button>
      </div>
    </section>`;
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-shelf]");
    if (!b) return;
    const track = b.parentElement.querySelector(".shelf-track");
    track.scrollBy({ left: +b.dataset.shelf * track.clientWidth * 0.85, behavior: "smooth" });
  });

  // Hide a shelf's arrows when everything already fits
  function updateShelfArrows() {
    document.querySelectorAll(".shelf-wrap").forEach((w) => {
      const t = w.querySelector(".shelf-track");
      w.classList.toggle("no-scroll", t.scrollWidth <= t.clientWidth + 4);
    });
  }
  window.addEventListener("resize", updateShelfArrows);

  // Books page: one shelf per genre
  function renderBookShelves(list) {
    const groups = new Map();
    for (const p of list) {
      const g = bookGenre(p) || "More books";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    const newest = [...list].sort((a, b) => (b.releaseDate || "").localeCompare(a.releaseDate || "") || b.id - a.id);
    return shelfHtml("New &amp; noteworthy", newest.slice(0, 12)) +
      [...groups].map(([g, items]) => shelfHtml(escapeHtml(g), items)).join("");
  }

  // Free e-book: add to My downloads
  async function claimFree(id) {
    if (!state.user) return openAuth("login");
    try {
      await api.post(`/api/downloads/${id}/claim`);
      await loadOwned();
      const p = state.products.get(id) || (current?.id === id ? current : null);
      if (p && isPack(p)) { if (await startDownload(id)) toast("Your download has started"); }
      else toast("Added to My downloads");
    } catch (err) { toast(err.message); }
  }

  // All books (for series, related and "more by" shelves)
  let allBooksCache = null;
  async function allBooks() {
    if (!allBooksCache) {
      allBooksCache = await api.get("/api/products?category=books&limit=200").catch(() => []);
      allBooksCache.forEach((x) => state.products.set(x.id, { ...state.products.get(x.id), ...x }));
    }
    return allBooksCache;
  }

  // ---------- Book details page ----------
  function renderBookPage() {
    const p = current, set = state.settings || {};
    const cat = catById(p.category);
    const off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
    const act = bookAction(p);
    const genre = bookGenre(p), lang = specValue(p, /^language$/i);
    const pages = bookPages(p), hours = readingHours(p);
    const learn = lines(p.learnPoints);
    const paras = String(p.description || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
    const longSynopsis = String(p.description || "").length > 420;
    const extraSpecs = pairs(p.specs).filter(([k]) => k && !/^(category|genre|language|pages)$/i.test(k));

    const buyButtons = act?.cls === "owned"
      ? `<button type="button" class="b-btn owned big" data-open-downloads>Go to My downloads</button>`
      : act?.cls === "free"
        ? `<button type="button" class="b-btn free big" data-claim="${p.id}">Get free eBook</button>`
        : act ? `<button type="button" class="b-btn big" data-buy="cart">Add to cart</button>
                 <button type="button" class="b-btn alt big" data-buy="now">Buy now</button>`
          : `<p class="pdp-out">Out of stock</p>`;

    const details = [
      p.author && ["Author", p.author],
      p.releaseDate && ["Release date", fmtDate(p.releaseDate)],
      p.publisher && ["Publisher", p.publisher],
      p.isbn && ["ISBN", p.isbn],
      lang && ["Language", lang],
      p.isDigital && ["Download format", p.fileType || "PDF"],
      p.isDigital && p.fileSize && ["File size", fmtSize(p.fileSize)],
      ...extraSpecs,
    ].filter(Boolean);

    pv.innerHTML = `
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/" data-category="all">Home</a><span>/</span>
        ${cat ? `<a href="/" data-category="${escapeHtml(cat.id)}">${escapeHtml(cat.label)}</a><span>/</span>` : ""}
        ${genre ? `<span>${escapeHtml(genre)}</span><span>/</span>` : ""}
        <span aria-current="page">${escapeHtml(p.name)}</span>
      </nav>

      <div class="bk-top">
        <div class="bk-cover-col">
          <div class="bk-cover">
            ${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)} cover" />` : icon("book")}
            ${p.previewList.length ? `<button type="button" class="look-inside" data-look-inside>${svgIcon('<path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z"/>')}Look inside</button>` : ""}
          </div>
          <a class="bk-rating" href="#bkReviews"><span class="stars" style="--fill:${(p.rating || 0) * 20}%"></span><small>(${p.reviewCount})</small></a>
          ${genre ? `<p class="bk-genre">in <a href="/" data-category="${escapeHtml(p.category)}">${escapeHtml(genre)}</a></p>` : ""}
        </div>

        <div class="bk-main">
          <h1>${escapeHtml(p.name)}</h1>
          ${p.subtitle ? `<p class="bk-subtitle">${escapeHtml(p.subtitle)}</p>` : ""}
          ${p.author ? `<p class="bk-by">by <button type="button" class="link-btn" data-goto="bkMoreBy">${escapeHtml(p.author)}</button></p>` : ""}
          ${p.series ? `<p class="bk-series">${p.seriesNo ? `Book ${p.seriesNo} · ` : ""}<button type="button" class="link-btn" data-goto="bkSeries">${escapeHtml(p.series)}</button></p>` : ""}
          ${p.badge ? `<span class="pill-badge">${escapeHtml(p.badge)}</span>` : ""}

          ${paras.length ? `
            <div class="bk-block">
              <h2>Synopsis</h2>
              <div class="bk-synopsis${longSynopsis ? " clamped" : ""}" id="bkSynopsis">${paras.map((x, i) => `<p${i === 0 ? ' class="lead"' : ""}>${escapeHtml(x)}</p>`).join("")}</div>
              ${longSynopsis ? `<button type="button" class="bk-more" data-readmore aria-expanded="false">Read more ⌄</button>` : ""}
            </div>` : ""}

          ${pages || p.words ? `
            <div class="bk-block">
              <h2>About this book</h2>
              <div class="bk-stats">
                ${pages ? `<div>${svgIcon('<path d="M4 4h12v16H4zM8 2h12v16"/>')}<strong>${pages}</strong><small>Pages</small></div>` : ""}
                ${hours ? `<div>${svgIcon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}<strong>${hours}</strong><small>Hours to read</small></div>` : ""}
                ${p.words ? `<div>${svgIcon('<path d="M2 5h8a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H2zM22 5h-8a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h8z"/>')}<strong>${fmtWords(p.words)}</strong><small>Total words</small></div>` : ""}
              </div>
            </div>` : ""}

          ${learn.length ? `<div class="bk-block"><h2>What you will learn</h2><ul class="bk-learn">${learn.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>` : ""}

          <div class="bk-block" id="bkSeries" hidden></div>
        </div>

        <aside class="bk-buy">
          <p class="bk-buy-label">${p.isDigital ? (p.price ? "eBook" : "Free eBook") : "Book"}</p>
          ${p.price ? `<div class="bk-buy-price"><span>${rupee(p.price)}</span>${off ? `<s>${rupee(p.mrp)}</s><em>Save ${off}%</em>` : ""}</div>` : ""}
          ${buyButtons}
          <p class="pdp-error" id="pdpError" hidden></p>
          ${p.isDigital && act?.cls !== "owned" && p.price ? `<p class="bk-buy-note">${escapeHtml(set.digitalPaymentNote || "")}</p>` : ""}
          ${p.isDigital ? `<p class="bk-buy-note">${svgIcon('<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>')}<span>${escapeHtml(p.fileType || "PDF")} download · find it in <strong>Account → My downloads</strong></span></p>` : ""}
        </aside>
      </div>

      <div id="bkShelves"></div>

      <section class="bk-section" id="bkReviews">
        <h2>Ratings and book reviews <span class="muted">(${p.reviewCount})</span></h2>
        <div id="bkReviewBody"><p class="muted">Loading reviews…</p></div>
      </section>

      ${details.length ? `
        <section class="bk-section bk-details">
          <div>
            <h2>${p.isDigital ? "eBook details" : "Book details"}</h2>
            <dl>${details.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("")}</dl>
          </div>
          ${p.isDigital ? `
            <div class="bk-devices">
              <p>You can read this ${escapeHtml(p.fileType || "PDF")} on any of these devices:</p>
              <ul>
                <li>${svgIcon('<rect x="2" y="4" width="20" height="13" rx="1"/><path d="M8 21h8M12 17v4"/>')}Desktop</li>
                <li>${svgIcon('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>')}Phone</li>
                <li>${svgIcon('<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>')}Tablet</li>
                <li>${svgIcon('<rect x="5" y="2" width="14" height="20" rx="1"/><path d="M8 6h8M8 10h8M8 14h5"/>')}eReader</li>
              </ul>
            </div>` : ""}
        </section>` : ""}`;

    if (state.reviewCache?.id === p.id) renderBookReviews(state.reviewCache.data);
    fillBookShelves(p);
  }

  // Series row + related / more-by shelves
  async function fillBookShelves(p) {
    const books = await allBooks();
    if (current?.id !== p.id || !$("#bkShelves")) return;
    const genre = bookGenre(p);
    const series = p.series ? books.filter((b) => b.series === p.series && b.id !== p.id).sort((a, b) => a.seriesNo - b.seriesNo) : [];
    const box = $("#bkSeries");
    if (series.length) {
      box.hidden = false;
      box.innerHTML = `<h2>In this series</h2>
        <div class="bk-series-row">${series.map((b) => `
          <button type="button" class="bk-series-item" data-open="${b.id}">
            ${b.imageUrl ? `<img src="${escapeHtml(b.imageUrl)}" alt="" />` : icon("book")}
            <span>${b.seriesNo ? `Book ${b.seriesNo}` : escapeHtml(b.name)}</span>
          </button>`).join("")}</div>
        <button type="button" class="b-btn alt" data-add-series>Add series to cart</button>`;
    }
    const related = books.filter((b) => b.id !== p.id && genre && bookGenre(b) === genre);
    const byAuthor = books.filter((b) => b.id !== p.id && p.author && b.author === p.author);
    // Always show similar books: same genre first, then the rest of the shop's books
    const similar = [...related, ...books.filter((b) => b.id !== p.id && !related.includes(b))].slice(0, 12);
    $("#bkShelves").innerHTML =
      shelfHtml("Similar books", similar) +
      shelfHtml(`More by ${escapeHtml(p.author || "")}`, byAuthor, "bkMoreBy");
    requestAnimationFrame(updateShelfArrows);
  }

  // Reviews with filter + sort
  let reviewFilter = "all", reviewSort = "newest";
  function renderBookReviews({ summary, reviews }) {
    const box = $("#bkReviewBody");
    if (!box) return;
    let list = reviews.filter((r) => reviewFilter === "all" || r.rating === +reviewFilter);
    list = [...list].sort((a, b) => reviewSort === "high" ? b.rating - a.rating
      : reviewSort === "low" ? a.rating - b.rating : b.createdAt.localeCompare(a.createdAt));
    const bars = [5, 4, 3, 2, 1].map((n) => {
      const c = summary.dist[n] || 0, pct = summary.count ? (c / summary.count) * 100 : 0;
      return `<div class="bar-row wide"><span>${n} STAR${n > 1 ? "S" : ""}</span><span class="bar"><span style="width:${pct}%"></span></span><span>${c}</span></div>`;
    }).join("");
    box.innerHTML = `
      <div class="bk-rev-summary">
        <div class="bk-overall">
          <p>Overall rating</p>
          <strong>${summary.count ? `${summary.avg.toFixed(1)} out of 5` : "No ratings yet"}</strong>
          <span><span class="stars" style="--fill:${summary.avg * 20}%"></span> <small>(${summary.count})</small></span>
        </div>
        <div class="bars">${bars}</div>
        <div class="bk-share">
          <p>Share your thoughts</p>
          <button type="button" class="b-btn" data-write-review>Write your review</button>
        </div>
      </div>
      <div class="bk-rev-head">
        <h3>All book reviews</h3>
        <div class="bk-rev-tools">
          <label>Filter by
            <select data-rev-filter>
              ${[["all", "All"], ["5", "5 stars"], ["4", "4 stars"], ["3", "3 stars"], ["2", "2 stars"], ["1", "1 star"]]
                .map(([v, l]) => `<option value="${v}"${reviewFilter === v ? " selected" : ""}>${l}</option>`).join("")}
            </select>
          </label>
          <label>Sort by
            <select data-rev-sort>
              ${[["newest", "Newest"], ["high", "Highest rated"], ["low", "Lowest rated"]]
                .map(([v, l]) => `<option value="${v}"${reviewSort === v ? " selected" : ""}>${l}</option>`).join("")}
            </select>
          </label>
        </div>
      </div>
      ${list.length ? list.map((r) => `
        <article class="bk-review">
          <div><span class="stars" style="--fill:${r.rating * 20}%"></span> <strong>${escapeHtml(current.name)}</strong></div>
          ${r.comment ? `<p>${escapeHtml(r.comment)}</p>` : ""}
          <small class="muted">by ${escapeHtml(r.name)} on ${new Date(r.createdAt.replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}</small>
        </article>`).join("")
        : `<p class="muted">${reviews.length ? "No reviews match this filter." : "No reviews yet. Buy the book and be the first to review it."}</p>`}`;
  }

  // Clicks that only exist on the book page
  pv.addEventListener("click", async (e) => {
    if (!current || !isBook(current)) return;
    const t = e.target;
    if (t.closest(".card[data-product]")) return; // handled by the main handler
    const claim = t.closest("[data-claim]"), go = t.closest("[data-goto]"), open = t.closest("[data-open]");
    if (claim) return claimFree(+claim.dataset.claim);
    if (open) return openProduct(+open.dataset.open);
    if (go) return $(`#${go.dataset.goto}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (t.closest("[data-readmore]")) {
      const syn = $("#bkSynopsis"), btn = t.closest("[data-readmore]");
      const open = syn.classList.toggle("clamped") === false;
      btn.textContent = open ? "Show less ⌃" : "Read more ⌄";
      btn.setAttribute("aria-expanded", String(open));
    }
    if (t.closest("[data-add-series]")) {
      const books = (await allBooks()).filter((b) => b.series === current.series && !state.owned.has(b.id));
      for (const b of books) await addToCart(b.id, { name: b.name, price: b.price });
      if (books.length) toast(`Added ${books.length} book${books.length > 1 ? "s" : ""} from the series`);
    }
  });
  pv.addEventListener("change", (e) => {
    if (e.target.matches("[data-rev-filter]")) reviewFilter = e.target.value;
    else if (e.target.matches("[data-rev-sort]")) reviewSort = e.target.value;
    else return;
    if (state.reviewCache?.id === current?.id) renderBookReviews(state.reviewCache.data);
  });

  // =========================================================
  // Downloadable packs: coloured tiles + download page
  // =========================================================
  // Each tile: [light, dark] gradient colours
  const TILE_COLORS = [["#2f6fe0", "#123f9e"], ["#1d74e0", "#0b4aa8"], ["#2fae6b", "#137a4f"], ["#8a46e0", "#4b1f9e"], ["#e0662f", "#9e3512"], ["#2f9eae", "#12657a"]];
  const tileIndex = (p) => Math.max(0, state.packOrder?.indexOf(p.id) ?? 0) % TILE_COLORS.length;
  const tileColor = (p) => TILE_COLORS[tileIndex(p)][1];
  const tileStyle = (p) => `--tile:${TILE_COLORS[tileIndex(p)][1]};--tile-a:${TILE_COLORS[tileIndex(p)][0]}`;
  const fmtBytes = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  // Small inline icons used on the pack pages
  const PK_ICONS = {
    cloud: '<path d="M7 18a5 5 0 0 1-.6-9.96A6.5 6.5 0 0 1 19 9.5a4.25 4.25 0 0 1-.25 8.5z" fill="currentColor" stroke="none"/><path d="M12 9.5v6.5m-3-3 3 3 3-3" stroke="var(--pk-cloud-arrow, #1d5fc4)" stroke-width="2.2"/>',
    check: '<circle cx="12" cy="12" r="10" fill="#2fae6b" stroke="none"/><path d="m7.5 12.5 3 3 6-6.5" stroke="#fff" stroke-width="2.4"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    down: '<path d="M12 4v12m-5-5 5 5 5-5M5 20h14"/>',
    tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    chart: '<path d="M4 20V14h3v6zM10.5 20v-9h3v9zM17 20V8h3v12z" fill="currentColor" stroke="none"/><path d="m4 10 5-4 4 3 7-6m-4 0h4v4"/>',
    users: '<circle cx="12" cy="8" r="3.5" fill="currentColor" stroke="none"/><circle cx="5.5" cy="10" r="2.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="10" r="2.6" fill="currentColor" stroke="none"/><path d="M5 21a7 7 0 0 1 14 0zM0.5 20a5 5 0 0 1 6-4.8M23.5 20a5 5 0 0 0-6-4.8" fill="currentColor" stroke="none"/>',
    megaphone: '<path d="M3 10v4h3l8 5V5L6 10z" fill="currentColor" stroke="none"/><path d="M18 8.5a5 5 0 0 1 0 7M20.5 6a8.5 8.5 0 0 1 0 12"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z" fill="currentColor" stroke="none" opacity=".55"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  };
  const pkIcon = (name, cls = "") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PK_ICONS[name]}</svg>`;
  const packDeco = (p) => {
    const n = `${p.name} ${p.sub || ""}`.toLowerCase();
    return /financ|account|money|tax/.test(n) ? "chart" : /hir|team|staff|people/.test(n) ? "users" : /market|social|brand|ads?\b/.test(n) ? "megaphone" : "box";
  };

  function packTileHtml(p) {
    return `
    <article class="card ptile" data-product="${p.id}" style="${tileStyle(p)}" tabindex="0">
      ${pkIcon(packDeco(p), "ptile-deco")}
      <div class="ptile-art">${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="" loading="lazy" />` : icon("box")}</div>
      <div class="ptile-foot">
        <h3>${escapeHtml(p.name)}</h3>
        <span class="ptile-link">View Pack ${pkIcon("arrow")}</span>
      </div>
      <span class="ptile-tag">${p.price ? rupee(p.price) : "Free"} · ZIP</span>
    </article>`;
  }

  // Business Packs page: download tiles on top, physical packs below
  function renderPacksPage(list) {
    const packs = list.filter(isPack), others = list.filter((p) => !isPack(p));
    state.packOrder = packs.map((p) => p.id);
    return (packs.length ? `<section class="pk-section"><div class="tile-grid">${packs.map(packTileHtml).join("")}</div></section>` : "")
      + (others.length ? `<section class="pk-section"><h2 class="sec-title">Printed &amp; physical packs</h2><div class="product-grid">${others.map(cardHtml).join("")}</div></section>` : "");
  }

  // Free pack: claim it; paid pack: send to checkout. Returns true when the customer can download.
  async function ensurePackAccess(p) {
    if (state.owned.has(p.id)) return true;
    if (!state.user) { openAuth("login"); return false; }
    if (!p.price) {
      try { await api.post(`/api/downloads/${p.id}/claim`); await loadOwned(); return true; }
      catch (err) { toast(err.message); return false; }
    }
    const ok = await addToCart(p.id, { name: p.name, price: p.price });
    if (ok) openCheckout();
    return false;
  }
  const downloadOne = (id, filePath) => saveDownload(`/api/downloads/${id}/file?path=${encodeURIComponent(filePath)}`);

  // Pack page texts from Admin → Settings → Business pack page (empty = not shown)
  let PK_TEXT = {};
  const paraHtml = (t) => String(t || "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${escapeHtml(x).replace(/\n/g, "<br>")}</p>`).join("");
  function renderPackPage() {
    const s = state.settings || {};
    PK_TEXT = { intro: s.packIntro, complete: s.packCompleteText, single: s.packSingleText, singleHelp: s.packSingleHelp, howToOpen: s.packHowToOpen };
    const p = current, owned = state.owned.has(p.id);
    const cat = catById(p.category);
    const inside = lines(p.learnPoints);
    const paras = String(p.description || "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
    const specs = pairs(p.specs).filter(([k]) => k);
    const mainLabel = owned || !p.price ? "Download Now" : `Buy now · ${rupee(p.price)}`;
    pv.innerHTML = `
      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="/" data-category="all">Home</a><span>/</span>
        ${cat ? `<a href="/" data-category="${escapeHtml(cat.id)}">${escapeHtml(cat.label)}</a><span>/</span>` : ""}
        <span aria-current="page">${escapeHtml(p.name)}</span>
      </nav>

      <section class="pk2-hero">
        <div class="pk2-cover">${p.imageUrl ? `<img src="${escapeHtml(p.imageUrl)}" alt="${escapeHtml(p.name)}" />` : pkIcon("box")}</div>
        <div class="pk2-info">
          <span class="pk2-eyebrow">${pkIcon("down")}${cat ? `${escapeHtml(cat.label)} · ` : ""}Digital download</span>
          <h1>${escapeHtml(p.name)}</h1>
          <div class="pk2-chips">
            <span class="pk2-chip ${p.price ? "price" : "free"}">${p.price ? rupee(p.price) : "Free"}</span>
            <span class="pk2-chip">ZIP file</span>
            ${p.fileSize ? `<span class="pk2-chip">${fmtBytes(p.fileSize)}</span>` : ""}
            ${inside.length ? `<span class="pk2-chip">${inside.length} files</span>` : ""}
          </div>
          ${paras.length ? `<ul class="pk2-points">${paras.map((x) => `<li>${pkIcon("tick")}<span>${escapeHtml(x)}</span></li>`).join("")}</ul>` : ""}
          ${PK_TEXT.intro ? `<p class="pk2-intro">${escapeHtml(PK_TEXT.intro)}</p>` : ""}
          <p class="pk2-status ${owned ? "ok" : !p.price ? "free" : "wait"}">${pkIcon(owned ? "check" : "doc")}<span>${owned ? "This pack is already in your account." : !p.price ? "It's free: just sign in to download." : "Downloads unlock after your order is confirmed."}</span></p>
        </div>
      </section>

      <section class="pk-card pk-card-main">
        <div class="pk-card-txt">
          <h2 class="pk-h">${escapeHtml(p.name)}: complete pack</h2>
          ${PK_TEXT.complete ? `<p>${escapeHtml(PK_TEXT.complete)}</p>` : ""}
          ${p.highlight ? `<p class="pk-note">${pkIcon("doc")}<span>Includes: ${escapeHtml(p.highlight)}</span></p>` : ""}
          <button type="button" class="pk-btn pk-btn-lg" data-pk-all>${pkIcon("down")}<span>${owned || !p.price ? "Download Complete Pack" : mainLabel}</span>${pkIcon("right", "pk-btn-go")}</button>
        </div>
      </section>

      <section class="pk-card">
        <h2 class="pk-h">Download a single file</h2>
        ${PK_TEXT.single ? `<p>${escapeHtml(PK_TEXT.single)}</p>` : ""}
        <label class="pk-select-wrap">${pkIcon("doc")}
          <select class="pk-select" id="pkSelect" aria-label="Select download"><option value="">Select download</option></select>
        </label>
        <button type="button" class="pk-btn" data-pk-one>${pkIcon("tick")}<span>Confirm</span></button>
        <p class="pdp-error" id="pkError" hidden></p>
        ${PK_TEXT.singleHelp ? `<details class="pk-before">
          <summary>Before you begin downloading a single file</summary>
          <div>${paraHtml(PK_TEXT.singleHelp)}</div>
        </details>` : ""}
        <details class="pk-before">
          <summary>More download options</summary>
          <div>
            ${PK_TEXT.howToOpen ? paraHtml(PK_TEXT.howToOpen) : ""}
            ${inside.length ? `<p>Inside you will find:</p><ul>${inside.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
            ${specs.length ? `<table class="spec-table">${specs.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</table>` : ""}
            <p class="pk-terms">*Your use of these templates is governed by our <button type="button" class="link-btn" data-terms>Terms and conditions</button>.</p>
          </div>
        </details>
      </section>

      <section class="pk-section" id="pkMore" hidden>
        <h2 class="sec-title pk-h">More download packs</h2>
        <div class="tile-grid" id="pkMoreGrid"></div>
      </section>`;

    // Fill the file list and the "more packs" tiles
    api.get(`/api/products/${p.id}/files`).then((files) => {
      if (current?.id !== p.id) return;
      $("#pkSelect").innerHTML = `<option value="">Select download</option>` +
        files.map((f) => `<option value="${escapeHtml(f.path)}">${escapeHtml(f.name.replace(/^\d+\s/, ""))} (${fmtBytes(f.size)})</option>`).join("");
    }).catch(() => {});
    api.get(`/api/products?category=${encodeURIComponent(p.category)}`).then((list) => {
      if (current?.id !== p.id) return;
      const packs = list.filter(isPack);
      state.packOrder = packs.map((x) => x.id);
      packs.forEach((x) => state.products.set(x.id, { ...state.products.get(x.id), ...x }));
      const others = packs.filter((x) => x.id !== p.id);
      $("#pkMoreGrid").innerHTML = others.map(packTileHtml).join("");
      $("#pkMore").hidden = !others.length;
    }).catch(() => {});
  }

  pv.addEventListener("click", async (e) => {
    if (!current || !isPack(current)) return;
    const t = e.target;
    if (t.closest(".card[data-product]")) return;
    if (t.closest("[data-terms]")) return document.querySelector('.site-footer [data-policy="policyTerms"]')?.click();
    if (t.closest("[data-pk-all]")) {
      if (await ensurePackAccess(current)) { if (await startDownload(current.id)) toast("Your download has started"); renderProduct(); }
      return;
    }
    if (t.closest("[data-pk-one]")) {
      const sel = $("#pkSelect"), err = $("#pkError");
      if (!sel.value) { err.textContent = "Please choose a file from the list first."; err.hidden = false; return; }
      err.hidden = true;
      const chosen = sel.value;
      if (await ensurePackAccess(current) && await downloadOne(current.id, chosen)) toast("Your download has started");
    }
  });

  // ---------- Reviews ----------
  async function loadReviews(id) {
    try {
      const data = await api.get(`/api/products/${id}/reviews`);
      state.reviewCache = { id, data };
      if (current?.id === id) (isBook(current) ? renderBookReviews(data) : renderReviews(data));
    } catch {
      const box = $("#pdpReviewList");
      if (box) box.innerHTML = `<p class="muted">Could not load reviews.</p>`;
    }
  }

  function renderReviews({ summary, reviews }) {
    const box = $("#pdpReviewList");
    if (!box) return;
    const shown = choice.allReviews ? reviews : reviews.slice(0, 3);
    const bars = [5, 4, 3, 2, 1].map((n) => {
      const c = summary.dist[n] || 0, pct = summary.count ? (c / summary.count) * 100 : 0;
      return `<div class="bar-row"><span>${n}★</span><span class="bar"><span style="width:${pct}%"></span></span><span>${c}</span></div>`;
    }).join("");
    const items = shown.map((r) => `
      <article class="review">
        <div class="review-head">
          <strong>${escapeHtml(r.name)}</strong>
          <span class="stars" style="--fill:${r.rating * 20}%" aria-label="${r.rating} out of 5 stars"></span>
          <span class="muted">${new Date(r.createdAt.replace(" ", "T") + "Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
        </div>
        ${r.comment ? `<p>${escapeHtml(r.comment)}</p>` : ""}
      </article>`).join("");
    box.innerHTML = `
      <div class="review-summary">
        <div class="avg">
          <strong>${summary.count ? summary.avg.toFixed(1) : "–"}</strong>
          <span class="stars" style="--fill:${summary.avg * 20}%" aria-hidden="true"></span>
        </div>
        <p class="muted">${summary.count} review${summary.count === 1 ? "" : "s"}</p>
        <div class="bars">${bars}</div>
        <button type="button" class="pill-dark" data-write-review>Write a product review</button>
      </div>
      <div class="review-list">
        <h3>What our customers say</h3>
        ${items || `<p class="muted">No reviews yet. Be the first to review this product after your order is delivered.</p>`}
        ${reviews.length > 3 ? `<button type="button" class="link-btn" data-more-reviews>${choice.allReviews ? "Show less" : `View all ${reviews.length} reviews`}</button>` : ""}
      </div>`;
  }

  async function writeReview() {
    if (!state.user) return openAuth("login");
    const orders = await api.get("/api/orders").catch(() => []);
    const item = orders.filter((o) => o.status === "delivered").flatMap((o) => o.items).find((i) => i.productId === current.id);
    if (!item) {
      return showPopup({ title: "Review after delivery", message: "You can review this product once an order for it has been delivered to you.", cancelText: null });
    }
    const saved = await openRating(current.id, current.name, item.myRating || 0);
    if (saved) {
      toast("Thanks for your review!");
      const fresh = await api.get(`/api/products/${current.id}`).catch(() => null);
      if (fresh) Object.assign(current, { rating: fresh.rating, reviewCount: fresh.reviewCount });
      renderProduct();
      loadReviews(current.id);
    }
  }

  // ---------- Similar products ----------
  async function loadRelated(p) {
    const items = (await api.get(`/api/products?category=${encodeURIComponent(p.category)}`).catch(() => []))
      .filter((x) => x.id !== p.id).slice(0, 5);
    items.forEach((x) => state.products.set(x.id, x));
    state.relatedCache = { id: p.id, items };
    if (current?.id === p.id) renderRelated(items);
  }
  function renderRelated(items) {
    const box = $("#pdpRelated");
    if (!box) return;
    box.innerHTML = items.map(cardHtml).join("");
    $("#pdpRelatedWrap").hidden = !items.length;
  }

  // Previous / next product (in the order of the list the shopper came from)
  async function stepProduct(dir) {
    let ids = state.lastList.map((x) => x.id);
    if (!ids.includes(current.id)) {
      const all = await api.get("/api/products?category=all").catch(() => []);
      all.forEach((x) => state.products.set(x.id, x));
      ids = all.map((x) => x.id);
    }
    if (ids.length < 2) return;
    const i = ids.indexOf(current.id);
    openProduct(ids[(i + dir + ids.length) % ids.length]);
  }

  function readQty() {
    const el = $("#pdpQty");
    if (!el) return choice.qty;
    const max = Math.max(1, Math.min(99, current.stock));
    const n = Math.max(1, Math.min(max, parseInt(el.value, 10) || 1));
    el.value = n;
    choice.qty = n;
    return n;
  }

  pv.addEventListener("click", async (e) => {
    if (!current) return;
    const t = e.target;
    if (t.closest(".card[data-product]")) return onCardClick(e);
    if (t.closest("[data-open-downloads]")) return openDownloads();
    const now = t.closest("[data-download-now]");
    if (now) return startDownload(+now.dataset.downloadNow);
    const claimBtn = t.closest("[data-claim]");
    if (claimBtn && !isBook(current)) return claimFree(+claimBtn.dataset.claim);
    if (t.closest("[data-look-inside]")) return openLookInside(current);
    if (t.closest("[data-download]")) return downloadBook(current.id);
    const size = t.closest("[data-size]"), color = t.closest("[data-color]"), thumb = t.closest("[data-img]");
    const step = t.closest("[data-step]"), nav = t.closest("[data-nav]"), buy = t.closest("[data-buy]"), tab = t.closest("[data-tab]");
    if (size || color || thumb || tab) {
      readQty();
      if (size) choice.size = size.dataset.size;
      if (color) {
        choice.color = color.dataset.color;
        if (current.colorImageMap[choice.color]) choice.image = -1; // show that colour's photo
      }
      if (thumb) choice.image = +thumb.dataset.img;
      if (tab) choice.tab = tab.dataset.tab;
      renderProduct();
      if (tab?.classList.contains("link-btn")) pv.querySelector(".pdp-tabs")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (step) { $("#pdpQty").value = (parseInt($("#pdpQty").value, 10) || 1) + +step.dataset.step; readQty(); }
    if (nav) stepProduct(+nav.dataset.nav);
    if (t.closest("[data-write-review]")) writeReview();
    if (t.closest("[data-more-reviews]")) { choice.allReviews = !choice.allReviews; renderReviews(state.reviewCache.data); }
    if (buy) {
      const err = $("#pdpError");
      const needSize = list(current.sizes).length && !choice.size;
      const needColor = list(current.colors).length && !choice.color;
      if (needSize || needColor) {
        err.textContent = `Please choose a ${needColor ? "colour" : "size"} first.`;
        err.hidden = false;
        pv.querySelector(".pdp-options").classList.add("shake");
        setTimeout(() => pv.querySelector(".pdp-options")?.classList.remove("shake"), 500);
        return;
      }
      err.hidden = true;
      const ok = await addToCart(current.id, { name: current.name, price: current.price },
        { qty: readQty(), size: choice.size, color: choice.color });
      if (ok && buy.dataset.buy === "now") openCheckout();
    }
  });
  pv.addEventListener("change", (e) => { if (e.target.id === "pdpQty") readQty(); });

  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(location.search);
    const id = +params.get("product");
    const view = params.get("view");
    const path = location.pathname;
    if (path === "/orders" || view === "orders") showOrdersPage(false);
    else if (path === "/downloads" || view === "downloads") showDownloadsPage(false);
    else if (path === "/checkout" || view === "checkout") showCheckoutPage(false);
    else if (id) openProduct(id, false);
    else if (state.view !== "list") showListView(false);
  });

  // =========================================================
  // Search with live suggestions
  // =========================================================
  const input = $("#searchInput"), results = $("#searchResults");
  let matches = [], activeIndex = -1, searchTimer, searchReq = 0;

  function highlight(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    const re = new RegExp(`(${escapeHtml(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig");
    return safe.replace(re, "<mark>$1</mark>");
  }

  async function updateSuggestions() {
    const q = input.value.trim();
    activeIndex = -1;
    if (!q) { results.hidden = true; matches = []; return; }
    const reqId = ++searchReq;
    try {
      const params = new URLSearchParams({ q, category: "all", limit: 8 });
      const found = await api.get(`/api/products?${params}`);
      if (reqId !== searchReq) return;
      matches = found;
    } catch { return; }

    results.innerHTML = matches.length
      ? matches.map((p, i) => `
          <li role="option" data-index="${i}">
            <span>${highlight(p.name, q)}<small>${escapeHtml(p.categoryLabel)}</small></span>
            <span class="price">${p.price ? rupee(p.price) : "Free"}</span>
          </li>`).join("")
      : `<li class="empty">No results for “${escapeHtml(q)}”</li>`;
    results.hidden = false;
  }
  const debouncedSuggest = () => { clearTimeout(searchTimer); searchTimer = setTimeout(updateSuggestions, 150); };

  async function pickSuggestion(p) {
    results.hidden = true;
    input.value = "";
    return openProduct(p.id);
    await setFilter({ category: p.category });
    const card = document.querySelector(`[data-product="${p.id}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 1500);
  }

  input.addEventListener("input", debouncedSuggest);
  input.addEventListener("focus", debouncedSuggest);
  input.addEventListener("keydown", (e) => {
    const items = results.querySelectorAll("li[data-index]");
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && items.length) {
      e.preventDefault();
      activeIndex = (activeIndex + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.classList.toggle("active", i === activeIndex));
      items[activeIndex].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Escape") {
      results.hidden = true;
    }
  });
  results.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-index]");
    if (li) { e.preventDefault(); pickSuggestion(matches[+li.dataset.index]); }
  });
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (activeIndex >= 0 && matches[activeIndex]) return pickSuggestion(matches[activeIndex]);
    results.hidden = true;
    setFilter({ category: "all", q: input.value.trim() });
  });

  // =========================================================
  // Account
  // =========================================================
  const accountBtn = $("#accountBtn"), accountMenu = $("#accountMenu");

  function renderAccount() {
    const u = state.user;
    loadOwned();
    const items = u
      ? [
          { label: "My orders", action: "orders" },
          { label: "My downloads", action: "downloads" },
          { label: "My favourites", action: "favs" },
          { label: "Sign out", action: "logout" },
        ]
      : [
          { label: "Sign in", action: "login" },
          { label: "Create account", action: "register" },
          { label: "My favourites", action: "favs" },
        ];
    accountMenu.innerHTML = items.map((i) => i.href
      ? `<li><a href="${i.href}">${i.label}</a></li>`
      : `<li><button data-action="${i.action}">${i.label}</button></li>`).join("");
  }

  accountBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    accountMenu.hidden = !accountMenu.hidden;
    accountBtn.setAttribute("aria-expanded", !accountMenu.hidden);
  });

  accountMenu.addEventListener("click", async (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    accountMenu.hidden = true;
    if (action === "login" || action === "register") openAuth(action);
    if (action === "orders") showOrdersPage(true);
    if (action === "downloads") showDownloadsPage(true);
    if (action === "favs") { $("#searchInput").value = ""; setFilter({ category: "all", favs: true }); window.scrollTo({ top: 0, behavior: "smooth" }); }
    if (action === "logout") {
      await api.post("/api/auth/logout");
      state.user = null;
      state.cart = guestCart.read();
      renderAccount(); renderCart();
      if (state.view === "orders" || state.view === "downloads") showListView(true);
      toast("Signed out");
    }
  });

  // Sign in / create account happen on their own page (/login).
  // `after` says what to continue with once the customer is back:
  // "orders" | "downloads" | "checkout" | { add: { productId, info, opts } }
  const AFTER_KEY = "sonnad_after_login";
  function openAuth(mode, after = null) {
    try {
      if (after && typeof after !== "function") sessionStorage.setItem(AFTER_KEY, JSON.stringify(after));
      else sessionStorage.removeItem(AFTER_KEY);
    } catch {}
    const back = after === "orders" ? "/orders" : (after === "downloads" ? "/downloads" : (after === "checkout" ? "/checkout" : location.pathname + location.search));
    location.href = `/login?${new URLSearchParams({ mode, next: back }).toString()}`;
  }
  // Called once the page has loaded: finish whatever the customer was doing before signing in
  async function resumeAfterLogin() {
    let after = null, welcome = false;
    try {
      after = JSON.parse(sessionStorage.getItem(AFTER_KEY) || "null");
      welcome = !!sessionStorage.getItem("sonnad_welcome");
      sessionStorage.removeItem(AFTER_KEY);
      sessionStorage.removeItem("sonnad_welcome");
    } catch {}
    if (!state.user) return;
    if (welcome) toast(`Welcome, ${state.user.name.split(" ")[0]}!`);
    if (after === "orders") showOrdersPage(false);
    else if (after === "downloads") showDownloadsPage(false);
    else if (after === "checkout") showCheckoutPage(false);
    else if (after?.add) {
      const { productId, info, opts } = after.add;
      if (await addToCart(productId, info, opts) && state.cart.items.length) openCheckout();
    }
  }

  // =========================================================
  // Cart (server cart when signed in, browser cart for guests)
  // =========================================================
  const guestCart = {
    read() {
      let items = [];
      try { items = JSON.parse(localStorage.getItem("sonnad_cart")) || []; } catch {}
      const total = items.reduce((s, i) => s + i.price * i.qty, 0);
      const count = items.reduce((s, i) => s + i.qty, 0);
      return { items, total, count };
    },
    write(items) {
      try { localStorage.setItem("sonnad_cart", JSON.stringify(items)); } catch {}
      return guestCart.read();
    },
    clear() { try { localStorage.removeItem("sonnad_cart"); } catch {} },
  };

  async function addToCart(productId, info, opts = {}) {
    // Guests sign in first; then the item is added and checkout opens.
    if (!state.user) return openAuth("login", { add: { productId, info, opts } });
    try {
      if (state.user) {
        state.cart = await api.post("/api/cart", { productId, qty: opts.qty || 1, size: opts.size, color: opts.color });
      } else {
        const items = guestCart.read().items;
        const found = items.find((i) => i.productId === productId);
        if (found) found.qty = Math.min(found.qty + 1, 99);
        else items.push({ productId, qty: 1, name: info.name, price: info.price });
        state.cart = guestCart.write(items);
      }
      renderCart(true);
      toast(`Added “${info.name}” to cart`);
      return true;
    } catch (err) { toast(err.message); return false; }
  }

  async function setQty(productId, qty, options = "") {
    try {
      if (state.user) {
        state.cart = await api.put(`/api/cart/${productId}`, { qty, options });
      } else {
        const items = guestCart.read().items
          .map((i) => (i.productId === productId && (i.options || "") === options ? { ...i, qty } : i))
          .filter((i) => i.qty > 0);
        state.cart = guestCart.write(items);
      }
      renderCart();
    } catch (err) { toast(err.message); }
  }

  function renderCart(bump = false) {
    const badge = $("#cartCount");
    badge.textContent = state.cart.count;
    badge.classList.toggle("is-zero", !state.cart.count); // hide the red bubble when the cart is empty
    if (bump) { badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump"); }

    $("#cartItems").innerHTML = state.cart.items.length
      ? state.cart.items.map((i) => `
          <li class="cart-item">
            <div>
              <strong>${escapeHtml(i.name)}</strong>
              ${i.options ? `<small class="cart-opts">${escapeHtml(i.options)}</small>` : ""}
              ${i.isDigital ? `<small class="cart-opts">Digital download</small>` : ""}
              <small>${rupee(i.price)} each${i.minQty > 1 ? ` · min. ${i.minQty} in total` : ""}</small>
            </div>
            <div class="qty">
              <button data-qty="${i.productId}" data-opts="${escapeHtml(i.options || "")}" data-to="${i.qty - 1}" aria-label="Decrease">−</button>
              <span>${i.qty}</span>
              <button data-qty="${i.productId}" data-opts="${escapeHtml(i.options || "")}" data-to="${i.qty + 1}" aria-label="Increase"${i.isDigital ? " disabled title=\"One copy per order\"" : ""}>+</button>
            </div>
            <span class="price">${rupee(i.price * i.qty)}</span>
          </li>`).join("")
      : `<li class="muted cart-empty">Your cart is empty.</li>`;
    $("#cartTotal").textContent = rupee(state.cart.total);
    $("#checkoutBtn").disabled = !state.cart.items.length;
  }

  $("#cartItems").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-qty]");
    if (btn) setQty(+btn.dataset.qty, Math.max(0, Math.min(99, +btn.dataset.to)), btn.dataset.opts || "");
  });

  const drawer = $("#cartDrawer"), backdrop = $("#drawerBackdrop");
  function openDrawer() { drawer.classList.add("open"); drawer.setAttribute("aria-hidden", "false"); backdrop.hidden = false; }
  function closeDrawer() { drawer.classList.remove("open"); drawer.setAttribute("aria-hidden", "true"); backdrop.hidden = true; }
  $("#cartBtn").addEventListener("click", openDrawer);
  $("#cartClose").addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);

  // =========================================================
  // Checkout / Delivery Details Page (replaces popup modal)
  // =========================================================
  const checkoutForm = $("#checkoutForm");

  async function showCheckoutPage(push = true) {
    if (!state.user) return openAuth("login", "checkout");
    if (!state.cart.items.length) {
      toast("Your cart is empty");
      return showListView(true);
    }
    closeDrawer();
    state.view = "checkout";
    pv.hidden = true;
    if (ov) ov.hidden = true;
    if (dv) dv.hidden = true;
    $("#hero").hidden = true;
    $("#pageHead").hidden = true;
    $("#genreChips").hidden = true;
    $("#productGrid").hidden = true;
    cv.hidden = false;
    document.title = `Delivery details · ${state.baseTitle || "Sonnad Studio"}`;
    if (push) history.pushState({ view: "checkout" }, "", "/checkout");
    window.scrollTo({ top: 0, behavior: "smooth" });
    renderCheckoutPage();
  }

  function renderCheckoutPage() {
    $("#checkoutError").hidden = true;
    Object.keys(checkoutRules).forEach((n) => {
      checkoutForm.elements[n]?.classList.remove("invalid");
      const err = checkoutForm.querySelector(`[data-for="${n}"]`);
      if (err) err.textContent = "";
    });
    if (!checkoutForm.elements.name.value && state.user?.name && NAME_RE.test(state.user.name)) {
      checkoutForm.elements.name.value = state.user.name;
    }
    const digitalOnly = state.cart.items.every((i) => i.isDigital);
    $("#addressFields").hidden = digitalOnly;
    // Texts and delivery charge come from Admin → Settings → Checkout
    const set = state.settings || {};
    $("#digitalCheckoutNote").textContent = set.digitalCheckoutNote || "";
    $("#digitalCheckoutNote").hidden = !digitalOnly || !set.digitalCheckoutNote;
    $("#paymentMethodTitle").textContent = set.paymentMethodTitle || "";
    $("#paymentMethodTitle").hidden = !set.paymentMethodTitle;
    $("#paymentNote").textContent = (digitalOnly ? set.digitalPaymentNote : set.paymentNote) || "";
    const fee = deliveryFee(state.cart.total, digitalOnly);
    $("#checkoutDelivery").innerHTML = digitalOnly ? "Not needed"
      : fee ? rupee(fee) : `<span class="free-badge">FREE</span>`;
    const hint = !digitalOnly && fee && set.freeDeliveryAbove ? ` · Free delivery on orders of ${rupee(set.freeDeliveryAbove)} or more` : "";
    $("#checkoutDelivery").title = hint.replace(/^ · /, "");
    const subtotalEl = $("#checkoutSubtotal");
    if (subtotalEl) subtotalEl.textContent = rupee(state.cart.total);
    $("#checkoutTotal").textContent = rupee(state.cart.total + fee);

    const itemsList = $("#checkoutItemsList");
    if (itemsList) {
      itemsList.innerHTML = state.cart.items.map((i) => `
        <li class="checkout-item-row">
          <div class="checkout-item-img">
            ${i.imageUrl ? `<img src="${escapeHtml(i.imageUrl)}" alt="${escapeHtml(i.name)}" />` : `<div class="checkout-item-placeholder">${svgIcon(ICONS.box)}</div>`}
          </div>
          <div class="checkout-item-info">
            <strong>${escapeHtml(i.name)}</strong>
            <small class="muted">Qty: ${i.qty}${i.options ? ` · ${escapeHtml(i.options)}` : ""}</small>
            ${i.isDigital ? `<small class="order-item-badge">Digital</small>` : ""}
          </div>
          <span class="checkout-item-price">${rupee(i.price * i.qty)}</span>
        </li>`).join("");
    }
  }

  const openCheckout = (push = true) => showCheckoutPage(push);
  $("#checkoutBtn").addEventListener("click", () => showCheckoutPage(true));

  cv.addEventListener("click", (e) => {
    if (e.target.closest("[data-cancel-checkout]")) {
      showListView(true);
    }
  });

  // ---- Checkout field rules (the server checks the same rules again)
  const NAME_RE = /^\p{L}[\p{L}\p{M} .'-]*$/u;
  const checkoutRules = {
    name: (v) => !v ? "Enter your full name."
      : v.length < 2 ? "Name is too short."
      : !NAME_RE.test(v) ? "Name can only contain letters, spaces, dots and hyphens." : "",
    phone: (v) => !v ? "Enter your mobile number."
      : !/^[6-9]\d{9}$/.test(v) ? "Enter a valid 10-digit mobile number (starting with 6, 7, 8 or 9)." : "",
    address: (v) => v.length < 5 ? "Enter your full address." : "",
    city: (v) => !v ? "Enter your city."
      : !NAME_RE.test(v) ? "City can only contain letters." : "",
    pincode: (v) => !/^[1-9]\d{5}$/.test(v) ? "Enter a valid 6-digit PIN code." : "",
  };
  function checkField(name) {
    const input = checkoutForm.elements[name];
    const msg = checkoutRules[name](input.value.trim().replace(/\s+/g, " "));
    input.classList.toggle("invalid", !!msg);
    input.setAttribute("aria-invalid", msg ? "true" : "false");
    checkoutForm.querySelector(`[data-for="${name}"]`).textContent = msg;
    return !msg;
  }
  // Mobile and PIN: digits only while typing; name and city: no digits
  checkoutForm.addEventListener("input", (e) => {
    const el = e.target;
    if (el.name === "phone") el.value = el.value.replace(/\D/g, "").replace(/^(91|0)(?=\d{10})/, "").slice(0, 10);
    if (el.name === "pincode") el.value = el.value.replace(/\D/g, "").slice(0, 6);
    if (el.name === "name" || el.name === "city") el.value = el.value.replace(/\d/g, "");
    if (el.classList.contains("invalid")) checkField(el.name);
  });
  checkoutForm.addEventListener("focusout", (e) => {
    if (checkoutRules[e.target.name] && e.target.value) checkField(e.target.name);
  });

  checkoutForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#checkoutError").hidden = true;
    const skip = $("#addressFields").hidden ? ["address", "city", "pincode"] : [];
    const bad = Object.keys(checkoutRules).filter((n) => !skip.includes(n) && !checkField(n));
    if (bad.length) { checkoutForm.elements[bad[0]].focus(); return; }
    try {
      const digitalLines = state.cart.items.filter((i) => i.isDigital);
      const order = await api.post("/api/orders", formData(checkoutForm));
      checkoutForm.reset();
      state.cart = await api.get("/api/cart");
      renderCart();
      loadProducts(); // stock changed
      toast(`Order #${order.id} placed · ${rupee(order.total)}`);
      await showOrdersPage(true);
    } catch (err) {
      $("#checkoutError").textContent = err.message;
      $("#checkoutError").hidden = false;
    }
  });

  // =========================================================
  // My Orders Page (replaces popup modal)
  // =========================================================
  async function showOrdersPage(push = true) {
    state.view = "orders";
    pv.hidden = true;
    if (dv) dv.hidden = true;
    if (cv) cv.hidden = true;
    $("#hero").hidden = true;
    $("#pageHead").hidden = true;
    $("#genreChips").hidden = true;
    $("#productGrid").hidden = true;
    ov.hidden = false;
    document.title = `My Orders · ${state.baseTitle || "Sonnad Studio"}`;
    if (push) history.pushState({ view: "orders" }, "", "/orders");
    window.scrollTo({ top: 0, behavior: "smooth" });
    await renderOrdersPage();
  }

  // ---------- My Orders: an e-commerce style order history ----------
  const ORDER_STEPS = ["placed", "confirmed", "shipped", "delivered"];
  const ORDER_STATUS = {
    placed: { label: "Order placed", text: "We have your order and will confirm it soon.", tone: "amber" },
    confirmed: { label: "Confirmed", text: "Your order is confirmed and being prepared.", tone: "blue" },
    shipped: { label: "Shipped", text: "Your order is on its way to you.", tone: "indigo" },
    delivered: { label: "Delivered", text: "Your order has been delivered.", tone: "green" },
    cancelled: { label: "Cancelled", text: "This order was cancelled.", tone: "red" },
  };
  const ORDER_FILTERS = [["all", "All orders"], ["active", "In progress"], ["delivered", "Delivered"], ["cancelled", "Cancelled"]];
  const orderUi = { filter: "all", q: "", open: new Set(), orders: [] };
  const isDigitalOrder = (o) => o.items.length && o.items.every((i) => i.isDigital);
  const orderDate = (o, opts = { day: "numeric", month: "short", year: "numeric" }) =>
    new Date(String(o.createdAt).replace(" ", "T") + "Z").toLocaleString("en-IN", opts);
  const OI = {
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    bag: '<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 10V6.5a3 3 0 0 1 6 0V10"/>',
    truck: '<path d="M2 6h11v10H2zM13 9h4.5l3.5 3.5V16h-8z"/><circle cx="6" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
    home: '<path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z"/>',
    clip: '<path d="M9 4h6v3H9z"/><path d="M8 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-2"/><path d="m9 14 2 2 4-4"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.1-2.4 3.8M12 17h.01"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    dl: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  };

  function accountHead(active, title, sub) {
    return `
      <div class="account-page-head">
        <div class="account-page-nav">
          <button type="button" class="page-back-btn" data-back-to-shop>
            <svg viewBox="0 0 24 24"><path d="M19 12H5m6-6-6 6 6 6"/></svg> Back to shop
          </button>
          <div class="account-tabs-nav">
            <button type="button" class="account-nav-tab${active === "orders" ? " active" : ""}" data-nav="orders">My Orders</button>
            <button type="button" class="account-nav-tab${active === "downloads" ? " active" : ""}" data-nav="downloads">My Downloads</button>
          </div>
        </div>
        <div class="account-title-wrap">
          <h1>${title}</h1>
          ${sub ? `<p class="account-subtitle">${sub}</p>` : ""}
        </div>
      </div>`;
  }

  // Placed → Confirmed → Shipped → Delivered (digital orders: Placed → Ready to download)
  function orderTracker(o) {
    if (o.status === "cancelled") {
      return `<div class="ot-cancelled">${svgIcon(OI.x)}<span>This order was cancelled${o.items.some((i) => !i.isDigital) ? " and nothing will be shipped" : ""}.</span></div>`;
    }
    const digital = isDigitalOrder(o);
    const steps = digital
      ? [["placed", "Ordered", OI.bag], ["confirmed", "Ready to download", OI.dl]]
      : [["placed", "Ordered", OI.bag], ["confirmed", "Confirmed", OI.clip], ["shipped", "Shipped", OI.truck], ["delivered", "Delivered", OI.home]];
    const reached = digital ? (o.status === "placed" ? 0 : 1) : ORDER_STEPS.indexOf(o.status);
    return `
      <ol class="order-track${digital ? " is-digital" : ""}" style="--done:${reached / (steps.length - 1)}">
        ${steps.map(([, label, ic], i) => `
          <li class="${i < reached ? "done" : i === reached ? "current" : ""}">
            <span class="ot-dot">${svgIcon(i <= reached ? OI.check : ic)}</span>
            <span class="ot-label">${label}</span>
          </li>`).join("")}
      </ol>`;
  }

  function orderItemRow(o, i) {
    const ready = ["confirmed", "shipped", "delivered"].includes(o.status);
    const link = i.canRate ? `data-open-product="${i.productId}"` : "";
    const actions = [];
    if (i.isDigital && i.canRate && ready) actions.push(`<button type="button" class="oi-btn oi-primary" data-open-downloads>${svgIcon(OI.dl)}Download</button>`);
    if (i.isDigital && !ready && o.status !== "cancelled") actions.push(`<span class="oi-note">Download unlocks once the order is confirmed</span>`);
    if (!i.isDigital && i.canRate) actions.push(`<button type="button" class="oi-btn oi-primary" data-buy-again="${i.productId}" data-name="${escapeHtml(i.name)}" data-price="${i.price}" data-has-options="${i.options ? 1 : ""}">${svgIcon(OI.repeat)}Buy it again</button>`);
    if (i.canRate) actions.push(`<button type="button" class="oi-btn" data-open-product="${i.productId}">${svgIcon(OI.eye)}View product</button>`);
    if (o.status === "delivered" && i.canRate) {
      actions.push(`<button type="button" class="oi-btn oi-rate" data-rate="${i.productId}" data-name="${escapeHtml(i.name)}" data-current="${i.myRating}">
        ${i.myRating ? `<span class="star">${"★".repeat(i.myRating)}</span><span class="star-off">${"★".repeat(5 - i.myRating)}</span> Edit review` : "★ Write a review"}</button>`);
    }
    return `
      <li class="oi-row">
        <div class="oi-media" ${link} ${link ? 'role="link" tabindex="0"' : ""}>
          ${i.imageUrl ? `<img src="${escapeHtml(i.imageUrl)}" alt="" loading="lazy" />` : svgIcon(ICONS.box)}
        </div>
        <div class="oi-main">
          <h4 class="oi-name">${i.canRate ? `<button type="button" class="oi-name-link" data-open-product="${i.productId}">${escapeHtml(i.name)}</button>` : escapeHtml(i.name)}</h4>
          <div class="oi-meta">
            ${i.options ? `<span>${escapeHtml(i.options)}</span>` : ""}
            <span>Qty: ${i.qty}</span>
            <span>${rupee(i.price)} each</span>
            ${i.isDigital ? `<span class="oi-tag">Digital download</span>` : ""}
          </div>
          ${actions.length ? `<div class="oi-actions">${actions.join("")}</div>` : ""}
        </div>
        <strong class="oi-price">${rupee(i.price * i.qty)}</strong>
      </li>`;
  }

  function orderCardHtml(o) {
    const st = ORDER_STATUS[o.status] || ORDER_STATUS.placed;
    const digital = isDigitalOrder(o);
    const open = orderUi.open.has(o.id);
    const count = o.items.reduce((n, i) => n + i.qty, 0);
    const subtotal = o.items.reduce((n, i) => n + i.price * i.qty, 0);
    const s = state.settings || {};
    const payNote = digital ? s.digitalPaymentNote : s.paymentNote;
    return `
      <article class="order-card tone-${st.tone}" data-order="${o.id}">
        <header class="oc-head">
          <div class="oc-cell"><small>Order placed</small><span>${orderDate(o)}</span></div>
          <div class="oc-cell"><small>Total</small><span>${rupee(o.total)}</span></div>
          <div class="oc-cell oc-ship"><small>${digital ? "Delivery" : "Ship to"}</small><span>${digital ? "Digital download" : `${escapeHtml(o.name || "")}${o.city && o.city !== "-" ? `, ${escapeHtml(o.city)}` : ""}`}</span></div>
          <div class="oc-cell oc-id"><small>Order # ${o.id}</small>
            <button type="button" class="oc-link" data-toggle-order="${o.id}" aria-expanded="${open}">${open ? "Hide details" : "View details"} ${svgIcon(OI.chev)}</button>
          </div>
        </header>

        <div class="oc-status">
          <div class="oc-status-text">
            <span class="oc-pill">${st.label}</span>
            <p>${digital && ["confirmed", "shipped", "delivered"].includes(o.status) ? "Your download is ready in My Downloads."
              : digital && o.status === "placed" ? "Your download unlocks once we confirm your payment."
              : st.text}${o.status === "placed" ? " You can still cancel it." : ""}</p>
          </div>
          ${orderTracker(o)}
        </div>
        ${o.courier || o.tracking || o.note ? `
        <div class="oc-track-info">
          ${o.courier || o.tracking ? `<p>${svgIcon(OI.truck)}<span>${o.courier ? `Shipped with <strong>${escapeHtml(o.courier)}</strong>` : "Tracking"}${o.tracking ? ` · Tracking number <strong class="oc-trk">${escapeHtml(o.tracking)}</strong> <button type="button" class="oc-copy" data-copy="${escapeHtml(o.tracking)}">Copy</button>` : ""}</span></p>` : ""}
          ${o.note ? `<p>${svgIcon(OI.help)}<span><strong>Message from us:</strong> ${escapeHtml(o.note)}</span></p>` : ""}
        </div>` : ""}

        <ul class="oi-list">${o.items.map((i) => orderItemRow(o, i)).join("")}</ul>

        <div class="oc-details" ${open ? "" : "hidden"}>
          <div class="oc-detail-box">
            <h5>${svgIcon(digital ? OI.dl : OI.pin)}${digital ? "Delivery" : "Shipping address"}</h5>
            ${digital
              ? `<p>Digital items are delivered to <strong>My Downloads</strong> once the order is confirmed.</p>`
              : `<p><strong>${escapeHtml(o.name || "")}</strong><br>${escapeHtml(o.address || "")}<br>${escapeHtml(o.city || "")}${o.pincode ? ` – ${escapeHtml(o.pincode)}` : ""}</p>`}
            ${o.phone ? `<p class="muted">Phone: ${escapeHtml(o.phone)}</p>` : ""}
          </div>
          <div class="oc-detail-box">
            <h5>${svgIcon(OI.card)}Payment</h5>
            <p>${escapeHtml(payNote || (o.total ? "Pay as agreed with the store" : "Free order, nothing to pay"))}</p>
          </div>
          <div class="oc-detail-box oc-summary">
            <h5>${svgIcon(OI.clip)}Order summary</h5>
            <div class="oc-sum-row"><span>Items (${count})</span><span>${rupee(subtotal)}</span></div>
            <div class="oc-sum-row"><span>Delivery</span>${digital ? `<span>Not needed</span>` : o.deliveryFee ? `<span>${rupee(o.deliveryFee)}</span>` : `<span class="free">Free</span>`}</div>
            <div class="oc-sum-row oc-sum-total"><span>Order total</span><span>${rupee(o.total)}</span></div>
          </div>
        </div>

        <footer class="oc-foot">
          <span class="oc-count">${count} item${count === 1 ? "" : "s"}</span>
          <div class="oc-foot-actions">
            ${helpLink(o) ? `<a class="oc-btn" href="${helpLink(o)}" target="_blank" rel="noopener">${svgIcon(OI.help)}Need help?</a>` : ""}
            ${o.status === "placed" ? `<button type="button" class="oc-btn oc-danger" data-cancel-order="${o.id}">${svgIcon(OI.x)}Cancel order</button>` : ""}
          </div>
        </footer>
      </article>`;
  }

  // WhatsApp (preferred) or email link with the order number filled in
  function helpLink(o) {
    const s = state.settings || {};
    const msg = `Hi, I need help with my order #${o.id}.`;
    const wa = /^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(s.whatsapp || "") ? s.whatsapp : "";
    if (wa) return `${wa}${wa.includes("?") ? "&" : "?"}text=${encodeURIComponent(msg)}`;
    if (s.footerEmail) return `mailto:${s.footerEmail}?subject=${encodeURIComponent(`Order #${o.id}`)}&body=${encodeURIComponent(msg)}`;
    return "";
  }

  function matchesOrderFilter(o) {
    const f = orderUi.filter;
    if (f === "active" && !["placed", "confirmed", "shipped"].includes(o.status)) return false;
    if (f === "delivered" && o.status !== "delivered") return false;
    if (f === "cancelled" && o.status !== "cancelled") return false;
    const q = orderUi.q.trim().toLowerCase().replace(/^#/, "");
    if (!q) return true;
    return String(o.id) === q || o.items.some((i) => i.name.toLowerCase().includes(q));
  }

  function drawOrders() {
    const all = orderUi.orders;
    const n = {
      all: all.length,
      active: all.filter((o) => ["placed", "confirmed", "shipped"].includes(o.status)).length,
      delivered: all.filter((o) => o.status === "delivered").length,
      cancelled: all.filter((o) => o.status === "cancelled").length,
    };
    const shown = all.filter(matchesOrderFilter);
    const box = ov.querySelector(".orders-body");
    if (!box) return;
    box.innerHTML = `
      <div class="orders-toolbar">
        <div class="orders-filters" role="tablist">
          ${ORDER_FILTERS.map(([k, label]) => `<button type="button" role="tab" class="of-chip${orderUi.filter === k ? " on" : ""}" data-order-filter="${k}" aria-selected="${orderUi.filter === k}">${label}<span>${n[k]}</span></button>`).join("")}
        </div>
        <label class="orders-search">${svgIcon(OI.search)}<input type="search" id="orderSearch" placeholder="Search by order number or product" value="${escapeHtml(orderUi.q)}" aria-label="Search orders" /></label>
      </div>
      <div class="orders-page-list">
        ${shown.map(orderCardHtml).join("") || `<div class="account-card account-empty-card"><div class="account-empty-icon">${svgIcon(OI.search)}</div><h3>No matching orders</h3><p class="muted">Try another filter or search.</p></div>`}
      </div>`;
  }

  async function renderOrdersPage() {
    if (!state.user) {
      ov.innerHTML = accountHead("orders", "My Orders", "Track orders, view receipts and review your items.") + `
        <div class="account-card account-empty-card">
          <div class="account-empty-icon">${svgIcon(ICONS.box)}</div>
          <h3>Sign in to view your orders</h3>
          <p class="muted">Track deliveries, get your downloads and review products by signing in.</p>
          <div class="account-empty-actions">
            <button type="button" class="btn-gold" data-action="login">Sign in</button>
            <button type="button" class="btn-ghost" data-action="register">Create account</button>
          </div>
        </div>`;
      return;
    }
    ov.innerHTML = accountHead("orders", "My Orders", "Track, manage and review everything you've ordered.") +
      `<div class="orders-body"><div class="account-loading"><p class="muted">Loading your orders…</p></div></div>`;
    try {
      orderUi.orders = await api.get("/api/orders");
      if (!orderUi.orders.length) {
        ov.querySelector(".orders-body").innerHTML = `
          <div class="account-card account-empty-card">
            <div class="account-empty-icon">${svgIcon(ICONS.box)}</div>
            <h3>No orders yet</h3>
            <p class="muted">When you place an order, you can track it here.</p>
            <div class="account-empty-actions"><button type="button" class="btn-gold" data-back-to-shop>Start shopping</button></div>
          </div>`;
        return;
      }
      drawOrders();
    } catch (err) {
      ov.querySelector(".orders-body").innerHTML = `<p class="form-error">${escapeHtml(err.message)}</p>`;
    }
  }

  ov.addEventListener("click", async (e) => {
    if (e.target.closest("[data-back-to-shop]")) return showListView(true);
    if (e.target.closest('[data-nav="downloads"]') || e.target.closest("[data-open-downloads]")) return showDownloadsPage(true);
    const act = e.target.closest("[data-action]")?.dataset.action;
    if (act) return openAuth(act, "orders");
    const f = e.target.closest("[data-order-filter]");
    if (f) { orderUi.filter = f.dataset.orderFilter; return drawOrders(); }
    const tg = e.target.closest("[data-toggle-order]");
    if (tg) {
      const id = +tg.dataset.toggleOrder;
      orderUi.open.has(id) ? orderUi.open.delete(id) : orderUi.open.add(id);
      const card = tg.closest(".order-card");
      card.outerHTML = orderCardHtml(orderUi.orders.find((o) => o.id === id));
      return;
    }
    const prod = e.target.closest("[data-open-product]");
    if (prod) return openProduct(+prod.dataset.openProduct);
    const again = e.target.closest("[data-buy-again]");
    if (again) {
      const id = +again.dataset.buyAgain;
      if (again.dataset.hasOptions) return openProduct(id); // pick size/colour again on the product page
      const ok = await addToCart(id, { name: again.dataset.name, price: +again.dataset.price });
      if (ok) openDrawer();
      return;
    }
    const cp = e.target.closest("[data-copy]");
    if (cp) {
      try { await navigator.clipboard.writeText(cp.dataset.copy); toast("Tracking number copied"); }
      catch { toast(cp.dataset.copy); }
      return;
    }
    const cancel = e.target.closest("[data-cancel-order]");
    if (cancel) {
      const id = +cancel.dataset.cancelOrder;
      const ok = await confirmPopup({ title: `Cancel order #${id}?`, message: "Your order will be cancelled and nothing will be charged or shipped.", confirmText: "Cancel order", cancelText: "Keep order", danger: true });
      if (!ok) return;
      try {
        await api.post(`/api/orders/${id}/cancel`);
        toast(`Order #${id} cancelled`);
        orderUi.orders = await api.get("/api/orders");
        drawOrders();
      } catch (err) { toast(err.message); }
      return;
    }
    const rateBtn = e.target.closest("[data-rate]");
    if (rateBtn) {
      const saved = await openRating(+rateBtn.dataset.rate, rateBtn.dataset.name, +rateBtn.dataset.current);
      if (saved) {
        toast("Thanks for your review!");
        orderUi.orders = await api.get("/api/orders").catch(() => orderUi.orders);
        drawOrders();
        loadProducts();
      }
    }
  });
  ov.addEventListener("keydown", (e) => {
    const m = e.target.closest?.(".oi-media[data-open-product]");
    if (m && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openProduct(+m.dataset.openProduct); }
  });
  ov.addEventListener("input", (e) => {
    if (e.target.id !== "orderSearch") return;
    orderUi.q = e.target.value;
    const pos = e.target.selectionStart;
    drawOrders();
    const inp = $("#orderSearch");
    inp.focus();
    inp.setSelectionRange(pos, pos);
  });

  const openOrders = (push = true) => showOrdersPage(push);

  function openRating(productId, name, current) {
    return new Promise((resolve) => {
      const dlg = document.createElement("dialog");
      dlg.className = "modal popup";
      dlg.innerHTML = `
        <form class="modal-body" novalidate>
          <h2>Rate this product</h2>
          <p class="popup-message">${escapeHtml(name)}</p>
          <div class="star-picker" role="radiogroup" aria-label="Rating">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" data-star="${n}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`).join("")}
          </div>
          <label>Comment (optional)<textarea name="comment" maxlength="500" placeholder="What did you like?"></textarea></label>
          <p class="form-error" hidden></p>
          <div class="modal-actions">
            <button type="button" class="btn-ghost" data-cancel>Cancel</button>
            <button type="submit" class="btn-gold">Submit</button>
          </div>
        </form>`;
      let rating = current || 0, saved = false;
      const stars = dlg.querySelectorAll("[data-star]");
      const paint = (n) => stars.forEach((s) => {
        s.classList.toggle("on", +s.dataset.star <= n);
        s.setAttribute("aria-checked", String(+s.dataset.star === rating));
      });
      paint(rating);
      dlg.addEventListener("click", (e) => {
        const s = e.target.closest("[data-star]");
        if (s) { rating = +s.dataset.star; paint(rating); }
        if (e.target.closest("[data-cancel]") || e.target === dlg) dlg.close();
      });
      dlg.querySelector(".star-picker").addEventListener("mouseover", (e) => {
        const s = e.target.closest("[data-star]"); if (s) paint(+s.dataset.star);
      });
      dlg.querySelector(".star-picker").addEventListener("mouseleave", () => paint(rating));
      dlg.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = dlg.querySelector(".form-error");
        if (!rating) { err.textContent = "Please choose 1 to 5 stars."; err.hidden = false; return; }
        try {
          await api.post("/api/reviews", { productId, rating, comment: dlg.querySelector("textarea").value });
          saved = true; dlg.close();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
      dlg.addEventListener("close", () => { dlg.remove(); resolve(saved); });
      document.body.appendChild(dlg);
      dlg.showModal();
    });
  }

  // Close buttons inside any dialog
  document.querySelectorAll("dialog [data-close]").forEach((b) =>
    b.addEventListener("click", () => b.closest("dialog").close()));

  // Close popups on outside click / Escape
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#account")) accountMenu.hidden = true;
    if (!e.target.closest("#searchForm")) results.hidden = true;
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  // =========================================================
  // Init
  // =========================================================
  (async function init() {
    try {
      const [categories, user, settings] = await Promise.all([
        api.get("/api/categories"), api.get("/api/auth/me"), api.get("/api/settings").catch(() => ({})),
      ]);
      state.categories = categories;
      applySettings(settings);
      state.user = user;
      state.cart = user ? await api.get("/api/cart") : guestCart.read();
    } catch {
      showPageHead("", "Could not reach the server. Start it with: npm start");
      return;
    }
    renderCategories();
    renderAccount();
    renderCart();
    state.baseTitle = document.title;
    const path = location.pathname;
    const startView = new URLSearchParams(location.search).get("view");
    const startCat = new URLSearchParams(location.search).get("category");
    await setFilter({ category: startCat && catById(startCat) ? startCat : "all" });
    const startId = +new URLSearchParams(location.search).get("product");
    if (path === "/orders" || startView === "orders") {
      await showOrdersPage(false);
    } else if (path === "/downloads" || startView === "downloads") {
      await showDownloadsPage(false);
    } else if (path === "/checkout" || startView === "checkout") {
      await showCheckoutPage(false);
    } else if (startId) {
      await openProduct(startId, false);
    }
    resumeAfterLogin();
  })();
})();
