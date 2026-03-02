// ============================================================
// WINN Platforms — news.js
// News posts (moderator/admin only); scrollable full-content feed
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc, updateDoc,
  serverTimestamp, Timestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getCurrentUser, getCurrentRole, hasRole, escHtml, showToast, formatDate
} from "./auth.js?v=3";
import {
  initEditor, getEditorHTML, initThumbnailZone, initAttachmentZone, renderBody, highlightContent, initPreview
} from "./editor.js";

const COLLECTION = "news_posts";
const _items = new Map();
let _quill      = null;
let _thumbZone  = null;
let _attachZone = null;
let _userRole   = "guest";
let _editId     = null;

function _publishSec(data) {
  return data.publishAt?.seconds ?? data.createdAt?.seconds ?? 0;
}

function _isPublished(data) {
  return _publishSec(data) <= Date.now() / 1000;
}

function _updateCount(n) {
  const el = document.getElementById("news-count");
  if (el) el.textContent = `${n} post${n !== 1 ? "s" : ""}`;
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

function _showFeed(scrollToId) {
  document.getElementById("list-view").style.display   = "";
  document.getElementById("detail-view").style.display = "none";

  const rows = document.getElementById("news-rows");
  if (!rows) return;

  const isMod = hasRole(_userRole, "moderator");
  const role  = getCurrentRole();
  const user  = getCurrentUser();

  const visible = [..._items.entries()]
    .filter(([, d]) => isMod || _isPublished(d))
    .sort((a, b) => _publishSec(b[1]) - _publishSec(a[1]));

  _updateCount(visible.length);

  if (visible.length === 0) {
    rows.innerHTML = `<div class="empty-state"><div class="empty-icon">📰</div><p>No news posts yet.</p></div>`;
    return;
  }

  rows.innerHTML = visible.map(([id, data]) => {
    const isPub     = _isPublished(data);
    const badge     = (!isPub && isMod) ? `<span class="scheduled-badge">Scheduled</span>` : "";
    const canDelete = hasRole(role, "admin") || hasRole(role, "moderator") || (user && user.uid === data.authorUid);
    const likedKey  = `winnews_liked_${id}`;
    const isLiked   = localStorage.getItem(likedKey) === "1";
    const likeCount = data.likeCount || 0;

    return `
      <article class="news-article" id="news-article-${escHtml(id)}">
        <div class="news-article-title">${escHtml(data.title || "(untitled)")} ${badge}</div>
        <div class="news-article-meta">
          <span>${escHtml(data.authorName || "Staff")}</span>
          <span>·</span>
          <span>${formatDate(data.publishAt ?? data.createdAt)}</span>
        </div>
        <div class="post-detail-body rich-content" id="news-body-${escHtml(id)}"></div>
        ${_attachmentsHTML(data.attachments)}
        <div class="news-article-footer">
          <button class="news-like-btn${isLiked ? " is-liked" : ""}" data-like-id="${escHtml(id)}">
            ❤️ <span class="news-like-count">${likeCount}</span>
          </button>
          ${canDelete ? `
            <div class="post-detail-actions" style="margin:0">
              <button type="button" class="btn btn-primary btn-sm" data-edit-id="${escHtml(id)}">Edit</button>
              <button type="button" class="btn btn-danger btn-sm" data-delete-id="${escHtml(id)}">Delete</button>
            </div>` : ""}
        </div>
      </article>`;
  }).join("");

  // Render rich body content after DOM is ready
  visible.forEach(([id, data]) => {
    const bodyEl = document.getElementById(`news-body-${id}`);
    if (bodyEl) {
      bodyEl.innerHTML = renderBody(data.body);
      highlightContent(bodyEl);
    }
  });

  // Like handlers
  rows.querySelectorAll(".news-like-btn[data-like-id]").forEach(btn => {
    const id       = btn.dataset.likeId;
    const likedKey = `winnews_liked_${id}`;
    btn.addEventListener("click", async () => {
      const wasLiked = btn.classList.contains("is-liked");
      const delta    = wasLiked ? -1 : 1;
      const countEl  = btn.querySelector(".news-like-count");
      const oldCount = parseInt(countEl.textContent) || 0;
      const newCount = Math.max(0, oldCount + delta);

      btn.classList.toggle("is-liked");
      countEl.textContent = newCount;
      if (wasLiked) localStorage.removeItem(likedKey);
      else          localStorage.setItem(likedKey, "1");

      try {
        await updateDoc(doc(db, COLLECTION, id), { likeCount: increment(delta) });
        _items.set(id, { ..._items.get(id), likeCount: newCount });
      } catch {
        btn.classList.toggle("is-liked");
        countEl.textContent = oldCount;
        if (wasLiked) localStorage.setItem(likedKey, "1");
        else          localStorage.removeItem(likedKey);
      }
    });
  });

  // Edit handlers
  rows.querySelectorAll("[data-edit-id]").forEach(btn => {
    btn.addEventListener("click", () => _startEdit(btn.dataset.editId));
  });

  // Delete handlers
  rows.querySelectorAll("[data-delete-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.deleteId;
      if (!confirm("Delete this post?")) return;
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        _items.delete(id);
        showToast("Post deleted.", "info");
        location.hash = "";
        _showFeed();
      } catch (err) { showToast("Delete failed: " + err.message, "error"); }
    });
  });

  // Scroll to target post if specified
  if (scrollToId) {
    requestAnimationFrame(() => {
      const el = document.getElementById(`news-article-${scrollToId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function _startEdit(id) {
  const data = _items.get(id);
  if (!data) return;
  _editId = id;

  const form      = document.getElementById("news-post-form");
  const toggleBtn = document.getElementById("news-toggle-btn");
  location.hash = "";
  if (form)      form.style.display      = "";
  if (toggleBtn) toggleBtn.textContent   = "✕ Cancel";

  const titleInput = document.getElementById("news-title");
  if (titleInput) titleInput.value = data.title || "";
  if (_quill) _quill.clipboard.dangerouslyPasteHTML(data.body || "");
  if (_thumbZone) _thumbZone.setThumbUrl(data.thumbnailUrl || null);

  const paInput = document.getElementById("news-publish-at");
  if (paInput && data.publishAt) {
    const d = new Date(data.publishAt.seconds * 1000);
    d.setSeconds(0, 0);
    paInput.value = d.toISOString().slice(0, 16);
  }

  const submitBtn = document.querySelector("#news-form [type=submit]");
  if (submitBtn) submitBtn.textContent = "Update Post";
  form?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function _handleHash() {
  const id = location.hash.slice(1);
  _showFeed(id && _items.has(id) ? id : null);
}

export async function initNewsPage(role) {
  _userRole = role;
  window.addEventListener("hashchange", _handleHash);

  const rows = document.getElementById("news-rows");
  if (rows) rows.innerHTML = `<div class="spinner"><div class="spinner-ring"></div></div>`;

  try {
    const snap = await getDocs(collection(db, COLLECTION));
    _items.clear();
    snap.docs.forEach(d => _items.set(d.id, d.data()));
  } catch (err) {
    if (rows) rows.innerHTML = `<p style="color:var(--danger)">Error loading news: ${escHtml(err.message)}</p>`;
    return;
  }

  _handleHash();

  if (hasRole(role, "moderator")) {
    try {
      _quill      = initEditor("news-toolbar", "news-editor", "news");
      _thumbZone  = initThumbnailZone("news-thumb", "news-thumb-preview", "news");
      _attachZone = initAttachmentZone("news-attach-input", "news-attach-list", "news");
      initPreview("news-preview-btn", "news-preview-panel", () => ({
        title:    document.getElementById("news-title")?.value.trim() || "",
        thread:   "",
        body:     _quill ? getEditorHTML(_quill) : "",
        thumbUrl: _thumbZone?.getThumbUrl() || null,
      }));
    } catch (e) {
      console.warn("News editor init failed:", e);
    }

    const pa = document.getElementById("news-publish-at");
    if (pa) { const n = new Date(); n.setSeconds(0, 0); pa.value = n.toISOString().slice(0, 16); }

    const toggleBtn = document.getElementById("news-toggle-btn");
    const form      = document.getElementById("news-post-form");

    function _resetFormState() {
      _editId = null;
      if (_quill) _quill.setContents([]);
      if (_thumbZone) _thumbZone.reset();
      const sb = document.querySelector("#news-form [type=submit]");
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
    const cancelBtn = document.getElementById("news-cancel-btn");
    if (cancelBtn && form) {
      cancelBtn.addEventListener("click", () => {
        form.style.display = "none";
        const tb = document.getElementById("news-toggle-btn");
        if (tb) tb.textContent = "+ New Post";
        _resetFormState();
      });
    }
  }

  _handleHash();
}

export async function submitNews() {
  const titleInput = document.getElementById("news-title");
  const submitBtn  = document.querySelector("#news-form [type=submit]");
  const errorEl    = document.getElementById("news-form-error");
  const role       = getCurrentRole();
  const user       = getCurrentUser();

  if (!hasRole(role, "moderator")) {
    showToast("Only moderators and admins can post news.", "error"); return;
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

  const form      = document.getElementById("news-post-form");
  const toggleBtn = document.getElementById("news-toggle-btn");
  const paInput   = document.getElementById("news-publish-at");

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
      const publishAt = paInput?.value
        ? Timestamp.fromDate(new Date(paInput.value))
        : _items.get(editId)?.publishAt ?? Timestamp.fromDate(new Date());

      const changes = { title, body, thumbnailUrl: _thumbZone?.getThumbUrl() || null, publishAt };
      await updateDoc(doc(db, COLLECTION, editId), changes);
      _items.set(editId, { ..._items.get(editId), ...changes });
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
        likeCount:    0,
      };

      const newDoc = await addDoc(collection(db, COLLECTION), postData);
      _items.set(newDoc.id, { ...postData, createdAt: { seconds: Date.now() / 1000 } });
      _closeForm();
      showToast("News published!", "success");
      _showFeed();
    }
  } catch (err) {
    showToast(`Failed to ${editId ? "update" : "publish"}: ` + err.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = editId ? "Update Post" : "Publish";
  }
}
