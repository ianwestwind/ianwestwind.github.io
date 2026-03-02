// ============================================================
// WINN Platforms — forum.js
// Forum posts with rich editor, thumbnails, and attachments
// ============================================================

import { db, auth } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, deleteDoc, doc, updateDoc,
  query, orderBy, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getCurrentUser, getCurrentRole, hasRole, escHtml, showToast, formatDate
} from "./auth.js?v=3";
import {
  initEditor, getEditorHTML, initThumbnailZone, initAttachmentZone, renderBody, highlightContent, initPreview
} from "./editor.js";

const COLLECTION = "forum_posts";
const _posts = new Map();
let _quill      = null;
let _thumbZone  = null;
let _attachZone = null;
let _editId     = null; // set while editing an existing post
let _navOffset  = 0;   // current page offset for the nav strip

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
    rows.innerHTML = `<div class="empty-state"><div class="empty-icon"></div><p>No posts yet. Be the first to start a discussion!</p></div>`;
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
        ${data.thumbnailUrl ? `<span class="post-has-thumb" title="Has thumbnail">Image</span>` : ""}
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

function _renderNavStrip(container, sortedPairs, currentId) {
  const PAGE  = 5;
  const total = sortedPairs.length;
  if (total <= 1) { container.innerHTML = ""; return; }

  const ci = sortedPairs.findIndex(([id]) => id === currentId);
  if (ci >= 0 && (ci < _navOffset || ci >= _navOffset + PAGE)) {
    _navOffset = Math.floor(ci / PAGE) * PAGE;
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
    _renderNavStrip(container, sortedPairs, currentId);
  });

  container.querySelector(".post-nav-next")?.addEventListener("click", () => {
    _navOffset = Math.min(Math.floor((total - 1) / PAGE) * PAGE, _navOffset + PAGE);
    _renderNavStrip(container, sortedPairs, currentId);
  });

  container.querySelectorAll(".post-nav-page[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      _navOffset = parseInt(btn.dataset.page) * PAGE;
      _renderNavStrip(container, sortedPairs, currentId);
    });
  });
}

function _showDetail(id) {
  const data = _posts.get(id);
  if (!data) { location.hash = ""; return; }

  const listView   = document.getElementById("list-view");
  const detailView = document.getElementById("detail-view");
  if (listView)   listView.style.display   = "none";
  if (detailView) detailView.style.display = "";

  const role      = getCurrentRole();
  const user      = getCurrentUser() || auth.currentUser;
  const authorUid = data.authorUid != null ? String(data.authorUid) : "";
  const isAuthor  = user && authorUid && String(user.uid) === authorUid
    || (user && !authorUid && (user.displayName === data.authorName || (user.email && user.email === data.authorName)));
  const canDelete = hasRole(role, "admin") || hasRole(role, "moderator") || isAuthor;

  const sortedPairs = [..._posts.entries()].sort((a, b) =>
    (b[1].createdAt?.seconds ?? 0) - (a[1].createdAt?.seconds ?? 0)
  );

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
    <div class="post-detail-body rich-content" id="forum-detail-body-${id}"></div>
    ${_attachmentsHTML(data.attachments)}
    ${canDelete ? `<div class="post-detail-actions"><button type="button" class="btn btn-primary btn-sm" id="forum-edit-${id}">Edit</button><button type="button" class="btn btn-danger btn-sm" id="forum-delete-${id}">Delete Post</button></div>` : ""}
    <div id="forum-nav-container-${escHtml(id)}"></div>
    <div id="forum-comments-${id}" class="comments-section"></div>
  `;

  const bodyEl = document.getElementById(`forum-detail-body-${id}`);
  bodyEl.innerHTML = renderBody(data.body);
  highlightContent(bodyEl);

  document.getElementById("back-btn").addEventListener("click", () => { location.hash = ""; });

  _renderNavStrip(document.getElementById(`forum-nav-container-${id}`), sortedPairs, id);

  if (canDelete) {
    document.getElementById(`forum-edit-${id}`).addEventListener("click", () => _startEdit(id));
    document.getElementById(`forum-delete-${id}`).addEventListener("click", async () => {
      if (!confirm("Delete this post?")) return;
      try {
        await deleteDoc(doc(db, COLLECTION, id));
        _posts.delete(id);
        showToast("Post deleted.", "info");
        location.hash = "";
      } catch (err) { showToast("Delete failed: " + err.message, "error"); }
    });
  }

  _loadAndRenderComments(id);
}

async function _loadAndRenderComments(postId) {
  const section = document.getElementById(`forum-comments-${postId}`);
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
    <div id="forum-comments-list-${postId}"></div>
    ${canComment ? `
      <div class="comment-form">
        <textarea id="forum-new-comment-${postId}" class="comment-textarea" placeholder="Add a comment…" rows="3"></textarea>
        <div class="comment-form-actions">
          <button class="btn btn-primary btn-sm" id="forum-submit-comment-${postId}">Post Comment</button>
        </div>
      </div>
    ` : ""}
  `;

  _renderCommentsList(postId, topLevel, repliesByParent, canComment, user, role);

  if (canComment) {
    document.getElementById(`forum-submit-comment-${postId}`)?.addEventListener("click", async () => {
      const ta = document.getElementById(`forum-new-comment-${postId}`);
      const body = ta?.value.trim();
      if (!body) return;
      const btn = document.getElementById(`forum-submit-comment-${postId}`);
      btn.disabled = true;
      await _submitComment(postId, body, null);
      if (ta) ta.value = "";
      btn.disabled = false;
    });
  }
}

