// ============================================================
// WINN Platforms — consultation.js
// Admin manages time slots; logged-in users pick a slot and
// submit a booking request.
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, addDoc, getDocs, getDoc, setDoc, doc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getCurrentUser, hasRole, escHtml, showToast, formatDate
} from "./auth.js?v=3";

const SLOTS_COL    = "consultation_slots";
const BOOKINGS_COL = "consultations";

const _slots    = new Map();   // slotId → data
const _bookings = new Map();   // bookingId → data

let _userRole       = "guest";
let _calYear        = 0;
let _calMonth       = 0;       // 0-based
let _selectedDate   = null;    // "YYYY-MM-DD"
let _selectedSlotId = null;
let _userBookedSlotIds = new Set(); // slotIds the current user has already requested

let _consultSettings = { approvalMessage: "", videoLink: "" };
const DEFAULT_APPROVAL_MSG =
  "Your consultation has been confirmed. Please join using the meeting link below at your scheduled time.";

// ---- Helpers ----

function _toLocalDateTimeInput(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function _dateKey(ts) {
  let d;
  if (ts && typeof ts.toDate === "function") d = ts.toDate();
  else if (ts && typeof ts.seconds === "number") d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function _timeLabel(ts, durationMins) {
  let d;
  if (ts && typeof ts.toDate === "function") d = ts.toDate();
  else if (ts && typeof ts.seconds === "number") d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  const fmt = t => t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const end = new Date(d.getTime() + (durationMins || 30) * 60000);
  return `${fmt(d)} – ${fmt(end)}`;
}

function _statusBadgeHTML(status) {
  return `<span class="status-badge status-${escHtml(status)}">${escHtml(status)}</span>`;
}

// ---- Data loading ----

async function _loadSlots() {
  const snap = await getDocs(query(collection(db, SLOTS_COL), orderBy("dateTime", "asc")));
  _slots.clear();
  snap.docs.forEach(d => _slots.set(d.id, d.data()));
}

async function _loadBookings() {
  const snap = await getDocs(query(collection(db, BOOKINGS_COL), orderBy("createdAt", "desc")));
  _bookings.clear();
  snap.docs.forEach(d => _bookings.set(d.id, d.data()));
}

// ---- Calendar ----

function _renderCalendar() {
  const isAdmin = hasRole(_userRole, "admin");
  const label   = document.getElementById("cal-month-label");
  const grid    = document.getElementById("cal-grid");
  if (!grid) return;

  const monthNames = ["January","February","March","April","May","June",
                      "July","August","September","October","November","December"];
  if (label) label.textContent = `${monthNames[_calMonth]} ${_calYear}`;

  // Build set of dates that have slots (available for users; any for admin)
  const slotDates = new Set();
  _slots.forEach(slot => {
    if (isAdmin || slot.isAvailable !== false) {
      slotDates.add(_dateKey(slot.dateTime));
    }
  });

  const firstDay  = new Date(_calYear, _calMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
  const today     = _dateKey(new Date());
  const pad       = n => String(n).padStart(2, "0");

  let html = "";

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-day other-month"></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${_calYear}-${pad(_calMonth + 1)}-${pad(d)}`;
    let cls = "cal-day";
    if (dateStr === today)         cls += " today";
    if (slotDates.has(dateStr))    cls += " has-slots";
    if (dateStr === _selectedDate) cls += " selected";

    const clickable = slotDates.has(dateStr);
    const attrs = clickable
      ? `role="button" tabindex="0" data-date="${dateStr}"`
      : "";
    html += `<div class="${cls}" ${attrs}>${d}</div>`;
  }

  grid.innerHTML = html;

  grid.querySelectorAll(".cal-day.has-slots").forEach(cell => {
    cell.addEventListener("click", () => _selectDate(cell.dataset.date));
    cell.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); _selectDate(cell.dataset.date); }
    });
  });
}

function _prevMonth() {
  _calMonth--;
  if (_calMonth < 0) { _calMonth = 11; _calYear--; }
  _selectedDate = null;
  _renderCalendar();
  _hideSlotsSection();
}

function _nextMonth() {
  _calMonth++;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  _selectedDate = null;
  _renderCalendar();
  _hideSlotsSection();
}

function _selectDate(dateStr) {
  _selectedDate = dateStr;
  _renderCalendar();
  _renderSlotList();

  const section = document.getElementById("slot-section");
  if (section) section.style.display = "";
}

function _hideSlotsSection() {
  const section = document.getElementById("slot-section");
  if (section) section.style.display = "none";
  _hideBookingForm();
}

