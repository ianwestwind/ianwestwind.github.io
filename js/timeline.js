// ============================================================
// Multimodal Intelligence Lab — timeline.js
// Scrollable, zoomable project timeline. Admin edits projects,
// milestones, and dues. Stored in site_config/timeline.
// ============================================================

import { db } from "./firebase-config.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { hasRole, showToast, escHtml } from "./auth.js?v=11";
import { initEditor, getEditorHTML, renderBody, highlightContent } from "./editor.js";

const TIMELINE_DOC = doc(db, "site_config", "timeline");
const LABEL_W = 168;
const MIN_PX = 1.5;
const MAX_PX = 28;

const PROJECT_TYPES = [
  ["grant", "Grant"],
  ["paper", "Paper"],
  ["presentation", "Presentation"],
  ["other", "Other"],
];

let _projects = [];
let _isAdmin = false;
let _selectedId = null;
let _editTarget = null;
let _px = 6;
let _ready = false;
let _addQuill = null;
let _editQuill = null;
let _scrolledToToday = false;
let _started = false;

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseISODate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function isoDate(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

function daySpan(a, b) {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
}

function formatShort(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function viewRange(projects) {
  const today = startOfDay(new Date());
  let min = today;
  let max = today;
  for (const p of projects) {
    const dates = [parseISODate(p.start), parseISODate(p.end)];
    for (const m of p.milestones || []) dates.push(parseISODate(m.date));
    for (const d of dates) {
      if (!d) continue;
      if (d < min) min = d;
      if (d > max) max = d;
    }
  }
  return { start: addDays(min, -21), end: addDays(max, 28) };
}

function progressOf(project) {
  const items = project.milestones || [];
  if (!items.length) return null;
  const done = items.filter(m => m.done).length;
  return { done, total: items.length, ratio: done / items.length };
}

function progressText(prog) {
  if (!prog) return "No milestones yet";
  const pct = (prog.ratio * 100).toFixed(1);
  return `${prog.done} of ${prog.total} done (${pct}%)`;
}

async function saveProjects(projects) {
  await setDoc(TIMELINE_DOC, { projects }, { merge: true });
}

function selectedProject() {
  return _projects.find(p => p.id === _selectedId) || null;
}

function projectType(project) {
  const type = project && project.type;
  return PROJECT_TYPES.some(([id]) => id === type) ? type : "other";
}

function typeLabel(type) {
  return PROJECT_TYPES.find(([id]) => id === type)?.[1] || "Other";
}

function typeOptions(selected) {
  return PROJECT_TYPES.map(([id, label]) =>
    `<option value="${id}"${id === selected ? " selected" : ""}>${label}</option>`
  ).join("");
}

export function initTimeline(role) {
  _isAdmin = hasRole(role, "admin");
  const adminBar = document.getElementById("tl-admin-bar");
  if (adminBar) adminBar.hidden = !_isAdmin;
  if (_started) {
    render();
    return;
  }
  _started = true;

  document.getElementById("tl-add-toggle")?.addEventListener("click", () => {
    const wrap = document.getElementById("tl-project-form-wrap");
    if (!wrap) return;
    wrap.hidden = !wrap.hidden;
    if (!wrap.hidden) {
      ensureAddEditor();
      document.getElementById("tl-name")?.focus();
    }
  });

  document.getElementById("tl-project-form")?.addEventListener("submit", onAddProject);
  document.getElementById("tl-zoom-in")?.addEventListener("click", () => setZoom(_px * 1.3));
  document.getElementById("tl-zoom-out")?.addEventListener("click", () => setZoom(_px / 1.3));
  document.getElementById("tl-today")?.addEventListener("click", scrollToToday);

  const scroller = document.getElementById("tl-scroll");
  scroller?.addEventListener("wheel", onWheel, { passive: false });
  scroller?.addEventListener("scroll", hideMarkTip, { passive: true });
  scroller?.addEventListener("pointerover", (e) => {
    const mark = e.target.closest?.(".tl-mark");
    if (mark) showMarkTip(mark);
  });
  scroller?.addEventListener("pointerout", (e) => {
    const mark = e.target.closest?.(".tl-mark");
    if (!mark) return;
    const next = e.relatedTarget?.closest?.(".tl-mark");
    if (next !== mark) hideMarkTip();
  });

  onSnapshot(TIMELINE_DOC, (snap) => {
    _projects = snap.exists() && Array.isArray(snap.data().projects) ? snap.data().projects : [];
    if (_selectedId && !_projects.some(p => p.id === _selectedId)) {
      _selectedId = null;
      _editTarget = null;
    }
    if (_editTarget && _editTarget !== "project" && _editTarget !== "add") {
      const current = _projects.find(p => p.id === _selectedId);
      if (!current || !(current.milestones || []).some(m => m.id === _editTarget)) _editTarget = null;
    }
    if (!_selectedId && _projects.length) _selectedId = _projects[0].id;
    _ready = true;
    render();
  }, (err) => {
    _ready = true;
    showToast("Could not load the timeline: " + err.message, "error");
    render();
  });
}

function onWheel(e) {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const scroller = document.getElementById("tl-scroll");
  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  const focal = scroller.scrollLeft + (e.clientX - rect.left) - LABEL_W;
  const day = focal / _px;
  const next = e.deltaY < 0 ? _px * 1.12 : _px / 1.12;
  _px = Math.min(MAX_PX, Math.max(MIN_PX, next));
  const left = day * _px - (e.clientX - rect.left) + LABEL_W;
  render({ detail: false, scrollLeft: left });
}

function setZoom(next) {
  const scroller = document.getElementById("tl-scroll");
  const focal = scroller ? scroller.scrollLeft + scroller.clientWidth / 2 - LABEL_W : 0;
  const day = focal / _px;
  _px = Math.min(MAX_PX, Math.max(MIN_PX, next));
  const left = scroller ? day * _px - scroller.clientWidth / 2 + LABEL_W : 0;
  render({ detail: false, scrollLeft: left });
}

function scrollToToday() {
  const scroller = document.getElementById("tl-scroll");
  if (!scroller || !_projects) return;
  const range = viewRange(_projects);
  const x = daySpan(range.start, startOfDay(new Date())) * _px;
  scroller.scrollLeft = Math.max(0, x - scroller.clientWidth * 0.33 + LABEL_W);
}

function render(opts = {}) {
  const count = document.getElementById("tl-count");
  if (count) count.textContent = _projects.length === 1 ? "1 project" : `${_projects.length} projects`;

  const empty = document.getElementById("tl-empty");
  const scroller = document.getElementById("tl-scroll");
  const canvas = document.getElementById("tl-canvas");
  if (!canvas || !scroller) return;

  hideMarkTip();
  const prevLeft = scroller.scrollLeft;
  const prevTop = scroller.scrollTop;
  const showEmpty = _ready && _projects.length === 0;
  if (empty) empty.hidden = !showEmpty;
  scroller.hidden = showEmpty;

  if (!showEmpty && _projects.length) {
    canvas.innerHTML = buildCanvas();
    bindCanvas();
  } else {
    canvas.innerHTML = "";
  }

  if (opts.detail !== false) renderDetail();

  if (!_scrolledToToday && _projects.length) {
    _scrolledToToday = true;
    scrollToToday();
  } else if (typeof opts.scrollLeft === "number") {
    scroller.scrollLeft = opts.scrollLeft;
    scroller.scrollTop = prevTop;
  } else {
    scroller.scrollLeft = prevLeft;
    scroller.scrollTop = prevTop;
  }
}

function buildCanvas() {
  const range = viewRange(_projects);
  const days = Math.max(1, daySpan(range.start, range.end));
  const trackW = Math.round(days * _px);
  const todayX = daySpan(range.start, startOfDay(new Date())) * _px;
  const axis = buildAxis(range, trackW);
  const rows = _projects.map(p => buildRow(p, range, trackW)).join("");
  const today = `<div class="tl-today" style="left:${LABEL_W + todayX}px" title="Today"></div>`;
  return `<div class="tl-canvas-inner" style="width:${LABEL_W + trackW}px">${today}
    <div class="tl-row tl-row-axis"><div class="tl-label tl-label-corner"></div><div class="tl-track tl-axis" style="width:${trackW}px">${axis}</div></div>
    ${rows}</div>`;
}

function buildAxis(range, trackW) {
  const parts = [];
  const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  if (cursor < range.start) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor <= range.end) {
    const x = daySpan(range.start, cursor) * _px;
    if (x >= 0 && x <= trackW) {
      const label = cursor.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      parts.push(`<span class="tl-tick" style="left:${x}px">${escHtml(label)}</span>`);
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return parts.join("");
}

function buildRow(project, range, trackW) {
  const start = parseISODate(project.start);
  const end = parseISODate(project.end);
  const prog = progressOf(project);
  const type = projectType(project);
  const selected = project.id === _selectedId ? " is-selected" : "";
  let bar = "";
  if (start && end) {
    const left = daySpan(range.start, start) * _px;
    const width = Math.max(_px, daySpan(start, end) * _px);
    const fill = prog ? Math.round(prog.ratio * 100) : 0;
    bar = `<div class="tl-bar is-${type}" style="left:${left}px;width:${width}px" title="${escHtml(typeLabel(type))}"><span class="tl-bar-fill" style="width:${fill}%"></span></div>`;
  }
  const marks = (project.milestones || []).map(m => {
    const d = parseISODate(m.date);
    if (!d) return "";
    const x = daySpan(range.start, d) * _px;
    const overdue = m.kind === "due" && !m.done && d < startOfDay(new Date());
    const cls = ["tl-mark", m.kind === "due" ? "is-due" : "is-milestone", m.done ? "is-done" : "", overdue ? "is-overdue" : ""].filter(Boolean).join(" ");
    const kind = m.kind === "due" ? "Due" : "Milestone";
    const title = m.title || "Untitled";
    const when = `${formatShort(d)}${m.done ? " · done" : overdue ? " · overdue" : ""}`;
    return `<span class="${cls}" style="left:${x}px" data-kind="${escHtml(kind)}" data-title="${escHtml(title)}" data-when="${escHtml(when)}" aria-label="${escHtml(`${kind}: ${title}, ${when}`)}"></span>`;
  }).join("");
  const progLabel = prog ? `<span class="tl-progress">${prog.done}/${prog.total}</span>` : "";
  const remove = _isAdmin ? `<button type="button" class="tl-remove" data-remove="${escHtml(project.id)}" title="Remove project">×</button>` : "";
  return `<div class="tl-row${selected}" data-id="${escHtml(project.id)}">
    <div class="tl-label"><span class="tl-swatch is-${type}" title="${escHtml(typeLabel(type))}"></span><span class="tl-name">${escHtml(project.name || "Untitled")}</span>${progLabel}${remove}</div>
    <div class="tl-track" style="width:${trackW}px">${bar}${marks}</div>
  </div>`;
}

function ensureMarkTip() {
  let tip = document.getElementById("tl-hover");
  if (tip) return tip;
  tip = document.createElement("div");
  tip.id = "tl-hover";
  tip.className = "tl-hover";
  tip.hidden = true;
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  return tip;
}

function showMarkTip(mark) {
  const tip = ensureMarkTip();
  const kind = mark.dataset.kind || "";
  const title = mark.dataset.title || "";
  const when = mark.dataset.when || "";
  if (!title && !kind) return;
  tip.replaceChildren();
  const titleEl = document.createElement("span");
  titleEl.className = "tl-hover-title";
  titleEl.textContent = title || kind;
  tip.appendChild(titleEl);
  const meta = [title ? kind : "", when].filter(Boolean).join(" · ");
  if (meta) {
    const metaEl = document.createElement("span");
    metaEl.className = "tl-hover-meta";
    metaEl.textContent = meta;
    tip.appendChild(metaEl);
  }
  tip.hidden = false;
  const rect = mark.getBoundingClientRect();
  const width = tip.offsetWidth;
  const height = tip.offsetHeight;
  let left = rect.left + rect.width / 2 - width / 2;
  let top = rect.top - height - 8;
  if (top < 8) top = rect.bottom + 8;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hideMarkTip() {
  const tip = document.getElementById("tl-hover");
  if (tip) tip.hidden = true;
}

function bindCanvas() {
  const canvas = document.getElementById("tl-canvas");
  if (!canvas) return;
  canvas.querySelectorAll(".tl-row[data-id]").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove]")) return;
      if (_selectedId !== row.dataset.id) _editTarget = null;
      _selectedId = row.dataset.id;
      render();
    });
  });
  canvas.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeProject(btn.dataset.remove);
    });
  });
}

