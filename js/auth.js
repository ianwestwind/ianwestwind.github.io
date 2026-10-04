// ============================================================
// Multimodal Intelligence Lab — auth.js
// Handles login, registration, logout, session state, roles
// ============================================================

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  EmailAuthProvider,
  reauthenticateWithCredential,
  verifyBeforeUpdateEmail,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---- Role hierarchy ----
// guest is signed out. visitor is the lowest signed-in account.
const ROLE_RANK = { guest: 0, visitor: 1, regular: 2, moderator: 3, admin: 4 };

export function hasRole(userRole, required) {
  const r = typeof userRole === "string" ? userRole.trim().toLowerCase() : "";
  const q = typeof required === "string" ? required.trim().toLowerCase() : "";
  return (ROLE_RANK[r] ?? 0) >= (ROLE_RANK[q] ?? 0);
}

// ---- Session state (module-level cache) ----
let _currentUser = null;
let _currentRole = "guest";
let _registering = false;

export function isRegistering() { return _registering; }

export function getCurrentUser() { return _currentUser; }
export function getCurrentRole() { return _currentRole; }

// ---- Fetch role from Firestore ----
async function fetchRole(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const raw = snap.data().role ?? "regular";
      const normalized = String(raw).trim().toLowerCase() || "regular";
      return normalized;
    }
    // The profile is written just after the account is created. Until then, the level is visitor.
    return "visitor";
  } catch (e) {
    console.warn("fetchRole error:", e);
  }
  return "visitor";
}

// ---- Auth state listener ----
// Call this once on page load. Calls callback(user, role).
export function initAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      try { await user.reload(); } catch (e) { console.warn("user.reload:", e); }
      _currentUser = auth.currentUser || user;
      const fetched = await fetchRole(_currentUser.uid);
      _currentRole = typeof fetched === "string" ? fetched.trim().toLowerCase() : "regular";
      await syncStoredEmail(_currentUser);
    } else {
      _currentUser = null;
      _currentRole = "guest";
    }
    if (typeof callback === "function") callback(_currentUser, _currentRole);
  });
}

// ---- Register new user ----
export async function register(email, password, displayName, institution, title) {
  const cleanInstitution = String(institution || "").trim();
  const cleanTitle = String(title || "").trim();
  if (!cleanInstitution || !cleanTitle || cleanInstitution.length > 120 || cleanTitle.length > 120) {
    const err = new Error("Institution and title are required.");
    err.code = "auth/invalid-profile";
    throw err;
  }
  _registering = true;
  let cred = null;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
    const token = await cred.user.getIdTokenResult(true);
    const storedEmail = token.claims.email || cred.user.email || email.trim();
    await setDoc(doc(db, "users", cred.user.uid), {
      displayName: displayName || storedEmail.split("@")[0],
      email:       storedEmail,
      institution: cleanInstitution,
      title:       cleanTitle,
      role:        "visitor",
      createdAt:   serverTimestamp()
    });
    _currentRole = "visitor";
    return cred.user;
  } catch (err) {
    if (cred?.user) {
      try { await cred.user.delete(); } catch (e) { console.warn("register cleanup:", e); }
    }
    throw err;
  } finally {
    _registering = false;
  }
}

// ---- Login ----
export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ---- Logout ----
export async function logout() {
  if (!window.confirm("Sign out?")) return false;
  await signOut(auth);
  return true;
}

// Keep the Firestore profile email aligned with the Auth account
// after a confirmed email change.
async function syncStoredEmail(user) {
  if (!user?.uid || !user.email) return;
  try {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().email === user.email) return;
    await updateDoc(ref, { email: user.email });
  } catch (e) {
    console.warn("syncStoredEmail:", e);
  }
}

async function reauthenticate(currentPassword) {
  const user = auth.currentUser;
  if (!user?.email) {
    const err = new Error("Sign in required.");
    err.code = "auth/user-not-found";
    throw err;
  }
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  return auth.currentUser;
}

// Sends a confirmation link to the new address. The sign-in email
// changes only after that link is opened; initAuth then syncs Firestore.
export async function changeEmail(newEmail, currentPassword) {
  const user = await reauthenticate(currentPassword);
  const email = String(newEmail || "").trim();
  if (email.toLowerCase() === (user.email || "").toLowerCase()) {
    const err = new Error("That is already your email.");
    err.code = "auth/same-email";
    throw err;
  }
  await verifyBeforeUpdateEmail(auth.currentUser, email);
  return "pending";
}

export async function changePassword(currentPassword, newPassword) {
  await reauthenticate(currentPassword);
  if (newPassword === currentPassword) {
    const err = new Error("Choose a different password.");
    err.code = "auth/same-password";
    throw err;
  }
  await updatePassword(auth.currentUser, newPassword);
}

export function friendlyAuthError(code) {
  const map = {
    "auth/email-already-in-use": "That email is already registered.",
    "auth/invalid-email":        "Invalid email address.",
    "auth/weak-password":        "Password must be at least 6 characters.",
    "auth/user-not-found":       "No account found with that email.",
    "auth/wrong-password":       "Incorrect password.",
    "auth/invalid-credential":   "Current password is incorrect.",
    "auth/requires-recent-login": "Please enter your current password and try again.",
    "auth/too-many-requests":    "Too many attempts. Please try again later.",
    "auth/same-email":           "That is already your email.",
    "auth/same-password":        "Choose a password that is different from your current one.",
    "auth/operation-not-allowed": "Email and password changes are not enabled for this site."
  };
  return map[code] || "An error occurred. Please try again.";
}

// ---- Update nav UI with auth state ----
export function updateNavUI(user, role) {
  const navMembers = document.getElementById("nav-members");
  if (navMembers) navMembers.hidden = !hasRole(role, "regular");

  const navEmail    = document.getElementById("nav-user-email");
  const navBadge    = document.getElementById("nav-role-badge");
  const navLogin    = document.getElementById("nav-login");
  const navLogout   = document.getElementById("nav-logout");
  const navSettings = document.getElementById("nav-settings");

  if (!navEmail && !navLogin) return;

  if (user) {
    const email = user.email || user.displayName || "";
    if (navEmail) {
      navEmail.textContent = email;
      navEmail.hidden = false;
    }
    if (navBadge) {
      navBadge.className = `nav-role-badge badge-${role}`;
      navBadge.textContent = role;
      navBadge.hidden = false;
    }
    if (navLogin)    navLogin.hidden = true;
    if (navSettings) navSettings.hidden = false;
    if (navLogout)   navLogout.hidden = false;
  } else {
    if (navEmail)    navEmail.hidden = true;
    if (navBadge)    navBadge.hidden = true;
    if (navLogin)    navLogin.hidden = false;
    if (navSettings) navSettings.hidden = true;
    if (navLogout)   navLogout.hidden = true;
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