function _renderSlotList() {
  const isAdmin   = hasRole(_userRole, "admin");
  const listEl    = document.getElementById("slot-list");
  const labelEl   = document.getElementById("slot-section-label");
  if (!listEl) return;

  const daySlots = [..._slots.entries()]
    .filter(([, s]) => _dateKey(s.dateTime) === _selectedDate)
    .sort((a, b) => {
      const aS = a[1].dateTime?.seconds ?? 0;
      const bS = b[1].dateTime?.seconds ?? 0;
      return aS - bS;
    });

  const visibleSlots = isAdmin ? daySlots : daySlots.filter(([, s]) => s.isAvailable !== false);

  const d = new Date(_selectedDate + "T00:00:00");
  const dateLabel = d.toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });
  if (labelEl) labelEl.textContent = `${visibleSlots.length} slot${visibleSlots.length !== 1 ? "s" : ""} on ${dateLabel}`;

  if (visibleSlots.length === 0) {
    listEl.innerHTML = `<div style="padding:.75rem;color:var(--text-muted);font-size:.85rem;">No available slots on this date.</div>`;
    return;
  }

  listEl.innerHTML = visibleSlots.map(([id, slot]) => {
    const timeStr = _timeLabel(slot.dateTime, slot.durationMins);
    const metaStr = `${slot.durationMins || 30} min${slot.notes ? " · " + escHtml(slot.notes) : ""}`;
    const unavail = slot.isAvailable === false;

    if (isAdmin) {
      return `
        <div class="admin-slot-row">
          <div class="admin-slot-row-info">
            <div class="admin-slot-row-time">${escHtml(timeStr)}</div>
            ${slot.notes ? `<div class="admin-slot-row-notes">${escHtml(slot.notes)}</div>` : ""}
          </div>
          <div class="admin-slot-row-actions">
            ${_statusBadgeHTML(unavail ? "hidden" : "available")}
            <button type="button" class="btn btn-ghost btn-sm" data-toggle="${escHtml(id)}">${unavail ? "Show" : "Hide"}</button>
            <button type="button" class="btn btn-danger btn-sm" data-delete="${escHtml(id)}">Delete</button>
          </div>
        </div>`;
    }

    const alreadyBooked = _userBookedSlotIds.has(id);
    return `
      <div class="slot-row${unavail ? " unavailable" : ""}">
        <div>
          <div class="slot-row-time">${escHtml(timeStr)}</div>
          <div class="slot-row-meta">${escHtml(metaStr)}</div>
        </div>
        ${!unavail
          ? alreadyBooked
            ? `<span class="status-badge status-pending">Requested</span>`
            : `<button type="button" class="btn btn-primary btn-sm" data-book="${escHtml(id)}">Book</button>`
          : ""}
      </div>`;
  }).join("");

  listEl.querySelectorAll("[data-book]").forEach(btn => {
    btn.addEventListener("click", () => _selectSlot(btn.dataset.book));
  });
  listEl.querySelectorAll("[data-toggle]").forEach(btn => {
    btn.addEventListener("click", () => _toggleSlotAvailability(btn.dataset.toggle));
  });
  listEl.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => _deleteSlot(btn.dataset.delete));
  });
}

// ---- Booking form ----

