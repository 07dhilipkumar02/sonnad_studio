/* Admin panel sign in page (/admin/login) */
(() => {
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  // Return to the admin section that was open (e.g. #orders)
  const hash = params.get("next") || "";
  const target = "/admin" + (/^#[a-z]+$/.test(hash) ? hash : "");

  if (params.get("signedout")) {
    $("#authNote").textContent = "You have been signed out.";
    $("#authNote").hidden = false;
  }

  document.addEventListener("click", (e) => {
    const eye = e.target.closest("[data-eye]");
    if (!eye) return;
    const input = eye.parentElement.querySelector("input");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
    eye.classList.toggle("on", show);
  });

  $("#adminLoginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#adminLoginBtn"), err = $("#adminLoginError");
    err.hidden = true;
    btn.disabled = true;
    try {
      await api.post("/api/auth/admin/login", formData(e.target));
      location.replace(target);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });

  api.get("/api/settings").then((s) => {
    const name = s.storeName || "Sonnad Studio";
    document.title = `Admin sign in · ${name}`;
    if (s.logoImage) $("#authLogo").innerHTML = `<img class="logo-img" src="${escapeHtml(s.logoImage)}" alt="${escapeHtml(name)}" />`;
  }).catch(() => {});

  // Already signed in as admin? Go straight to the panel.
  api.get("/api/auth/me").then((u) => { if (u?.role === "admin") location.replace(target); }).catch(() => {});
})();
