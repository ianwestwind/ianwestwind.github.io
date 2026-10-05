// ============================================================
// Multimodal Intelligence Lab — members.js
// Member directory for regular, moderator, and admin.
// An admin can reassign anyone except another admin.
// A moderator can reassign regular members and visitors.
// ============================================================

import { db } from "./firebase-config.js";
import { collection, doc, deleteField, getDocs, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getCurrentUser, hasRole, escHtml, showToast } from "./auth.js?v=11";
import { onNavOrderChange } from "./nav-visibility.js?v=order1";

const LEVELS = [
  { id: "admin", label: "Admin" },
  { id: "moderator", label: "Moderator" },
  { id: "regular", label: "Regular" },
  { id: "visitor", label: "Visitor" }
];

const ACCESS = {
  full: "Full",
  own: "Own",
  read: "Read",
  none: "None"
};

const RESEARCH_ACCESS = { admin: "full", moderator: "full", regular: "own", visitor: "read" };

const AREA_BY_KEY = {
  about: { label: "About", access: { admin: "full", moderator: "read", regular: "read", visitor: "read" } },
  software: { label: "Software", access: { admin: "full", moderator: "read", regular: "read", visitor: "read" } },
  design: { label: "Design", access: { admin: "full", moderator: "read", regular: "read", visitor: "read" } },
  forum: { label: "Research", access: RESEARCH_ACCESS },
  writing: { label: "Writing", access: { admin: "full", moderator: "own", regular: "own", visitor: "read" } },
  news: { label: "News", access: { admin: "full", moderator: "full", regular: "own", visitor: "read" } },
  teaching: { label: "Teaching", note: "Limited access. Sign up for the class, or ask the director for the password." },
  consultation: { label: "Consultation", access: { admin: "full", moderator: "own", regular: "own", visitor: "none" } },
  timeline: { label: "Timeline", access: { admin: "full", moderator: "read", regular: "read", visitor: "read" } },
  members: { label: "Members", access: { admin: "full", moderator: "own", regular: "read", visitor: "none" } }
};

const HREF_TO_AREA = {
  "index.html": "about",
  "portfolio-software.html": "software",
  "portfolio-design.html": "design",
  "forum.html": "forum",
  "writing.html": "writing",
  "news.html": "news",
  "consultation.html": "consultation",
  "timeline.html": "timeline",
  "members.html": "members"
};

const DEFAULT_AREA_KEYS = ["about", "software", "design", "forum", "writing", "news", "teaching", "consultation", "timeline", "members"];

let _people = [];
let _actorRole = "";
let _bound = false;
let _ready = false;

onNavOrderChange(() => {
  const chart = document.getElementById("org-chart");
  if (_ready && chart && !chart.hidden) paint();
});

const ROLE_CHOICES = [
  { value: "admin", role: "admin", regularClass: "", label: "Admin" },
  { value: "moderator", role: "moderator", regularClass: "", label: "Moderator" },
  { value: "regular-a", role: "regular", regularClass: "a", label: "Regular A" },
  { value: "regular-b", role: "regular", regularClass: "b", label: "Regular B" },
  { value: "regular-c", role: "regular", regularClass: "c", label: "Regular C" },
  { value: "visitor", role: "visitor", regularClass: "", label: "Visitor" }
];

function classOf(person) {
  const value = String(person?.regularClass || "").trim().toLowerCase();
  return value === "a" || value === "b" || value === "c" ? value : "";
}

function roleChoice(value) {
  return ROLE_CHOICES.find(choice => choice.value === value) || null;
}

function personChoiceValue(person) {
  if (person.role === "regular" && classOf(person)) return `regular-${classOf(person)}`;
  return person.role;
}

function assignableRoles(actorRole) {
  if (actorRole === "admin") return ROLE_CHOICES.map(choice => choice.value);
  if (actorRole === "moderator") return ["regular-a", "regular-b", "regular-c", "visitor"];
  return [];
}

function canEditPerson(actorRole, targetRole) {
  if (actorRole === "admin") return targetRole !== "admin";
  if (actorRole === "moderator") return targetRole === "regular" || targetRole === "visitor";
  return false;
}

function memberName(person) {
  const name = String(person.displayName || "").trim();
  if (name) return name;
  const email = String(person.email || "").trim();
  if (email.includes("@")) return email.split("@")[0];
  return "Unnamed";
}

