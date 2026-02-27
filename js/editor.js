// ============================================================
// WINN Platforms — editor.js
// Quill rich-text editor with Firebase Storage for image / video / audio
// and helpers for thumbnail & general file attachments.
// ============================================================

import { storage } from "./firebase-config.js";
import { ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { showToast } from "./auth.js";

// ---- File-size limits ----
export const LIMITS = {
  image:      10 * 1024 * 1024,   // 10 MB
  audio:      50 * 1024 * 1024,   // 50 MB
  video:     100 * 1024 * 1024,   // 100 MB
  attachment: 25 * 1024 * 1024,   // 25 MB
};

function fmtMB(b) { return `${Math.round(b / 1048576)} MB`; }
function fmtKB(b) { return b >= 1048576 ? fmtMB(b) : `${Math.round(b / 1024)} KB`; }

async function storeFile(file, path) {
  const r = ref(storage, path);
  await uploadBytes(r, file);
  return getDownloadURL(r);
}

function pickFile(accept, multiple = false) {
  return new Promise(resolve => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => resolve(multiple ? [...inp.files] : (inp.files[0] || null));
    inp.click();
  });
}

// ---- Register Quill blots + formats (idempotent) ----
let _registered = false;
function ensureRegistered() {
  if (_registered || typeof Quill === "undefined") return;
  _registered = true;

  // Font families
  const Font = Quill.import("formats/font");
  Font.whitelist = ["georgia", "courier"];
  Quill.register(Font, true);

  // Inline font-size via style attribute
  const Size = Quill.import("attributors/style/size");
  Size.whitelist = ["12px", "14px", "16px", "18px", "20px", "24px", "32px", "48px"];
  Quill.register(Size, true);

  const BlockEmbed = Quill.import("blots/block/embed");

  // Override built-in video blot → native <video> instead of <iframe>
  class VideoBlot extends BlockEmbed {
    static create(url) {
      const n = super.create();
      n.setAttribute("src", url);
      n.setAttribute("controls", "");
      n.style.cssText = "max-width:100%;display:block;margin:.5rem 0";
      return n;
    }
    static value(n) { return n.getAttribute("src"); }
  }
  VideoBlot.blotName = "video";
  VideoBlot.tagName  = "video";
  Quill.register(VideoBlot, true);

  // Custom audio blot
  class AudioBlot extends BlockEmbed {
    static create(url) {
      const n = super.create();
      n.setAttribute("src", url);
      n.setAttribute("controls", "");
      n.style.cssText = "max-width:100%;display:block;margin:.5rem 0";
      return n;
    }
    static value(n) { return n.getAttribute("src"); }
  }
  AudioBlot.blotName = "audio";
  AudioBlot.tagName  = "audio";
  Quill.register(AudioBlot, true);
}

// ---- Inline media handlers ----
async function doImage(quill, ns) {
  const file = await pickFile("image/*");
  if (!file) return;
  if (file.size > LIMITS.image) {
    showToast(`Image exceeds ${fmtMB(LIMITS.image)} limit.`, "error"); return;
  }
  showToast("Uploading image…", "info");
  try {
    const url   = await storeFile(file, `editor-media/${ns}/img-${Date.now()}-${file.name}`);
    const range = quill.getSelection(true);
    quill.insertEmbed(range.index, "image", url, Quill.sources.USER);
    quill.setSelection(range.index + 1, Quill.sources.SILENT);
  } catch { showToast("Image upload failed.", "error"); }
}

async function doVideo(quill, ns) {
  const file = await pickFile("video/*");
  if (!file) return;
  if (file.size > LIMITS.video) {
    showToast(`Video exceeds ${fmtMB(LIMITS.video)} limit.`, "error"); return;
  }
  showToast("Uploading video…", "info");
  try {
    const url   = await storeFile(file, `editor-media/${ns}/vid-${Date.now()}-${file.name}`);
    const range = quill.getSelection(true);
    quill.insertEmbed(range.index, "video", url, Quill.sources.USER);
    quill.setSelection(range.index + 1, Quill.sources.SILENT);
  } catch { showToast("Video upload failed.", "error"); }
}

