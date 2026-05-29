/**
 * Floating badge attached to a password field.
 *
 * Preact app rendered into a closed Shadow DOM so the host page can't style
 * us and we can't accidentally style it. The badge opens automatically when
 * the password field receives focus.
 */
import { render } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { fullHost, registrableDomain } from "../shared/domain.js";
import { ProfileEditor } from "../shared/ProfileEditor.js";
import { Logo } from "../shared/Logo.js";
import {
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconSettings,
  IconClose,
} from "../shared/icons.js";
import { t } from "../shared/i18n.js";
import type { AccountEntry, Profile } from "../shared/types.js";
import { readUsername } from "./detect.js";
import { BackgroundError, send } from "./messaging.js";
import atomStyles from "../shared/atoms.css?inline";
import badgeStyles from "./badge.css?inline";

const HOST_TAG = "keyfount-badge";
const BANNER_TAG = "keyfount-save-banner";
const ROTATE_TAG = "keyfount-rotate-banner";

// The badge UI lives in a *closed* shadow root so the host page can't reach
// into it (it could otherwise read a generated password from our DOM). e2e
// builds (`KEYFOUNT_E2E=1`, see wxt.config.ts) flip this to "open" so
// Playwright can drive the panel; production stays closed. The badge's
// behaviour is identical either way — only DOM isolation differs.
declare const __E2E__: boolean;
const SHADOW_MODE: ShadowRootMode = __E2E__ ? "open" : "closed";

/**
 * Write a value to an input using the prototype setter so React/Vue/etc
 * controlled components see it, then fire input + change events.
 */
function writeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Show a top-right toast asking the user to save a freshly-filled account.
 * Independent of the per-field badge so it survives the panel closing and
 * is positioned relative to the viewport (Dashlane-style).
 */
export async function showSaveBanner({
  domain,
  username,
  profile,
}: {
  domain: string;
  username: string;
  profile?: Profile;
}): Promise<void> {
  // Remove any previous instance so the new one replaces it cleanly.
  document.querySelectorAll(BANNER_TAG).forEach((el) => el.remove());

  const host = document.createElement(BANNER_TAG);
  host.style.cssText =
    "position: fixed; top: 16px; right: 16px; z-index: 2147483647; pointer-events: none;";
  const shadow = host.attachShadow({ mode: SHADOW_MODE });
  const styleEl = document.createElement("style");
  styleEl.textContent = `${atomStyles}\n${badgeStyles}`;
  shadow.appendChild(styleEl);
  const mount = document.createElement("div");
  shadow.appendChild(mount);
  document.documentElement.appendChild(host);

  const dismiss = () => {
    render(null, mount);
    host.remove();
  };

  render(
    <SaveBanner
      domain={domain}
      username={username}
      {...(profile !== undefined ? { profile } : {})}
      onClose={dismiss}
    />,
    mount,
  );

  // Auto-dismiss after 10s.
  setTimeout(dismiss, 10_000);
}

function SaveBanner({
  domain,
  username,
  profile,
  onClose,
}: {
  domain: string;
  username: string;
  profile?: Profile;
  onClose: () => void;
}) {
  const save = async () => {
    try {
      // Resolve the profile: prefer the one the badge passed in (frozen at
      // fill time). If absent (e.g. legacy pending entry from a previous
      // version), fall back to the site's current effective profile so
      // recording still works.
      let chosen = profile;
      if (chosen === undefined) {
        try {
          const p = await send({ kind: "getProfile", domain });
          chosen = p.profile;
        } catch {
          /* swallowed — recordAccount will fail below if profile is missing */
        }
      }
      if (chosen !== undefined) {
        await send({ kind: "recordAccount", domain, username, profile: chosen });
      }
    } catch {
      /* swallowed — saving is nice-to-have */
    }
    try {
      await send({ kind: "clearPendingSave", domain });
    } catch {
      /* swallowed */
    }
    onClose();
  };

  const dismiss = async () => {
    try {
      await send({ kind: "clearPendingSave", domain });
    } catch {
      /* swallowed */
    }
    onClose();
  };

  return (
    <div class="save-banner" role="alertdialog" aria-label={t("history_save_prompt")}>
      <div class="save-banner__head">
        <Logo size={16} />
        <span class="save-banner__title">{t("history_save_prompt")}</span>
      </div>
      <div class="save-banner__meta">
        <span class="save-banner__domain">{domain}</span>
        <span class="save-banner__username">{username}</span>
      </div>
      <div class="save-banner__actions">
        <button type="button" class="badge__btn badge__btn--primary" onClick={save}>
          {t("history_save_cta")}
        </button>
        <button type="button" class="badge__btn" onClick={dismiss}>
          {t("history_save_dismiss")}
        </button>
      </div>
    </div>
  );
}