function levelLabel(role, regularClass = "") {
  if (role === "regular" && (regularClass === "a" || regularClass === "b" || regularClass === "c")) {
    return `Regular ${regularClass.toUpperCase()}`;
  }
  return LEVELS.find(level => level.id === role)?.label || role || "Unknown";
}

function canSupervise(lead, member) {
  if (!lead || !member || lead.id === member.id) return false;
  if (lead.role !== "regular" || member.role !== "regular") return false;
  const leadClass = classOf(lead);
  const memberClass = classOf(member);
  if (memberClass === "b") return leadClass === "a";
  if (memberClass === "c") return leadClass === "a" || leadClass === "b";
  return false;
}

function supervisorOf(person, regulars) {
  if (!person?.supervisorId) return null;
  const lead = regulars.find(item => item.id === person.supervisorId);
  return canSupervise(lead, person) ? lead : null;
}

function normalizeRole(role) {
  return String(role || "regular").trim().toLowerCase();
}

function emailLine(email) {
  const value = String(email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return `<span class="org-card-email">${escHtml(value || "No email")}</span>`;
  }
  return `<a class="org-card-email" href="mailto:${escHtml(value)}">${escHtml(value)}</a>`;
}

function roleControl(person, actorRole) {
  const label = levelLabel(person.role, classOf(person));
  if (!canEditPerson(actorRole, person.role) || !person.id) {
    return `<span class="org-card-level">${escHtml(label)}</span>`;
  }
  const currentValue = personChoiceValue(person);
  const choices = assignableRoles(actorRole);
  const known = choices.includes(currentValue);
  const current = known ? "" : `<option value="${escHtml(currentValue)}" selected>${escHtml(label.toUpperCase())}</option>`;
  const options = choices.map(value => {
    const choice = roleChoice(value);
    const selected = value === currentValue ? " selected" : "";
    return `<option value="${escHtml(value)}"${selected}>${escHtml(choice.label.toUpperCase())}</option>`;
  }).join("");
  return `<label class="org-card-level is-editable">
      <span class="org-role-title">${escHtml(label.toUpperCase())}</span>
      <span class="org-role-arrow" aria-hidden="true"></span>
      <select data-assign-role="${escHtml(person.id)}" aria-label="Role for ${escHtml(memberName(person))}">
        ${current}${options}
      </select>
    </label>`;
}

function supervisorControl(person, actorRole, regulars) {
  if (actorRole !== "admin" || person.role !== "regular") return "";
  const choices = sortRegulars(regulars.filter(lead => canSupervise(lead, person)));
  if (!choices.length) return "";
  const currentLead = supervisorOf(person, regulars);
  const current = currentLead ? currentLead.id : "";
  const currentName = currentLead ? memberName(currentLead) : "Unassigned";
  const options = [`<option value=""${current ? "" : " selected"}>Unassigned</option>`]
    .concat(choices.map(lead => {
      const selected = lead.id === current ? " selected" : "";
      return `<option value="${escHtml(lead.id)}"${selected}>${escHtml(memberName(lead))}</option>`;
    }))
    .join("");
  return `<label class="org-card-level is-editable org-lead">
      <span class="org-role-title org-lead-name">${escHtml(currentName)}</span>
      <span class="org-role-arrow" aria-hidden="true"></span>
      <select data-assign-supervisor="${escHtml(person.id)}" aria-label="Supervisor for ${escHtml(memberName(person))}">
        ${options}
      </select>
    </label>`;
}

function leadControl(person, actorRole, moderators, regulars) {
  if (actorRole !== "admin" || person.role !== "regular" || moderators.length < 2) return "";
  if (supervisorOf(person, regulars)) return "";
  const current = moderators.some(mod => mod.id === person.moderatorId) ? person.moderatorId : "";
  const currentMod = moderators.find(mod => mod.id === current);
  const currentName = currentMod ? memberName(currentMod) : "Unassigned";
  const options = [`<option value=""${current ? "" : " selected"}>Unassigned</option>`]
    .concat(moderators.map(mod => {
      const selected = mod.id === current ? " selected" : "";
      return `<option value="${escHtml(mod.id)}"${selected}>${escHtml(memberName(mod))}</option>`;
    }))
    .join("");
  return `<label class="org-card-level is-editable org-lead">
      <span class="org-role-title org-lead-name">${escHtml(currentName)}</span>
      <span class="org-role-arrow" aria-hidden="true"></span>
      <select data-assign-lead="${escHtml(person.id)}" aria-label="Moderator for ${escHtml(memberName(person))}">
        ${options}
      </select>
    </label>`;
}