async function doAudio(quill, ns) {
  const file = await pickFile("audio/*");
  if (!file) return;
  if (file.size > LIMITS.audio) {
    showToast(`Audio exceeds ${fmtMB(LIMITS.audio)} limit.`, "error"); return;
  }
  showToast("Uploading audio…", "info");
  try {
    const url   = await storeFile(file, `editor-media/${ns}/aud-${Date.now()}-${file.name}`);
    const range = quill.getSelection(true);
    quill.insertEmbed(range.index, "audio", url, Quill.sources.USER);
    quill.setSelection(range.index + 1, Quill.sources.SILENT);
  } catch { showToast("Audio upload failed.", "error"); }
}

// ---- Attachment zone ----
// Returns { getAttachments() } where attachments = [{name,url,type,size}]
export function initAttachmentZone(inputId, listId, ns) {
  const inp  = document.getElementById(inputId);
  const list = document.getElementById(listId);
  if (!inp || !list) return { getAttachments: () => [] };

  const files = [];

  inp.addEventListener("change", async () => {
    const picked = [...inp.files];
    inp.value = "";
    for (const f of picked) {
      if (f.size > LIMITS.attachment) {
        showToast(`"${f.name}" exceeds ${fmtMB(LIMITS.attachment)} limit.`, "error");
        continue;
      }
      const item = document.createElement("div");
      item.className = "attach-item attach-uploading";
      item.textContent = `Uploading ${f.name}…`;
      list.appendChild(item);
      try {
        const url = await storeFile(f, `attachments/${ns}/${Date.now()}-${f.name}`);
        const entry = { name: f.name, url, type: f.type, size: f.size };
        files.push(entry);
        item.className = "attach-item";
        item.innerHTML = `
          <a href="${escA(url)}" target="_blank" rel="noopener" class="attach-link">${escA(f.name)}</a>
          <span class="attach-size">${fmtKB(f.size)}</span>
          <button type="button" class="attach-remove" aria-label="Remove">✕</button>
        `;
        item.querySelector(".attach-remove").onclick = () => {
          const i = files.indexOf(entry);
          if (i !== -1) files.splice(i, 1);
          item.remove();
        };
      } catch {
        showToast(`Failed to upload "${f.name}".`, "error");
        item.remove();
      }
    }
  });

  return { getAttachments: () => [...files], reset: () => { files.length = 0; list.innerHTML = ""; } };
}

// ---- Thumbnail zone ----
// Returns { getThumbUrl(), reset() }
export function initThumbnailZone(inputId, previewId, ns) {
  const inp     = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  if (!inp || !preview) return { getThumbUrl: () => null, reset: () => {} };

  let thumbUrl = null;

  inp.addEventListener("change", async () => {
    const file = inp.files[0];
    inp.value  = "";
    if (!file) return;
    if (file.size > LIMITS.image) {
      showToast(`Thumbnail exceeds ${fmtMB(LIMITS.image)} limit.`, "error"); return;
    }
    showToast("Uploading thumbnail…", "info");
    try {
      thumbUrl = await storeFile(file, `thumbnails/${ns}/${Date.now()}-${file.name}`);
      _showThumb(thumbUrl);
    } catch { showToast("Thumbnail upload failed.", "error"); }
  });

  function _showThumb(url) {
    preview.innerHTML = `
      <div class="thumb-preview">
        <img src="${escA(url)}" alt="Thumbnail preview" />
        <button type="button" class="thumb-remove" id="remove-thumb-${inputId}">✕ Remove</button>
      </div>`;
    document.getElementById(`remove-thumb-${inputId}`).onclick = () => {
      thumbUrl = null;
      preview.innerHTML = "";
    };
  }

  return {
    getThumbUrl: () => thumbUrl,
    setThumbUrl: (url) => { thumbUrl = url; if (url) _showThumb(url); else preview.innerHTML = ""; },
    reset: () => { thumbUrl = null; preview.innerHTML = ""; }
  };
}

// ---- Init editor ----
// toolbarId: id of the HTML toolbar <div>
// editorId:  id of the editor <div>
// ns:        storage namespace ("forum" | "news" | "blog")
export function initEditor(toolbarId, editorId, ns) {
  ensureRegistered();

  const quill = new Quill(`#${editorId}`, {
    theme: "snow",
    modules: {
      toolbar: {
        container: `#${toolbarId}`,
        handlers: {
          image: () => doImage(quill, ns),
          video: () => doVideo(quill, ns),
          audio: () => doAudio(quill, ns),
        }
      }
    },
    placeholder: "Write here…"
  });

  return quill;
}