function renderDetail() {
  const el = document.getElementById("tl-detail");
  if (!el) return;
  const project = selectedProject();
  if (!project) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  const prog = progressOf(project);
  const start = parseISODate(project.start);
  const end = parseISODate(project.end);
  const type = projectType(project);
  const progText = progressText(prog);
  const details = String(project.details || "").trim();
  const items = [...(project.milestones || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const list = items.length
    ? items.map(m => milestoneRow(m)).join("")
    : `<p class="tl-muted">No milestones or dues yet.</p>`;
  const editingProject = _isAdmin && _editTarget === "project";
  const projectBlock = editingProject
    ? `<div class="tl-detail-head">
        <h3>Edit project</h3>
        <button type="button" class="btn btn-ghost btn-sm" id="tl-edit-cancel">Cancel</button>
      </div>
      <form class="tl-edit" id="tl-edit-form">
        <div class="form-group">
          <label for="tl-edit-name">Name</label>
          <input type="text" id="tl-edit-name" value="${escHtml(project.name || "")}" required />
        </div>
        <div class="form-group">
          <label for="tl-edit-type">Type</label>
          <select id="tl-edit-type">${typeOptions(type)}</select>
        </div>
        <div class="tl-date-row">
          <div class="form-group">
            <label for="tl-edit-start">Start</label>
            <input type="date" id="tl-edit-start" value="${escHtml(project.start || "")}" required />
          </div>
          <div class="form-group">
            <label for="tl-edit-end">End</label>
            <input type="date" id="tl-edit-end" value="${escHtml(project.end || "")}" required />
          </div>
        </div>
        <div class="form-group">
          <label>Details</label>
          <div id="tl-edit-details-mount"></div>
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Save project</button>
      </form>`
    : `<div class="tl-detail-head">
        <div>
          <h3>${escHtml(project.name || "Untitled")}</h3>
          <p class="tl-type"><span class="tl-swatch is-${type}" aria-hidden="true"></span>${escHtml(typeLabel(type))}</p>
        </div>
        ${_isAdmin ? `<button type="button" class="btn btn-ghost btn-sm" id="tl-edit-open">Edit</button>` : ""}
      </div>
      <dl class="tl-facts">
        <div><dt>Start</dt><dd>${start ? escHtml(formatShort(start)) : "—"}</dd></div>
        <div><dt>End</dt><dd>${end ? escHtml(formatShort(end)) : "—"}</dd></div>
        <div><dt>Progress</dt><dd>${escHtml(progText)}</dd></div>
      </dl>
      ${details ? `<div class="tl-note rich-content">${renderBody(details)}</div>` : ""}`;
  const addBtn = _isAdmin && _editTarget !== "add"
    ? `<button type="button" class="btn btn-ghost btn-sm" id="tl-add-mark-open">Add</button>`
    : "";
  const addForm = _isAdmin && _editTarget === "add"
    ? `<form class="tl-add-mark" id="tl-mark-form">
        <div class="form-group">
          <label for="tl-mark-title">Title</label>
          <input type="text" id="tl-mark-title" placeholder="Title" required />
        </div>
        <div class="tl-date-row">
          <div class="form-group">
            <label for="tl-mark-date">Date</label>
            <input type="date" id="tl-mark-date" required />
          </div>
          <div class="form-group">
            <label for="tl-mark-kind">Type</label>
            <select id="tl-mark-kind">
              <option value="milestone">Milestone</option>
              <option value="due">Due</option>
            </select>
          </div>
        </div>
        <div class="tl-mark-actions">
          <button type="submit" class="btn btn-primary btn-sm">Add</button>
          <button type="button" class="btn btn-ghost btn-sm" id="tl-add-mark-cancel">Cancel</button>
        </div>
      </form>`
    : "";

  el.innerHTML = `
    ${projectBlock}
    <div class="tl-marks-head">
      <h4 class="tl-marks-title">Milestones</h4>
      ${addBtn}
    </div>
    ${addForm}
    <div class="tl-marks">${list}</div>`;

  el.querySelectorAll("[data-toggle]").forEach(box => {
    box.addEventListener("change", () => toggleDone(project.id, box.dataset.toggle, box.checked));
  });
  el.querySelectorAll("[data-edit-mark]").forEach(btn => {
    btn.addEventListener("click", () => {
      _editTarget = btn.dataset.editMark;
      renderDetail();
      document.getElementById("tl-mark-edit-title")?.focus();
    });
  });
  el.querySelectorAll("[data-drop-mark]").forEach(btn => {
    btn.addEventListener("click", () => {
      const mark = (project.milestones || []).find(m => m.id === btn.dataset.dropMark);
      if (!confirm(`Remove “${mark?.title || "this milestone"}”?`)) return;
      if (_editTarget === btn.dataset.dropMark) _editTarget = null;
      dropMark(project.id, btn.dataset.dropMark);
    });
  });
  el.querySelectorAll("[data-cancel-mark]").forEach(btn => {
    btn.addEventListener("click", () => {
      _editTarget = null;
      renderDetail();
    });
  });
  el.querySelectorAll("[data-save-mark]").forEach(form => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      saveMarkEdits(project.id, form.dataset.saveMark);
    });
  });
  document.getElementById("tl-edit-open")?.addEventListener("click", () => {
    _editTarget = "project";
    renderDetail();
    document.getElementById("tl-edit-name")?.focus();
  });
  document.getElementById("tl-edit-cancel")?.addEventListener("click", () => {
    _editTarget = null;
    renderDetail();
  });
  document.getElementById("tl-add-mark-open")?.addEventListener("click", () => {
    _editTarget = "add";
    renderDetail();
    document.getElementById("tl-mark-title")?.focus();
  });
  document.getElementById("tl-add-mark-cancel")?.addEventListener("click", () => {
    _editTarget = null;
    renderDetail();
  });
  document.getElementById("tl-edit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveProjectEdits(project.id);
  });
  document.getElementById("tl-mark-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    addMark(project.id);
  });

  if (editingProject) mountEditDetails(project.details || "");
  else _editQuill = null;
  const note = el.querySelector(".tl-note");
  if (note) highlightContent(note);
}

