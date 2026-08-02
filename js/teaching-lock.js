// ============================================================
// WINN Platforms — teaching-lock.js
// Password-gates the Teaching nav dropdown. Unlock persists
// for the browser session via sessionStorage.
// ============================================================

const STORAGE_KEY = "winn-teaching-unlocked";
const PASSWORD = "9999";

function isUnlocked() {
  return sessionStorage.getItem(STORAGE_KEY) === "1";
}

function setUnlocked() {
  sessionStorage.setItem(STORAGE_KEY, "1");
}

function ensureModal() {
  if (document.getElementById("teaching-lock-modal")) return;

  const modal = document.createElement("div");
  modal.id = "teaching-lock-modal";
  modal.className = "teaching-lock-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "teaching-lock-title");
  modal.innerHTML = `
    <div class="teaching-lock-dialog">
      <h3 id="teaching-lock-title" class="teaching-lock-title">Teaching Access</h3>
      <p class="teaching-lock-hint">Enter the password to view teaching materials.</p>
      <form id="teaching-lock-form" class="teaching-lock-form" autocomplete="off">
        <input
          type="password"
          id="teaching-lock-input"
          class="teaching-lock-input"
          placeholder="Password"
          inputmode="numeric"
          maxlength="32"
          required
        />
        <p class="teaching-lock-error" id="teaching-lock-error" hidden>Incorrect password.</p>
        <div class="teaching-lock-actions">
          <button type="button" class="btn btn-ghost btn-sm" id="teaching-lock-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm">Unlock</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => {
    modal.classList.remove("is-open");
    const err = document.getElementById("teaching-lock-error");
    const input = document.getElementById("teaching-lock-input");
    if (err) err.hidden = true;
    if (input) input.value = "";
  };

  document.getElementById("teaching-lock-cancel").addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) close();
  });

  document.getElementById("teaching-lock-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("teaching-lock-input");
    const err = document.getElementById("teaching-lock-error");
    if ((input?.value || "") === PASSWORD) {
      setUnlocked();
      close();
      document.querySelectorAll(".nav-dropdown[data-nav-key='teaching']").forEach((dd) => {
        dd.classList.add("open");
      });
    } else if (err) {
      err.hidden = false;
      input?.select();
    }
  });
}

function openModal() {
  ensureModal();
  const modal = document.getElementById("teaching-lock-modal");
  const input = document.getElementById("teaching-lock-input");
  const err = document.getElementById("teaching-lock-error");
  if (err) err.hidden = true;
  modal.classList.add("is-open");
  requestAnimationFrame(() => input?.focus());
}

export function initTeachingLock() {
  document.querySelectorAll(".nav-dropdown[data-nav-key='teaching']").forEach((dropdown) => {
    const btn = dropdown.querySelector(".nav-dropdown-btn");
    if (!btn || btn.dataset.teachingLockBound === "1") return;
    btn.dataset.teachingLockBound = "1";
    btn.removeAttribute("onclick");

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isUnlocked()) {
        dropdown.classList.toggle("open");
        return;
      }
      dropdown.classList.remove("open");
      openModal();
    });
  });
}
