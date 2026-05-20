/**
 * Floating badge attached to a password field.
 *
 * Preact app rendered into a closed Shadow DOM so the host page can't style
 * us and we can't accidentally style it. The badge opens automatically when
 * the password field receives focus.
 */
import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { registrableDomain } from "../shared/domain.js";
import { ProfileEditor } from "../shared/ProfileEditor.js";
import { IconBolt, IconCheck, IconCopy, IconSettings, IconClose } from "../shared/icons.js";
import { t } from "../shared/i18n.js";
import type { Profile } from "../shared/types.js";
import { readUsername } from "./detect.js";
import { BackgroundError, send } from "./messaging.js";
import badgeStyles from "./badge.css?inline";

const HOST_TAG = "itsmypassword-badge";

export interface BadgeController {
  update: () => void;
  open: () => void;
  detach: () => void;
}

export function attachBadge(password: HTMLInputElement): BadgeController {
  const host = document.createElement(HOST_TAG);
  host.style.cssText =
    "position: absolute; z-index: 2147483647; width: 0; height: 0; pointer-events: none; margin: 0; padding: 0;";
  const shadow = host.attachShadow({ mode: "closed" });
  const styleEl = document.createElement("style");
  styleEl.textContent = badgeStyles;
  shadow.appendChild(styleEl);
  const mount = document.createElement("div");
  shadow.appendChild(mount);
  document.documentElement.appendChild(host);

  let openRef: (() => void) | null = null;
  let updateRef: (() => void) | null = null;
  const setOpen = (fn: () => void) => {
    openRef = fn;
  };
  const setUpdate = (fn: () => void) => {
    updateRef = fn;
  };

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

  render(<Badge password={password} registerOpen={setOpen} registerUpdate={setUpdate} />, mount);
  position();

  const reposition = () => {
    position();
    if (updateRef !== null) updateRef();
  };
  window.addEventListener("scroll", reposition, { passive: true, capture: true });
  window.addEventListener("resize", reposition, { passive: true });

  return {
    update: position,
    open: () => {
      if (openRef !== null) openRef();
    },
    detach: () => {
      window.removeEventListener("scroll", reposition, { capture: true });
      window.removeEventListener("resize", reposition);
      render(null, mount);
      host.remove();
    },
  };
}

interface BadgeProps {
  password: HTMLInputElement;
  registerOpen: (fn: () => void) => void;
  registerUpdate: (fn: () => void) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "first-run" }
  | { kind: "locked" }
  | { kind: "no-domain" }
  | { kind: "no-email" }
  | { kind: "ready"; password: string; domain: string }
  | { kind: "error"; message: string };

function Badge({ password, registerOpen, registerUpdate }: BadgeProps) {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    registerOpen(() => setOpen(true));
    registerUpdate(() => {
      // no-op for now — Preact re-renders position-driven elements via CSS
    });
  }, [registerOpen, registerUpdate]);

  // Close the panel if the user clicks outside.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target !== null && !password.contains(target) && !findHost(target)) {
        setOpen(false);
        setShowSettings(false);
      }
    };
    window.addEventListener("mousedown", onClick, true);
    return () => window.removeEventListener("mousedown", onClick, true);
  }, [open, password]);

  // Re-suggest whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open]);

  const refresh = useCallback(
    async (override?: Profile) => {
      setStatus({ kind: "loading" });
      setCopied(false);
      try {
        const state = await send({ kind: "status" });
        if (state.isFirstRun) {
          setStatus({ kind: "first-run" });
          return;
        }
        if (state.locked) {
          setStatus({ kind: "locked" });
          return;
        }
        const domain = registrableDomain(window.location.href);
        if (domain === null) {
          setStatus({ kind: "no-domain" });
          return;
        }
        const email = readUsername(password);
        if (email.length === 0) {
          setStatus({ kind: "no-email" });
          return;
        }

        // Pull the current profile so we can edit it inline.
        if (profile === null && override === undefined) {
          const p = await send({ kind: "getProfile", domain });
          setProfile(p.profile);
        }

        const effective = override ?? profile;
        const response = await send({
          kind: "generate",
          domain,
          email,
          ...(effective !== null ? { profile: effective } : {}),
        });
        setStatus({ kind: "ready", password: response.password, domain });
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof BackgroundError ? error.message : t("badge_failed"),
        });
      }
    },
    [password, profile],
  );

  const fill = useCallback(() => {
    if (status.kind !== "ready") return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    if (setter !== undefined) setter.call(password, status.password);
    else password.value = status.password;
    password.dispatchEvent(new Event("input", { bubbles: true }));
    password.dispatchEvent(new Event("change", { bubbles: true }));
    setOpen(false);
  }, [password, status]);

  const copy = useCallback(async () => {
    if (status.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(status.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setStatus({ kind: "error", message: t("badge_no_clipboard") });
    }
  }, [status]);

  const onProfileChange = useCallback(
    async (next: Profile) => {
      setProfile(next);
      if (status.kind === "ready") {
        const domain = status.domain;
        try {
          await send({ kind: "setProfile", domain, profile: next });
        } catch {
          // ignore — the badge still re-derives below
        }
      }
      void refresh(next);
    },
    [refresh, status],
  );

  return (
    <div class="badge">
      <button
        type="button"
        class="badge__trigger"
        aria-label={t("extName")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
          if (open) setShowSettings(false);
        }}
      >
        <IconBolt size={14} />
      </button>

      {open ? (
        <div class="badge__panel">
          <div class="badge__header">
            <span class="badge__title">
              {status.kind === "ready" ? t("badge_ready_for", status.domain) : t("extName")}
            </span>
            <div class="badge__header-actions">
              {status.kind === "ready" && profile !== null ? (
                <button
                  type="button"
                  class="badge__icon-button"
                  onClick={() => setShowSettings((v) => !v)}
                  aria-label={t("badge_customize")}
                >
                  <IconSettings size={14} />
                </button>
              ) : null}
              <button
                type="button"
                class="badge__icon-button"
                onClick={() => {
                  setOpen(false);
                  setShowSettings(false);
                }}
                aria-label={t("common_close")}
              >
                <IconClose size={14} />
              </button>
            </div>
          </div>

          {status.kind === "ready" && showSettings && profile !== null ? (
            <div class="badge__settings">
              <ProfileEditor profile={profile} onChange={onProfileChange} compact />
            </div>
          ) : status.kind === "ready" ? (
            <>
              <div class="badge__password">{status.password}</div>
              <div class="badge__actions">
                <button type="button" class="badge__btn badge__btn--primary" onClick={fill}>
                  {t("common_fill")}
                </button>
                <button type="button" class="badge__btn" onClick={copy}>
                  {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                  {copied ? t("common_copied") : t("common_copy")}
                </button>
              </div>
            </>
          ) : (
            <p class="badge__status">{statusMessage(status)}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function statusMessage(status: Status): string {
  switch (status.kind) {
    case "idle":
    case "loading":
      return t("common_working");
    case "first-run":
      return t("badge_first_run");
    case "locked":
      return t("badge_locked");
    case "no-domain":
      return t("badge_no_domain");
    case "no-email":
      return t("badge_no_email");
    case "error":
      return status.message;
    case "ready":
      return "";
  }
}

function findHost(node: Node): HTMLElement | null {
  let cur: Node | null = node;
  while (cur !== null) {
    if (cur instanceof HTMLElement && cur.tagName.toLowerCase() === HOST_TAG) return cur;
    cur = cur.parentNode ?? (cur as ShadowRoot).host ?? null;
  }
  return null;
}