function profileLines(person) {
  const lines = [person.institution, person.title]
    .map(value => String(value || "").trim())
    .filter(Boolean);
  if (!lines.length) return "";
  return `<div class="org-card-meta">${lines.map(line => `<span>${escHtml(line)}</span>`).join("")}</div>`;
}

function personCard(person, actorRole, moderators, regulars) {
  return `<article class="org-card">
      <span class="org-card-name">${escHtml(memberName(person))}</span>
      ${profileLines(person)}
      ${emailLine(person.email)}
      ${roleControl(person, actorRole)}
      ${supervisorControl(person, actorRole, regulars)}
      ${leadControl(person, actorRole, moderators, regulars)}
    </article>`;
}

function sortByName(list) {
  return list.sort((a, b) => memberName(a).localeCompare(memberName(b), undefined, { sensitivity: "base" }));
}

function sortRegulars(list) {
  const rank = { a: 0, b: 1, c: 2, "": 3 };
  return list.sort((a, b) => {
    const byClass = rank[classOf(a)] - rank[classOf(b)];
    if (byClass) return byClass;
    return memberName(a).localeCompare(memberName(b), undefined, { sensitivity: "base" });
  });
}

function accessMark(kind) {
  const label = ACCESS[kind] || ACCESS.none;
  return `<span class="org-mark is-${escHtml(kind || "none")}">${escHtml(label)}</span>`;
}

function menuAreaKeys() {
  const nav = document.querySelector(".nav-sidebar .nav-links");
  if (!nav) return DEFAULT_AREA_KEYS;
  const keys = [];
  for (const el of nav.children) {
    const link = el.matches("a")
      ? el
      : el.querySelector(":scope > a, :scope > .nav-dropdown-head a, :scope > .nav-dropdown-btn");
    const key = el.dataset.navKey || link?.dataset.navKey || HREF_TO_AREA[link?.getAttribute("href") || ""];
    if (key && AREA_BY_KEY[key] && !keys.includes(key)) keys.push(key);
  }
  return keys.length ? keys : DEFAULT_AREA_KEYS;
}

function researchSubpages() {
  const links = document.querySelectorAll('.nav-dropdown[data-nav-key="forum"] .nav-dropdown-menu a');
  const labels = [...links].map(link => link.textContent.trim()).filter(Boolean);
  const names = labels.length ? labels : ["LEAD", "WINN", "Publications"];
  return names.map(label => ({ label, sub: true, access: RESEARCH_ACCESS }));
}

function orderedAreas() {
  const rows = [];
  for (const key of menuAreaKeys()) {
    rows.push(AREA_BY_KEY[key]);
    if (key === "forum") rows.push(...researchSubpages());
  }
  return rows;
}

function renderLevels() {
  const heads = LEVELS.map(level => `<th scope="col">${escHtml(level.label)}</th>`).join("");
  const rows = orderedAreas().map(row => {
    const cells = row.note
      ? `<td class="org-level-note" colspan="${LEVELS.length}">${escHtml(row.note)}</td>`
      : LEVELS.map(level => `<td>${accessMark(row.access[level.id])}</td>`).join("");
    const label = row.sub ? `- ${row.label}` : row.label;
    return `<tr>
      <th scope="row">${escHtml(label)}</th>
      ${cells}
    </tr>`;
  }).join("");
  return `<section class="org-levels" aria-label="Level descriptions">
    <table>
      <thead>
        <tr><th scope="col">Area</th>${heads}</tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="org-level-key">
      <span class="org-mark is-full">Full</span> runs the page, including other people's posts and comments.
      <span class="org-mark is-own">Own</span> is your own post, comment, or booking on that page.
      <span class="org-mark is-read">Read</span> is view only.
      Regular A, B, and C share the Regular column.
    </p>
  </section>`;
}

function leadOf(regular, moderators) {
  if (!moderators.length) return "";
  if (moderators.length === 1) return moderators[0].id;
  return moderators.some(mod => mod.id === regular.moderatorId) ? regular.moderatorId : "";
}

function personWrap(card, { joint = "", stem = false } = {}) {
  const lead = joint === "in" ? `<span class="org-joint" aria-hidden="true"></span>` : "";
  const tail = joint === "out"
    ? `<span class="org-joint" aria-hidden="true"></span>`
    : (stem ? `<span class="org-stem" aria-hidden="true"></span>` : "");
  return `<div class="org-person">${lead}${card}${tail}</div>`;
}

