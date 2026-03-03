// ============================================================
// WINN Platforms — nav-visibility.js
// Admin can show/hide and drag-to-reorder individual nav links.
// State persists in Firestore site_config/nav_visibility.
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

const DEFAULT_ORDER = ["software", "design", "forum", "writing", "news", "teaching", "consultation"];
const DEFAULT_STATE = { software: true, design: true, forum: true, writing: true, news: true, teaching: true, consultation: true };
let _state = { ...DEFAULT_STATE };
let _order = [...DEFAULT_ORDER];

const SVG_EYE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

const SVG_EYE_OFF = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

const SVG_DRAG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="4" cy="3" r="1.5"/><circle cx="8" cy="3" r="1.5"/><circle cx="4" cy="8" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>`;

let _dragSrc = null;

export async function initNavVisibility(role) {
  try {
    const snap = await getDoc(NAV_DOC);
    if (snap.exists()) {
      const data = snap.data();
      _state = { ...DEFAULT_STATE, ...data };
      if (Array.isArray(data.order) && data.order.length) {
        const stored  = data.order.filter(k => DEFAULT_ORDER.includes(k));
        const missing = DEFAULT_ORDER.filter(k => !stored.includes(k));
        // Insert each missing key at its correct DEFAULT_ORDER position rather
        // than appending them all at the end (handles new keys added after save).
        _order = [...stored];
        for (const key of missing) {
          const di = DEFAULT_ORDER.indexOf(key);
          let at = _order.length;
          for (let i = di - 1; i >= 0; i--) {
            const pos = _order.indexOf(DEFAULT_ORDER[i]);
            if (pos !== -1) { at = pos + 1; break; }
          }
          _order.splice(at, 0, key);
        }
      }
    } else {
      _state = { ...DEFAULT_STATE };
    }
  } catch {
    _state = { ...DEFAULT_STATE };
  }

  const isAdmin = hasRole(role, "admin");
  const links   = document.querySelectorAll(".nav-sidebar .nav-links a");

  links.forEach(link => {
    const key = HREF_TO_KEY[link.getAttribute("href")];
    if (!key) return;

    if (isAdmin) {
      const row = document.createElement("div");
      row.className   = "nav-link-row";
      row.dataset.navKey = key;
      row.draggable   = true;
      link.parentNode.insertBefore(row, link);
      row.appendChild(link);

      // Drag handle (left)
      const handle = document.createElement("span");
      handle.className = "nav-drag-handle";
      handle.innerHTML = SVG_DRAG;
      handle.title     = "Drag to reorder";
      row.insertBefore(handle, link);

      // Eye button (right)
      const btn = document.createElement("button");
      btn.type      = "button";
      btn.className = "nav-eye-btn" + (_state[key] === false ? " is-hidden" : "");
      btn.dataset.key = key;
      btn.title     = _state[key] !== false ? "Hide from visitors" : "Show to visitors";
      btn.innerHTML = _state[key] !== false ? SVG_EYE : SVG_EYE_OFF;
      btn.addEventListener("click", () => _toggle(key, btn));
      row.appendChild(btn);

      _addDragEvents(row);
    } else {
      link.dataset.navKey = key;
      if (_state[key] === false) link.style.display = "none";
    }
  });

  _applyOrder(isAdmin);
  document.documentElement.setAttribute("data-nav-ready", "");
}

function _applyOrder(isAdmin) {
  const navLinks = document.querySelector(".nav-sidebar .nav-links");
  if (!navLinks) return;
  _order.forEach(key => {
    // Teaching uses a div.nav-dropdown; regular items use .nav-link-row (admin) or a (visitor)
    const sel = key === "teaching"
      ? `[data-nav-key="${key}"]`
      : isAdmin
        ? `.nav-link-row[data-nav-key="${key}"]`
        : `a[data-nav-key="${key}"]`;
    const el = navLinks.querySelector(sel);
    if (el) navLinks.appendChild(el);
  });
}

function _addDragEvents(row) {
  row.addEventListener("dragstart", e => {
    _dragSrc = row;
    row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", row.dataset.navKey);
  });

  row.addEventListener("dragend", () => {
    _dragSrc = null;
    row.classList.remove("dragging");
    document.querySelectorAll(".nav-link-row.drag-over")
      .forEach(r => r.classList.remove("drag-over"));
    _saveDragOrder();
  });

  row.addEventListener("dragover", e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (_dragSrc && row !== _dragSrc) {
      document.querySelectorAll(".nav-link-row.drag-over")
        .forEach(r => r.classList.remove("drag-over"));
      row.classList.add("drag-over");
    }
  });

  row.addEventListener("dragleave", () => {
    row.classList.remove("drag-over");
  });

  row.addEventListener("drop", e => {
    e.preventDefault();
    if (!_dragSrc || _dragSrc === row) return;
    const parent = row.parentNode;
    const rows   = [...parent.querySelectorAll(".nav-link-row")];
    const srcIdx = rows.indexOf(_dragSrc);
    const dstIdx = rows.indexOf(row);
    if (srcIdx < dstIdx) {
      parent.insertBefore(_dragSrc, row.nextSibling);
    } else {
      parent.insertBefore(_dragSrc, row);
    }
    row.classList.remove("drag-over");
  });
}

async function _saveDragOrder() {
  const navLinks = document.querySelector(".nav-sidebar .nav-links");
  if (!navLinks) return;
  // Collect ordered keys from .nav-link-row items (draggable links), then
  // re-insert any non-draggable keys (e.g. "teaching") at their current position.
  const rowKeys = [...navLinks.querySelectorAll(".nav-link-row[data-nav-key]")]
    .map(r => r.dataset.navKey);
  const allEls  = [...navLinks.querySelectorAll("[data-nav-key]")];
  _order = allEls.map(el => el.dataset.navKey);
  try {
    await setDoc(NAV_DOC, { ..._state, order: _order });
  } catch (e) {
    showToast("Order save failed: " + e.message, "error");
  }
}

async function _toggle(key, btn) {
  const wasVisible = _state[key] !== false;
  const nowVisible = !wasVisible;

  _state[key] = nowVisible;
  btn.innerHTML = nowVisible ? SVG_EYE : SVG_EYE_OFF;
  btn.title = nowVisible ? "Hide from visitors" : "Show to visitors";
  btn.classList.toggle("is-hidden", !nowVisible);

  try {
    await setDoc(NAV_DOC, { ..._state, order: _order });
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    showToast(label + (nowVisible ? " is now visible." : " is now hidden."), "info");
  } catch (e) {
    _state[key] = wasVisible;
    btn.innerHTML = wasVisible ? SVG_EYE : SVG_EYE_OFF;
    btn.title = wasVisible ? "Hide from visitors" : "Show to visitors";
    btn.classList.toggle("is-hidden", !wasVisible);
    showToast("Save failed: " + e.message, "error");
  }
}