function milestoneRow(m) {
  if (_isAdmin && _editTarget === m.id) return milestoneEditForm(m);
  const d = parseISODate(m.date);
  const overdue = m.kind === "due" && !m.done && d && d < startOfDay(new Date());
  const kind = m.kind === "due" ? "Due" : "Milestone";
  const check = _isAdmin
    ? `<input type="checkbox" data-toggle="${escHtml(m.id)}" ${m.done ? "checked" : ""} aria-label="Mark done" />`
    : `<span class="tl-check ${m.done ? "is-done" : ""}" aria-hidden="true"></span>`;
  const edit = _isAdmin
    ? `<button type="button" class="btn btn-ghost btn-sm tl-mark-edit-btn" data-edit-mark="${escHtml(m.id)}">Edit</button>`
    : "";
  return `<div class="tl-mark-row${overdue ? " is-overdue" : ""}${m.done ? " is-done" : ""}">
    ${check}
    <span class="tl-mark-kind">${kind}</span>
    <span class="tl-mark-title">${escHtml(m.title || "Untitled")}</span>
    <span class="tl-mark-date">${d ? escHtml(formatShort(d)) : ""}${overdue ? " · overdue" : ""}</span>
    ${edit}
  </div>`;
}

function milestoneEditForm(m) {
  const due = m.kind === "due";
  return `<form class="tl-mark-edit" data-save-mark="${escHtml(m.id)}">
    <div class="tl-mark-edit-grid">
      <div class="form-group">
        <label for="tl-mark-edit-title">Title</label>
        <input type="text" id="tl-mark-edit-title" value="${escHtml(m.title || "")}" required />
      </div>
      <div class="form-group">
        <label for="tl-mark-edit-date">Date</label>
        <input type="date" id="tl-mark-edit-date" value="${escHtml(m.date || "")}" required />
      </div>
      <div class="form-group">
        <label for="tl-mark-edit-kind">Type</label>
        <select id="tl-mark-edit-kind">
          <option value="milestone"${due ? "" : " selected"}>Milestone</option>
          <option value="due"${due ? " selected" : ""}>Due</option>
        </select>
      </div>
    </div>
    <div class="tl-mark-actions">
      <button type="submit" class="btn btn-primary btn-sm">Save</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cancel-mark>Cancel</button>
      <button type="button" class="btn btn-ghost btn-sm tl-delete" data-drop-mark="${escHtml(m.id)}">Delete</button>
    </div>
  </form>`;
}

