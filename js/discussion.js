// ============================================================
// WINN Platforms — discussion.js
// General discussion threads: load, post, delete (role-gated)
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

const COLLECTION = "discussion_posts";

function renderSpinner() {
  return `<div class="spinner"><div class="spinner-ring"></div></div>`;
}

function renderEmpty() {
  return `<div class="empty-state">
    <div class="empty-icon">🗨️</div>
    <p>No discussions yet. Start one!</p>
  </div>`;
}

function renderPost(id, data, role) {
  const canDelete = hasRole(role, "moderator") ||
                    (getCurrentUser() && getCurrentUser().uid === data.authorUid);
  const deleteBtn = canDelete
    ? `<button class="btn btn-danger btn-sm" data-delete="${escHtml(id)}">Delete</button>`
    : "";
  return `
    <div class="post-item" id="dpost-${escHtml(id)}">
      <div class="post-header">
        <div class="post-title">${escHtml(data.title || "(untitled)")}</div>
        <div class="post-meta">
          <span class="post-author">${escHtml(data.authorName || "Anonymous")}</span>
          <span>·</span>
          <span>${formatDate(data.createdAt)}</span>
        </div>
      </div>
      <div class="post-body">${escHtml(data.body || "")}</div>
      ${canDelete ? `<div class="post-actions">${deleteBtn}</div>` : ""}
    </div>
  `;
}

export async function loadDiscussionPosts(containerId) {
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

    container.innerHTML = `<div class="post-list">` +
      snap.docs.map(d => renderPost(d.id, d.data(), role)).join("") +
      `</div>`;

    container.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", () => deleteDiscussionPost(btn.dataset.delete));
    });
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger)">Error loading discussions: ${escHtml(err.message)}</p>`;
  }
}

export async function submitDiscussionPost(formId, listContainerId) {
  const form       = document.getElementById(formId);
  const titleInput = form.querySelector("[name=title]");
  const bodyInput  = form.querySelector("[name=body]");
  const submitBtn  = form.querySelector("[type=submit]");
  const errorEl    = form.querySelector(".form-error");

  const role = getCurrentRole();
  const user = getCurrentUser();

  if (!hasRole(role, "regular")) {
    showToast("You must be logged in as a registered user to post.", "error");
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

    showToast("Discussion posted!", "success");
    await loadDiscussionPosts(listContainerId);
  } catch (err) {
    showToast("Failed to post: " + err.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Post";
  }
}

export async function deleteDiscussionPost(postId) {
  const user = getCurrentUser();
  if (!user) return;

  if (!confirm("Delete this post?")) return;

  try {
    await deleteDoc(doc(db, COLLECTION, postId));
    document.getElementById(`dpost-${postId}`)?.remove();
    showToast("Post deleted.", "info");
  } catch (err) {
    showToast("Delete failed: " + err.message, "error");
  }
}
