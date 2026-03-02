// ============================================================
// WINN Platforms — writing.js
// Writing posts (moderator+ can post); thumbnail cards + scheduling
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc, updateDoc,
  query, orderBy, serverTimestamp, Timestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getCurrentUser, getCurrentRole, hasRole, escHtml, showToast, formatDate
} from "./auth.js?v=3";
import {
  initEditor, getEditorHTML, initThumbnailZone, initAttachmentZone, renderBody, highlightContent, initPreview
} from "./editor.js";

const COLLECTION = "writing_posts";
const _posts = new Map();
let _quill       = null;
let _thumbZone   = null;
let _attachZone  = null;
let _userRole    = "guest";
let _editId      = null;
let _navOffset   = 0;   // current page offset for the nav strip
let _initialized = false;

function _toLocalDateTimeInput(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
  const el = document.getElementById("writing-count");
  if (el) el.textContent = `${n} post${n !== 1 ? "s" : ""}`;
}

function _showList() {
  document.getElementById("list-view").style.display   = "";
  document.getElementById("detail-view").style.display = "none";

  const rows  = document.getElementById("writing-rows");
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

function _renderNavStrip(container, sortedPairs, currentId, autoAdjust = true) {
  const PAGE  = 5;
  const total = sortedPairs.length;
  if (total <= 1) { container.innerHTML = ""; return; }

  if (autoAdjust) {
    const ci = sortedPairs.findIndex(([id]) => id === currentId);
    if (ci >= 0 && (ci < _navOffset || ci >= _navOffset + PAGE)) {
      _navOffset = Math.floor(ci / PAGE) * PAGE;
    }
  }
  _navOffset = Math.max(0, Math.min(_navOffset, Math.floor((total - 1) / PAGE) * PAGE));

  const start      = _navOffset;
  const end        = Math.min(start + PAGE, total);
  const slice      = sortedPairs.slice(start, end);
  const hasPrev    = start > 0;
  const hasNext    = end < total;
  const totalPages = Math.ceil(total / PAGE);
  const curPage    = Math.floor(start / PAGE);

  const pageNums = Array.from({ length: totalPages }, (_, i) =>
    `<button class="post-nav-page${i === curPage ? " post-nav-page-active" : ""}" data-page="${i}">${i + 1}</button>`
  ).join("");

  container.innerHTML = `
    <div class="post-nav-strip">
      ${slice.map(([id, data]) => {
        const isCurrent = id === currentId;
        const title = escHtml((data.title || "(untitled)").slice(0, 60));
        return isCurrent
          ? `<div class="post-nav-item post-nav-current"><span class="post-nav-title">${title}</span></div>`
          : `<div class="post-nav-item" role="button" tabindex="0" data-nav-id="${escHtml(id)}"><span class="post-nav-title">${title}</span></div>`;
      }).join("")}
    </div>
    ${totalPages > 1 ? `
      <div class="post-nav-controls">
        <button class="btn btn-ghost btn-sm post-nav-prev"${hasPrev ? "" : " disabled"}>◀ Prev</button>
        <div class="post-nav-pages">${pageNums}</div>
        <button class="btn btn-ghost btn-sm post-nav-next"${hasNext ? "" : " disabled"}>Next ▶</button>
      </div>
    ` : ""}
  `;

  container.querySelectorAll(".post-nav-item[data-nav-id]").forEach(item => {
    const nav = () => { location.hash = item.dataset.navId; };
    item.addEventListener("click", nav);
    item.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); nav(); } });
  });

  container.querySelector(".post-nav-prev")?.addEventListener("click", () => {
    _navOffset = Math.max(0, _navOffset - PAGE);
    _renderNavStrip(container, sortedPairs, currentId, false);
  });

  container.querySelector(".post-nav-next")?.addEventListener("click", () => {
    _navOffset = Math.min(Math.floor((total - 1) / PAGE) * PAGE, _navOffset + PAGE);
    _renderNavStrip(container, sortedPairs, currentId, false);
  });

  container.querySelectorAll(".post-nav-page[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      _navOffset = parseInt(btn.dataset.page) * PAGE;
      _renderNavStrip(container, sortedPairs, currentId, false);
    });
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
  const canDelete = hasRole(role, "admin") || hasRole(role, "moderator") || isAuthor;
  const isMod     = hasRole(role, "moderator");
  const scheduled = !_isPublished(data) && isMod;

  const sortedPairs = [..._posts.entries()]
    .filter(([, d]) => isMod || _isPublished(d))
    .sort((a, b) => _publishSec(b[1]) - _publishSec(a[1]));

  const likedKey  = `winwriting_liked_${id}`;
  const isLiked   = localStorage.getItem(likedKey) === "1";
  const likeCount = data.likeCount || 0;

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
    <div class="news-article-footer" style="margin-top:1rem">
      <button class="writing-like-btn${isLiked ? " is-liked" : ""}" id="writing-like-btn-${escHtml(id)}">
        ❤️ <span id="writing-like-count-${escHtml(id)}">${likeCount}</span>
      </button>
    </div>
    ${canDelete ? `<div class="post-detail-actions"><button type="button" class="btn btn-primary btn-sm" id="writing-edit-${id}">Edit</button><button type="button" class="btn btn-danger btn-sm" id="writing-delete-${id}">Delete Post</button></div>` : ""}
    <div id="writing-nav-container-${escHtml(id)}"></div>
    <div id="writing-comments-${id}" class="comments-section"></div>
  `;

  const bodyEl = document.getElementById(`detail-body-${id}`);
  bodyEl.innerHTML = renderBody(data.body);
  highlightContent(bodyEl);

  document.getElementById("back-btn").addEventListener("click", () => { location.hash = ""; });

  const likeBtn = document.getElementById(`writing-like-btn-${id}`);
  if (likeBtn) {
    likeBtn.addEventListener("click", async () => {
      const wasLiked = likeBtn.classList.contains("is-liked");
      const delta    = wasLiked ? -1 : 1;
      const countEl  = document.getElementById(`writing-like-count-${id}`);
      const oldCount = parseInt(countEl.textContent) || 0;
      const newCount = Math.max(0, oldCount + delta);

      likeBtn.classList.toggle("is-liked");
      countEl.textContent = newCount;
      if (wasLiked) localStorage.removeItem(likedKey);
      else          localStorage.setItem(likedKey, "1");

      try {
        await updateDoc(doc(db, COLLECTION, id), { likeCount: increment(delta) });
        _posts.set(id, { ..._posts.get(id), likeCount: newCount });
      } catch {
        likeBtn.classList.toggle("is-liked");
        countEl.textContent = oldCount;
        if (wasLiked) localStorage.setItem(likedKey, "1");
        else          localStorage.removeItem(likedKey);
      }
    });
  }

  _renderNavStrip(document.getElementById(`writing-nav-container-${id}`), sortedPairs, id);

  _loadAndRenderComments(id);

  if (canDelete) {
    document.getElementById(`writing-edit-${id}`).addEventListener("click", () => _startEdit(id));
    document.getElementById(`writing-delete-${id}`).addEventListener("click", async () => {
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

async function _loadAndRenderComments(postId) {
  const section = document.getElementById(`writing-comments-${postId}`);
  if (!section) return;

  const role = getCurrentRole();
  const user = getCurrentUser();
  const canComment = hasRole(role, "regular");

  let comments = [];
  try {
    const q = query(
      collection(db, COLLECTION, postId, "comments"),
      orderBy("createdAt", "asc")
    );
    const snap = await getDocs(q);
    comments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Comments load error:", err);
    section.innerHTML = `<p style="color:var(--danger)">Error loading comments: ${escHtml(err.message)}</p>`;
    return;
  }

  const topLevel = comments.filter(c => !c.parentId);
  const repliesByParent = {};
  comments.filter(c => c.parentId).forEach(r => {
    (repliesByParent[r.parentId] ??= []).push(r);
  });

  const visibleCount = comments.filter(c => !c.deleted).length;

  section.innerHTML = `
    <div class="comments-header">Comments (${visibleCount})</div>
    <div id="writing-comments-list-${postId}"></div>
    ${canComment ? `
      <div class="comment-form">
        <textarea id="writing-new-comment-${postId}" class="comment-textarea" placeholder="Add a comment…" rows="3"></textarea>
        <div class="comment-form-actions">
          <button class="btn btn-primary btn-sm" id="writing-submit-comment-${postId}">Post Comment</button>
        </div>
      </div>
    ` : ""}
  `;

  _renderCommentsList(postId, topLevel, repliesByParent, canComment, user, role);

  if (canComment) {
    document.getElementById(`writing-submit-comment-${postId}`)?.addEventListener("click", async () => {
      const ta = document.getElementById(`writing-new-comment-${postId}`);
      const body = ta?.value.trim();
      if (!body) return;
      const btn = document.getElementById(`writing-submit-comment-${postId}`);
      btn.disabled = true;
      await _submitComment(postId, body, null);
      if (ta) ta.value = "";
      btn.disabled = false;
    });
  }
}

function _renderCommentsList(postId, topLevel, repliesByParent, canComment, user, role) {
  const list = document.getElementById(`writing-comments-list-${postId}`);
  if (!list) return;

  if (topLevel.length === 0) {
    list.innerHTML = `<p class="comments-empty">No comments yet. Be the first!</p>`;
  } else {
    list.innerHTML = topLevel.map(c => {
      const replies = repliesByParent[c.id] || [];
      const isDeleted = c.deleted === true;
      const canDeleteC = hasRole(role, "admin") || (user && user.uid === c.authorUid);
      return `
        <div class="comment${isDeleted ? " comment-is-deleted" : ""}" data-id="${escHtml(c.id)}">
          ${isDeleted ? `<div class="comment-deleted-msg">[comment deleted]</div>` : `
            <div class="comment-meta">
              <span class="comment-author">${escHtml(c.authorName || "Anonymous")}</span>
              <span class="comment-date">· ${formatDate(c.createdAt)}</span>
            </div>
            <div class="comment-body">${escHtml(c.body || "")}</div>
            <div class="comment-actions">
              ${canComment ? `<button class="btn btn-ghost btn-sm reply-btn" data-comment-id="${escHtml(c.id)}">Reply</button>` : ""}
              ${canDeleteC ? `<button class="btn btn-ghost btn-sm delete-comment-btn" data-comment-id="${escHtml(c.id)}" data-has-replies="${replies.length > 0}">Delete</button>` : ""}
            </div>
          `}
          <div class="comment-replies">
            ${replies.map(r => {
              const isDeletedR = r.deleted === true;
              const canDeleteR = hasRole(role, "admin") || (user && user.uid === r.authorUid);
              return `
                <div class="comment comment-reply${isDeletedR ? " comment-is-deleted" : ""}">
                  ${isDeletedR ? `<div class="comment-deleted-msg">[comment deleted]</div>` : `
                    <div class="comment-meta">
                      <span class="comment-author">${escHtml(r.authorName || "Anonymous")}</span>
                      <span class="comment-date">· ${formatDate(r.createdAt)}</span>
                    </div>
                    <div class="comment-body">${escHtml(r.body || "")}</div>
                    <div class="comment-actions">
                      ${canComment ? `<button class="btn btn-ghost btn-sm reply-to-reply-btn" data-parent-id="${escHtml(c.id)}" data-reply-to="${escHtml(r.authorName || "Anonymous")}">Reply</button>` : ""}
                      ${canDeleteR ? `<button class="btn btn-ghost btn-sm delete-comment-btn" data-comment-id="${escHtml(r.id)}" data-has-replies="false">Delete</button>` : ""}
                    </div>
                  `}
                </div>`;
            }).join("")}
          </div>
          ${canComment && !isDeleted ? `
            <div class="reply-form" id="writing-reply-form-${escHtml(c.id)}" style="display:none">
              <textarea class="comment-textarea" placeholder="Write a reply…" rows="2"></textarea>
              <div class="comment-form-actions">
                <button class="btn btn-primary btn-sm submit-reply-btn" data-comment-id="${escHtml(c.id)}">Post Reply</button>
                <button class="btn btn-ghost btn-sm cancel-reply-btn" data-comment-id="${escHtml(c.id)}">Cancel</button>
              </div>
            </div>
          ` : ""}
        </div>`;
    }).join("");
  }

  if (canComment) {
    list.querySelectorAll(".reply-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const form = document.getElementById(`writing-reply-form-${btn.dataset.commentId}`);
        if (form) form.style.display = form.style.display === "none" ? "" : "none";
      });
    });
    list.querySelectorAll(".reply-to-reply-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const form = document.getElementById(`writing-reply-form-${btn.dataset.parentId}`);
        if (form) {
          form.style.display = "";
          const ta = form.querySelector("textarea");
          if (ta) { ta.value = `@${btn.dataset.replyTo} `; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
        }
      });
    });
    list.querySelectorAll(".submit-reply-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const cid = btn.dataset.commentId;
        const form = document.getElementById(`writing-reply-form-${cid}`);
        const ta = form?.querySelector("textarea");
        const body = ta?.value.trim();
        if (!body) return;
        btn.disabled = true;
        await _submitComment(postId, body, cid);
        if (ta) ta.value = "";
        if (form) form.style.display = "none";
        btn.disabled = false;
      });
    });
    list.querySelectorAll(".cancel-reply-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const form = document.getElementById(`writing-reply-form-${btn.dataset.commentId}`);
        if (form) form.style.display = "none";
      });
    });
  }

  list.querySelectorAll(".delete-comment-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      await _deleteComment(postId, btn.dataset.commentId, btn.dataset.hasReplies === "true");
    });
  });
}

async function _deleteComment(postId, commentId, hasReplies) {
  if (!confirm("Delete this comment?")) return;
  try {
    if (hasReplies) {
      await updateDoc(doc(db, COLLECTION, postId, "comments", commentId), { deleted: true });
    } else {
      await deleteDoc(doc(db, COLLECTION, postId, "comments", commentId));
    }
    showToast("Comment deleted.", "info");
    await _loadAndRenderComments(postId);
  } catch (err) {
    showToast("Failed to delete: " + err.message, "error");
  }
}

async function _submitComment(postId, body, parentId) {
  const user = getCurrentUser();
  const role = getCurrentRole();
  if (!hasRole(role, "regular") || !user) {
    showToast("You must be logged in to comment.", "error");
    return;
  }
  try {
    await addDoc(collection(db, COLLECTION, postId, "comments"), {
      body,
      authorUid:  user.uid,
      authorName: user.displayName || user.email,
      createdAt:  serverTimestamp(),
      parentId:   parentId || null,
    });
    showToast(parentId ? "Reply posted!" : "Comment posted!", "success");
    await _loadAndRenderComments(postId);
  } catch (err) {
    showToast("Failed to post: " + err.message, "error");
  }
}

function _startEdit(id) {
  const data = _posts.get(id);
  if (!data) return;
  _editId = id;

  const form      = document.getElementById("writing-post-form");
  const toggleBtn = document.getElementById("writing-toggle-btn");
  location.hash = "";
  if (form)      form.style.display      = "";
  if (toggleBtn) toggleBtn.style.display = "none";

  const titleInput = document.getElementById("writing-title");
  if (titleInput) titleInput.value = data.title || "";
  if (_quill) _quill.clipboard.dangerouslyPasteHTML(data.body || "");
  if (_thumbZone) _thumbZone.setThumbUrl(data.thumbnailUrl || null);

  const paInput = document.getElementById("writing-publish-at");
  if (paInput && data.publishAt) {
    const d = new Date(data.publishAt.seconds * 1000);
    d.setSeconds(0, 0);
    paInput.value = _toLocalDateTimeInput(d);
  }

  const submitBtn = document.querySelector("#writing-form [type=submit]");
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

export async function initWritingPage(role) {
  _userRole = role;

  // Load posts only on first call; subsequent calls (e.g. after auth) just update UI.
  if (!_initialized) {
    _initialized = true;
    window.addEventListener("hashchange", _handleHash);
    const rows = document.getElementById("writing-rows");
    if (rows) rows.innerHTML = `<div class="spinner"><div class="spinner-ring"></div></div>`;

    try {
      const snap = await getDocs(collection(db, COLLECTION));
      _posts.clear();
      snap.docs.forEach(d => _posts.set(d.id, d.data()));
    } catch (err) {
      _initialized = false; // allow retry
      if (rows) rows.innerHTML = `<p style="color:var(--danger)">Error loading posts: ${escHtml(err.message)}</p>`;
      return;
    }
  }

  _handleHash();

  const listHeader = document.getElementById("writing-list-header");
  if (listHeader) listHeader.style.display = hasRole(role, "moderator") ? "" : "none";

  if (hasRole(role, "moderator") && !_quill) {
    try {
      _quill      = initEditor("writing-toolbar", "writing-editor", "writing");
      _thumbZone  = initThumbnailZone("writing-thumb", "writing-thumb-preview", "writing");
      _attachZone = initAttachmentZone("writing-attach-input", "writing-attach-list", "writing");
      initPreview("writing-preview-btn", "writing-preview-panel", () => ({
        title:    document.getElementById("writing-title")?.value.trim() || "",
        thread:   "",
        body:     _quill ? getEditorHTML(_quill) : "",
        thumbUrl: _thumbZone?.getThumbUrl() || null,
      }));
    } catch (e) {
      console.warn("Writing editor init failed:", e);
    }

    // Set publishAt default to now
    const pa = document.getElementById("writing-publish-at");
    if (pa) { const n = new Date(); n.setSeconds(0, 0); pa.value = _toLocalDateTimeInput(n); }

    // Toggle form
    const toggleBtn = document.getElementById("writing-toggle-btn");
    const form      = document.getElementById("writing-post-form");

    function _resetFormState() {
      _editId = null;
      if (_quill) _quill.setContents([]);
      if (_thumbZone) _thumbZone.reset();
      const sb = document.querySelector("#writing-form [type=submit]");
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
    const cancelBtn = document.getElementById("writing-cancel-btn");
    if (cancelBtn && form) {
      cancelBtn.addEventListener("click", () => {
        form.style.display = "none";
        const tb = document.getElementById("writing-toggle-btn");
        if (tb) { tb.style.display = ""; tb.textContent = "+ New Post"; }
        _resetFormState();
      });
    }
  }

  _handleHash();
}

export async function submitWriting() {
  const titleInput = document.getElementById("writing-title");
  const submitBtn  = document.querySelector("#writing-form [type=submit]");
  const errorEl    = document.getElementById("writing-form-error");
  const role       = getCurrentRole();
  const user       = getCurrentUser();

  if (!hasRole(role, "moderator")) {
    showToast("Only moderators and admins can post in Writing.", "error"); return;
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

  const form      = document.getElementById("writing-post-form");
  const toggleBtn = document.getElementById("writing-toggle-btn");
  const paInput   = document.getElementById("writing-publish-at");

  function _closeForm() {
    titleInput.value = "";
    if (_quill) _quill.setContents([]);
    if (_thumbZone) _thumbZone.reset();
    if (_attachZone) _attachZone.reset();
    if (paInput) { const n = new Date(); n.setSeconds(0, 0); paInput.value = _toLocalDateTimeInput(n); }
    if (form)      form.style.display      = "none";
    if (toggleBtn) { toggleBtn.style.display = ""; toggleBtn.textContent = "+ New Post"; }
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
        likeCount:    0,
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