function kidsList(inner) {
  if (!inner) return "";
  return `<ul class="org-kids"><span class="org-rail" hidden></span>${inner}</ul>`;
}

function branchItem(card, children) {
  return `<li class="org-node">${personWrap(card, { joint: "in", stem: !!children })}${kidsList(children)}</li>`;
}

function regularKids(person, actorRole, moderators, regulars) {
  const kids = sortRegulars(regulars.filter(item => supervisorOf(item, regulars)?.id === person.id));
  if (!kids.length) return "";
  return kids.map(kid => branchItem(
    personCard(kid, actorRole, moderators, regulars),
    regularKids(kid, actorRole, moderators, regulars)
  )).join("");
}

export function renderDirectory(people, actorRole = "") {
  const admins = [];
  const moderators = [];
  const regulars = [];
  const visitors = [];
  const extra = [];
  for (const person of people) {
    const entry = {
      ...person,
      role: normalizeRole(person.role),
      regularClass: classOf(person),
      moderatorId: String(person.moderatorId || ""),
      supervisorId: String(person.supervisorId || "")
    };
    if (entry.role === "admin") admins.push(entry);
    else if (entry.role === "moderator") moderators.push(entry);
    else if (entry.role === "regular") regulars.push(entry);
    else if (entry.role === "visitor") visitors.push(entry);
    else extra.push(entry);
  }
  for (const list of [admins, moderators, visitors, extra]) sortByName(list);
  sortRegulars(regulars);
  const card = person => personCard(person, actorRole, moderators, regulars);

  const moderatorItems = moderators.map(mod => {
    const kids = regulars
      .filter(person => !supervisorOf(person, regulars) && leadOf(person, moderators) === mod.id)
      .map(person => branchItem(card(person), regularKids(person, actorRole, moderators, regulars)));
    return branchItem(card(mod), kids.join(""));
  }).join("");

  const branches = kidsList(moderatorItems);
  let root = "";
  if (admins.length && branches) {
    root = admins.length === 1
      ? `<div class="org-node">${personWrap(card(admins[0]), { stem: true })}${branches}</div>`
      : `<div class="org-node"><div class="org-person"><ul class="org-kids org-parents"><span class="org-rail" hidden></span>${admins.map(person => `<li class="org-node">${personWrap(card(person), { joint: "out" })}</li>`).join("")}</ul><span class="org-stem" aria-hidden="true"></span></div>${branches}</div>`;
  } else if (admins.length) {
    root = `<div class="org-root">${admins.map(person => personWrap(card(person))).join("")}</div>`;
  }
  const tree = (root || branches)
    ? `<div class="org-tree">${root}${branches && !admins.length ? branches : ""}</div>`
    : "";

  const looseRegulars = regulars.filter(person => !supervisorOf(person, regulars) && !leadOf(person, moderators));
  const looseCards = [
    ...looseRegulars.map(person => {
      const kids = regularKids(person, actorRole, moderators, regulars);
      return `<div class="org-node">${personWrap(card(person), { stem: !!kids })}${kidsList(kids)}</div>`;
    }),
    ...visitors.map(person => personWrap(card(person))),
    ...extra.map(person => personWrap(card(person)))
  ];
  const looseHtml = looseCards.length ? `<div class="org-loose">${looseCards.join("")}</div>` : "";

  return `${renderLevels()}${tree}${looseHtml}`;
}

async function onAssign(event) {
  const select = event.target.closest?.("[data-assign-role]");
  if (!select) return;
  const person = _people.find(item => item.id === select.dataset.assignRole);
  if (!person || !canEditPerson(_actorRole, person.role)) return;
  const nextValue = select.value;
  const next = roleChoice(nextValue);
  const prev = personChoiceValue(person);
  if (!next || nextValue === prev || !assignableRoles(_actorRole).includes(nextValue)) {
    select.value = prev;
    return;
  }
  const name = memberName(person);
  if (!confirm(`Set ${name} to ${next.label}?`)) {
    select.value = prev;
    return;
  }
  select.disabled = true;
  try {
    const patch = { role: next.role };
    if (next.regularClass) patch.regularClass = next.regularClass;
    else patch.regularClass = deleteField();
    const updated = { ...person, role: next.role, regularClass: next.regularClass };
    const regulars = _people.filter(item => (item.id === person.id ? updated.role : item.role) === "regular")
      .map(item => item.id === person.id ? updated : item);
    const lead = supervisorOf(updated, regulars);
    if (!lead) patch.supervisorId = deleteField();
    if (next.role !== "regular") patch.moderatorId = deleteField();
    await updateDoc(doc(db, "users", person.id), patch);
    person.role = next.role;
    person.regularClass = next.regularClass;
    if (!lead) person.supervisorId = "";
    if (next.role !== "regular") person.moderatorId = "";
    if (_actorRole === "admin") await clearBrokenSupervision(person);
    showToast(`${name} is now ${next.label}.`, "success");
    paint();
  } catch (err) {
    select.disabled = false;
    select.value = prev;
    showToast("Could not update role: " + (err.message || "unknown error"), "error");
  }
}

