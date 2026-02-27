// ============================================================
// WINN Platforms — announcements.js
// Hash-routed list/detail; moderator/admin can post/delete
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getCurrentUser, getCurrentRole, hasRole, escHtml, showToast, formatDate
} from "./auth.js";

const COLLECTION = "announcements";
const _items = new Map(); // id → data

function renderSpinner() {
  return `<div class="spinner"><div class="spinner-ring"></div></div>`;
}

function renderEmpty() {
  return `<div class="empty-state">
    <div class="empty-icon">📢</div>
    <p>No announcements yet.</p>
  </div>`;
}

function _snippet(text, max = 120) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function _updateCount(n) {
  const countEl = document.getElementById("ann-count");
  if (countEl) countEl.textContent = `${n} announcement${n !== 1 ? "s" : ""}`;
}

function _showList() {
  const listView   = document.getElementById("list-view");
  const detailView = document.getElementById("detail-view");
  if (listView)   listView.style.display   = "";
  if (detailView) detailView.style.display = "none";

  const rows = document.getElementById("announcements-rows");
  if (!rows) return;

  if (_items.size === 0) {
    rows.innerHTML = renderEmpty();
    _updateCount(0);
    return;
  }

  const sorted = [..._items.entries()].sort((a, b) => {
    const ta = a[1].createdAt?.seconds ?? 0;
    const tb = b[1].createdAt?.seconds ?? 0;
    return tb - ta;
  });

  rows.innerHTML = sorted.map(([id, data]) => `
    <div class="announcement-row" data-id="${escHtml(id)}" role="button" tabindex="0">
      <div class="announcement-row-title">${escHtml(data.title || "(untitled)")}</div>
      <div class="announcement-row-snippet">${escHtml(_snippet(data.body))}</div>
      <div class="announcement-row-meta">
        <span>${escHtml(data.authorName || "Staff")}</span>
        <span>·</span>
        <span>${formatDate(data.createdAt)}</span>
      </div>
    </div>
  `).join("");

  rows.querySelectorAll(".announcement-row").forEach(row => {
    const openDetail = () => { location.hash = row.dataset.id; };
    row.addEventListener("click", openDetail);
    row.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(); }
    });
  });

  _updateCount(_items.size);
}

function _showDetail(id) {
  const data = _items.get(id);
  if (!data) { location.hash = ""; return; }

  const listView   = document.getElementById("list-view");
  const detailView = document.getElementById("detail-view");
  if (listView)   listView.style.display   = "none";
  if (detailView) detailView.style.display = "";

  const role     = getCurrentRole();
  const canDelete = hasRole(role, "moderator");

  detailView.innerHTML = `
    <div class="post-detail-header">
      <button class="back-btn" id="back-btn">← Back</button>
    </div>
    <div class="post-detail-title">${escHtml(data.title || "(untitled)")}</div>
    <div class="post-detail-meta">
      <span>${escHtml(data.authorName || "Staff")}</span>
      <span>·</span>
      <span>${formatDate(data.createdAt)}</span>
    </div>
    <div class="post-detail-body">${escHtml(data.body || "")}</div>
    ${canDelete ? `<div class="post-detail-actions"><button class="btn btn-danger btn-sm" id="detail-delete-btn">Delete Announcement</button></div>` : ""}
  `;

  document.getElementById("back-btn").addEventListener("click", () => { location.hash = ""; });

  if (canDelete) {
    document.getElementById("detail-delete-btn").addEventListener("click", async () => {
      if (!confirm("Delete this announcement?")) return;
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        _items.delete(id);
        showToast("Announcement deleted.", "info");
        location.hash = "";
      } catch (err) {
        showToast("Delete failed: " + err.message, "error");
      }
    });
  }
}

function _handleHash() {
  const id = location.hash.slice(1);
  if (id && _items.has(id)) {
    _showDetail(id);
  } else {
    _showList();
  }
}

export async function initAnnouncementsPage() {
  window.addEventListener("hashchange", _handleHash);

  const rows = document.getElementById("announcements-rows");
  if (rows) rows.innerHTML = renderSpinner();

  try {
    const q    = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    _items.clear();
    snap.docs.forEach(d => _items.set(d.id, d.data()));
  } catch (err) {
    if (rows) rows.innerHTML = `<p style="color:var(--danger)">Error loading announcements: ${escHtml(err.message)}</p>`;
    return;
  }

  _handleHash();
}

export async function submitAnnouncement(formId) {
  const form       = document.getElementById(formId);
  const titleInput = form.querySelector("[name=title]");
  const bodyInput  = form.querySelector("[name=body]");
  const submitBtn  = form.querySelector("[type=submit]");
  const errorEl    = form.querySelector(".form-error");

  const role = getCurrentRole();
  const user = getCurrentUser();

  if (!hasRole(role, "moderator")) {
    showToast("Only moderators and admins can post announcements.", "error");
    return;
  }

  const title = titleInput.value.trim();
  const body  = bodyInput.value.trim();

  if (!title || !body) {
    if (errorEl) { errorEl.textContent = "Title and body are required."; errorEl.classList.add("visible"); }
    return;
  }

  if (errorEl) errorEl.classList.remove("visible");
  submitBtn.disabled    = true;
  submitBtn.textContent = "Posting…";

  try {
    const postData = {
      title,
      body,
      authorUid:  user.uid,
      authorName: user.displayName || user.email,
      createdAt:  serverTimestamp()
    };

    const newDoc = await addDoc(collection(db, COLLECTION), postData);
    _items.set(newDoc.id, { ...postData, createdAt: { seconds: Date.now() / 1000 } });

    form.reset();

    showToast("Announcement published!", "success");
    _showList();
  } catch (err) {
    showToast("Failed to post: " + err.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Post Announcement";
  }
}
