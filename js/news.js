// ============================================================
// WINN Platforms — news.js
// News posts (moderator/admin only); simple list + scheduling
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

function _snippet(html, max = 130) {
  if (!html) return "";
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) + "…" : text;
}

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

function _showList() {
  document.getElementById("list-view").style.display   = "";
  document.getElementById("detail-view").style.display = "none";

  const rows  = document.getElementById("news-rows");
  if (!rows) return;

  const isMod   = hasRole(_userRole, "moderator");
  const visible = [..._items.entries()]
    .filter(([, d]) => isMod || _isPublished(d))
    .sort((a, b)  => _publishSec(b[1]) - _publishSec(a[1]));

  _updateCount(visible.length);

  if (visible.length === 0) {
    rows.innerHTML = `<div class="empty-state"><div class="empty-icon">📰</div><p>No news posts yet.</p></div>`;
    return;
  }

  rows.innerHTML = visible.map(([id, data]) => {
    const isPub  = _isPublished(data);
    const badge  = (!isPub && isMod) ? `<span class="scheduled-badge">Scheduled</span>` : "";
    const likes  = data.likeCount > 0 ? `<span class="news-row-likes">❤️ ${data.likeCount}</span>` : "";
    return `
      <div class="news-row" data-id="${escHtml(id)}" role="button" tabindex="0">
        <div class="news-row-title">${escHtml(data.title || "(untitled)")} ${badge}</div>
        <div class="news-row-snippet">${escHtml(_snippet(data.body))}</div>
        <div class="news-row-meta">
          <span>${escHtml(data.authorName || "Staff")}</span>
          <span>·</span>
          <span>${formatDate(data.publishAt ?? data.createdAt)}</span>
          ${likes}
        </div>
      </div>`;
  }).join("");

  rows.querySelectorAll(".news-row").forEach(row => {
    const open = () => { location.hash = row.dataset.id; };
    row.addEventListener("click", open);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
}

function _navStripHtml(sortedPairs, currentId) {
  if (sortedPairs.length <= 1) return "";
  const ci = sortedPairs.findIndex(([id]) => id === currentId);
  if (ci === -1) return "";
  let start = Math.max(0, ci - 2);
  let end   = Math.min(sortedPairs.length - 1, ci + 2);
  if (ci - start < 2) end   = Math.min(sortedPairs.length - 1, end + (2 - (ci - start)));
  if (end - ci   < 2) start = Math.max(0, start - (2 - (end - ci)));
  return `<div class="post-nav-strip">${
    sortedPairs.slice(start, end + 1).map(([id, data]) => {
      const isCurrent = id === currentId;
      const title = escHtml((data.title || "(untitled)").slice(0, 45));
      return isCurrent
        ? `<div class="post-nav-item post-nav-current"><span class="post-nav-title">${title}</span></div>`
        : `<div class="post-nav-item" role="button" tabindex="0" data-nav-id="${escHtml(id)}"><span class="post-nav-title">${title}</span></div>`;
    }).join("")
  }</div>`;
}

function _showDetail(id) {
  const data = _items.get(id);
  if (!data) { location.hash = ""; return; }

  document.getElementById("list-view").style.display   = "none";
  document.getElementById("detail-view").style.display = "";

  const role      = getCurrentRole();
  const user      = getCurrentUser();
  const canDelete = hasRole(role, "admin") || hasRole(role, "moderator") || (user && user.uid === data.authorUid);
  const isMod     = hasRole(role, "moderator");
  const scheduled = !_isPublished(data) && isMod;

  const sortedPairs = [..._items.entries()]
    .filter(([, d]) => isMod || _isPublished(d))
    .sort((a, b) => _publishSec(b[1]) - _publishSec(a[1]));

  const likedKey  = `winnews_liked_${id}`;
  const isLiked   = localStorage.getItem(likedKey) === "1";
  const likeCount = data.likeCount || 0;

  const detailView = document.getElementById("detail-view");
  detailView.innerHTML = `
    <div class="post-detail-header">
      <button class="back-btn" id="back-btn">← Back</button>
      ${scheduled ? '<span class="scheduled-badge" style="margin-left:.5rem">Scheduled</span>' : ""}
    </div>
    <div class="post-detail-title">${escHtml(data.title || "(untitled)")}</div>
    <div class="post-detail-meta">
      <span>${escHtml(data.authorName || "Staff")}</span>
      <span>·</span>
      <span>${formatDate(data.publishAt ?? data.createdAt)}</span>
    </div>
    <div class="post-detail-body rich-content" id="detail-body-${id}"></div>
    ${_attachmentsHTML(data.attachments)}
    <div class="news-like-row">
      <button class="news-like-btn${isLiked ? " is-liked" : ""}" id="news-like-btn-${id}">
        ❤️ <span id="news-like-count-${id}">${likeCount}</span>
      </button>
    </div>
    ${canDelete ? `<div class="post-detail-actions"><button type="button" class="btn btn-primary btn-sm" id="news-edit-${id}">Edit</button><button type="button" class="btn btn-danger btn-sm" id="news-delete-${id}">Delete Post</button></div>` : ""}
    ${_navStripHtml(sortedPairs, id)}
  `;

  const bodyEl = document.getElementById(`detail-body-${id}`);
  bodyEl.innerHTML = renderBody(data.body);
  highlightContent(bodyEl);

  document.getElementById("back-btn").addEventListener("click", () => { location.hash = ""; });

  detailView.querySelectorAll(".post-nav-item[data-nav-id]").forEach(item => {
    const nav = () => { location.hash = item.dataset.navId; };
    item.addEventListener("click", nav);
    item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nav(); } });
  });

  const likeBtn = document.getElementById(`news-like-btn-${id}`);
  const countEl = document.getElementById(`news-like-count-${id}`);
  likeBtn.addEventListener("click", async () => {
    const wasLiked = likeBtn.classList.contains("is-liked");
    const delta    = wasLiked ? -1 : 1;
    const oldCount = parseInt(countEl.textContent) || 0;
    const newCount = Math.max(0, oldCount + delta);

    // Optimistic update
    likeBtn.classList.toggle("is-liked");
    countEl.textContent = newCount;
    if (wasLiked) localStorage.removeItem(likedKey);
    else          localStorage.setItem(likedKey, "1");

    try {
      await updateDoc(doc(db, COLLECTION, id), { likeCount: increment(delta) });
      _items.set(id, { ..._items.get(id), likeCount: newCount });
    } catch {
      // Revert on failure
      likeBtn.classList.toggle("is-liked");
      countEl.textContent = oldCount;
      if (wasLiked) localStorage.setItem(likedKey, "1");
      else          localStorage.removeItem(likedKey);
    }
  });

  if (canDelete) {
    document.getElementById(`news-edit-${id}`).addEventListener("click", () => _startEdit(id));
    document.getElementById(`news-delete-${id}`).addEventListener("click", async () => {
      if (!confirm("Delete this post?")) return;
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        _items.delete(id);
        showToast("Post deleted.", "info");
        location.hash = "";
      } catch (err) { showToast("Delete failed: " + err.message, "error"); }
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
  if (id && _items.has(id)) _showDetail(id);
  else _showList();
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

    // Set publishAt default to now
    const pa = document.getElementById("news-publish-at");
    if (pa) { const n = new Date(); n.setSeconds(0, 0); pa.value = n.toISOString().slice(0, 16); }

    // Toggle form
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
      // Update existing post (preserve attachments, author, createdAt, likeCount)
      const publishAt = paInput?.value
        ? Timestamp.fromDate(new Date(paInput.value))
        : _items.get(editId)?.publishAt ?? Timestamp.fromDate(new Date());

      const changes = {
        title,
        body,
        thumbnailUrl: _thumbZone?.getThumbUrl() || null,
        publishAt,
      };
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
      _showList();
    }
  } catch (err) {
    showToast(`Failed to ${editId ? "update" : "publish"}: ` + err.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = editId ? "Update Post" : "Publish";
  }
}