/**
 * Top-right banner shown when a password-change form is detected on a
 * page where the user already has a saved account. Offers to rotate
 * the entry's counter, write the new password into the new-password
 * field(s), and persist the bumped profile.
 */
export async function showRotateBanner({ entry }: { entry: AccountEntry }): Promise<void> {
  document.querySelectorAll(ROTATE_TAG).forEach((el) => el.remove());

  const host = document.createElement(ROTATE_TAG);
  host.style.cssText =
    "position: fixed; top: 16px; right: 16px; z-index: 2147483647; pointer-events: none;";
  const shadow = host.attachShadow({ mode: SHADOW_MODE });
  const styleEl = document.createElement("style");
  styleEl.textContent = `${atomStyles}\n${badgeStyles}`;
  shadow.appendChild(styleEl);
  const mount = document.createElement("div");
  shadow.appendChild(mount);
  document.documentElement.appendChild(host);

  const dismiss = () => {
    render(null, mount);
    host.remove();
  };

  render(<RotateBanner entry={entry} onClose={dismiss} />, mount);
  setTimeout(dismiss, 20_000);
}

function RotateBanner({ entry, onClose }: { entry: AccountEntry; onClose: () => void }) {
  const rotate = async () => {
    try {
      const bumped: Profile = {
        ...entry.profile,
        counter: (entry.profile.counter ?? 1) + 1,
      };
      const old = await send({
        kind: "generate",
        domain: entry.domain,
        email: entry.username,
        profile: entry.profile,
      });
      const fresh = await send({
        kind: "generate",
        domain: entry.domain,
        email: entry.username,
        profile: bumped,
      });
      // Fill the page's password fields, writing the old value into the
      // "current-password" slot and the new value everywhere else.
      const passwordInputs = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="password"]'),
      ).filter((el) => el.offsetParent !== null);
      for (const input of passwordInputs) {
        const hintParts = [
          input.getAttribute("autocomplete") ?? "",
          input.name ?? "",
          input.id ?? "",
        ];
        const hint = hintParts.join(" ").toLowerCase();
        if (hint.includes("current") || hint.includes("old")) {
          writeInput(input, old.password);
        } else {
          writeInput(input, fresh.password);
        }
      }
      try {
        await navigator.clipboard.writeText(fresh.password);
        await send({ kind: "armClipboardClear" });
      } catch {
        /* clipboard requires focus on some pages; best-effort */
      }
      await send({
        kind: "updateAccountProfile",
        domain: entry.domain,
        username: entry.username,
        profile: bumped,
      });
    } catch {
      /* swallowed — banner closes anyway */
    }
    onClose();
  };

  return (
    <div class="save-banner" role="alertdialog" aria-label={t("rotate_banner_title")}>
      <div class="save-banner__head">
        <Logo size={16} />
        <span class="save-banner__title">{t("rotate_banner_title")}</span>
      </div>
      <div class="save-banner__meta">
        <span class="save-banner__domain">{entry.domain}</span>
        <span class="save-banner__username">{entry.username}</span>
      </div>
      <p class="badge__status">{t("rotate_banner_body")}</p>
      <div class="save-banner__actions">
        <button type="button" class="badge__btn badge__btn--primary" onClick={rotate}>
          {t("rotate_cta")}
        </button>
        <button type="button" class="badge__btn" onClick={onClose}>
          {t("rotate_dismiss")}
        </button>
      </div>
    </div>
  );
}