function _selectSlot(slotId) {
  const slot = _slots.get(slotId);
  if (!slot) return;
  _selectedSlotId = slotId;

  const infoEl = document.getElementById("booking-slot-info");
  if (infoEl) infoEl.textContent = `Selected: ${_timeLabel(slot.dateTime, slot.durationMins)}`;

  // Pre-fill name/email from user profile
  const user = getCurrentUser();
  if (user) {
    const nameEl = document.getElementById("book-name");
    const emailEl = document.getElementById("book-email");
    if (nameEl && !nameEl.value) nameEl.value = user.displayName || "";
    if (emailEl && !emailEl.value) emailEl.value = user.email || "";
  }

  const wrap = document.getElementById("booking-form-wrap");
  if (wrap) {
    wrap.style.display = "";
    wrap.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function _hideBookingForm() {
  const wrap = document.getElementById("booking-form-wrap");
  if (wrap) wrap.style.display = "none";
  const confirm = document.getElementById("booking-confirmation");
  if (confirm) confirm.style.display = "none";
  _selectedSlotId = null;
}

// ---- Admin slot management ----

function _renderAdminSlots() {
  const listEl  = document.getElementById("admin-slot-list");
  const countEl = document.getElementById("admin-slot-count");
  if (!listEl) return;

  const sorted = [..._slots.entries()].sort((a, b) => {
    const aS = a[1].dateTime?.seconds ?? 0;
    const bS = b[1].dateTime?.seconds ?? 0;
    return aS - bS;
  });

  if (countEl) countEl.textContent = `${sorted.length} slot${sorted.length !== 1 ? "s" : ""}`;

  if (sorted.length === 0) {
    listEl.innerHTML = `<div style="padding:.75rem;color:var(--text-muted);font-size:.85rem;">No slots yet. Add one above.</div>`;
    return;
  }

  listEl.innerHTML = sorted.map(([id, slot]) => {
    const unavail = slot.isAvailable === false;
    return `
      <div class="admin-slot-row">
        <div class="admin-slot-row-info">
          <div class="admin-slot-row-time">${escHtml(formatDate(slot.dateTime))} · ${slot.durationMins || 30} min</div>
          ${slot.notes ? `<div class="admin-slot-row-notes">${escHtml(slot.notes)}</div>` : ""}
        </div>
        <div class="admin-slot-row-actions">
          ${_statusBadgeHTML(unavail ? "hidden" : "available")}
          <button type="button" class="btn btn-ghost btn-sm" data-toggle="${escHtml(id)}">${unavail ? "Show" : "Hide"}</button>
          <button type="button" class="btn btn-danger btn-sm" data-delete="${escHtml(id)}">Delete</button>
        </div>
      </div>`;
  }).join("");

  listEl.querySelectorAll("[data-toggle]").forEach(btn => {
    btn.addEventListener("click", () => _toggleSlotAvailability(btn.dataset.toggle));
  });
  listEl.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => _deleteSlot(btn.dataset.delete));
  });
}

async function _toggleSlotAvailability(slotId) {
  const slot = _slots.get(slotId);
  if (!slot) return;
  const newVal = slot.isAvailable === false ? true : false;
  try {
    await updateDoc(doc(db, SLOTS_COL, slotId), { isAvailable: newVal });
    _slots.set(slotId, { ...slot, isAvailable: newVal });
    _renderAdminSlots();
    if (_selectedDate) _renderSlotList();
  } catch (e) {
    showToast("Update failed: " + e.message, "error");
  }
}

async function _deleteSlot(slotId) {
  if (!confirm("Delete this slot?")) return;
  try {
    await deleteDoc(doc(db, SLOTS_COL, slotId));
    _slots.delete(slotId);
    _renderAdminSlots();
    if (_selectedDate) _renderSlotList();
    showToast("Slot deleted.", "info");
  } catch (e) {
    showToast("Delete failed: " + e.message, "error");
  }
}

// ---- Admin bookings list ----

function _renderAdminBookings() {
  const listEl  = document.getElementById("admin-booking-list");
  const countEl = document.getElementById("admin-booking-count");
  if (!listEl) return;

  const sorted = [..._bookings.entries()];
  if (countEl) countEl.textContent = `${sorted.length} booking request${sorted.length !== 1 ? "s" : ""}`;

  if (sorted.length === 0) {
    listEl.innerHTML = `<div style="padding:.75rem;color:var(--text-muted);font-size:.85rem;">No booking requests yet.</div>`;
    return;
  }

  listEl.innerHTML = sorted.map(([id, b]) => `
    <div class="booking-row">
      <div class="booking-row-header">
        <span class="booking-row-name">${escHtml(b.requesterName || "Unknown")}</span>
        ${_statusBadgeHTML(b.status || "pending")}
      </div>
      <div class="booking-row-slot">${escHtml(formatDate(b.slotDateTime))}</div>
      <div class="booking-row-contact">
        <span>${escHtml(b.requesterEmail || "")}</span>
        ${b.requesterPhone ? `<span>·</span><span>${escHtml(b.requesterPhone)}</span>` : ""}
      </div>
      <div class="booking-row-topic">${escHtml(b.topic || "")}</div>
      <div class="booking-row-actions">
        <select class="booking-status-select" data-booking="${escHtml(id)}">
          <option value="pending"  ${(b.status || "pending") === "pending"  ? "selected" : ""}>Pending</option>
          <option value="approved" ${b.status === "approved" ? "selected" : ""}>Approved</option>
          <option value="rejected" ${b.status === "rejected" ? "selected" : ""}>Rejected</option>
        </select>
      </div>
    </div>`).join("");

  listEl.querySelectorAll(".booking-status-select").forEach(sel => {
    sel.addEventListener("change", () => updateBookingStatus(sel.dataset.booking, sel.value));
  });
}

