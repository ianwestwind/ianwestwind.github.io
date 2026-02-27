// ============================================================
// WINN Platforms — forum.js
// Forum posts with rich editor, thumbnails, and attachments
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc, updateDoc,
  query, orderBy, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getCurrentUser, getCurrentRole, hasRole, escHtml, showToast, formatDate
} from "./auth.js";
import {
  initEditor, getEditorHTML, initThumbnailZone, initAttachmentZone, renderBody, highlightContent, initPreview
} from "./editor.js";

const COLLECTION = "forum_posts";
const _posts = new Map();
let _quill      = null;
let _thumbZone  = null;
let _attachZone = null;
let _editId     = null; // set while editing an existing post

function _updateCount(n) {
  const el = document.getElementById("post-count");
  if (el) el.textContent = `${n} post${n !== 1 ? "s" : ""}`;
}

function _showList() {
  const listView   = document.getElementById("list-view");
  const detailView = document.getElementById("detail-view");
  if (listView)   listView.style.display   = "";
  if (detailView) detailView.style.display = "none";

  const rows = document.getElementById("posts-rows");
  if (!rows) return;

  if (_posts.size === 0) {
    rows.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><p>No posts yet. Be the first to start a discussion!</p></div>`;
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
        ${data.thumbnailUrl ? `<span class="post-has-thumb" title="Has thumbnail">🖼</span>` : ""}
      </div>
      <div class="post-row-meta">
        <span>${escHtml(data.authorName || "Anonymous")}</span>
        <span>·</span>
        <span>${formatDate(data.createdAt)}</span>
      </div>
    </div>
  `).join("");

  rows.querySelectorAll(".post-row").forEach(row => {
    const open = () => { location.hash = row.dataset.id; };
    row.addEventListener("click", open);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
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

  const role      = getCurrentRole();
  const user      = getCurrentUser();
  const canDelete = hasRole(role, "moderator") || (user && user.uid === data.authorUid);

  detailView.innerHTML = `
    <div class="post-detail-header">
      <button class="back-btn" id="back-btn">← Back</button>
    </div>
    ${data.thumbnailUrl ? `<div class="post-detail-thumb"><img src="${escHtml(data.thumbnailUrl)}" alt="" /></div>` : ""}
    <div class="post-detail-title">
      ${escHtml(data.title || "(untitled)")}
      ${data.thread ? `<span class="post-thread-tag">#${escHtml(data.thread)}</span>` : ""}
    </div>
    <div class="post-detail-meta">
      <span>${escHtml(data.authorName || "Anonymous")}</span>
      <span>·</span>
      <span>${formatDate(data.createdAt)}</span>
    </div>
    <div class="post-detail-body rich-content" id="forum-detail-body-${id}"></div>
    ${_attachmentsHTML(data.attachments)}
    ${canDelete ? `<div class="post-detail-actions">
      <button class="btn btn-secondary btn-sm" id="detail-edit-btn">Edit</button>
      <button class="btn btn-danger btn-sm" id="detail-delete-btn">Delete Post</button>
    </div>` : ""}
  `;

  const bodyEl = document.getElementById(`forum-detail-body-${id}`);
  bodyEl.innerHTML = renderBody(data.body);
  highlightContent(bodyEl);

  document.getElementById("back-btn").addEventListener("click", () => { location.hash = ""; });

  if (canDelete) {
    document.getElementById("detail-edit-btn").addEventListener("click", () => _startEdit(id));
    document.getElementById("detail-delete-btn").addEventListener("click", async () => {
      if (!confirm("Delete this post?")) return;
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        _posts.delete(id);
        showToast("Post deleted.", "info");
        location.hash = "";
      } catch (err) { showToast("Delete failed: " + err.message, "error"); }
    });
  }
}

function _startEdit(id) {
  const data = _posts.get(id);
  if (!data) return;
  _editId = id;

  const newForm   = document.getElementById("new-post-form");
  const toggleBtn = document.getElementById("toggle-form-btn");
  location.hash = "";
  if (newForm)   newForm.style.display   = "";
  if (toggleBtn) toggleBtn.textContent   = "✕ Cancel";

  const titleInput  = document.querySelector("#forum-form [name=title]");
  const threadInput = document.querySelector("#forum-form [name=thread]");
  if (titleInput)  titleInput.value  = data.title  || "";
  if (threadInput) threadInput.value = data.thread || "";
  if (_quill) _quill.clipboard.dangerouslyPasteHTML(data.body || "");
  if (_thumbZone) _thumbZone.setThumbUrl(data.thumbnailUrl || null);

  const submitBtn = document.querySelector("#forum-form [type=submit]");
  if (submitBtn) submitBtn.textContent = "Update Post";
  newForm?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function _attachmentsHTML(attachments) {
  if (!attachments?.length) return "";
  return `
    <div class="attach-section">
      <div class="attach-section-title">Attachments</div>
      ${attachments.map(a => `
        <div class="attach-item">
          <a href="${escHtml(a.url)}" target="_blank" rel="noopener" class="attach-link">${escHtml(a.name)}</a>
          <span class="attach-size">${Math.round((a.size || 0) / 1024)} KB</span>
        </div>`).join("")}
    </div>`;
}

function _handleHash() {
  const id = location.hash.slice(1);
  if (id && _posts.has(id)) _showDetail(id);
  else _showList();
}

export async function initForumPage() {
  window.addEventListener("hashchange", _handleHash);

  const rows = document.getElementById("posts-rows");
  if (rows) rows.innerHTML = `<div class="spinner"><div class="spinner-ring"></div></div>`;

  try {
    const q    = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    _posts.clear();
    snap.docs.forEach(d => _posts.set(d.id, d.data()));
  } catch (err) {
    if (rows) rows.innerHTML = `<p style="color:var(--danger)">Error loading posts: ${escHtml(err.message)}</p>`;
    return;
  }

  const listHeader = document.getElementById("list-header");
  if (listHeader) listHeader.style.display = "";

  // Init editor + zones for signed-in users
  const role = getCurrentRole();
  if (hasRole(role, "regular")) {
    _quill      = initEditor("forum-toolbar", "forum-editor", "forum");
    _thumbZone  = initThumbnailZone("forum-thumb", "forum-thumb-preview", "forum");
    _attachZone = initAttachmentZone("forum-attach-input", "forum-attach-list", "forum");

    initPreview("forum-preview-btn", "forum-preview-panel", () => ({
      title:    document.getElementById("post-title")?.value.trim() || "",
      thread:   document.getElementById("post-thread")?.value.trim() || "",
      body:     _quill ? getEditorHTML(_quill) : "",
      thumbUrl: _thumbZone?.getThumbUrl() || null,
    }));
  }

  // Toggle form
  const toggleBtn = document.getElementById("toggle-form-btn");
  const newForm   = document.getElementById("new-post-form");
  function _resetFormState() {
    _editId = null;
    if (_quill) _quill.setContents([]);
    if (_thumbZone) _thumbZone.reset();
    const sb = document.querySelector("#forum-form [type=submit]");
    if (sb) sb.textContent = "Post";
  }

  if (toggleBtn && newForm) {
    toggleBtn.addEventListener("click", () => {
      const hidden = newForm.style.display === "none" || newForm.style.display === "";
      newForm.style.display = hidden ? "" : "none";
      toggleBtn.textContent = hidden ? "✕ Cancel" : "+ New Post";
      if (!hidden) _resetFormState();
    });
  }
  const cancelBtn = document.getElementById("forum-cancel-btn");
  if (cancelBtn && newForm) {
    cancelBtn.addEventListener("click", () => {
      newForm.style.display = "none";
      if (toggleBtn) toggleBtn.textContent = "+ New Post";
      _resetFormState();
    });
  }

  _handleHash();
}

export async function submitForumPost() {
  const form        = document.getElementById("forum-form");
  const titleInput  = form.querySelector("[name=title]");
  const threadInput = form.querySelector("[name=thread]");
  const submitBtn   = form.querySelector("[type=submit]");
  const errorEl     = document.getElementById("forum-form-error");

  const role = getCurrentRole();
  const user = getCurrentUser();

  if (!hasRole(role, "regular")) {
    showToast("You must be logged in as a registered user to post.", "error"); return;
  }

  const title  = titleInput.value.trim();
  const thread = threadInput ? threadInput.value.trim() : "";
  const body   = _quill ? getEditorHTML(_quill) : "";

  if (!title) {
    if (errorEl) { errorEl.textContent = "Title is required."; errorEl.classList.add("visible"); }
    return;
  }

  if (errorEl) errorEl.classList.remove("visible");
  const editId = _editId;
  submitBtn.disabled    = true;
  submitBtn.textContent = editId ? "Updating…" : "Posting…";

  const newForm   = document.getElementById("new-post-form");
  const toggleBtn = document.getElementById("toggle-form-btn");

  function _closeForm() {
    titleInput.value = "";
    if (threadInput) threadInput.value = "";
    if (_quill) _quill.setContents([]);
    if (_thumbZone) _thumbZone.reset();
    if (newForm)   newForm.style.display   = "none";
    if (toggleBtn) toggleBtn.textContent   = "+ New Post";
    _editId = null;
  }

  try {
    if (editId) {
      // Update existing post (preserve attachments, author, createdAt)
      const changes = {
        title,
        body,
        thread:       thread || null,
        thumbnailUrl: _thumbZone?.getThumbUrl() || null,
      };
      await updateDoc(doc(db, COLLECTION, editId), changes);
      _posts.set(editId, { ..._posts.get(editId), ...changes });
      _closeForm();
      showToast("Post updated!", "success");
      location.hash = editId;
    } else {
      // Create new post
      const postData = {
        title,
        body,
        thread:       thread || null,
        thumbnailUrl: _thumbZone?.getThumbUrl() || null,
        attachments:  _attachZone?.getAttachments() || [],
        authorUid:    user.uid,
        authorName:   user.displayName || user.email,
        createdAt:    serverTimestamp()
      };
      const newDoc = await addDoc(collection(db, COLLECTION), postData);
      _posts.set(newDoc.id, { ...postData, createdAt: { seconds: Date.now() / 1000 } });
      if (_attachZone) _attachZone.reset();
      _closeForm();
      showToast("Post published!", "success");
      _showList();
    }
  } catch (err) {
    showToast(`Failed to ${editId ? "update" : "post"}: ` + err.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = editId ? "Update Post" : "Post";
  }
}