function detailsEditorMarkup(prefix) {
  return `<div class="editor-wrapper">
    <div id="${prefix}-toolbar">
      <span class="ql-formats">
        <select class="ql-font">
          <option selected>Inter</option>
          <option value="georgia">Georgia</option>
          <option value="courier">Courier</option>
        </select>
      </span>
      <span class="ql-formats">
        <select class="ql-size">
          <option value="12px">12</option>
          <option value="14px">14</option>
          <option selected>16</option>
          <option value="18px">18</option>
          <option value="20px">20</option>
          <option value="24px">24</option>
          <option value="32px">32</option>
          <option value="48px">48</option>
        </select>
      </span>
      <span class="ql-formats">
        <select class="ql-header">
          <option value="1">H1</option>
          <option value="2">H2</option>
          <option value="3">H3</option>
          <option selected>Body</option>
        </select>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-bold"></button>
        <button type="button" class="ql-italic"></button>
        <button type="button" class="ql-underline"></button>
        <button type="button" class="ql-strike"></button>
      </span>
      <span class="ql-formats">
        <select class="ql-color"></select>
        <select class="ql-background"></select>
      </span>
      <span class="ql-formats">
        <select class="ql-align"></select>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-list" value="ordered"></button>
        <button type="button" class="ql-list" value="bullet"></button>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-blockquote"></button>
        <button type="button" class="ql-code-block"></button>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-link"></button>
        <button type="button" class="ql-image" title="Insert Image"></button>
        <button type="button" class="ql-video" title="Insert Video"></button>
        <button type="button" class="ql-audio" title="Insert Audio">♪</button>
      </span>
      <span class="ql-formats">
        <button type="button" class="ql-clean"></button>
      </span>
    </div>
    <div id="${prefix}-editor" class="editor-content tl-details-editor"></div>
  </div>`;
}