// ---- Admin slot form initialization ----

function _initAdminSlotForm() {
  const toggleBtn = document.getElementById("slot-toggle-btn");
  const form      = document.getElementById("slot-add-form");
  const cancelBtn = document.getElementById("slot-cancel-btn");
  const datetimeInput = document.getElementById("slot-datetime");

  // Default to next hour in local time
  if (datetimeInput) {
    const n = new Date();
    n.setHours(n.getHours() + 1, 0, 0, 0);
    datetimeInput.value = _toLocalDateTimeInput(n);
  }

  if (toggleBtn && form) {
    toggleBtn.addEventListener("click", () => {
      const hidden = form.style.display === "none" || form.style.display === "";
      form.style.display    = hidden ? "" : "none";
      toggleBtn.textContent = hidden ? "✕ Cancel" : "+ Add Slot";
    });
  }
  if (cancelBtn && form) {
    cancelBtn.addEventListener("click", () => {
      form.style.display = "none";
      if (toggleBtn) toggleBtn.textContent = "+ Add Slot";
    });
  }
}

// ---- Consultation settings (admin) ----

async function _loadConsultSettings() {
  try {
    const snap = await getDoc(doc(db, "site_config", "consultation_settings"));
    if (snap.exists()) {
      _consultSettings = { ..._consultSettings, ...snap.data() };
    }
  } catch (e) {
    console.error("Failed to load consultation settings:", e);
  }
}

function _renderAdminSettings() {
  const msgEl  = document.getElementById("cs-approval-msg");
  const linkEl = document.getElementById("cs-video-link");
  if (msgEl)  msgEl.value  = _consultSettings.approvalMessage || "";
  if (linkEl) linkEl.value = _consultSettings.videoLink || "";
}

export async function saveConsultSettings() {
  const msgEl   = document.getElementById("cs-approval-msg");
  const linkEl  = document.getElementById("cs-video-link");
  const saveBtn = document.getElementById("cs-save-btn");

  const approvalMessage = msgEl?.value.trim() || "";
  const videoLink       = linkEl?.value.trim() || "";

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
  try {
    await setDoc(
      doc(db, "site_config", "consultation_settings"),
      { approvalMessage, videoLink },
      { merge: true }
    );
    _consultSettings = { approvalMessage, videoLink };
    showToast("Settings saved.", "success");
  } catch (e) {
    showToast("Save failed: " + e.message, "error");
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save Settings"; }
  }
}

// ---- My Bookings (user) ----

