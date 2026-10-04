// Site logo in the top-left corner.
// Placeholder until an admin uploads one. Current choice and past
// uploads live in site_config/logo; image files live in Storage.

import { db, storage } from "./firebase-config.js";
import { doc, onSnapshot, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { initAuth, hasRole, showToast } from "./auth.js?v=11";

const LOGO_DOC = doc(db, "site_config", "logo");
const PLACEHOLDER = "img/logo.png";
export const LOGO_WIDTH = 280;
export const LOGO_HEIGHT = 130;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_EDGE = 560;

let _started = false;
let _isAdmin = false;
let _data = { url: "", path: "", history: [] };

export function initLogo() {
  if (_started) return;
  const brand = document.querySelector(".nav-brand-logo");
  if (!brand) return;
  _started = true;
  ensureUi();
  applyLogo("");

  onSnapshot(LOGO_DOC, (snap) => {
    const data = snap.exists() ? snap.data() : {};
    _data = {
      url: typeof data.url === "string" ? data.url : "",
      path: typeof data.path === "string" ? data.path : "",
      history: Array.isArray(data.history) ? data.history.filter(item => item && item.url) : []
    };
    applyLogo(_data.url);
    renderHistory();
  }, () => {
    applyLogo("");
  });

  initAuth((user, role) => {
    _isAdmin = !!(user && hasRole(role, "admin"));
    const admin = document.getElementById("logo-admin");
    if (admin) admin.hidden = !_isAdmin;
    if (!_isAdmin) {
      const panel = document.getElementById("logo-panel");
      if (panel) panel.hidden = true;
    }
  });
}

function applyLogo(url) {
  document.querySelectorAll(".nav-brand-logo").forEach((img) => {
    const next = url || PLACEHOLDER;
    if (img.getAttribute("src") !== next) img.src = next;
    img.classList.toggle("is-placeholder", !url);
  });
}

function ensureUi() {
  if (document.getElementById("logo-admin")) return;
  const brand = document.querySelector(".nav-brand");
  if (!brand) return;
  const wrap = document.createElement("div");
  wrap.id = "logo-admin";
  wrap.className = "logo-admin";
  wrap.hidden = true;
  wrap.innerHTML = `
    <button type="button" class="btn btn-ghost btn-sm" id="logo-edit-btn">Edit logo</button>
    <div class="logo-panel" id="logo-panel" hidden>
      <p class="logo-size-note">Recommended size: ${LOGO_WIDTH} × ${LOGO_HEIGHT} px. The corner shows it about 74 px wide. PNG or JPG, up to 10 MB.</p>
      <label class="file-input-label">
        Upload a new logo
        <input type="file" id="logo-file" accept="image/png,image/jpeg,image/webp,image/gif" />
      </label>
      <p class="logo-history-label">Previous logos</p>
      <div class="logo-history" id="logo-history"></div>
      <div class="logo-panel-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="logo-use-placeholder">Use placeholder</button>
        <button type="button" class="btn btn-ghost btn-sm" id="logo-close">Close</button>
      </div>
    </div>`;
  brand.insertAdjacentElement("afterend", wrap);

  document.getElementById("logo-edit-btn").addEventListener("click", () => {
    const panel = document.getElementById("logo-panel");
    panel.hidden = !panel.hidden;
  });
  document.getElementById("logo-close").addEventListener("click", () => {
    document.getElementById("logo-panel").hidden = true;
  });
  document.getElementById("logo-use-placeholder").addEventListener("click", () => chooseLogo("", ""));
  document.getElementById("logo-file").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) uploadLogo(file);
  });
}

function renderHistory() {
  const box = document.getElementById("logo-history");
  if (!box) return;
  box.replaceChildren();
  if (!_data.history.length) {
    const empty = document.createElement("p");
    empty.className = "logo-empty";
    empty.textContent = "No previous logos yet.";
    box.appendChild(empty);
    return;
  }
  _data.history.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "logo-past" + (item.url === _data.url ? " is-current" : "");
    btn.title = "Use this logo";
    const img = document.createElement("img");
    img.src = item.url;
    img.alt = "";
    btn.appendChild(img);
    btn.addEventListener("click", () => chooseLogo(item.url, item.path || ""));
    box.appendChild(btn);
  });
}

async function chooseLogo(url, path) {
  if (!_isAdmin) return;
  try {
    await setDoc(LOGO_DOC, { url, path }, { merge: true });
    showToast(url ? "Logo updated." : "Placeholder restored.", "success");
  } catch (err) {
    showToast("Could not update the logo: " + err.message, "error");
  }
}

async function uploadLogo(file) {
  if (!_isAdmin) return;
  if (!file.type.startsWith("image/")) {
    showToast("Choose an image file.", "error");
    return;
  }
  if (file.size > MAX_BYTES) {
    showToast("Logo images must be under 10 MB.", "error");
    return;
  }
  try {
    const prepared = await prepareLogo(file);
    const path = `profile/logo-${Date.now()}.${prepared.ext}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, prepared.blob, { contentType: prepared.contentType });
    const url = await getDownloadURL(storageRef);
    const history = [{ url, path }, ..._data.history.filter(item => item.url !== url)];
    await setDoc(LOGO_DOC, { url, path, history }, { merge: true });
    showToast("Logo uploaded.", "success");
  } catch (err) {
    showToast("Could not upload the logo: " + err.message, "error");
  }
}

function prepareLogo(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = file.type === "image/png";
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("Could not read that image."));
          return;
        }
        resolve({
          blob,
          contentType: png ? "image/png" : "image/jpeg",
          ext: png ? "png" : "jpg"
        });
      }, png ? "image/png" : "image/jpeg", 0.92);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Could not read that image."));
    };
    img.src = objectUrl;
  });
}