function detailsForEditor(text) {
  const raw = String(text || "");
  if (!raw.trim()) return "";
  if (raw.trimStart().startsWith("<")) return raw;
  return raw.split(/\n{2,}/).map(part => `<p>${escHtml(part).replace(/\n/g, "<br>")}</p>`).join("");
}

function openDetailsEditor(prefix, html) {
  const mountId = prefix === "tl-details" ? "tl-details-mount" : "tl-edit-details-mount";
  const mount = document.getElementById(mountId);
  if (!mount || mount.querySelector(".ql-editor")) return null;
  mount.innerHTML = detailsEditorMarkup(prefix);
  const quill = initEditor(`${prefix}-toolbar`, `${prefix}-editor`, "timeline");
  quill.root.dataset.placeholder = "What this project is about";
  const body = detailsForEditor(html);
  if (body) quill.clipboard.dangerouslyPasteHTML(body);
  return quill;
}

function ensureAddEditor() {
  if (_addQuill) return;
  try {
    const quill = openDetailsEditor("tl-details", "");
    if (quill) _addQuill = quill;
  } catch (err) {
    showToast("Could not open the details editor.", "error");
  }
}

function mountEditDetails(html) {
  try {
    _editQuill = openDetailsEditor("tl-edit-details", html);
  } catch (err) {
    _editQuill = null;
    showToast("Could not open the details editor.", "error");
  }
}

