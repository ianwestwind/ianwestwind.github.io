// Multimodal Intelligence Lab — layout-controls.js
// Theme, font, and font-size controls (right sidebar). Persists to localStorage.

import { initTeachingLock } from "./teaching-lock.js";
import { initLogo } from "./logo.js";

const THEME_KEY = "winn-theme";
const FONT_KEY = "winn-font";
const FONTSIZE_KEY = "winn-fontsize";

const FONTS = {
  inter: "Inter, system-ui, sans-serif",
  georgia: "Georgia, 'Times New Roman', serif",
  system: "system-ui, -apple-system, sans-serif"
};

const FONTSIZE_MAP = { s: "14px", m: "16px", l: "18px" };

export function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || "light";
}

export function getStoredFont() {
  return localStorage.getItem(FONT_KEY) || "inter";
}

export function getStoredFontSize() {
  return localStorage.getItem(FONTSIZE_KEY) || "m";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const lightBtn = document.getElementById("theme-light");
  const darkBtn = document.getElementById("theme-dark");
  if (lightBtn) lightBtn.classList.toggle("active", theme === "light");
  if (darkBtn) darkBtn.classList.toggle("active", theme === "dark");
}

function applyFont(fontId) {
  document.documentElement.setAttribute("data-font", fontId);
  document.body.style.fontFamily = FONTS[fontId] || FONTS.inter;
  document.querySelectorAll(".font-option").forEach(el => {
    el.classList.toggle("active", el.dataset.font === fontId);
  });
}

function applyFontSize(sizeId) {
  const base = FONTSIZE_MAP[sizeId] || FONTSIZE_MAP.m;
  document.documentElement.setAttribute("data-fontsize", sizeId);
  document.documentElement.style.fontSize = base;
  document.querySelectorAll(".font-size-option").forEach(el => {
    el.classList.toggle("active", el.dataset.size === sizeId);
  });
}

export function initLayoutControls() {
  const theme = getStoredTheme();
  const font = getStoredFont();
  const fontSize = getStoredFontSize();
  applyTheme(theme);
  applyFont(font);
  applyFontSize(fontSize);

  document.getElementById("theme-light")?.addEventListener("click", () => {
    localStorage.setItem(THEME_KEY, "light");
    applyTheme("light");
  });
  document.getElementById("theme-dark")?.addEventListener("click", () => {
    localStorage.setItem(THEME_KEY, "dark");
    applyTheme("dark");
  });

  document.querySelectorAll(".font-option").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.font;
      if (id) {
        localStorage.setItem(FONT_KEY, id);
        applyFont(id);
      }
    });
  });

  document.querySelectorAll(".font-size-option").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.size;
      if (id) {
        localStorage.setItem(FONTSIZE_KEY, id);
        applyFontSize(id);
      }
    });
  });

  initTeachingLock();
  initResearchNav();
  initLogo();
}

function initResearchNav() {
  const onResearch = /\/forum\.html$/.test(location.pathname) || location.pathname.endsWith("/forum.html");
  const section = new URLSearchParams(location.search).get("section");

  document.querySelectorAll(".nav-dropdown[data-nav-key='forum']").forEach((dropdown) => {
    const btn = dropdown.querySelector(".nav-dropdown-btn");
    if (!btn || btn.dataset.researchBound === "1") return;
    btn.dataset.researchBound = "1";

    if (onResearch) dropdown.classList.add("open");
    if (onResearch && !section) btn.classList.add("active");
    dropdown.querySelectorAll(".nav-dropdown-menu a").forEach((link) => {
      const target = new URL(link.getAttribute("href"), location.href);
      if (onResearch && target.searchParams.get("section") === section) {
        link.classList.add("active");
      }
    });

    btn.addEventListener("click", (e) => {
      const here = /\/forum\.html$/.test(location.pathname) || location.pathname.endsWith("/forum.html");
      const current = new URLSearchParams(location.search).get("section");
      if (here && !current) {
        e.preventDefault();
        dropdown.classList.toggle("open");
      }
    });
  });
}
