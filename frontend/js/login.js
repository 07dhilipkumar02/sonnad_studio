/* Website sign in / create account page (/login) */
(() => {
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  // Only go back to pages on this site
  const rawNext = params.get("next") || "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  let mode = params.get("mode") === "register" ? "register" : "login";

  $("#authBack").href = next;

  function setMode(m) {
    mode = m;
    const login = m === "login";
    document.querySelectorAll(".auth-tabs [data-mode]").forEach((b) => {
      const on = b.dataset.mode === m;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
    $("#authTitle").textContent = login ? "Sign in to your account" : "Create your account";
    $("#authSub").textContent = login ? "Welcome back! Please enter your details." : "It only takes a minute. You'll be able to order and download right away.";
    $("#authSubmit").textContent = login ? "Sign in" : "Create account";
    $("#nameField").hidden = login;
    $("#authForm").elements.password.autocomplete = login ? "current-password" : "new-password";
    $("#authSwitch").innerHTML = login
      ? `New here? <button type="button" data-mode="register">Create an account</button>`
      : `Already have an account? <button type="button" data-mode="login">Sign in</button>`;
    $("#authError").hidden = true;
    history.replaceState(null, "", `?${new URLSearchParams({ mode: m, next }).toString()}`);
  }
  document.addEventListener("click", (e) => {
    const m = e.target.closest("[data-mode]")?.dataset.mode;
    if (m) { setMode(m); $("#authForm").elements[m === "register" ? "name" : "email"].focus(); }
    const eye = e.target.closest("[data-eye]");
    if (eye) {
      const input = eye.parentElement.querySelector("input");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
      eye.classList.toggle("on", show);
    }
  });

  // Move anything the visitor put in the cart as a guest into their account
  async function mergeGuestCart() {
    let items = [];
    try { items = JSON.parse(localStorage.getItem("sonnad_cart")) || []; } catch {}
    if (!items.length) return;
    try { await api.post("/api/cart/merge", { items }); localStorage.removeItem("sonnad_cart"); } catch {}
  }

  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#authSubmit"), err = $("#authError");
    err.hidden = true;
    btn.disabled = true;
    try {
      await api.post(`/api/auth/${mode}`, formData(e.target));
      await mergeGuestCart();
      try { sessionStorage.setItem("sonnad_welcome", "1"); } catch {}
      location.replace(next);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });

  // Store name, logo and description from Admin → Settings
  api.get("/api/settings").then((s) => {
    const name = s.storeName || "Sonnad Studio";
    document.title = `${mode === "login" ? "Sign in" : "Create account"} · ${name}`;
    document.querySelectorAll(".auth-store-name").forEach((el) => (el.textContent = name));
    $("#authBrandText").textContent = s.footerAbout || "";
    $("#authBrandText").hidden = !s.footerAbout;
    // first 3 "Why choose us" titles (each line is "Title | short text")
    const perks = String(s.whyChoose || "").split("\n").map((l) => l.split("|")[0].trim()).filter(Boolean).slice(0, 3);
    $("#authPerks").innerHTML = perks.map((p) => `<li><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>${escapeHtml(p)}</li>`).join("");
    $("#authPerks").hidden = !perks.length;
    if (s.logoImage) $("#authLogo").innerHTML = `<img class="logo-img" src="${escapeHtml(s.logoImage)}" alt="${escapeHtml(name)}" />`;
  }).catch(() => {});

  // Already signed in? Go straight back.
  api.get("/api/auth/me").then((u) => { if (u) location.replace(next); }).catch(() => {});

  setMode(mode);
})();
