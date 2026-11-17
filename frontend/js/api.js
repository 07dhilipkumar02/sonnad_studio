/* Shared helpers: API calls + formatting. Used by app.js and admin.js. */
// API address from frontend/.env (PUBLIC_API_URL, loaded by /env.js). Empty = this same server.
const API_BASE = String((window.ENV && window.ENV.PUBLIC_API_URL) || "").replace(/\/+$/, "");
const api = {
  async request(method, url, body) {
    if (API_BASE && url.startsWith("/")) url = API_BASE + url;
    const headers = body ? { "Content-Type": "application/json" } : {};
    // Admin pages use the admin sign-in; the shop uses the customer sign-in
    if (document.body?.classList.contains("adm") || window.API_PANEL === "admin") headers["X-Panel"] = "admin";
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
  get: (url) => api.request("GET", url),
  post: (url, body) => api.request("POST", url, body || {}),
  put: (url, body) => api.request("PUT", url, body),
  patch: (url, body) => api.request("PATCH", url, body),
  del: (url) => api.request("DELETE", url),
};

const rupee = (n) => "₹" + Number(n).toLocaleString("en-IN");
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let toastTimer;
function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return showPopup({ title: "Notice", message, cancelText: null });
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

/* Popup dialog used instead of the browser's alert()/confirm().
   Returns a Promise<boolean>: true = confirmed, false = cancelled/closed. */
function showPopup({ title = "Are you sure?", message = "", confirmText = "OK", cancelText = "Cancel", danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "modal popup";
    dlg.innerHTML = `
      <div class="modal-body">
        <h2>${escapeHtml(title)}</h2>
        ${message ? `<p class="popup-message">${escapeHtml(message)}</p>` : ""}
        <div class="modal-actions">
          ${cancelText ? `<button type="button" class="btn-ghost" data-answer="no">${escapeHtml(cancelText)}</button>` : ""}
          <button type="button" class="${danger ? "btn-danger" : "btn-gold"}" data-answer="yes">${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    let answer = false;
    dlg.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-answer]");
      if (btn) { answer = btn.dataset.answer === "yes"; dlg.close(); }
      else if (e.target === dlg) dlg.close(); // click on the dark backdrop
    });
    dlg.addEventListener("close", () => { dlg.remove(); resolve(answer); });
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.querySelector(cancelText ? "[data-answer=no]" : "[data-answer=yes]").focus();
  });
}
const confirmPopup = (options) => showPopup(options);
