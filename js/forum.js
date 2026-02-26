// ============================================================
// WINN Platforms — forum.js
// Forum threads: load, post, delete (role-gated)
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

const COLLECTION = "forum_posts";

// ---- Render helpers ----
function renderSpinner() {
  return `<div class="spinner"><div class="spinner-ring"></div></div>`;
}

function renderEmpty() {
  return `<div class="empty-state">
    <div class="empty-icon">💬</div>
    <p>No posts yet. Be the first to start a discussion!</p>
  </div>`;
}

function renderPost(id, data, role) {
  const canDelete = hasRole(role, "moderator") ||
                    (getCurrentUser() && getCurrentUser().uid === data.authorUid);
  const deleteBtn = canDelete
    ? `<button class="btn btn-danger btn-sm" data-delete="${escHtml(id)}">Delete</button>`
    : "";
  return `
    <div class="post-item" id="post-${escHtml(id)}">
      <div class="post-header">
        <div class="post-title">${escHtml(data.title || "(untitled)")}</div>
        <div class="post-meta">
          <span class="post-author">${escHtml(data.authorName || "Anonymous")}</span>
          <span>·</span>
          <span>${formatDate(data.createdAt)}</span>
          ${data.thread ? `<span>·</span><span>#${escHtml(data.thread)}</span>` : ""}
        </div>
      </div>
      <div class="post-body">${escHtml(data.body || "")}</div>
      ${canDelete ? `<div class="post-actions">${deleteBtn}</div>` : ""}
    </div>
  `;
}

// ---- Load posts ----
export async function loadForumPosts(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = renderSpinner();

  try {
    const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const role = getCurrentRole();

    if (snap.empty) {
      container.innerHTML = renderEmpty();
      return;
    }

    container.innerHTML = `<div class="post-list" id="post-list-inner">` +
      snap.docs.map(d => renderPost(d.id, d.data(), role)).join("") +
      `</div>`;

    // Attach delete listeners
    container.querySelectorAll("[data-delete]").forEach(btn => {
      btn.addEventListener("click", () => deleteForumPost(btn.dataset.delete));
    });
  } catch (err) {
    container.innerHTML = `<p style="color:var(--danger)">Error loading posts: ${escHtml(err.message)}</p>`;
  }
}

// ---- Submit post ----
export async function submitForumPost(formId, listContainerId) {
  const form       = document.getElementById(formId);
  const titleInput = form.querySelector("[name=title]");
  const bodyInput  = form.querySelector("[name=body]");
  const threadInput= form.querySelector("[name=thread]");
  const submitBtn  = form.querySelector("[type=submit]");
  const errorEl    = form.querySelector(".form-error");

  const role = getCurrentRole();
  const user = getCurrentUser();

  if (!hasRole(role, "regular")) {
    showToast("You must be logged in as a registered user to post.", "error");
    return;
  }

  const title  = titleInput.value.trim();
  const body   = bodyInput.value.trim();
  const thread = threadInput ? threadInput.value.trim() : "";

  if (!title || !body) {
    if (errorEl) { errorEl.textContent = "Title and body are required."; errorEl.classList.add("visible"); }
    return;
  }

  if (errorEl) errorEl.classList.remove("visible");
  submitBtn.disabled = true;
  submitBtn.textContent = "Posting…";

  try {
    await addDoc(collection(db, COLLECTION), {
      title,
      body,
      thread:     thread || null,
      authorUid:  user.uid,
      authorName: user.displayName || user.email,
      createdAt:  serverTimestamp()
    });

    titleInput.value = "";
    bodyInput.value  = "";
    if (threadInput) threadInput.value = "";

    showToast("Post published!", "success");
    await loadForumPosts(listContainerId);
  } catch (err) {
    showToast("Failed to post: " + err.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Post";
  }
}

// ---- Delete post ----
export async function deleteForumPost(postId) {
  const role = getCurrentRole();
  const user = getCurrentUser();
  if (!user) return;

  const confirmed = confirm("Delete this post?");
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, COLLECTION, postId));
    document.getElementById(`post-${postId}`)?.remove();
    showToast("Post deleted.", "info");
  } catch (err) {
    showToast("Delete failed: " + err.message, "error");
  }
}