async function clearBrokenSupervision(person) {
  const regulars = _people.filter(item => item.role === "regular");
  const broken = regulars.filter(item => item.supervisorId === person.id && !canSupervise(person, item));
  await Promise.all(broken.map(async item => {
    await updateDoc(doc(db, "users", item.id), { supervisorId: deleteField() });
    item.supervisorId = "";
  }));
}

async function onAssignLead(event) {
  const select = event.target.closest?.("[data-assign-lead]");
  if (!select || _actorRole !== "admin") return;
  const person = _people.find(item => item.id === select.dataset.assignLead);
  if (!person || person.role !== "regular") return;
  const next = select.value;
  const stored = String(person.moderatorId || "");
  const moderators = _people.filter(item => item.role === "moderator");
  const prev = moderators.some(mod => mod.id === stored) ? stored : "";
  if (next === prev) return;
  if (moderators.length < 2 || (next && !moderators.some(mod => mod.id === next))) {
    select.value = prev;
    return;
  }
  const name = memberName(person);
  const lead = moderators.find(mod => mod.id === next);
  const message = lead
    ? `Place ${name} with ${memberName(lead)}?`
    : `Remove ${name} from a moderator?`;
  if (!confirm(message)) {
    select.value = prev;
    return;
  }
  select.disabled = true;
  try {
    const patch = next
      ? { moderatorId: next, supervisorId: deleteField() }
      : { moderatorId: deleteField() };
    await updateDoc(doc(db, "users", person.id), patch);
    person.moderatorId = next;
    if (next) person.supervisorId = "";
    showToast(lead ? `${name} is with ${memberName(lead)}.` : `${name} is unassigned.`, "success");
    paint();
  } catch (err) {
    select.disabled = false;
    select.value = prev;
    showToast("Could not update moderator: " + (err.message || "unknown error"), "error");
  }
}

async function onAssignSupervisor(event) {
  const select = event.target.closest?.("[data-assign-supervisor]");
  if (!select || _actorRole !== "admin") return;
  const person = _people.find(item => item.id === select.dataset.assignSupervisor);
  if (!person || person.role !== "regular") return;
  const next = select.value;
  const regulars = _people.filter(item => item.role === "regular");
  const prevLead = supervisorOf(person, regulars);
  const prev = prevLead ? prevLead.id : "";
  if (next === prev) return;
  const lead = regulars.find(item => item.id === next);
  if (next && !canSupervise(lead, person)) {
    select.value = prev;
    return;
  }
  const name = memberName(person);
  const message = lead
    ? `Place ${name} under ${memberName(lead)}?`
    : `Remove ${name} from a supervisor?`;
  if (!confirm(message)) {
    select.value = prev;
    return;
  }
  select.disabled = true;
  try {
    const patch = next
      ? { supervisorId: next, moderatorId: deleteField() }
      : { supervisorId: deleteField() };
    await updateDoc(doc(db, "users", person.id), patch);
    person.supervisorId = next;
    if (next) person.moderatorId = "";
    showToast(lead ? `${name} is under ${memberName(lead)}.` : `${name} is unassigned.`, "success");
    paint();
  } catch (err) {
    select.disabled = false;
    select.value = prev;
    showToast("Could not update supervisor: " + (err.message || "unknown error"), "error");
  }
}

function directCardCenters(ul) {
  return [...ul.children].filter(el => el.classList.contains("org-node")).flatMap(node => {
    const card = node.querySelector(":scope > .org-person > .org-card");
    if (!card) return [];
    const rect = card.getBoundingClientRect();
    return [rect.top + rect.height / 2];
  });
}

