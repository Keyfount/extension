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
import { Logo } from "../shared/Logo.js";
import { IconCheck, IconCopy, IconSettings, IconClose } from "../shared/icons.js";
import { t } from "../shared/i18n.js";
import type { Profile } from "../shared/types.js";
import { readUsername } from "./detect.js";
import { BackgroundError, send } from "./messaging.js";
import atomStyles from "../shared/atoms.css?inline";
import badgeStyles from "./badge.css?inline";

const HOST_TAG = "itsmypassword-badge";

export interface BadgeController {
  update: () => void;
  open: () => void;
  close: () => void;
  detach: () => void;
}

export function attachBadge(password: HTMLInputElement): BadgeController {
  const host = document.createElement(HOST_TAG);
  host.style.cssText =
    "position: absolute; z-index: 2147483647; width: 0; height: 0; pointer-events: none; margin: 0; padding: 0;";
  const shadow = host.attachShadow({ mode: "closed" });
  const styleEl = document.createElement("style");
  styleEl.textContent = `${atomStyles}\n${badgeStyles}`;
  shadow.appendChild(styleEl);
  const mount = document.createElement("div");
  shadow.appendChild(mount);
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
    const rect = password.getBoundingClientRect();
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
      registerOpen={setOpen}
      registerClose={setClose}
      registerUpdate={setUpdate}
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
  registerOpen: (fn: () => void) => void;
  registerClose: (fn: () => void) => void;
  registerUpdate: (fn: () => void) => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "first-run" }
  | { kind: "locked"; hasPin: boolean }
  | { kind: "no-domain" }
  | { kind: "no-email"; domain: string }
  | { kind: "ready"; password: string; domain: string }
  | { kind: "error"; message: string };

function Badge({ password, registerOpen, registerClose, registerUpdate }: BadgeProps) {
  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [copied, setCopied] = useState(false);
  const [emailOverride, setEmailOverride] = useState("");

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
    void refresh();
  }, [open]);

  const refresh = useCallback(
    async (override?: { profile?: Profile; email?: string }) => {
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
        const email = override?.email ?? (emailOverride.trim() || readUsername(password));
        if (email.length === 0) {
          setStatus({ kind: "no-email", domain });
          return;
        }

        if (profile === null && override?.profile === undefined) {
          const p = await send({ kind: "getProfile", domain });
          setProfile(p.profile);
        }

        const effective = override?.profile ?? profile;
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
    [password, profile, emailOverride],
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

  if (status.kind === "ready" && props.showSettings && props.profile !== null) {
    return <ProfileEditor profile={props.profile} onChange={props.onProfileChange} compact />;
  }

  if (status.kind === "ready") {
    return (
      <>
        <div class="badge__password">{status.password}</div>
        <div class="badge__actions">
          <button type="button" class="badge__btn badge__btn--primary" onClick={props.fill}>
            {t("common_fill")}
          </button>
          <button type="button" class="badge__btn" onClick={props.copy}>
            {props.copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
            {props.copied ? t("common_copied") : t("common_copy")}
          </button>
        </div>
      </>
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
