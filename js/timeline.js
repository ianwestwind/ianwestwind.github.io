// ============================================================
// Multimodal Intelligence Lab — timeline.js
// Scrollable, zoomable project timeline. Admin edits projects,
// milestones, and dues. Stored in site_config/timeline.
// ============================================================

import { db } from "./firebase-config.js";
import { doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { hasRole, showToast, escHtml } from "./auth.js?v=8";

const TIMELINE_DOC = doc(db, "site_config", "timeline");
const LABEL_W = 168;
const MIN_PX = 1.5;
const MAX_PX = 28;

let _projects = [];
let _isAdmin = false;
let _selectedId = null;
let _px = 6;
let _ready = false;
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

async function saveProjects(projects) {
  await setDoc(TIMELINE_DOC, { projects }, { merge: true });
}

function selectedProject() {
  return _projects.find(p => p.id === _selectedId) || null;
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
    if (!wrap.hidden) document.getElementById("tl-name")?.focus();
  });

  document.getElementById("tl-project-form")?.addEventListener("submit", onAddProject);
  document.getElementById("tl-zoom-in")?.addEventListener("click", () => setZoom(_px * 1.3));
  document.getElementById("tl-zoom-out")?.addEventListener("click", () => setZoom(_px / 1.3));
  document.getElementById("tl-today")?.addEventListener("click", scrollToToday);

  const scroller = document.getElementById("tl-scroll");
  scroller?.addEventListener("wheel", onWheel, { passive: false });

  onSnapshot(TIMELINE_DOC, (snap) => {
    _projects = snap.exists() && Array.isArray(snap.data().projects) ? snap.data().projects : [];
    if (_selectedId && !_projects.some(p => p.id === _selectedId)) _selectedId = null;
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
  const selected = project.id === _selectedId ? " is-selected" : "";
  let bar = "";
  if (start && end) {
    const left = daySpan(range.start, start) * _px;
    const width = Math.max(_px, daySpan(start, end) * _px);
    const fill = prog ? Math.round(prog.ratio * 100) : 0;
    bar = `<div class="tl-bar" style="left:${left}px;width:${width}px"><span class="tl-bar-fill" style="width:${fill}%"></span></div>`;
  }
  const marks = (project.milestones || []).map(m => {
    const d = parseISODate(m.date);
    if (!d) return "";
    const x = daySpan(range.start, d) * _px;
    const overdue = m.kind === "due" && !m.done && d < startOfDay(new Date());
    const cls = ["tl-mark", m.kind === "due" ? "is-due" : "is-milestone", m.done ? "is-done" : "", overdue ? "is-overdue" : ""].filter(Boolean).join(" ");
    const tip = `${m.title} · ${formatShort(d)}${m.done ? " · done" : overdue ? " · overdue" : ""}`;
    return `<span class="${cls}" style="left:${x}px" title="${escHtml(tip)}"></span>`;
  }).join("");
  const progLabel = prog ? `<span class="tl-progress">${prog.done}/${prog.total}</span>` : "";
  const remove = _isAdmin ? `<button type="button" class="tl-remove" data-remove="${escHtml(project.id)}" title="Remove project">×</button>` : "";
  return `<div class="tl-row${selected}" data-id="${escHtml(project.id)}">
    <div class="tl-label"><span class="tl-name">${escHtml(project.name || "Untitled")}</span>${progLabel}${remove}</div>
    <div class="tl-track" style="width:${trackW}px">${bar}${marks}</div>
  </div>`;
}

function bindCanvas() {
  const canvas = document.getElementById("tl-canvas");
  if (!canvas) return;
  canvas.querySelectorAll(".tl-row[data-id]").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove]")) return;
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
  const span = start && end ? `${formatShort(start)} – ${formatShort(end)}` : "";
  const progText = prog ? `${prog.done} of ${prog.total} done` : "No milestones yet";
  const items = [...(project.milestones || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const list = items.length
    ? items.map(m => milestoneRow(project, m)).join("")
    : `<p class="tl-muted">No milestones or dues yet.</p>`;
  const editor = _isAdmin ? `
    <form class="tl-edit" id="tl-edit-form">
      <div class="form-group">
        <label for="tl-edit-name">Name</label>
        <input type="text" id="tl-edit-name" value="${escHtml(project.name || "")}" required />
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
      <button type="submit" class="btn btn-ghost btn-sm">Save project</button>
    </form>
    <form class="tl-add-mark" id="tl-mark-form">
      <div class="form-group">
        <label for="tl-mark-title">Milestone or due</label>
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
      <button type="submit" class="btn btn-primary btn-sm">Add</button>
    </form>` : "";

  el.innerHTML = `
    <div class="tl-detail-head">
      <h3>${escHtml(project.name || "Untitled")}</h3>
      <p class="tl-muted">${escHtml(span)}${span ? " · " : ""}${escHtml(progText)}</p>
    </div>
    <div class="tl-marks">${list}</div>
    ${editor}`;

  el.querySelectorAll("[data-toggle]").forEach(box => {
    box.addEventListener("change", () => toggleDone(project.id, box.dataset.toggle, box.checked));
  });
  el.querySelectorAll("[data-drop-mark]").forEach(btn => {
    btn.addEventListener("click", () => dropMark(project.id, btn.dataset.dropMark));
  });
  document.getElementById("tl-edit-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveProjectEdits(project.id);
  });
  document.getElementById("tl-mark-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    addMark(project.id);
  });
}

function milestoneRow(project, m) {
  const d = parseISODate(m.date);
  const overdue = m.kind === "due" && !m.done && d && d < startOfDay(new Date());
  const kind = m.kind === "due" ? "Due" : "Milestone";
  const check = _isAdmin
    ? `<input type="checkbox" data-toggle="${escHtml(m.id)}" ${m.done ? "checked" : ""} aria-label="Mark done" />`
    : `<span class="tl-check ${m.done ? "is-done" : ""}" aria-hidden="true"></span>`;
  const remove = _isAdmin ? `<button type="button" class="tl-remove" data-drop-mark="${escHtml(m.id)}" title="Remove">×</button>` : "";
  return `<div class="tl-mark-row${overdue ? " is-overdue" : ""}${m.done ? " is-done" : ""}">
    ${check}
    <span class="tl-mark-kind">${kind}</span>
    <span class="tl-mark-title">${escHtml(m.title || "Untitled")}</span>
    <span class="tl-mark-date">${d ? escHtml(formatShort(d)) : ""}${overdue ? " · overdue" : ""}</span>
    ${remove}
  </div>`;
}

async function onAddProject(e) {
  e.preventDefault();
  if (!_isAdmin) return;
  const name = document.getElementById("tl-name").value.trim();
  const start = document.getElementById("tl-start").value;
  const end = document.getElementById("tl-end").value;
  if (!parseISODate(start) || !parseISODate(end) || end < start) {
    showToast("End date must be on or after the start date.", "error");
    return;
  }
  const project = { id: uid(), name, start, end, milestones: [] };
  try {
    await saveProjects([..._projects, project]);
    _selectedId = project.id;
    e.target.reset();
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
  const start = document.getElementById("tl-edit-start").value;
  const end = document.getElementById("tl-edit-end").value;
  if (!parseISODate(start) || !parseISODate(end) || end < start) {
    showToast("End date must be on or after the start date.", "error");
    return;
  }
  try {
    await saveProjects(_projects.map(p => p.id === id ? { ...p, name, start, end } : p));
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
  } catch (err) {
    showToast("Could not add item: " + err.message, "error");
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
