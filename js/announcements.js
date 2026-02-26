// ============================================================
// WINN Platforms — announcements.js
// Announcements: all can read; moderator/admin can post/delete
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getCurrentUser,
  getCurrentRole,
  hasRole,
  escHtml,
  showToast,
  formatDate
} from "./auth.js";

const COLLECTION = "announcements";

function renderSpinner() {
  return `<div class="spinner"><div class="spinner-ring"></div></div>`;
}

function renderEmpty() {
  return `<div class="empty-state">
    <div class="empty-icon">📢</div>
    <p>No announcements yet.</p>
  </div>`;
}

function renderAnnouncement(id, data, role) {
  const canDelete = hasRole(role, "moderator");
  const deleteBtn = canDelete
    ? `<button class="btn btn-danger btn-sm" data-delete="${escHtml(id)}" style="margin-top:0.5rem">Delete</button>`
    : "";
  return `
    <div class="announcement-item" id="ann-${escHtml(id)}">
      <div class="announcement-title">${escHtml(data.title || "(untitled)")}</div>
      <div class="announcement-body">${escHtml(data.body || "")}</div>
      <div class="announcement-meta">
        Posted by <strong>${escHtml(data.authorName || "Staff")}</strong>
        &nbsp;·&nbsp; ${formatDate(data.createdAt)}
      </div>
      ${deleteBtn}
    </div>
  `;
}

export async function loadAnnouncements(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = renderSpinner();

  try {
    const q    = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const role = getCurrentRole();

    if (snap.empty) {
      container.innerHTML = renderEmpty();
      return;
    }

    container.innerHTML = snap.docs
      .map(d => renderAnnouncement(d.id, d.data(), role))
      .join("");

    container.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", () => deleteAnnouncement(btn.dataset.delete));
    });
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger)">Error loading announcements: ${escHtml(err.message)}</p>`;
  }
}

export async function submitAnnouncement(formId, listContainerId) {
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
    await addDoc(collection(db, COLLECTION), {
      title,
      body,
      authorUid:  user.uid,
      authorName: user.displayName || user.email,
      createdAt:  serverTimestamp()
    });

    titleInput.value = "";
    bodyInput.value  = "";

    showToast("Announcement published!", "success");
    await loadAnnouncements(listContainerId);
  } catch (err) {
    showToast("Failed to post: " + err.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Post Announcement";
  }
}

export async function deleteAnnouncement(annId) {
  const role = getCurrentRole();
  if (!hasRole(role, "moderator")) return;
  if (!confirm("Delete this announcement?")) return;

  try {
    await deleteDoc(doc(db, COLLECTION, annId));
    document.getElementById(`ann-${annId}`)?.remove();
    showToast("Announcement deleted.", "info");
  } catch (err) {
    showToast("Delete failed: " + err.message, "error");
  }
}