export interface BadgeController {
  update: () => void;
  open: () => void;
  close: () => void;
  detach: () => void;
}

export interface AttachOptions {
  password: HTMLInputElement;
  username: HTMLInputElement | null;
  /** Which field the trigger pin attaches to. Both fields are still
   *  written to when Fill is invoked, regardless of the anchor. */
  anchor: "password" | "username";
}

export function attachBadge(options: AttachOptions): BadgeController {
  const { password, username, anchor } = options;
  const anchorField = anchor === "username" && username !== null ? username : password;
  const host = document.createElement(HOST_TAG);
  host.style.cssText =
    "position: absolute; z-index: 2147483647; width: 0; height: 0; pointer-events: none; margin: 0; padding: 0;";
  const shadow = host.attachShadow({ mode: SHADOW_MODE });
  const styleEl = document.createElement("style");
  styleEl.textContent = `${atomStyles}\n${badgeStyles}`;
  shadow.appendChild(styleEl);
  const mount = document.createElement("div");
  shadow.appendChild(mount);
  // Reflect the panel's open/closed state onto the host (regular DOM, no
  // secret leaked) so it's observable for styling and e2e — the panel itself
  // is inside the shadow root.
  host.dataset.open = "false";
  document.documentElement.appendChild(host);

  let openRef: (() => void) | null = null;
  let closeRef: (() => void) | null = null;
  let updateRef: (() => void) | null = null;
  const setOpen = (fn: () => void) => {
    openRef = fn;
  };
  const setClose = (fn: () => void) => {
    closeRef = fn;
  };
  const setUpdate = (fn: () => void) => {
    updateRef = fn;
  };

  // Width must match .badge__panel in badge.css. Used to decide which
  // side of the trigger the panel should open from.
  const PANEL_WIDTH = 300;
  const VIEWPORT_PADDING = 8;
  const TRIGGER_SIZE = 24;
  const TRIGGER_OFFSET_FROM_FIELD = 28;

  const position = () => {
    const rect = anchorField.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      host.style.display = "none";
      return;
    }
    host.style.display = "block";
    const triggerLeft = rect.right - TRIGGER_OFFSET_FROM_FIELD;
    host.style.top = `${window.scrollY + rect.top}px`;
    host.style.left = `${window.scrollX + triggerLeft}px`;

    const viewportWidth = document.documentElement.clientWidth;
    const panelLeftIfRightAnchored = triggerLeft + TRIGGER_SIZE - PANEL_WIDTH;
    const panelRightIfLeftAnchored = triggerLeft + PANEL_WIDTH;
    const overflowsLeft = panelLeftIfRightAnchored < VIEWPORT_PADDING;
    const fitsOnRight = panelRightIfLeftAnchored <= viewportWidth - VIEWPORT_PADDING;
    host.dataset.side = overflowsLeft && fitsOnRight ? "left" : "right";
  };

  render(
    <Badge
      password={password}
      username={username}
      anchor={anchor}
      registerOpen={setOpen}
      registerClose={setClose}
      registerUpdate={setUpdate}
      onOpenChange={(isOpen) => {
        host.dataset.open = isOpen ? "true" : "false";
      }}
    />,
    mount,
  );
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
    close: () => {
      if (closeRef !== null) closeRef();
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
  username: HTMLInputElement | null;
  anchor: "password" | "username";
  registerOpen: (fn: () => void) => void;
  registerClose: (fn: () => void) => void;
  registerUpdate: (fn: () => void) => void;
  onOpenChange: (open: boolean) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "first-run" }
  | { kind: "locked"; hasPin: boolean }
  | { kind: "no-domain" }
  | { kind: "no-email"; domain: string }
  | { kind: "ready"; password: string; domain: string }
  // Saved accounts exist for this site: offer the list (pick to fill) plus
  // a "new account" entry, rather than auto-deriving for the detected email.
  | { kind: "choose"; domain: string }
  | { kind: "error"; message: string };