async function onAddProject(e) {
  e.preventDefault();
  if (!_isAdmin) return;
  const name = document.getElementById("tl-name").value.trim();
  const type = document.getElementById("tl-type").value;
  const start = document.getElementById("tl-start").value;
  const end = document.getElementById("tl-end").value;
  const details = _addQuill ? getEditorHTML(_addQuill) : "";
  if (!PROJECT_TYPES.some(([id]) => id === type)) {
    showToast("Choose a project type.", "error");
    return;
  }
  if (!parseISODate(start) || !parseISODate(end) || end < start) {
    showToast("End date must be on or after the start date.", "error");
    return;
  }
  const project = { id: uid(), name, type, start, end, details, milestones: [] };
  try {
    _editTarget = null;
    await saveProjects([..._projects, project]);
    _selectedId = project.id;
    e.target.reset();
    if (_addQuill) _addQuill.setContents([]);
    document.getElementById("tl-project-form-wrap").hidden = true;
    showToast("Project added.", "success");
  } catch (err) {
    showToast("Could not add project: " + err.message, "error");
  }
}

async function removeProject(id) {
  const project = _projects.find(p => p.id === id);
  if (!project || !_isAdmin) return;
  if (!confirm(`Remove “${project.name || "this project"}” from the timeline?`)) return;
  try {
    await saveProjects(_projects.filter(p => p.id !== id));
    showToast("Project removed.", "success");
  } catch (err) {
    showToast("Could not remove project: " + err.message, "error");
  }
}

