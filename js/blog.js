// ============================================================
// WINN Platforms — blog.js
// Blog posts (moderator+ can post); thumbnail cards + scheduling
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc, updateDoc,
  query, orderBy, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getCurrentUser, getCurrentRole, hasRole, escHtml, showToast, formatDate
} from "./auth.js";
import {
  initEditor, getEditorHTML, initThumbnailZone, initAttachmentZone, renderBody, highlightContent, initPreview
} from "./editor.js";

const COLLECTION = "blog_posts";
const _posts = new Map();
let _quill      = null;
let _thumbZone  = null;
let _attachZone = null;
let _userRole   = "guest";
let _editId     = null;

function _snippet(html, max = 130) {
  if (!html) return "";
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function _publishSec(data) {
  const p = data.publishAt ?? data.createdAt;
  if (p == null) return 0;
  if (typeof p.seconds === "number") return p.seconds;
  if (typeof p._seconds === "number") return p._seconds;
  if (typeof p.toDate === "function") return p.toDate().getTime() / 1000;
  const n = Number(p);
  if (!Number.isNaN(n)) return n < 1e10 ? n : n / 1000; // ms vs seconds
  return 0;
}

function _isPublished(data) {
  const sec = _publishSec(data);
  if (sec === 0) return true; // no date = treat as published
  const now = Date.now() / 1000;
  return sec <= now + 60; // allow 1 min future (clock skew)
}

function _updateCount(n) {
  const el = document.getElementById("blog-count");
  if (el) el.textContent = `${n} post${n !== 1 ? "s" : ""}`;
}

function _showList() {
  document.getElementById("list-view").style.display   = "";
  document.getElementById("detail-view").style.display = "none";

  const rows  = document.getElementById("blog-rows");
  if (!rows) return;

  const isMod   = hasRole(_userRole, "moderator");
  const visible = [..._posts.entries()]
    .filter(([, d]) => isMod || _isPublished(d))
    .sort((a, b)  => _publishSec(b[1]) - _publishSec(a[1]));

  _updateCount(visible.length);

  if (visible.length === 0) {
    rows.innerHTML = `<div class="empty-state"><div class="empty-icon"></div><p>No posts yet. Be the first!</p></div>`;
    return;
  }

  rows.innerHTML = visible.map(([id, data]) => {
    const isPub = _isPublished(data);
    const badge = (!isPub && isMod) ? `<span class="scheduled-badge">Scheduled</span>` : "";
    const thumb = data.thumbnailUrl
      ? `<img src="${escHtml(data.thumbnailUrl)}" alt="" class="pub-card-thumb" />`
      : `<div class="pub-card-thumb pub-card-thumb-placeholder"></div>`;
    return `
      <div class="pub-card" data-id="${escHtml(id)}" role="button" tabindex="0">
        ${thumb}
        <div class="pub-card-content">
          <div class="pub-card-title">${escHtml(data.title || "(untitled)")} ${badge}</div>
          <div class="pub-card-snippet">${escHtml(_snippet(data.body))}</div>
          <div class="pub-card-meta">
            <span>${escHtml(data.authorName || "Anonymous")}</span>
            <span>·</span>
            <span>${formatDate(data.publishAt ?? data.createdAt)}</span>
          </div>
        </div>
      </div>`;
  }).join("");

  rows.querySelectorAll(".pub-card").forEach(row => {
    const open = () => { location.hash = row.dataset.id; };
    row.addEventListener("click", open);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
}

function _showDetail(id) {
  const data = _posts.get(id);
  if (!data) { location.hash = ""; return; }

  document.getElementById("list-view").style.display   = "none";
  document.getElementById("detail-view").style.display = "";

  const role      = getCurrentRole();
  const user      = getCurrentUser();
  const isAuthor  = user && (user.uid === data.authorUid || (!data.authorUid && (user.displayName === data.authorName || (user.email && user.email === data.authorName))));
  const canDelete = hasRole(role, "moderator") || isAuthor;
  const isMod     = hasRole(role, "moderator");
  const scheduled = !_isPublished(data) && isMod;

  const detailView = document.getElementById("detail-view");
  detailView.innerHTML = `
    <div class="post-detail-header">
      <button class="back-btn" id="back-btn">← Back</button>
      ${scheduled ? '<span class="scheduled-badge" style="margin-left:.5rem">Scheduled</span>' : ""}
    </div>
    ${data.thumbnailUrl ? `<div class="post-detail-thumb"><img src="${escHtml(data.thumbnailUrl)}" alt="" /></div>` : ""}
    <div class="post-detail-title">${escHtml(data.title || "(untitled)")}</div>
    <div class="post-detail-meta">
      <span>${escHtml(data.authorName || "Anonymous")}</span>
      <span>·</span>
      <span>${formatDate(data.publishAt ?? data.createdAt)}</span>
    </div>
    <div class="post-detail-body rich-content" id="detail-body-${id}"></div>
    ${_attachmentsHTML(data.attachments)}
    ${canDelete ? `<div class="post-detail-actions"><button type="button" class="btn btn-primary btn-sm" id="blog-edit-${id}">Edit</button><button type="button" class="btn btn-danger btn-sm" id="blog-delete-${id}">Delete Post</button></div>` : ""}
  `;

  const bodyEl = document.getElementById(`detail-body-${id}`);
  bodyEl.innerHTML = renderBody(data.body);
  highlightContent(bodyEl);

  document.getElementById("back-btn").addEventListener("click", () => { location.hash = ""; });

  if (canDelete) {
    document.getElementById(`blog-edit-${id}`).addEventListener("click", () => _startEdit(id));
    document.getElementById(`blog-delete-${id}`).addEventListener("click", async () => {
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

  const form      = document.getElementById("blog-post-form");
  const toggleBtn = document.getElementById("blog-toggle-btn");
  location.hash = "";
  if (form)      form.style.display      = "";
  if (toggleBtn) toggleBtn.textContent   = "✕ Cancel";

  const titleInput = document.getElementById("blog-title");
  if (titleInput) titleInput.value = data.title || "";
  if (_quill) _quill.clipboard.dangerouslyPasteHTML(data.body || "");
  if (_thumbZone) _thumbZone.setThumbUrl(data.thumbnailUrl || null);

  const paInput = document.getElementById("blog-publish-at");
  if (paInput && data.publishAt) {
    const d = new Date(data.publishAt.seconds * 1000);
    d.setSeconds(0, 0);
    paInput.value = d.toISOString().slice(0, 16);
  }

  const submitBtn = document.querySelector("#blog-form [type=submit]");
  if (submitBtn) submitBtn.textContent = "Update Post";
  form?.scrollIntoView({ behavior: "smooth", block: "start" });
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

export async function initBlogPage(role) {
  _userRole = role;
  window.addEventListener("hashchange", _handleHash);

  const rows = document.getElementById("blog-rows");
  if (rows) rows.innerHTML = `<div class="spinner"><div class="spinner-ring"></div></div>`;

  try {
    const snap = await getDocs(collection(db, COLLECTION));
    _posts.clear();
    snap.docs.forEach(d => _posts.set(d.id, d.data()));
  } catch (err) {
    if (rows) rows.innerHTML = `<p style="color:var(--danger)">Error loading blog: ${escHtml(err.message)}</p>`;
    return;
  }

  _handleHash();

  const listHeader = document.getElementById("blog-list-header");
  if (listHeader && hasRole(role, "moderator")) listHeader.style.display = "";

  if (hasRole(role, "moderator")) {
    try {
      _quill      = initEditor("blog-toolbar", "blog-editor", "blog");
      _thumbZone  = initThumbnailZone("blog-thumb", "blog-thumb-preview", "blog");
      _attachZone = initAttachmentZone("blog-attach-input", "blog-attach-list", "blog");
      initPreview("blog-preview-btn", "blog-preview-panel", () => ({
        title:    document.getElementById("blog-title")?.value.trim() || "",
        thread:   "",
        body:     _quill ? getEditorHTML(_quill) : "",
        thumbUrl: _thumbZone?.getThumbUrl() || null,
      }));
    } catch (e) {
      console.warn("Blog editor init failed:", e);
    }

    // Set publishAt default to now
    const pa = document.getElementById("blog-publish-at");
    if (pa) { const n = new Date(); n.setSeconds(0, 0); pa.value = n.toISOString().slice(0, 16); }

    // Toggle form
    const toggleBtn = document.getElementById("blog-toggle-btn");
    const form      = document.getElementById("blog-post-form");

    function _resetFormState() {
      _editId = null;
      if (_quill) _quill.setContents([]);
      if (_thumbZone) _thumbZone.reset();
      const sb = document.querySelector("#blog-form [type=submit]");
      if (sb) sb.textContent = "Publish";
    }

    if (toggleBtn && form) {
      toggleBtn.addEventListener("click", () => {
        const hidden = form.style.display === "none" || form.style.display === "";
        form.style.display    = hidden ? "" : "none";
        toggleBtn.textContent = hidden ? "✕ Cancel" : "+ New Post";
        if (!hidden) _resetFormState();
      });
    }
    const cancelBtn = document.getElementById("blog-cancel-btn");
    if (cancelBtn && form) {
      cancelBtn.addEventListener("click", () => {
        form.style.display = "none";
        const tb = document.getElementById("blog-toggle-btn");
        if (tb) tb.textContent = "+ New Post";
        _resetFormState();
      });
    }
  }

  _handleHash();
}

export async function submitBlog() {
  const titleInput = document.getElementById("blog-title");
  const submitBtn  = document.querySelector("#blog-form [type=submit]");
  const errorEl    = document.getElementById("blog-form-error");
  const role       = getCurrentRole();
  const user       = getCurrentUser();

  if (!hasRole(role, "moderator")) {
    showToast("Only moderators and admins can post on the blog.", "error"); return;
  }

  const title  = titleInput.value.trim();
  const body   = _quill ? getEditorHTML(_quill) : "";
  const editId = _editId;

  if (!title) {
    if (errorEl) { errorEl.textContent = "Title is required."; errorEl.classList.add("visible"); }
    return;
  }

  if (errorEl) errorEl.classList.remove("visible");
  submitBtn.disabled    = true;
  submitBtn.textContent = editId ? "Updating…" : "Publishing…";

  const form      = document.getElementById("blog-post-form");
  const toggleBtn = document.getElementById("blog-toggle-btn");
  const paInput   = document.getElementById("blog-publish-at");

  function _closeForm() {
    titleInput.value = "";
    if (_quill) _quill.setContents([]);
    if (_thumbZone) _thumbZone.reset();
    if (_attachZone) _attachZone.reset();
    if (paInput) { const n = new Date(); n.setSeconds(0, 0); paInput.value = n.toISOString().slice(0, 16); }
    if (form)      form.style.display      = "none";
    if (toggleBtn) toggleBtn.textContent   = "+ New Post";
    _editId = null;
  }

  try {
    if (editId) {
      // Update existing post (preserve attachments, author, createdAt)
      const publishAt = paInput?.value
        ? Timestamp.fromDate(new Date(paInput.value))
        : _posts.get(editId)?.publishAt ?? Timestamp.fromDate(new Date());

      const changes = {
        title,
        body,
        thumbnailUrl: _thumbZone?.getThumbUrl() || null,
        publishAt,
      };
      await updateDoc(doc(db, COLLECTION, editId), changes);
      _posts.set(editId, { ..._posts.get(editId), ...changes });
      _closeForm();
      showToast("Post updated!", "success");
      location.hash = editId;
    } else {
      const publishAt = paInput?.value
        ? Timestamp.fromDate(new Date(paInput.value))
        : Timestamp.fromDate(new Date());

      const postData = {
        title,
        body,
        thumbnailUrl: _thumbZone?.getThumbUrl() || null,
        attachments:  _attachZone?.getAttachments() || [],
        authorUid:    user.uid,
        authorName:   user.displayName || user.email,
        publishAt,
        createdAt:    serverTimestamp(),
      };

      const newDoc = await addDoc(collection(db, COLLECTION), postData);
      _posts.set(newDoc.id, { ...postData, createdAt: { seconds: Date.now() / 1000 } });
      _closeForm();
      showToast("Post published!", "success");
      _showList();
    }
  } catch (err) {
    showToast(`Failed to ${editId ? "update" : "publish"}: ` + err.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = editId ? "Update Post" : "Publish";
  }
}
