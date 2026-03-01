// ============================================================
// WINN Platforms — analytics.js
// Visitor tracking: log page visits to Firestore, display stats
// for admins in the nav sidebar.
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { hasRole } from "./auth.js?v=3";

const VISITS = "visits";

// ---- Country code → flag emoji ----
function _flag(code) {
  if (!code || code.length !== 2) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E0 + c.charCodeAt(0) - 65));
}

// ---- Inject stats widget at bottom of nav sidebar ----
function _ensureWidget() {
  if (document.getElementById("nav-stats")) return;
  const sidebar = document.querySelector(".nav-sidebar");
  if (!sidebar) return;
  const el = document.createElement("div");
  el.id = "nav-stats";
  el.style.cssText = "padding:.75rem 1rem;border-top:1px solid var(--border);";
  el.innerHTML = `
    <div id="nav-stats-heading" style="font-size:.72rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none;">
      Visitors <span id="nav-stats-caret">▾</span>
    </div>
    <div id="nav-stats-body" style="font-size:.8rem;color:var(--text-secondary);display:flex;flex-direction:column;gap:.3rem;margin-top:.5rem;">
      <span style="color:var(--text-muted)">Loading…</span>
    </div>`;
  el.querySelector("#nav-stats-heading").addEventListener("click", () => {
    const body   = document.getElementById("nav-stats-body");
    const caret  = document.getElementById("nav-stats-caret");
    const hidden = body.style.display === "none";
    body.style.display  = hidden ? "flex" : "none";
    caret.textContent   = hidden ? "▾" : "▸";
  });
  sidebar.appendChild(el);
}

// ---- Log a visit (once per session per page) ----
export async function logVisit(page) {
  const key = `_winn_v_${page}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");

  const data = {
    page,
    timestamp: serverTimestamp(),
    referrer:  document.referrer || null,
    lang:      navigator.language || null,
    tz:        Intl.DateTimeFormat().resolvedOptions().timeZone || null,
  };

  // Geo lookup with 3-second timeout — fire and forget
  try {
    const geo = await Promise.race([
      fetch("https://ipapi.co/json/").then(r => r.json()),
      new Promise((_, rej) => setTimeout(rej, 3000)),
    ]);
    if (geo && !geo.error) {
      data.country     = geo.country_name || null;
      data.countryCode = geo.country_code || null;
      data.city        = geo.city        || null;
      data.region      = geo.region      || null;
    }
  } catch {}

  try { await addDoc(collection(db, VISITS), data); } catch {}
}

// ---- Show stats widget in sidebar (admin only) ----
export async function showStats(role) {
  if (!hasRole(role, "admin")) return;
  _ensureWidget();
  const body = document.getElementById("nav-stats-body");
  if (!body) return;

  try {
    const snap = await getDocs(
      query(collection(db, VISITS), orderBy("timestamp", "desc"), limit(1000))
    );
    const docs = snap.docs.map(d => d.data());

    const total    = docs.length;
    const todaySec = new Date().setHours(0, 0, 0, 0) / 1000;
    const today    = docs.filter(d => {
      const t = d.timestamp; if (!t) return false;
      return (t.seconds ?? t._seconds ?? 0) >= todaySec;
    }).length;

    const byCountry = {};
    docs.forEach(d => { const c = d.countryCode || "??"; byCountry[c] = (byCountry[c] || 0) + 1; });
    const topCountries = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const byPage = {};
    docs.forEach(d => { const p = d.page || "?"; byPage[p] = (byPage[p] || 0) + 1; });
    const topPages = Object.entries(byPage).sort((a, b) => b[1] - a[1]);

    const countriesHtml = topCountries.map(([code, n]) =>
      `<span>${_flag(code)} ${code} <span style="color:var(--text-muted)">${n}</span></span>`
    ).join("");

    const pagesHtml = topPages.map(([p, n]) =>
      `<span style="display:flex;justify-content:space-between;gap:.5rem"><span>${p}</span><span style="color:var(--text-muted)">${n}</span></span>`
    ).join("");

    body.innerHTML = `
      <span><span style="font-weight:600;color:var(--text-primary)">${total}</span> total &nbsp;·&nbsp; <span style="font-weight:600;color:var(--text-primary)">${today}</span> today</span>
      ${topCountries.length ? `<div style="display:flex;flex-wrap:wrap;gap:.2rem .5rem;margin-top:.15rem">${countriesHtml}</div>` : ""}
      ${topPages.length    ? `<div style="margin-top:.4rem;display:flex;flex-direction:column;gap:.2rem">${pagesHtml}</div>` : ""}`;
  } catch {
    body.innerHTML = `<span style="color:var(--danger)">Failed to load</span>`;
  }
}
