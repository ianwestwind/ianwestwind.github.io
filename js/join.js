// ============================================================
// Multimodal Intelligence Lab — join.js
// Join Us page copy. Admins edit it with the same rich-text
// toolbar as News, Writing, and Research. Stored in site_config/join.
// ============================================================

import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { hasRole, showToast } from "./auth.js?v=13";
import { initEditor, getEditorHTML, renderBody, highlightContent } from "./editor.js?v=box1";

const JOIN_DOC = doc(db, "site_config", "join");

const LEGACY_JOIN_TEXT = [
  "The [Lab Name] Multimodal Intelligence Lab welcomes inquiries from people who want to contribute to our research. We work on methods that combine imaging, physiological signals, clinical records, language, audio, and video to improve health and human understanding.",
  "Applicants include faculty and research scientists, industry partners, postdoctoral fellows, PhD and medical students, other graduate students, and undergraduates, including premedical students. To review each group fairly and efficiently, we use three application forms.",
  "The Collaborator Inquiry is for faculty, researchers, clinicians, and industry partners proposing joint research, data partnerships, grant collaborations, or visiting appointments.",
  "The Graduate & Medical Trainee Application is for PhD students, postdocs, medical students, and master's and other graduate students.",
  "The Undergraduate Application is for undergraduates, including those on a premedical track.",
  "Every form asks for your background, research interests, relevant skills, availability, and a CV, plus questions specific to your stage of training.",
  "Opportunities for course credit, work-study, internships, and paid positions are limited. Every student and trainee therefore starts with a volunteer period of at least six months, during which you build skills, join lab meetings, and contribute to an ongoing project under a mentor. After that period, a volunteer may request a move to credit or paid status, based on their contributions, mentor endorsement, and available positions.",
  "Because this pathway takes a sustained commitment, we generally cannot accept graduating undergraduate seniors or second-year master's students. The exceptions are students in a continuous bachelor's–master's (coterm) program and students who will continue here in graduate school.",
  "We read every application. Please allow [X] weeks for a response, and note that sending a complete application through the correct form is the fastest way to be considered."
].join("\n\n");

export const DEFAULT_JOIN_HTML = [
  "<p>The [Lab Name] Multimodal Intelligence Lab welcomes inquiries from people who want to contribute to our research. We work on methods that combine imaging, physiological signals, clinical records, language, audio, and video to improve health and human understanding.</p>",
  "<p>Applicants include faculty and research scientists, industry partners, postdoctoral fellows, PhD and medical students, other graduate students, and undergraduates, including premedical students.</p>",
  "<h2>Three application forms</h2>",
  "<p>To review each group fairly and efficiently, we use three application forms.</p>",
  "<h3 data-box=\"1\">Collaborator Inquiry</h3>",
  "<p data-box=\"1\">For faculty, researchers, clinicians, and industry partners proposing joint research, data partnerships, grant collaborations, or visiting appointments.</p>",
  "<h3 data-box=\"2\">Graduate &amp; Medical Trainee Application</h3>",
  "<p data-box=\"2\">For PhD students, postdocs, medical students, and master's and other graduate students.</p>",
  "<h3 data-box=\"3\">Undergraduate Application</h3>",
  "<p data-box=\"3\">For undergraduates, including those on a premedical track.</p>",
  "<h2 data-box=\"4\">What every form asks</h2>",
  "<p data-box=\"4\">Every form asks for your background, research interests, relevant skills, availability, and a CV, plus questions specific to your stage of training.</p>",
  "<h2 data-box=\"5\">The first six months</h2>",
  "<p data-box=\"5\">Opportunities for course credit, work-study, internships, and paid positions are limited. Every student and trainee therefore starts with a volunteer period of at least six months, during which you build skills, join lab meetings, and contribute to an ongoing project under a mentor.</p>",
  "<p data-box=\"5\">After that period, a volunteer may request a move to credit or paid status, based on their contributions, mentor endorsement, and available positions.</p>",
  "<h2 data-box=\"7\">After you apply</h2>",
  "<p data-box=\"7\">We read every application. Please allow 2 weeks for a response, and note that sending a complete application through the correct form is the fastest way to be considered.</p>"
].join("");

