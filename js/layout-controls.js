// WINN Platforms — layout-controls.js
// Theme, font, and font-size controls (right sidebar). Persists to localStorage.

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
}