function personAnchorY(person) {
  const card = person.querySelector(":scope > .org-card");
  if (card) {
    const rect = card.getBoundingClientRect();
    return rect.top + rect.height / 2;
  }
  const ul = person.querySelector(":scope > .org-kids");
  const centers = ul ? directCardCenters(ul) : [];
  if (centers.length) return (centers[0] + centers[centers.length - 1]) / 2;
  const rect = person.getBoundingClientRect();
  return rect.top + rect.height / 2;
}

function alignClusterStem(person) {
  const stem = person.querySelector(":scope > .org-stem");
  const ul = person.querySelector(":scope > .org-kids");
  if (!stem || !ul) return;
  const centers = directCardCenters(ul);
  if (!centers.length) return;
  const mid = (centers[0] + centers[centers.length - 1]) / 2;
  const ulRect = ul.getBoundingClientRect();
  stem.style.transform = `translateY(${mid - (ulRect.top + ulRect.height / 2)}px)`;
}

export function layoutOrgLines(root) {
  if (!root) return;
  root.querySelectorAll(".org-person, .org-stem").forEach(el => { el.style.transform = ""; });
  const nodes = [...root.querySelectorAll(".org-node")].sort((a, b) =>
    a.querySelectorAll(".org-node").length - b.querySelectorAll(".org-node").length
  );
  nodes.forEach(node => {
    const person = node.querySelector(":scope > .org-person");
    const kids = node.querySelector(":scope > .org-kids");
    if (!person || !kids) return;
    alignClusterStem(person);
    const centers = directCardCenters(kids);
    if (!centers.length) return;
    const mid = (centers[0] + centers[centers.length - 1]) / 2;
    const delta = mid - personAnchorY(person);
    if (Math.abs(delta) > 0.5) person.style.transform = `translateY(${delta}px)`;
  });
  root.querySelectorAll(".org-kids").forEach(ul => {
    const rail = ul.querySelector(":scope > .org-rail");
    if (!rail) return;
    const centers = directCardCenters(ul);
    if (centers.length < 2) {
      rail.hidden = true;
      return;
    }
    const top = ul.getBoundingClientRect().top;
    rail.hidden = false;
    rail.style.top = `${centers[0] - top}px`;
    rail.style.height = `${Math.max(0, centers[centers.length - 1] - centers[0])}px`;
  });
}

function paint() {
  const chart = document.getElementById("org-chart");
  if (!chart) return;
  chart.innerHTML = renderDirectory(_people, _actorRole);
  layoutOrgLines(chart);
}

export async function initMembers(role) {
  const chart = document.getElementById("org-chart");
  const gate = document.getElementById("org-gate");
  const gateCopy = document.getElementById("org-gate-copy");
  const gateLogin = document.getElementById("org-gate-login");
  if (!chart || !gate) return;

  if (!_bound) {
    _bound = true;
    chart.addEventListener("change", (event) => {
      if (event.target.closest?.("[data-assign-supervisor]")) onAssignSupervisor(event);
      else if (event.target.closest?.("[data-assign-lead]")) onAssignLead(event);
      else onAssign(event);
    });
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(() => {
        if (!chart.hidden) layoutOrgLines(chart);
      }).observe(chart);
    }
  }

  if (!hasRole(role, "regular")) {
    chart.hidden = true;
    chart.innerHTML = "";
    gate.hidden = false;
    const signedIn = !!getCurrentUser();
    if (gateCopy) {
      gateCopy.textContent = signedIn
        ? "This directory is for regular members, moderators, and admins."
        : "Sign in with a regular member account or above to see the directory.";
    }
    if (gateLogin) gateLogin.hidden = signedIn;
    return;
  }

  _actorRole = hasRole(role, "admin") ? "admin" : hasRole(role, "moderator") ? "moderator" : "";
  gate.hidden = true;
  chart.hidden = false;
  chart.innerHTML = `<p class="org-empty">Loading members…</p>`;
  try {
    const snap = await getDocs(collection(db, "users"));
    _people = snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
      role: normalizeRole(d.data().role),
      regularClass: classOf(d.data()),
      moderatorId: String(d.data().moderatorId || ""),
      supervisorId: String(d.data().supervisorId || "")
    }));
    _ready = true;
    paint();
  } catch (err) {
    chart.innerHTML = `<p class="org-empty">Could not load members. ${escHtml(err.message || "")}</p>`;
  }
}
