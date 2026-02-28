// ============================================================
// WINN Platforms — auth.js
// Handles login, registration, logout, session state, roles
// ============================================================

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- Role hierarchy ----
const ROLE_RANK = { guest: 0, regular: 1, moderator: 2, admin: 3 };

export function hasRole(userRole, required) {
  const r = typeof userRole === "string" ? userRole.toLowerCase() : "";
  const q = typeof required === "string" ? required.toLowerCase() : "";
  return (ROLE_RANK[r] ?? 0) >= (ROLE_RANK[q] ?? 0);
}

// ---- Session state (module-level cache) ----
let _currentUser = null;
let _currentRole = "guest";

export function getCurrentUser() { return _currentUser; }
export function getCurrentRole() { return _currentRole; }

// ---- Fetch role from Firestore ----
async function fetchRole(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      return snap.data().role ?? "regular";
    }
  } catch (e) {
    console.warn("fetchRole error:", e);
  }
  return "regular";
}

// ---- Auth state listener ----
// Call this once on page load. Calls callback(user, role).
export function initAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      _currentUser = user;
      _currentRole = await fetchRole(user.uid);
    } else {
      _currentUser = null;
      _currentRole = "guest";
    }
    if (typeof callback === "function") callback(_currentUser, _currentRole);
  });
}

// ---- Register new user ----
export async function register(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid  = cred.user.uid;

  // Create user document with default "regular" role
  await setDoc(doc(db, "users", uid), {
    displayName: displayName || email.split("@")[0],
    email:       email,
    role:        "regular",
    createdAt:   serverTimestamp()
  });

  return cred.user;
}

// ---- Login ----
export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ---- Logout ----
export async function logout() {
  await signOut(auth);
}

// ---- Update nav UI with auth state ----
function roleDisplayName(role) {
  return role === "regular" ? "WINNer" : role;
}

export function updateNavUI(user, role) {
  const navUser    = document.getElementById("nav-user");
  const navLogin   = document.getElementById("nav-login");
  const navLogout  = document.getElementById("nav-logout");

  if (!navUser) return; // nav elements not present on this page

  if (user) {
    const roleBadgeClass = `badge-${role}`;
    const displayName = user.displayName || user.email;
    navUser.innerHTML = `
      <span>${escHtml(displayName)}</span>
      <span class="nav-role-badge ${roleBadgeClass}">${escHtml(roleDisplayName(role))}</span>
    `;
    navUser.style.display  = "flex";
    if (navLogin)  navLogin.style.display  = "none";
    if (navLogout) navLogout.style.display = "inline-flex";
  } else {
    navUser.style.display  = "none";
    if (navLogin)  navLogin.style.display  = "inline-flex";
    if (navLogout) navLogout.style.display = "none";
  }
}

// ---- Helpers ----
export function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function showToast(message, type = "info", duration = 3500) {
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

export function formatDate(ts) {
  if (ts == null) return "";
  let sec = 0;
  if (typeof ts === "number") {
    sec = ts < 1e10 ? ts : ts / 1000;
  } else if (ts && typeof ts.toDate === "function") {
    sec = ts.toDate().getTime() / 1000;
  } else if (ts && typeof ts.seconds === "number") {
    sec = ts.seconds;
  } else if (ts && typeof ts._seconds === "number") {
    sec = ts._seconds;
  } else {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) sec = d.getTime() / 1000;
  }
  if (!(sec > 0)) return "";
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const str = d.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
  return str === "Invalid Date" ? "" : str;
}