function _buildGoogleCalUrl(ts, durationMins, videoLink) {
  let start;
  if (ts && typeof ts.toDate === "function") start = ts.toDate();
  else if (ts && typeof ts.seconds === "number") start = new Date(ts.seconds * 1000);
  else start = new Date(ts);
  const end = new Date(start.getTime() + (durationMins || 30) * 60000);
  const fmt = d => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const params = new URLSearchParams({
    action:   "TEMPLATE",
    text:     "Consultation - WINN Platforms",
    dates:    `${fmt(start)}/${fmt(end)}`,
    details:  videoLink ? `Join at: ${videoLink}` : "Consultation with WINN Platforms",
    location: videoLink || "",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function _buildIcsDataUri(ts, durationMins, videoLink) {
  let start;
  if (ts && typeof ts.toDate === "function") start = ts.toDate();
  else if (ts && typeof ts.seconds === "number") start = new Date(ts.seconds * 1000);
  else start = new Date(ts);
  const end = new Date(start.getTime() + (durationMins || 30) * 60000);
  const fmt = d => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = `consult-${start.getTime()}@winn-platforms`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WINN Platforms//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    "SUMMARY:Consultation - WINN Platforms",
    videoLink ? `LOCATION:${videoLink}` : "",
    videoLink ? `DESCRIPTION:Join at: ${videoLink}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  return "data:text/calendar;charset=utf8," + encodeURIComponent(ics);
}

async function _loadUserBookings() {
  const user = getCurrentUser();
  if (!user) return;
  try {
    const snap = await getDocs(
      query(collection(db, BOOKINGS_COL), where("requesterUid", "==", user.uid))
    );
    const bookings = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
    _userBookedSlotIds = new Set(bookings.map(b => b.slotId).filter(Boolean));
    _renderMyBookings(bookings);
    if (_selectedDate) _renderSlotList(); // refresh "Requested" badges if a date is selected
  } catch (e) {
    console.warn("My bookings query failed:", e.message);
  }
}

function _renderMyBookings(bookings) {
  const section = document.getElementById("my-bookings-section");
  const listEl  = document.getElementById("my-bookings-list");
  if (!section || !listEl) return;

  if (bookings.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "";

  listEl.innerHTML = bookings.map(b => {
    const dateLabel  = formatDate(b.slotDateTime);
    const status     = b.status || "pending";
    const isApproved = status === "approved";
    const videoLink  = b.videoLink || _consultSettings.videoLink || "";
    const gcalUrl    = isApproved
      ? _buildGoogleCalUrl(b.slotDateTime, b.durationMins, videoLink)
      : "";
    const icsUri     = isApproved
      ? _buildIcsDataUri(b.slotDateTime, b.durationMins, videoLink)
      : "";

    return `
      <div class="my-booking-card">
        <div class="my-booking-header">
          ${_statusBadgeHTML(status)}
          <span class="my-booking-date">${escHtml(dateLabel)}</span>
        </div>
        <div class="my-booking-topic">${escHtml(b.topic || "")}</div>
        ${isApproved ? `
        <div class="my-booking-cal-row">
          ${videoLink ? `<a href="${escHtml(videoLink)}" target="_blank" rel="noopener" class="btn btn-primary btn-sm">Join Meeting</a>` : ""}
          ${gcalUrl   ? `<a href="${escHtml(gcalUrl)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">+ Google Calendar</a>` : ""}
          ${icsUri    ? `<a href="${escHtml(icsUri)}" download="consultation.ics" class="btn btn-ghost btn-sm">+ Download ICS</a>` : ""}
        </div>` : ""}
      </div>`;
  }).join("");
}

// ---- Public exports ----

export async function initConsultationPage(role) {
  _userRole = role;
  const user    = getCurrentUser();
  const isAdmin = hasRole(role, "admin");

  const gate      = document.getElementById("consult-gate");
  const userView  = document.getElementById("consult-user-view");
  const adminView = document.getElementById("consult-admin-view");

  // Show auth gate for unauthenticated users
  if (!user && !isAdmin) {
    if (gate)      gate.style.display      = "";
    if (userView)  userView.style.display  = "none";
    if (adminView) adminView.style.display = "none";
    return;
  }

  if (isAdmin) {
    if (gate)      gate.style.display      = "none";
    if (userView)  userView.style.display  = "none";
    if (adminView) adminView.style.display = "";

    try {
      await _loadSlots();
      await _loadBookings();
      await _loadConsultSettings();
    } catch (e) {
      showToast("Error loading data: " + e.message, "error");
      return;
    }

    _initAdminSlotForm();
    _renderAdminSettings();
    _renderAdminSlots();
    _renderAdminBookings();
  } else {
    if (gate)      gate.style.display      = "none";
    if (adminView) adminView.style.display = "none";
    if (userView)  userView.style.display  = "";

    try {
      await _loadSlots();
    } catch (e) {
      showToast("Error loading slots: " + e.message, "error");
      return;
    }

    const now = new Date();
    _calYear  = now.getFullYear();
    _calMonth = now.getMonth();
    _renderCalendar();

    document.getElementById("cal-prev")?.addEventListener("click", _prevMonth);
    document.getElementById("cal-next")?.addEventListener("click", _nextMonth);
    document.getElementById("booking-cancel-btn")?.addEventListener("click", _hideBookingForm);
    document.getElementById("booking-new-btn")?.addEventListener("click", () => {
      const confirm = document.getElementById("booking-confirmation");
      if (confirm) confirm.style.display = "none";
      const wrap   = document.getElementById("booking-form-wrap");
      if (wrap)    wrap.style.display    = "none";
      _selectedSlotId = null;
    });

    await _loadConsultSettings();
    await _loadUserBookings();
  }
}

export async function submitSlot() {
  const dtInput  = document.getElementById("slot-datetime");
  const durInput = document.getElementById("slot-duration");
  const notesInput = document.getElementById("slot-notes");
  const submitBtn  = document.getElementById("slot-submit-btn");
  const errorEl    = document.getElementById("slot-form-error");

  if (errorEl) errorEl.classList.remove("visible");

  if (!dtInput?.value) {
    if (errorEl) { errorEl.textContent = "Date & time is required."; errorEl.classList.add("visible"); }
    return;
  }

  const user = getCurrentUser();
  if (!user || !hasRole(_userRole, "admin")) {
    showToast("Admin only.", "error"); return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Adding…";

  try {
    const dt = Timestamp.fromDate(new Date(dtInput.value));
    const newSlot = {
      dateTime:     dt,
      durationMins: parseInt(durInput?.value || "30", 10),
      notes:        notesInput?.value.trim() || "",
      isAvailable:  true,
      createdAt:    serverTimestamp(),
      createdBy:    user.uid,
    };
    const ref = await addDoc(collection(db, SLOTS_COL), newSlot);
    _slots.set(ref.id, { ...newSlot, dateTime: dt });

    // Reset form
    if (dtInput)    { const n = new Date(); n.setHours(n.getHours() + 1, 0, 0, 0); dtInput.value = _toLocalDateTimeInput(n); }
    if (durInput)   durInput.value = "30";
    if (notesInput) notesInput.value = "";

    const form      = document.getElementById("slot-add-form");
    const toggleBtn = document.getElementById("slot-toggle-btn");
    if (form)      form.style.display      = "none";
    if (toggleBtn) toggleBtn.textContent   = "+ Add Slot";

    _renderAdminSlots();
    showToast("Slot added.", "success");
  } catch (e) {
    showToast("Failed to add slot: " + e.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Add Slot";
  }
}

export async function submitBooking() {
  const nameEl    = document.getElementById("book-name");
  const emailEl   = document.getElementById("book-email");
  const phoneEl   = document.getElementById("book-phone");
  const topicEl   = document.getElementById("book-topic");
  const submitBtn = document.getElementById("booking-submit-btn");
  const errorEl   = document.getElementById("booking-form-error");

  if (errorEl) errorEl.classList.remove("visible");

  const name  = nameEl?.value.trim();
  const email = emailEl?.value.trim();
  const phone = phoneEl?.value.trim();
  const topic = topicEl?.value.trim();

  if (!name || !email || !topic) {
    if (errorEl) {
      errorEl.textContent = "Name, email, and topic are required.";
      errorEl.classList.add("visible");
    }
    return;
  }

  if (!_selectedSlotId) {
    showToast("Please select a time slot first.", "error"); return;
  }

  const user = getCurrentUser();
  if (!user) { showToast("Please sign in to book.", "error"); return; }

  const slot = _slots.get(_selectedSlotId);
  if (!slot) { showToast("Selected slot not found.", "error"); return; }

  submitBtn.disabled    = true;
  submitBtn.textContent = "Submitting…";

  try {
    await addDoc(collection(db, BOOKINGS_COL), {
      slotId:         _selectedSlotId,
      slotDateTime:   slot.dateTime,
      durationMins:   slot.durationMins || 30,
      requesterUid:   user.uid,
      requesterName:  name,
      requesterEmail: email,
      requesterPhone: phone,
      topic,
      status:         "pending",
      adminNotes:     "",
      createdAt:      serverTimestamp(),
    });

    const wrap    = document.getElementById("booking-form-wrap");
    const confirm = document.getElementById("booking-confirmation");
    if (wrap)    wrap.style.display    = "none";
    if (confirm) confirm.style.display = "";

    showToast("Booking request submitted!", "success");
    await _loadUserBookings();
  } catch (e) {
    showToast("Submission failed: " + e.message, "error");
  } finally {
    submitBtn.disabled    = false;
    submitBtn.textContent = "Submit Request";
  }
}

export async function updateBookingStatus(bookingId, newStatus) {
  try {
    const updateData = {
      status:          newStatus,
      statusUpdatedAt: serverTimestamp(),
    };
    if (newStatus === "approved" && _consultSettings.videoLink) {
      updateData.videoLink = _consultSettings.videoLink;
    }
    await updateDoc(doc(db, BOOKINGS_COL, bookingId), updateData);
    const existing = _bookings.get(bookingId);
    if (existing) _bookings.set(bookingId, { ...existing, ...updateData });

    // Mark slot unavailable when approved so it no longer shows on calendar
    if (newStatus === "approved" && existing?.slotId) {
      await updateDoc(doc(db, SLOTS_COL, existing.slotId), { isAvailable: false });
      const slot = _slots.get(existing.slotId);
      if (slot) _slots.set(existing.slotId, { ...slot, isAvailable: false });
      _renderAdminSlots();
      if (_selectedDate) _renderSlotList();
    }

    _renderAdminBookings();
    showToast("Status updated.", "info");
  } catch (e) {
    showToast("Update failed: " + e.message, "error");
  }
}