function _renderCommentsList(postId, topLevel, repliesByParent, canComment, user, role) {
  const list = document.getElementById(`forum-comments-list-${postId}`);
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
          ${isDeleted ? `
            <div class="comment-deleted-msg">[comment deleted]</div>
          ` : `
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
                  ${isDeletedR ? `
                    <div class="comment-deleted-msg">[comment deleted]</div>
                  ` : `
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
                </div>
              `;
            }).join("")}
          </div>
          ${canComment && !isDeleted ? `
            <div class="reply-form" id="reply-form-${escHtml(c.id)}" style="display:none">
              <textarea class="comment-textarea" placeholder="Write a reply…" rows="2"></textarea>
              <div class="comment-form-actions">
                <button class="btn btn-primary btn-sm submit-reply-btn" data-comment-id="${escHtml(c.id)}">Post Reply</button>
                <button class="btn btn-ghost btn-sm cancel-reply-btn" data-comment-id="${escHtml(c.id)}">Cancel</button>
              </div>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");
  }

  if (canComment) {
    list.querySelectorAll(".reply-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const form = document.getElementById(`reply-form-${btn.dataset.commentId}`);
        if (form) form.style.display = form.style.display === "none" ? "" : "none";
      });
    });
    list.querySelectorAll(".reply-to-reply-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const form = document.getElementById(`reply-form-${btn.dataset.parentId}`);
        if (form) {
          form.style.display = "";
          const ta = form.querySelector("textarea");
          if (ta) {
            ta.value = `@${btn.dataset.replyTo} `;
            ta.focus();
            ta.setSelectionRange(ta.value.length, ta.value.length);
          }
        }
      });
    });
    list.querySelectorAll(".submit-reply-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const cid = btn.dataset.commentId;
        const form = document.getElementById(`reply-form-${cid}`);
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
        const form = document.getElementById(`reply-form-${btn.dataset.commentId}`);
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
      // Soft delete: keep as tombstone so replies still have context
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

  _handleHash();

  const listHeader = document.getElementById("list-header");
  if (listHeader) listHeader.style.display = "";

  // Init editor + zones for signed-in users (don't block list display if this fails)
  const role = getCurrentRole();
  if (hasRole(role, "regular")) {
    try {
      _quill      = initEditor("forum-toolbar", "forum-editor", "forum");
      _thumbZone  = initThumbnailZone("forum-thumb", "forum-thumb-preview", "forum");
      _attachZone = initAttachmentZone("forum-attach-input", "forum-attach-list", "forum");
      initPreview("forum-preview-btn", "forum-preview-panel", () => ({
        title:    document.getElementById("post-title")?.value.trim() || "",
        thread:   document.getElementById("post-thread")?.value.trim() || "",
        body:     _quill ? getEditorHTML(_quill) : "",
        thumbUrl: _thumbZone?.getThumbUrl() || null,
      }));
    } catch (e) {
      console.warn("Forum editor init failed:", e);
    }
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
      const nowSec = Math.floor(Date.now() / 1000);
      _posts.set(newDoc.id, {
        title:            postData.title,
        body:             postData.body,
        thread:           postData.thread,
        thumbnailUrl:     postData.thumbnailUrl,
        attachments:      postData.attachments,
        authorUid:        postData.authorUid,
        authorName:       postData.authorName,
        createdAt:        { seconds: nowSec }
      });
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
