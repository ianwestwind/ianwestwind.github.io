// ============================================================
// WINN Platforms — blog.js
// Blog posts (regular+ can post); thumbnail cards + scheduling
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  query, orderBy, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getCurrentUser, getCurrentRole, hasRole, escHtml, showToast, formatDate
} from "./auth.js";
import {
  initEditor, getEditorHTML, initThumbnailZone, initAttachmentZone, renderBody
} from "./editor.js";

const COLLECTION = "blog_posts";
const _posts = new Map();
let _quill      = null;
let _thumbZone  = null;
let _attachZone = null;
let _userRole   = "guest";

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
    rows.innerHTML = `<div class="empty-state"><div class="empty-icon">✍️</div><p>No blog posts yet. Be the first!</p></div>`;
    return;
  }

  rows.innerHTML = visible.map(([id, data]) => {
    const isPub = _isPublished(data);
    const badge = (!isPub && isMod) ? `<span class="scheduled-badge">Scheduled</span>` : "";
    const thumb = data.thumbnailUrl
      ? `<img src="${escHtml(data.thumbnailUrl)}" alt="" class="pub-card-thumb" />`
      : `<div class="pub-card-thumb pub-card-thumb-placeholder">✍️</div>`;
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
  const canDelete = hasRole(role, "moderator") || (user && user.uid === data.authorUid);
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
    ${canDelete ? `<div class="post-detail-actions"><button class="btn btn-danger btn-sm" id="detail-delete-btn">Delete Post</button></div>` : ""}
  `;

  document.getElementById(`detail-body-${id}`).innerHTML = renderBody(data.body);

  document.getElementById("back-btn").addEventListener("click", () => { location.hash = ""; });

  if (canDelete) {
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

  const listHeader = document.getElementById("blog-list-header");
  if (listHeader && hasRole(role, "regular")) listHeader.style.display = "";

  if (hasRole(role, "regular")) {
    _quill      = initEditor("blog-toolbar", "blog-editor", "blog");
    _thumbZone  = initThumbnailZone("blog-thumb", "blog-thumb-preview", "blog");
    _attachZone = initAttachmentZone("blog-attach-input", "blog-attach-list", "blog");

    // Set publishAt default to now
    const pa = document.getElementById("blog-publish-at");
    if (pa) { const n = new Date(); n.setSeconds(0, 0); pa.value = n.toISOString().slice(0, 16); }

    // Toggle form
    const toggleBtn = document.getElementById("blog-toggle-btn");
    const form      = document.getElementById("blog-post-form");
    if (toggleBtn && form) {
      toggleBtn.addEventListener("click", () => {
        const hidden = form.style.display === "none" || form.style.display === "";
        form.style.display    = hidden ? "" : "none";
        toggleBtn.textContent = hidden ? "✕ Cancel" : "+ New Post";
      });
    }
    const cancelBtn = document.getElementById("blog-cancel-btn");
    if (cancelBtn && form) {
      cancelBtn.addEventListener("click", () => {
        form.style.display = "none";
        const tb = document.getElementById("blog-toggle-btn");
        if (tb) tb.textContent = "+ New Post";
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

  if (!hasRole(role, "regular")) {
    showToast("You must be signed in to post.", "error"); return;
  }

  const title = titleInput.value.trim();
  const body  = _quill ? getEditorHTML(_quill) : "";

  if (!title) {
    if (errorEl) { errorEl.textContent = "Title is required."; errorEl.classList.add("visible"); }
    return;
  }

  if (errorEl) errorEl.classList.remove("visible");
  submitBtn.disabled    = true;
  submitBtn.textContent = "Publishing…";

  try {
    const paInput = document.getElementById("blog-publish-at");
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

    // Reset
    titleInput.value = "";
    if (_quill) _quill.setContents([]);
    if (_thumbZone) _thumbZone.reset();
    if (_attachZone) _attachZone.reset();
    if (paInput) { const n = new Date(); n.setSeconds(0, 0); paInput.value = n.toISOString().slice(0, 16); }

    document.getElementById("blog-post-form").style.display = "none";
    const tb = document.getElementById("blog-toggle-btn");
    if (tb) tb.textContent = "+ New Post";

    showToast("Blog post published!", "success");
    _showList();
  } catch (err) {
    showToast("Failed to publish: " + err.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Publish";
  }
}