function withResponseWindow(html) {
  const root = document.createElement("div");
  root.innerHTML = String(html || "").replaceAll("Please allow [X] weeks", "Please allow 2 weeks");
  const limit = "generally cannot accept graduating undergraduate seniors";
  [...root.children].forEach((el) => {
    const text = el.textContent || "";
    if (text.includes(limit) || text.trim() === "Who we can accept") el.remove();
  });
  return root.innerHTML;
}

let _html = DEFAULT_JOIN_HTML;
let _quill = null;
let _bound = false;

function normalize(text) {
  return String(text || "").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function isLegacyDefault(text) {
  return normalize(text) === normalize(LEGACY_JOIN_TEXT);
}

const BOX_CHROME = ["box-start", "box-mid", "box-end"];

function isHeading(el) {
  return /^H[12]$/.test(el.tagName);
}

function boxId(el) {
  return el && el.getAttribute ? (el.getAttribute("data-box") || "") : "";
}

function stripBoxChrome(html) {
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelectorAll("[data-box], .box-start, .box-mid, .box-end").forEach(el => {
    BOX_CHROME.forEach(name => el.classList.remove(name));
    if (!el.getAttribute("class")) el.removeAttribute("class");
  });
  return root.innerHTML;
}

// Older pages boxed text from heading level. Mark those blocks explicitly
// so the same boxes appear, and so an editor can turn them off.
function markLegacyBoxes(html) {
  const root = document.createElement("div");
  root.innerHTML = html;
  if (root.querySelector("[data-box]")) return html;
  const els = [...root.children];
  if (!els.some(el => isHeading(el) || el.tagName === "H3")) return html;

  let nextId = 1;
  const mark = nodes => {
    const id = String(nextId++);
    nodes.forEach(el => el.setAttribute("data-box", id));
  };

  let i = 0;
  while (i < els.length && !isHeading(els[i]) && els[i].tagName !== "H3") i++;
  while (i < els.length) {
    if (!isHeading(els[i]) && els[i].tagName !== "H3") {
      i++;
      continue;
    }
    const start = i;
    if (isHeading(els[i])) i++;
    const bodyStart = i;
    while (i < els.length && !isHeading(els[i])) i++;
    const body = els.slice(bodyStart, i);
    if (!body.some(el => el.tagName === "H3")) {
      mark(els.slice(start, i));
      continue;
    }
    let k = 0;
    while (k < body.length && body[k].tagName !== "H3") k++;
    while (k < body.length) {
      const group = [body[k]];
      k++;
      while (k < body.length && body[k].tagName !== "H3") group.push(body[k++]);
      mark(group);
    }
  }
  return root.innerHTML;
}

function listPieces(el) {
  if (el.tagName !== "OL" && el.tagName !== "UL") return [el];
  const items = [...el.children];
  if (!items.some(li => boxId(li))) return [el];
  const groups = [];
  for (const li of items) {
    const id = boxId(li);
    const last = groups[groups.length - 1];
    if (!last || last.id !== id) groups.push({ id, items: [li] });
    else last.items.push(li);
  }
  return groups.map(group => {
    const list = document.createElement(el.tagName.toLowerCase());
    group.items.forEach(li => {
      li.removeAttribute("data-box");
      list.appendChild(li);
    });
    if (group.id) list.setAttribute("data-box", group.id);
    return list;
  });
}

function organize(root) {
  const nodes = [...root.children].flatMap(listPieces);
  const out = document.createDocumentFragment();
  let i = 0;
  while (i < nodes.length) {
    const id = boxId(nodes[i]);
    if (!id) {
      out.appendChild(nodes[i]);
      i++;
      continue;
    }
    const box = document.createElement("div");
    box.className = "join-box";
    while (i < nodes.length && boxId(nodes[i]) === id) {
      nodes[i].removeAttribute("data-box");
      box.appendChild(nodes[i]);
      i++;
    }
    out.appendChild(box);
  }
  root.replaceChildren(out);
}

function blockSequence(root) {
  const seq = [];
  for (const child of root.children) {
    if (child.tagName === "OL" || child.tagName === "UL") seq.push(...child.children);
    else seq.push(child);
  }
  return seq;
}

function paintBoxes(root) {
  root.querySelectorAll("[data-box], .box-start, .box-mid, .box-end").forEach(el => {
    BOX_CHROME.forEach(name => el.classList.remove(name));
  });
  const blocks = blockSequence(root);
  let i = 0;
  while (i < blocks.length) {
    const id = boxId(blocks[i]);
    if (!id) {
      i++;
      continue;
    }
    const start = i;
    while (i < blocks.length && boxId(blocks[i]) === id) i++;
    blocks[start].classList.add("box-start");
    blocks[i - 1].classList.add("box-end");
    for (let j = start + 1; j < i - 1; j++) blocks[j].classList.add("box-mid");
  }
}

function render(html) {
  const display = document.getElementById("join-display");
  display.innerHTML = stripBoxChrome(renderBody(html || DEFAULT_JOIN_HTML));
  organize(display);
  highlightContent(display);
}

function ensureEditor() {
  if (_quill) return _quill;
  _quill = initEditor("join-toolbar", "join-editor", "join");
  _quill.getModule("toolbar").addHandler("box", function () {
    const quill = this.quill;
    const range = quill.getSelection();
    if (!range) return;
    const current = quill.getFormat(range);
    quill.format("box", current.box ? false : String(Date.now()));
  });
  _quill.on("editor-change", () => paintBoxes(_quill.root));
  return _quill;
}

function openEditor() {
  const error = document.getElementById("join-form-error");
  error.textContent = "";
  error.classList.remove("visible");
  const quill = ensureEditor();
  quill.setContents([]);
  quill.clipboard.dangerouslyPasteHTML(_html || DEFAULT_JOIN_HTML);
  paintBoxes(quill.root);
  document.getElementById("join-edit-wrap").hidden = false;
  document.getElementById("join-edit-btn").hidden = true;
  document.getElementById("join-display").hidden = true;
  quill.focus();
}

function closeEditor() {
  document.getElementById("join-edit-wrap").hidden = true;
  document.getElementById("join-edit-btn").hidden = false;
  document.getElementById("join-display").hidden = false;
}

async function load() {
  try {
    const snap = await getDoc(JOIN_DOC);
    const data = snap.exists() ? snap.data() : {};
    const stored = typeof data.text === "string" ? data.text : "";
    if (stored.trim() && !isLegacyDefault(stored)) {
      let html = stored.trim().startsWith("<") ? stored : renderBody(stored);
      if (data.boxMode !== "explicit") html = markLegacyBoxes(html);
      _html = withResponseWindow(html);
    }
  } catch (e) {
    console.warn("loadJoin", e);
  }
  render(_html);
}

async function save(event) {
  event.preventDefault();
  const error = document.getElementById("join-form-error");
  const next = stripBoxChrome(getEditorHTML(ensureEditor()));
  if (!next) {
    error.textContent = "Write the page text before saving.";
    error.classList.add("visible");
    return;
  }
  const btn = document.getElementById("join-save-btn");
  btn.disabled = true;
  try {
    await setDoc(JOIN_DOC, { text: next, boxMode: "explicit" }, { merge: true });
    _html = next;
    render(_html);
    closeEditor();
    showToast("Join Us updated.", "info");
  } catch (e) {
    error.textContent = "Save failed: " + (e.message || "try again.");
    error.classList.add("visible");
  } finally {
    btn.disabled = false;
  }
}

export async function initJoin(role) {
  document.getElementById("join-edit-btn").hidden = !hasRole(role, "admin");
  if (!_bound) {
    _bound = true;
    document.getElementById("join-edit-btn").addEventListener("click", openEditor);
    document.getElementById("join-cancel-btn").addEventListener("click", closeEditor);
    document.getElementById("join-form").addEventListener("submit", save);
  }
  await load();
}