export function getEditorHTML(quill) {
  const h = quill.root.innerHTML;
  return (h === "<p><br></p>" || h === "") ? "" : h;
}

// ---- Body renderer (HTML or legacy plain-text) ----
export function renderBody(html) {
  if (!html) return "";
  if (!html.trimStart().startsWith("<")) {
    // Legacy plain-text body
    return `<p style="white-space:pre-wrap">${escLegacy(html)}</p>`;
  }
  // Convert markdown-style ```lang fences that were typed into Quill as plain text.
  // Quill stores each line as <p>…</p>, so a fence looks like:
  //   <p>```python</p><p>code</p><p>```</p>
  return _convertCodeFences(html);
}

// Finds ```lang … ``` patterns in Quill-saved HTML and converts them to
// <pre class="ql-syntax language-lang"> blocks that hljs can highlight.
function _convertCodeFences(html) {
  return html.replace(
    /<p[^>]*>\s*```(\w*)\s*<\/p>([\s\S]*?)<p[^>]*>\s*```\s*<\/p>/g,
    (_, lang, body) => {
      const lines = [];
      const lineRe = /<p[^>]*>([\s\S]*?)<\/p>/g;
      let m;
      while ((m = lineRe.exec(body)) !== null) {
        const raw = m[1];
        // Empty paragraph (<p><br></p> or <p></p>)
        if (!raw || /^(<br\s*\/?>)?\s*$/.test(raw)) {
          lines.push("");
        } else {
          // Decode Quill-escaped HTML entities, strip any inline tags
          lines.push(
            raw.replace(/<br\s*\/?>/gi, "\n")
               .replace(/<[^>]+>/g, "")
               .replace(/&amp;/g, "&").replace(/&lt;/g, "<")
               .replace(/&gt;/g, ">").replace(/&quot;/g, '"')
               .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
          );
        }
      }
      // Trim leading/trailing blank lines from the block
      const code = lines.join("\n").replace(/^\n+|\n+$/, "");
      // Re-encode for safe innerHTML insertion
      const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const cls = "ql-syntax" + (lang ? ` language-${lang}` : "");
      return `<pre class="${cls}" spellcheck="false">${escaped}</pre>`;
    }
  );
}

// ---- Post preview ----
// btnId: id of the Preview toggle button
// panelId: id of the preview container div
// getContent(): returns { title, thread, body, thumbUrl }
export function initPreview(btnId, panelId, getContent) {
  const btn   = document.getElementById(btnId);
  const panel = document.getElementById(panelId);
  if (!btn || !panel) return;

  btn.addEventListener("click", () => {
    if (panel.dataset.open === "1") {
      panel.dataset.open = "";
      panel.style.display = "none";
      btn.textContent = "Preview";
      return;
    }

    const { title, thread, body, thumbUrl } = getContent();
    const thumbHtml  = thumbUrl ? `<div class="post-detail-thumb"><img src="${escA(thumbUrl)}" alt="" /></div>` : "";
    const threadHtml = thread   ? ` <span class="post-thread-tag">#${escA(thread)}</span>` : "";

    panel.innerHTML = `
      <div class="preview-banner">Preview</div>
      ${thumbHtml}
      <div class="post-detail-title">${escA(title || "(untitled)")}${threadHtml}</div>
      <div class="post-detail-body rich-content"></div>
    `;

    const bodyEl = panel.querySelector(".post-detail-body");
    bodyEl.innerHTML = renderBody(body);
    highlightContent(bodyEl);

    panel.dataset.open = "1";
    panel.style.display = "";
    btn.textContent = "Close Preview";
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

// ---- Syntax highlighting for rendered detail views ----
// Highlights Quill code blocks (pre.ql-syntax) and standard pre>code blocks.
// Call after setting innerHTML on a detail body container.
export function highlightContent(container) {
  if (!window.hljs) return;
  container.querySelectorAll("pre.ql-syntax, pre code").forEach(el => {
    window.hljs.highlightElement(el);
  });
}

function escA(s)      { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function escLegacy(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