function Badge({
  password,
  username,
  anchor: _anchor,
  registerOpen,
  registerClose,
  registerUpdate,
  onOpenChange,
}: BadgeProps) {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailOverride, setEmailOverride] = useState("");
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const [saved, setSaved] = useState<AccountEntry[]>([]);
  // When the page is a subdomain, a new account is saved against the
  // registrable domain by default (broad). The user can opt into a
  // full-host save — which also changes the derivation salt, so it must be
  // chosen before the password is generated.
  const [useFullHost, setUseFullHost] = useState(false);
  // Set when the user explicitly starts a new account on a site that
  // already has saved accounts — bypasses page-email detection so they can
  // type a fresh email and get the domain/sub-domain scope chooser.
  const [creatingNew, setCreatingNew] = useState(false);

  useEffect(() => {
    registerOpen(() => setOpen(true));
    registerClose(() => {
      setOpen(false);
      setShowSettings(false);
    });
    registerUpdate(() => {
      /* no-op */
    });
  }, [registerOpen, registerClose, registerUpdate]);

  // Mirror the open state to the host element (see attachBadge).
  useEffect(() => {
    onOpenChange(open);
  }, [open, onOpenChange]);

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

  useEffect(() => {
    if (!open) return;
    setCreatingNew(false);
    void refresh({ intent: "open" });
  }, [open]);

  const refresh = useCallback(
    async (override?: {
      profile?: Profile;
      email?: string;
      useFullHost?: boolean;
      intent?: "open" | "new" | "pick";
    }) => {
      setStatus({ kind: "loading" });
      setCopied(false);
      try {
        const state = await send({ kind: "status" });
        if (state.isFirstRun) {
          setStatus({ kind: "first-run" });
          return;
        }
        if (state.locked) {
          setStatus({ kind: "locked", hasPin: state.hasPin });
          return;
        }
        const domain = registrableDomain(window.location.href);
        if (domain === null) {
          setStatus({ kind: "no-domain" });
          return;
        }

        let savedForDomain: AccountEntry[] = [];
        // Local copy of the just-fetched flag — the `historyEnabled` state
        // set below won't be visible until the next render, so the chooser
        // decision in this same pass must read the fresh value.
        let historyOn = false;
        try {
          const ext = await send({ kind: "getState" });
          historyOn = ext.historyEnabled;
          setHistoryEnabled(ext.historyEnabled);
          if (ext.historyEnabled) {
            const list = await send({ kind: "listAccounts", url: window.location.href });
            savedForDomain = list.entries;
            setSaved(list.entries);
          } else {
            setSaved([]);
          }
        } catch {
          setHistoryEnabled(false);
          setSaved([]);
        }
        const intent = override?.intent;
        // "new" mode (explicit New-account button, or mid-flow after it) skips
        // page-email detection so the user types a fresh email.
        const wantNew = intent === "new" || (intent === undefined && creatingNew);
        // On a fresh open we ignore any stale typed email so the chooser can
        // show; otherwise the typed value drives the flow.
        const overrideEmail = intent === "open" ? "" : emailOverride.trim();

        // When saved accounts exist and the user hasn't picked one or chosen
        // "new", present the chooser instead of auto-deriving a password.
        const hasExplicitEmail = (override?.email ?? "").length > 0;
        if (
          !wantNew &&
          !hasExplicitEmail &&
          intent !== "pick" &&
          historyOn &&
          savedForDomain.length > 0 &&
          overrideEmail.length === 0
        ) {
          setStatus({ kind: "choose", domain });
          return;
        }

        let email = wantNew
          ? (override?.email ?? emailOverride.trim())
          : (override?.email ?? (overrideEmail || readUsername(password)));
        if (!wantNew && email.length === 0) {
          // Sign-up flows often split email (page 1) and password (page 2).
          // The content-script entry stashes the email the user typed on
          // any previous page of the same domain; if we still have nothing
          // to derive from, pick it up here as a last-resort fallback.
          try {
            const recent = await send({ kind: "getRecentUsername", domain });
            if (recent.username !== null) {
              email = recent.username;
              setEmailOverride(recent.username);
              if (username !== null && username.value.trim().length === 0) {
                writeInput(username, recent.username);
              }
            }
          } catch {
            /* swallowed */
          }
        }
        if (email.length === 0) {
          setStatus({ kind: "no-email", domain });
          return;
        }

        // A saved account always wins over the per-site default — its
        // profile is frozen at creation and tracks rotations done from
        // the popup's detail page. Otherwise fall back to the site's
        // effective profile so first-time logins still work. In "new" mode
        // we never match an existing account (so the scope chooser shows).
        const matching = wantNew ? undefined : savedForDomain.find((e) => e.username === email);
        const matchingProfile = matching?.profile ?? null;
        if (matchingProfile === null && profile === null && override?.profile === undefined) {
          const p = await send({ kind: "getProfile", domain });
          setProfile(p.profile);
        }

        // The derivation salt is the account's *canonical* domain. A matched
        // account (subdomain/full-host/linked) carries its own salt, so the
        // linked z.y.com row still yields w.y.com's password. A brand-new
        // account derives from the registrable domain by default, or from the
        // full host when the user opted in on a subdomain.
        const host = fullHost(window.location.href);
        const canNarrow = host !== null && host !== domain;
        const wantFullHost = override?.useFullHost ?? useFullHost;
        const saltDomain = matching
          ? matching.domain
          : wantFullHost && canNarrow && host !== null
            ? host
            : domain;

        const effective = override?.profile ?? matchingProfile ?? profile;
        const response = await send({
          kind: "generate",
          domain: saltDomain,
          email,
          ...(effective !== null ? { profile: effective } : {}),
        });
        setStatus({ kind: "ready", password: response.password, domain: saltDomain });
      } catch (error) {
        setStatus({
          kind: "error",
          message: error instanceof BackgroundError ? error.message : t("badge_failed"),
        });
      }
    },
    [password, profile, emailOverride, useFullHost, creatingNew],
  );

  const fill = useCallback(() => {
    if (status.kind !== "ready") return;
    const currentEmail = emailOverride.trim() || readUsername(password);
    writeInput(password, status.password);
    // Pre-fill the username/email field too when we have a value and the
    // field is empty (or we explicitly know the username from a saved
    // entry). Avoids the previous papercut where clicking Fill only
    // dropped the password and left the email field blank.
    if (username !== null && currentEmail.length > 0 && username.value.trim().length === 0) {
      writeInput(username, currentEmail);
    }
    const alreadySaved = saved.some(
      (e) => e.username === currentEmail && e.domain === status.domain,
    );
    setOpen(false);
    if (historyEnabled && !alreadySaved && currentEmail.length > 0) {
      const profileSnapshot = profile ?? undefined;
      void send({
        kind: "setPendingSave",
        domain: status.domain,
        username: currentEmail,
        ...(profileSnapshot !== undefined ? { profile: profileSnapshot } : {}),
      }).catch(() => {
        /* swallowed */
      });
      void showSaveBanner({
        domain: status.domain,
        username: currentEmail,
        ...(profileSnapshot !== undefined ? { profile: profileSnapshot } : {}),
      });
    }
  }, [password, status, historyEnabled, saved, emailOverride, profile]);

  const pickSaved = useCallback(
    (pickedUsername: string) => {
      setCreatingNew(false);
      setEmailOverride(pickedUsername);
      // Reflect the choice in the page's username field too — saves the
      // user a manual fill afterwards.
      if (username !== null) {
        writeInput(username, pickedUsername);
      }
      void refresh({ intent: "pick", email: pickedUsername });
    },
    [refresh, username],
  );

  // "New account" entry from the chooser: clear the detected email and drop
  // into the generate flow (email input → password with the domain/sub-domain
  // scope chooser + fill/copy).
  const startNew = useCallback(() => {
    setCreatingNew(true);
    setEmailOverride("");
    void refresh({ intent: "new", email: "" });
  }, [refresh]);

  const copy = useCallback(async () => {
    if (status.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(status.password);
      try {
        await send({ kind: "armClipboardClear" });
      } catch {
        /* auto-clear is a nicety; ignore failures */
      }
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
        try {
          await send({ kind: "setProfile", domain: status.domain, profile: next });
        } catch {
          /* swallowed */
        }
      }
      void refresh({ profile: next });
    },
    [refresh, status],
  );

  const submitEmail = useCallback(
    (event: Event) => {
      event.preventDefault();
      void refresh({ email: emailOverride.trim() });
    },
    [refresh, emailOverride],
  );

  const submitUnlock = useCallback(
    async (master: string, mode: "master" | "pin") => {
      try {
        if (mode === "master") {
          await send({ kind: "unlock", master });
        } else {
          await send({ kind: "unlockWithPin", pin: master });
        }
        void refresh();
      } catch (error) {
        setStatus({
          kind: "error",
          message:
            error instanceof BackgroundError
              ? error.message
              : mode === "pin"
                ? t("unlock_incorrect_pin")
                : t("unlock_incorrect"),
        });
      }
    },
    [refresh],
  );

  // Subdomain save-granularity affordance: only meaningful for a brand-new
  // account on a page whose host differs from its registrable root.
  const pageHost = fullHost(window.location.href);
  const pageRegistrable = registrableDomain(window.location.href);
  const canNarrow = pageHost !== null && pageRegistrable !== null && pageHost !== pageRegistrable;
  const currentEmail = emailOverride.trim() || readUsername(password);
  const isNewAccount = currentEmail.length > 0 && !saved.some((e) => e.username === currentEmail);

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
        <Logo size={14} />
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

          {historyEnabled && saved.length > 0 ? (
            <div class="badge__saved">
              <span class="badge__saved-label">{t("history_saved_for_site")}</span>
              <ul class="badge__saved-list">
                {saved.map((entry) => (
                  <li key={entry.username}>
                    <button
                      type="button"
                      class="badge__saved-row"
                      onClick={() => pickSaved(entry.username)}
                    >
                      {entry.username}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {status.kind === "choose" ? (
            <button
              type="button"
              class="badge__btn badge__btn--primary badge__new-account"
              onClick={startNew}
            >
              {t("badge_new_account")}
            </button>
          ) : null}

          {status.kind === "ready" && historyEnabled && canNarrow && isNewAccount ? (
            <div class="badge__scope" role="radiogroup" aria-label={t("save_scope_title")}>
              <span class="badge__scope-title">{t("save_scope_title")}</span>
              <button
                type="button"
                role="radio"
                aria-checked={!useFullHost}
                class={`badge__scope-opt${!useFullHost ? " is-selected" : ""}`}
                onClick={() => {
                  setUseFullHost(false);
                  void refresh({ useFullHost: false });
                }}
              >
                <span class="badge__scope-domain">{pageRegistrable}</span>
                <span class="badge__scope-hint">{t("save_scope_registrable_hint")}</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={useFullHost}
                class={`badge__scope-opt${useFullHost ? " is-selected" : ""}`}
                onClick={() => {
                  setUseFullHost(true);
                  void refresh({ useFullHost: true });
                }}
              >
                <span class="badge__scope-domain">{pageHost}</span>
                <span class="badge__scope-hint">{t("save_scope_full_host_hint")}</span>
              </button>
            </div>
          ) : null}

          {renderBody({
            status,
            showSettings,
            profile,
            copied,
            emailOverride,
            setEmailOverride,
            fill,
            copy,
            onProfileChange,
            submitEmail,
            submitUnlock,
          })}
        </div>
      ) : null}
    </div>
  );
}

interface BodyProps {
  status: Status;
  showSettings: boolean;
  profile: Profile | null;
  copied: boolean;
  emailOverride: string;
  setEmailOverride: (v: string) => void;
  fill: () => void;
  copy: () => void;
  onProfileChange: (p: Profile) => void;
  submitEmail: (e: Event) => void;
  submitUnlock: (value: string, mode: "master" | "pin") => void;
}

function renderBody(props: BodyProps) {
  const { status } = props;

  // The chooser renders its picker (saved list) + "new account" button in the
  // panel itself; nothing else to show here.
  if (status.kind === "choose") {
    return null;
  }

  if (status.kind === "ready" && props.showSettings && props.profile !== null) {
    return <ProfileEditor profile={props.profile} onChange={props.onProfileChange} compact />;
  }

  if (status.kind === "ready") {
    return (
      <ReadyView
        password={status.password}
        copied={props.copied}
        fill={props.fill}
        copy={props.copy}
      />
    );
  }

  if (status.kind === "no-email") {
    return (
      <form class="badge__form" onSubmit={props.submitEmail}>
        <p class="badge__status">{t("badge_no_email")}</p>
        <input
          class="badge__input"
          type="text"
          inputMode="email"
          autocomplete="email"
          placeholder={t("badge_email_placeholder")}
          value={props.emailOverride}
          onInput={(e) => props.setEmailOverride((e.target as HTMLInputElement).value)}
          autoFocus
        />
        <button
          type="submit"
          class="badge__btn badge__btn--primary"
          disabled={props.emailOverride.trim().length === 0}
        >
          {t("common_generate")}
        </button>
      </form>
    );
  }

  if (status.kind === "locked") {
    return <UnlockForm hasPin={status.hasPin} onSubmit={props.submitUnlock} />;
  }

  if (status.kind === "idle" || status.kind === "loading") {
    return (
      <div class="badge__skeleton" aria-busy="true" aria-live="polite">
        <div class="skeleton skeleton--row" />
        <div class="skeleton skeleton--row" />
        <div class="skeleton skeleton--row" />
      </div>
    );
  }
  return <p class="badge__status">{statusMessage(status)}</p>;
}

function UnlockForm({
  hasPin,
  onSubmit,
}: {
  hasPin: boolean;
  onSubmit: (value: string, mode: "master" | "pin") => void;
}) {
  const [mode, setMode] = useState<"master" | "pin">(hasPin ? "pin" : "master");
  const [value, setValue] = useState("");

  const submit = (event: Event) => {
    event.preventDefault();
    if (value.length === 0) return;
    onSubmit(value, mode);
  };

  return (
    <form class="badge__form" onSubmit={submit}>
      {hasPin ? (
        <div class="profile-mode" role="tablist">
          <button
            type="button"
            role="tab"
            aria-pressed={mode === "pin"}
            onClick={() => {
              setMode("pin");
              setValue("");
            }}
          >
            {t("unlock_pin_tab")}
          </button>
          <button
            type="button"
            role="tab"
            aria-pressed={mode === "master"}
            onClick={() => {
              setMode("master");
              setValue("");
            }}
          >
            {t("unlock_master_tab")}
          </button>
        </div>
      ) : null}
      <input
        class="badge__input"
        type="password"
        autocomplete="current-password"
        autoFocus
        {...(mode === "pin"
          ? {
              inputMode: "numeric" as const,
              pattern: "[0-9]*",
              minLength: 4,
              maxLength: 6,
              placeholder: t("unlock_pin_label"),
            }
          : { placeholder: t("setup_master_label") })}
        value={value}
        onInput={(e) => {
          const raw = (e.target as HTMLInputElement).value;
          setValue(mode === "pin" ? raw.replace(/\D/g, "") : raw);
        }}
      />
      <button
        type="submit"
        class="badge__btn badge__btn--primary"
        disabled={mode === "pin" ? value.length < 4 : value.length === 0}
      >
        {t("common_unlock")}
      </button>
    </form>
  );
}

function ReadyView({
  password,
  copied,
  fill,
  copy,
}: {
  password: string;
  copied: boolean;
  fill: () => void;
  copy: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const masked = "•".repeat(Math.min(password.length, 24));
  return (
    <>
      <div class="badge__password-row">
        <code class={revealed ? "badge__password" : "badge__password badge__password--masked"}>
          {revealed ? password : masked}
        </code>
        <button
          type="button"
          class="badge__icon-button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={revealed ? t("common_hide") : t("common_reveal")}
          title={revealed ? t("common_hide") : t("common_reveal")}
        >
          {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
        </button>
      </div>
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
  );
}

function statusMessage(status: Status): string {
  switch (status.kind) {
    case "idle":
    case "loading":
      return t("common_working");
    case "first-run":
      return t("badge_open_extension");
    case "no-domain":
      return t("badge_no_domain");
    case "error":
      return status.message;
    case "locked":
    case "no-email":
    case "ready":
    case "choose":
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
