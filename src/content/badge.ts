/**
 * Floating badge attached to a password field.
 *
 * Implemented as a single host `<div>` with an attached shadow root so the
 * host page's CSS cannot leak into our UI (and vice-versa). No Preact here —
 * the badge is small and runs on every page, so we keep the bundle minimal.
 *
 * Lifecycle:
 *   attachBadge(password)  → creates and positions the badge near `password`.
 *   The returned controller exposes update() and detach() so the content
 *   script can reposition on scroll/resize and clean up on field removal.
 */
import { registrableDomain } from "../shared/domain.js";
import { readUsername } from "./detect.js";
import { send, BackgroundError } from "./messaging.js";

const HOST_TAG = "itsmypassword-badge";

export interface BadgeController {
  update: () => void;
  detach: () => void;
}

export function attachBadge(password: HTMLInputElement): BadgeController {
  const host = document.createElement(HOST_TAG);
  host.style.cssText = `
    position: absolute;
    z-index: 2147483647;
    width: 0;
    height: 0;
    pointer-events: none;
    margin: 0;
    padding: 0;
  `;
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = STYLES + TEMPLATE;
  document.documentElement.appendChild(host);

  const button = shadow.querySelector<HTMLButtonElement>(".badge__button")!;
  const status = shadow.querySelector<HTMLDivElement>(".badge__status")!;
  const fillButton = shadow.querySelector<HTMLButtonElement>(".badge__fill")!;
  const copyButton = shadow.querySelector<HTMLButtonElement>(".badge__copy")!;

  let panelOpen = false;
  let lastGenerated: string | null = null;

  const position = () => {
    const rect = password.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      host.style.display = "none";
      return;
    }
    host.style.display = "block";
    host.style.top = `${window.scrollY + rect.top}px`;
    host.style.left = `${window.scrollX + rect.right - 28}px`;
  };

  const closePanel = () => {
    panelOpen = false;
    shadow.querySelector(".badge__panel")?.classList.add("hidden");
  };

  const openPanel = () => {
    panelOpen = true;
    shadow.querySelector(".badge__panel")?.classList.remove("hidden");
    void refreshSuggestion();
  };

  const refreshSuggestion = async () => {
    status.textContent = "Working…";
    fillButton.disabled = true;
    copyButton.disabled = true;
    try {
      const state = await send({ kind: "status" });
      if (state.locked || state.isFirstRun) {
        status.textContent = state.isFirstRun
          ? "Set up ItsMyPassword from the toolbar icon to start."
          : "Locked — click the toolbar icon to unlock.";
        return;
      }
      const domain = registrableDomain(window.location.href);
      if (domain === null) {
        status.textContent = "This page is not a regular website.";
        return;
      }
      const email = readUsername(password);
      if (email.length === 0) {
        status.textContent = "Type your email in the form first, then click ⚡ again.";
        return;
      }
      const response = await send({ kind: "generate", domain, email });
      lastGenerated = response.password;
      status.textContent = `Ready for ${domain}.`;
      fillButton.disabled = false;
      copyButton.disabled = false;
    } catch (error) {
      lastGenerated = null;
      status.textContent =
        error instanceof BackgroundError ? error.message : "Could not generate a password.";
    }
  };

  const fill = () => {
    if (lastGenerated === null) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (setter !== undefined) setter.call(password, lastGenerated);
    else password.value = lastGenerated;
    password.dispatchEvent(new Event("input", { bubbles: true }));
    password.dispatchEvent(new Event("change", { bubbles: true }));
    closePanel();
  };

  const copy = async () => {
    if (lastGenerated === null) return;
    try {
      await navigator.clipboard.writeText(lastGenerated);
      const previous = copyButton.textContent;
      copyButton.textContent = "Copied";
      setTimeout(() => {
        copyButton.textContent = previous;
      }, 1200);
    } catch {
      status.textContent = "Could not access the clipboard.";
    }
  };

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (panelOpen) closePanel();
    else openPanel();
  });
  fillButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    fill();
  });
  copyButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void copy();
  });

  position();
  const reposition = () => position();
  window.addEventListener("scroll", reposition, { passive: true, capture: true });
  window.addEventListener("resize", reposition, { passive: true });

  return {
    update: position,
    detach: () => {
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
      host.remove();
    },
  };
}

const STYLES = /* css */ `
<style>
  :host { all: initial; }
  .badge {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    align-items: flex-end;
    pointer-events: auto;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    color: #e6e9ef;
  }
  .badge__button {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: none;
    background: #2a3142;
    color: white;
    font-size: 14px;
    cursor: pointer;
    display: grid;
    place-items: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    transition: transform 100ms ease, background-color 100ms ease;
  }
  .badge__button:hover { background: #3a4357; transform: scale(1.05); }
  .badge__panel {
    margin-top: 6px;
    min-width: 220px;
    max-width: 280px;
    padding: 10px 12px;
    background: #181b22;
    color: #e6e9ef;
    border: 1px solid #2a303c;
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .badge__panel.hidden { display: none; }
  .badge__status { line-height: 1.4; }
  .badge__actions { display: flex; gap: 6px; }
  .badge__actions button {
    flex: 1;
    border: none;
    border-radius: 6px;
    padding: 6px 8px;
    background: #7c9cff;
    color: white;
    cursor: pointer;
    font: inherit;
  }
  .badge__actions button:disabled { opacity: 0.5; cursor: not-allowed; }
  .badge__actions button.badge__copy { background: transparent; color: #7c9cff; border: 1px solid #2a303c; }
</style>
`;

const TEMPLATE = /* html */ `
<div class="badge">
  <button class="badge__button" type="button" aria-label="ItsMyPassword">⚡</button>
  <div class="badge__panel hidden" role="dialog" aria-label="ItsMyPassword">
    <div class="badge__status">Working…</div>
    <div class="badge__actions">
      <button class="badge__fill" type="button" disabled>Fill</button>
      <button class="badge__copy" type="button" disabled>Copy</button>
    </div>
  </div>
</div>
`;
