// ============================================================
// WINN Platforms — forum.js
// Hash-routed list/detail view with image attachment support
// ============================================================

import { db, storage } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, orderBy, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  getCurrentUser, getCurrentRole, hasRole, escHtml, showToast, formatDate
} from "./auth.js";

const COLLECTION = "forum_posts";
const _posts = new Map(); // id → data

function renderSpinner() {
  return `<div class="spinner"><div class="spinner-ring"></div></div>`;
}

function renderEmpty() {
  return `<div class="empty-state">
    <div class="empty-icon">💬</div>
    <p>No posts yet. Be the first to start a discussion!</p>
  </div>`;
}

function _updateCount(n) {
  const countEl = document.getElementById("post-count");
  if (countEl) countEl.textContent = `${n} post${n !== 1 ? "s" : ""}`;
}

function _showList() {
  const listView   = document.getElementById("list-view");
  const detailView = document.getElementById("detail-view");
  if (listView)   listView.style.display   = "";
  if (detailView) detailView.style.display = "none";

  const rows = document.getElementById("posts-rows");
  if (!rows) return;

  if (_posts.size === 0) {
    rows.innerHTML = renderEmpty();
    _updateCount(0);
    return;
  }

  const sorted = [..._posts.entries()].sort((a, b) => {
    const ta = a[1].createdAt?.seconds ?? 0;
    const tb = b[1].createdAt?.seconds ?? 0;
    return tb - ta;
  });

  rows.innerHTML = sorted.map(([id, data]) => `
    <div class="post-row" data-id="${escHtml(id)}" role="button" tabindex="0">
      <div class="post-row-title">
        ${escHtml(data.title || "(untitled)")}
        ${data.thread ? `<span class="post-thread-tag">#${escHtml(data.thread)}</span>` : ""}
      </div>
      <div class="post-row-meta">
        <span>${escHtml(data.authorName || "Anonymous")}</span>
        <span>·</span>
        <span>${formatDate(data.createdAt)}</span>
      </div>
    </div>
  `).join("");

  rows.querySelectorAll(".post-row").forEach(row => {
    const openDetail = () => { location.hash = row.dataset.id; };
    row.addEventListener("click", openDetail);
    row.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(); }
    });
  });

  _updateCount(_posts.size);
}

function _showDetail(id) {
  const data = _posts.get(id);
  if (!data) { location.hash = ""; return; }

  const listView   = document.getElementById("list-view");
  const detailView = document.getElementById("detail-view");
  if (listView)   listView.style.display   = "none";
  if (detailView) detailView.style.display = "";

  const role = getCurrentRole();
  const user = getCurrentUser();
  const canDelete = hasRole(role, "moderator") || (user && user.uid === data.authorUid);

  detailView.innerHTML = `
    <div class="post-detail-header">
      <button class="back-btn" id="back-btn">← Back</button>
    </div>
    <div class="post-detail-title">
      ${escHtml(data.title || "(untitled)")}
      ${data.thread ? `<span class="post-thread-tag">#${escHtml(data.thread)}</span>` : ""}
    </div>
    <div class="post-detail-meta">
      <span>${escHtml(data.authorName || "Anonymous")}</span>
      <span>·</span>
      <span>${formatDate(data.createdAt)}</span>
    </div>
    <div class="post-detail-body">${escHtml(data.body || "")}</div>
    ${data.imageUrl ? `<div class="post-detail-image"><img src="${escHtml(data.imageUrl)}" alt="Post image" /></div>` : ""}
    ${canDelete ? `<div class="post-detail-actions"><button class="btn btn-danger btn-sm" id="detail-delete-btn">Delete Post</button></div>` : ""}
  `;

  document.getElementById("back-btn").addEventListener("click", () => { location.hash = ""; });

  if (canDelete) {
    document.getElementById("detail-delete-btn").addEventListener("click", async () => {
      if (!confirm("Delete this post?")) return;
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        _posts.delete(id);
        showToast("Post deleted.", "info");
        location.hash = "";
      } catch (err) {
        showToast("Delete failed: " + err.message, "error");
      }
    });
  }
}

function _handleHash() {
  const id = location.hash.slice(1);
  if (id && _posts.has(id)) {
    _showDetail(id);
  } else {
    _showList();
  }
}

export async function initForumPage() {
  window.addEventListener("hashchange", _handleHash);

  const rows = document.getElementById("posts-rows");
  if (rows) rows.innerHTML = renderSpinner();

  try {
    const q    = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    _posts.clear();
    snap.docs.forEach(d => _posts.set(d.id, d.data()));
  } catch (err) {
    if (rows) rows.innerHTML = `<p style="color:var(--danger)">Error loading posts: ${escHtml(err.message)}</p>`;
    return;
  }

  // Reveal list header after load
  const listHeader = document.getElementById("list-header");
  if (listHeader) listHeader.style.display = "";

  // Toggle new post form
  const toggleBtn = document.getElementById("toggle-form-btn");
  const newForm   = document.getElementById("new-post-form");
  if (toggleBtn && newForm) {
    toggleBtn.addEventListener("click", () => {
      const isHidden = newForm.style.display === "none" || newForm.style.display === "";
      newForm.style.display = isHidden ? "" : "none";
      toggleBtn.textContent = isHidden ? "✕ Cancel" : "+ New Post";
    });
  }

  // Image preview
  const fileInput = document.getElementById("post-image");
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file    = fileInput.files[0];
      const preview = document.getElementById("image-preview-container");
      if (!preview) return;
      if (file) {
        const reader = new FileReader();
        reader.onload = ev => {
          preview.innerHTML = `
            <div class="image-preview">
              <img src="${escHtml(ev.target.result)}" alt="Preview" />
              <button type="button" class="image-preview-remove" id="remove-image">✕</button>
            </div>
          `;
          document.getElementById("remove-image").addEventListener("click", () => {
            fileInput.value = "";
            preview.innerHTML = "";
          });
        };
        reader.readAsDataURL(file);
      } else {
        preview.innerHTML = "";
      }
    });
  }

  _handleHash();
}

export async function submitForumPost(formId) {
  const form        = document.getElementById(formId);
  const titleInput  = form.querySelector("[name=title]");
  const bodyInput   = form.querySelector("[name=body]");
  const threadInput = form.querySelector("[name=thread]");
  const fileInput   = document.getElementById("post-image");
  const submitBtn   = form.querySelector("[type=submit]");
  const errorEl     = form.querySelector(".form-error");

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
  submitBtn.disabled    = true;
  submitBtn.textContent = "Posting…";

  const postData = {
    title,
    body,
    thread:     thread || null,
    authorUid:  user.uid,
    authorName: user.displayName || user.email,
    createdAt:  serverTimestamp()
  };

  const file = fileInput?.files[0];

  try {
    let newId;
    let imageUrl = null;

    if (file) {
      try {
        const newRef     = doc(collection(db, COLLECTION));
        newId            = newRef.id;
        const storageRef = ref(storage, `post-images/${newId}/${Date.now()}-${file.name}`);
        await uploadBytes(storageRef, file);
        imageUrl         = await getDownloadURL(storageRef);
        await setDoc(newRef, { ...postData, imageUrl });
      } catch (uploadErr) {
        showToast("Image upload failed; posting without image.", "error");
        const newDoc = await addDoc(collection(db, COLLECTION), postData);
        newId = newDoc.id;
        imageUrl = null;
      }
    } else {
      const newDoc = await addDoc(collection(db, COLLECTION), postData);
      newId = newDoc.id;
    }

    // Add to local map with approximate timestamp for immediate re-render
    const localEntry = { ...postData, createdAt: { seconds: Date.now() / 1000 } };
    if (imageUrl) localEntry.imageUrl = imageUrl;
    _posts.set(newId, localEntry);

    // Reset form
    form.reset();
    const preview = document.getElementById("image-preview-container");
    if (preview) preview.innerHTML = "";

    // Collapse form
    const toggleBtn = document.getElementById("toggle-form-btn");
    const newForm   = document.getElementById("new-post-form");
    if (newForm)   newForm.style.display = "none";
    if (toggleBtn) toggleBtn.textContent = "+ New Post";

    showToast("Post published!", "success");
    _showList();
  } catch (err) {
    showToast("Failed to post: " + err.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Post";
  }
}