async function saveProjectEdits(id) {
  const name = document.getElementById("tl-edit-name").value.trim();
  const type = document.getElementById("tl-edit-type").value;
  const start = document.getElementById("tl-edit-start").value;
  const end = document.getElementById("tl-edit-end").value;
  const existing = _projects.find(p => p.id === id);
  const details = _editQuill ? getEditorHTML(_editQuill) : (existing?.details || "");
  if (!PROJECT_TYPES.some(([id]) => id === type)) {
    showToast("Choose a project type.", "error");
    return;
  }
  if (!parseISODate(start) || !parseISODate(end) || end < start) {
    showToast("End date must be on or after the start date.", "error");
    return;
  }
  try {
    await saveProjects(_projects.map(p => p.id === id ? { ...p, name, type, start, end, details } : p));
    _editTarget = null;
    renderDetail();
    showToast("Project saved.", "success");
  } catch (err) {
    showToast("Could not save project: " + err.message, "error");
  }
}

async function addMark(id) {
  const title = document.getElementById("tl-mark-title").value.trim();
  const date = document.getElementById("tl-mark-date").value;
  const kind = document.getElementById("tl-mark-kind").value === "due" ? "due" : "milestone";
  if (!parseISODate(date)) {
    showToast("Choose a date.", "error");
    return;
  }
  const mark = { id: uid(), title, date, kind, done: false };
  try {
    await saveProjects(_projects.map(p => p.id === id ? { ...p, milestones: [...(p.milestones || []), mark] } : p));
    _editTarget = null;
    renderDetail();
  } catch (err) {
    showToast("Could not add item: " + err.message, "error");
  }
}

async function saveMarkEdits(projectId, markId) {
  const title = document.getElementById("tl-mark-edit-title").value.trim();
  const date = document.getElementById("tl-mark-edit-date").value;
  const kind = document.getElementById("tl-mark-edit-kind").value === "due" ? "due" : "milestone";
  if (!title) {
    showToast("Add a title.", "error");
    return;
  }
  if (!parseISODate(date)) {
    showToast("Choose a date.", "error");
    return;
  }
  try {
    await saveProjects(_projects.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        milestones: (p.milestones || []).map(m => m.id === markId ? { ...m, title, date, kind } : m)
      };
    }));
    _editTarget = null;
    renderDetail();
    showToast("Milestone saved.", "success");
  } catch (err) {
    showToast("Could not save milestone: " + err.message, "error");
  }
}

async function toggleDone(projectId, markId, done) {
  if (!_isAdmin) return;
  try {
    await saveProjects(_projects.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, milestones: (p.milestones || []).map(m => m.id === markId ? { ...m, done } : m) };
    }));
  } catch (err) {
    showToast("Could not update progress: " + err.message, "error");
  }
}

async function dropMark(projectId, markId) {
  if (!_isAdmin) return;
  try {
    await saveProjects(_projects.map(p => {
      if (p.id !== projectId) return p;
      return { ...p, milestones: (p.milestones || []).filter(m => m.id !== markId) };
    }));
  } catch (err) {
    showToast("Could not remove item: " + err.message, "error");
  }
}
