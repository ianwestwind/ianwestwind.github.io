// ============================================================
// WINN Platforms — nav-visibility.js
// Admin can show/hide individual nav links; state persists in
// Firestore site_config/nav_visibility.
// ============================================================

import { db } from "./firebase-config.js";
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { hasRole, showToast } from "./auth.js?v=3";

const NAV_DOC = doc(db, "site_config", "nav_visibility");

// href → state key (About is intentionally excluded)
const HREF_TO_KEY = {
  "portfolio-software.html": "software",
  "portfolio-design.html":   "design",
  "forum.html":              "forum",
  "writing.html":            "writing",
  "news.html":               "news",
  "consultation.html":       "consultation",
};

const DEFAULT_STATE = { software: true, design: true, forum: true, writing: true, news: true, consultation: true };
let _state = { ...DEFAULT_STATE };

const SVG_EYE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

const SVG_EYE_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export async function initNavVisibility(role) {
  // Load visibility state from Firestore (public read — no auth required)
  try {
    const snap = await getDoc(NAV_DOC);
    _state = snap.exists() ? { ...DEFAULT_STATE, ...snap.data() } : { ...DEFAULT_STATE };
  } catch {
    _state = { ...DEFAULT_STATE };
  }

  const isAdmin = hasRole(role, "admin");

  const links = document.querySelectorAll(".nav-sidebar .nav-links a");
  links.forEach(link => {
    const key = HREF_TO_KEY[link.getAttribute("href")];
    if (!key) return; // About link — skip

    if (isAdmin) {
      // Wrap link + eye button in a flex row
      const row = document.createElement("div");
      row.className = "nav-link-row";
      link.parentNode.insertBefore(row, link);
      row.appendChild(link);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-eye-btn" + (_state[key] === false ? " is-hidden" : "");
      btn.dataset.key = key;
      btn.title = _state[key] !== false ? "Hide from visitors" : "Show to visitors";
      btn.innerHTML = _state[key] !== false ? SVG_EYE : SVG_EYE_OFF;
      btn.addEventListener("click", () => _toggle(key, btn));
      row.appendChild(btn);
    } else {
      if (_state[key] === false) link.style.display = "none";
    }
  });

  // Lift flash-prevention CSS (visibility: hidden on toggleable links)
  document.documentElement.setAttribute("data-nav-ready", "");
}

async function _toggle(key, btn) {
  const wasVisible = _state[key] !== false;
  const nowVisible = !wasVisible;

  // Optimistic update
  _state[key] = nowVisible;
  btn.innerHTML = nowVisible ? SVG_EYE : SVG_EYE_OFF;
  btn.title = nowVisible ? "Hide from visitors" : "Show to visitors";
  btn.classList.toggle("is-hidden", !nowVisible);

  try {
    await setDoc(NAV_DOC, _state);
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    showToast(label + (nowVisible ? " is now visible." : " is now hidden."), "info");
  } catch (e) {
    // Rollback
    _state[key] = wasVisible;
    btn.innerHTML = wasVisible ? SVG_EYE : SVG_EYE_OFF;
    btn.title = wasVisible ? "Hide from visitors" : "Show to visitors";
    btn.classList.toggle("is-hidden", !wasVisible);
    showToast("Save failed: " + e.message, "error");
  }
}
