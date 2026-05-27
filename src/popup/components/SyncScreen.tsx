/**
 * Inline sync wizard. Lives at `screen.value === "sync"` so it feels like
 * a regular popup navigation (no separate window). Three logical steps,
 * driven by local state:
 *
 *   1. url      — paste server URL + Test connection
 *   2. auth     — type email; the SW reads the master from the unlocked
 *                 session, no second master input
 *   3. pending  — admin must approve; we poll /auth/approval-status
 *                 every 3 s until 'approved' or 'rejected'
 *   4. approved — success summary
 *
 * Wired into App.tsx and reached from SettingsScreen's SyncSection by
 * setting `screen.value = "sync"`.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { send } from "../api.js";
import { Header } from "./Header.js";
import { IconChevronRight } from "../../shared/icons.js";
import { t } from "../../shared/i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import { fingerprint, screen } from "../state.js";
import { loadVaultData } from "../vault.js";

/**
 * Fire-and-forget post-connect bootstrap. The moment the session
 * lands on `approved` (either via the synchronous `syncConnect`
 * response or via the `syncPollApproval` admin-approval poll), we
 * (a) PULL first so any remote deletes (carried in the v2 snapshot's
 * tombstone field) are applied locally before we re-emit our own
 * upserts, then (b) push every locally-known account so the server
 * gets caught up with what was already on this device. Finally we
 * reload the popup vault so the account list rerenders with the
 * merged state — otherwise the user has to close + reopen the popup
 * to see anything change.
 *
 * Pull-then-push is the same order the desktop client uses for
 * `pushAllLocalAccountsAndPull`; before #70 the extension did the
 * inverse (push-then-pull) and resurrected freshly-deleted accounts
 * on every reconnect — see Trigger 1 in Keyfount/desktop#54.
 */
function onSessionApproved(): void {
  void (async () => {
    try {
      await send({ kind: "syncPull" });
    } catch {
      /* best-effort */
    }
    try {
      await send({ kind: "syncPushAll" });
    } catch {
      /* best-effort */
    }
    try {
      await loadVaultData();
    } catch {
      /* swallow */
    }
  })();
}

type Step = "url" | "auth" | "pending" | "approved" | "rejected";

interface DoneState {
  baseUrl: string;
  email: string;
  loggedIn: boolean;
  rejectionReason?: string;
}

export function SyncScreen() {
  const [step, setStep] = useState<Step>("url");
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (step === "auth") {
      const handle = setTimeout(() => emailRef.current?.focus(), 120);
      return () => clearTimeout(handle);
    }
    return undefined;
  }, [step]);

  // Bootstrap from existing session if any (e.g. user re-entered the
  // screen while already pending).
  useEffect(() => {
    void (async () => {
      const status = await send({ kind: "syncStatus" });
      if (status.connected && status.session) {
        setBaseUrl(status.session.baseUrl);
        setEmail(status.session.email);
        if (status.session.approvalStatus === "approved") {
          setDone({ baseUrl: status.session.baseUrl, email: status.session.email, loggedIn: true });
          setStep("approved");
        } else {
          setStep("pending");
          startPolling();
        }
      }
    })();
    return () => stopPolling();
  }, []);

  function startPolling(): void {
    stopPolling();
    const tick = async (): Promise<void> => {
      try {
        const r = await send({ kind: "syncPollApproval" });
        if (r.status === "approved" && "session" in r) {
          setDone({ baseUrl: r.session.baseUrl, email: r.session.email, loggedIn: true });
          setStep("approved");
          onSessionApproved();
          return;
        }
        if (r.status === "rejected") {
          const reasonText = "reason" in r ? r.reason : undefined;
          setDone({
            baseUrl,
            email,
            loggedIn: false,
            ...(reasonText !== undefined ? { rejectionReason: reasonText } : {}),
          });
          setStep("rejected");
          return;
        }
        if (r.status === "no_session") {
          setStep("url");
          return;
        }
        // still pending → re-arm
        pollTimer.current = setTimeout(() => void tick(), 3000);
      } catch {
        // transient network error — keep polling
        pollTimer.current = setTimeout(() => void tick(), 5000);
      }
    };
    pollTimer.current = setTimeout(() => void tick(), 1500);
  }
  function stopPolling(): void {
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function testAndAdvance(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const res = await send({ kind: "syncTestConnection", baseUrl });
      if (!res.reachable) {
        setError(humanReachReason(res.reason));
        return;
      }
      setStep("auth");
    } finally {
      setBusy(false);
    }
  }

  async function connect(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const res = await send({ kind: "syncConnect", baseUrl, email: email.trim() });
      if (res.session.approvalStatus === "pending") {
        setStep("pending");
        startPolling();
      } else {
        setDone({ baseUrl: res.session.baseUrl, email: res.session.email, loggedIn: res.loggedIn });
        setStep("approved");
        onSessionApproved();
      }
    } catch (err) {
      setError(humanConnectError(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelPending(): Promise<void> {
    stopPolling();
    await send({ kind: "syncDisconnect" });
    setStep("url");
    setDone(null);
  }

  return (
    <motion.div
      class="flex flex-col gap-4 p-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header
        subtitle={t("sync_wizard_subtitle")}
        fingerprint={fingerprint.value}
        actions={
          <motion.button
            type="button"
            class="btn btn-quiet btn-icon"
            whileTap={TAP_SCALE}
            onClick={() => {
              stopPolling();
              screen.value = "settings";
            }}
            aria-label={t("common_back")}
          >
            <IconChevronRight size={18} style={{ transform: "rotate(180deg)" }} />
          </motion.button>
        }
      />

      <StepBar step={step} />

      {step === "url" ? (
        <div class="card p-5 flex-col gap-3">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-(--color-ink-muted)">{t("sync_wizard_url_label")}</span>
            <input
              type="url"
              class="input"
              placeholder={t("sync_wizard_url_placeholder")}
              value={baseUrl}
              onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
              disabled={busy}
              autoFocus
            />
          </label>
          {error !== null ? <ErrorBox message={error} /> : null}
          <div class="flex justify-end">
            <motion.button
              type="button"
              class="btn btn-primary"
              onClick={() => void testAndAdvance()}
              disabled={busy || baseUrl.trim().length < 8}
              whileTap={TAP_SCALE}
            >
              {busy ? t("sync_wizard_test_busy") : t("sync_wizard_test_button")}
            </motion.button>
          </div>
        </div>
      ) : null}

      {step === "auth" ? (
        <div class="card p-5 flex-col gap-3">
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-(--color-ink-muted)">{t("sync_wizard_email_label")}</span>
            <input
              ref={emailRef}
              type="email"
              class="input"
              placeholder={t("sync_wizard_email_placeholder")}
              autoComplete="email"
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              disabled={busy}
            />
          </label>
          {error !== null ? <ErrorBox message={error} /> : null}
          <div class="flex justify-between gap-2">
            <motion.button
              type="button"
              class="btn btn-quiet"
              onClick={() => setStep("url")}
              disabled={busy}
              whileTap={TAP_SCALE}
            >
              {t("common_back")}
            </motion.button>
            <motion.button
              type="button"
              class="btn btn-primary"
              onClick={() => void connect()}
              disabled={busy || email.trim().length < 3}
              whileTap={TAP_SCALE}
            >
              {busy ? t("sync_wizard_connect_busy") : t("sync_wizard_connect_button")}
            </motion.button>
          </div>
        </div>
      ) : null}

      {step === "pending" ? (
        <div class="card p-5 flex-col gap-3 items-center">
          <Spinner />
          <strong class="text-sm text-(--color-ink)">{t("sync_wizard_pending_title")}</strong>
          <p class="text-xs text-(--color-ink-muted) text-center">
            <code>{baseUrl}</code>
          </p>
          <motion.button
            type="button"
            class="btn btn-quiet text-xs"
            onClick={() => void cancelPending()}
            whileTap={TAP_SCALE}
          >
            {t("sync_wizard_pending_cancel")}
          </motion.button>
        </div>
      ) : null}

      {step === "approved" && done !== null ? (
        <div class="card p-5 flex-col gap-3">
          <div class="callout callout-success">
            {t("sync_wizard_approved_message", done.baseUrl, done.email)}
          </div>
          <div class="flex justify-end">
            <motion.button
              type="button"
              class="btn btn-primary"
              onClick={() => {
                screen.value = "settings";
              }}
              whileTap={TAP_SCALE}
            >
              {t("sync_wizard_done")}
            </motion.button>
          </div>
        </div>
      ) : null}

      {step === "rejected" && done !== null ? (
        <div class="card p-5 flex-col gap-3">
          <div class="callout callout-danger">
            <strong>{t("sync_wizard_rejected_title")}</strong>
            {done.rejectionReason !== undefined ? (
              <p class="m-0 mt-1 text-xs">
                {t("sync_wizard_rejected_reason", done.rejectionReason)}
              </p>
            ) : (
              <p class="m-0 mt-1 text-xs">{t("sync_wizard_rejected_default")}</p>
            )}
          </div>
          <div class="flex justify-end">
            <motion.button
              type="button"
              class="btn btn-primary"
              onClick={() => void cancelPending()}
              whileTap={TAP_SCALE}
            >
              {t("common_back")}
            </motion.button>
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}

function StepBar({ step }: { step: Step }) {
  const idx = step === "url" ? 0 : step === "auth" ? 1 : 2;
  return (
    <div class="flex items-center gap-1.5 px-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          class={`h-1 flex-1 rounded-full ${
            i <= idx ? "bg-(--color-accent)" : "bg-(--color-stroke-soft)"
          }`}
        />
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <div
      class="h-8 w-8 rounded-full border-2 border-(--color-stroke-soft) border-t-(--color-accent) animate-spin"
      aria-hidden="true"
    />
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div class="callout callout-danger text-xs" role="alert">
      {message}
    </div>
  );
}

function humanReachReason(reason?: string): string {
  switch (reason) {
    case "invalid_url":
      return t("sync_reach_invalid_url");
    case "timeout":
      return t("sync_reach_timeout");
    case "network_error":
      return t("sync_reach_network");
    case "unexpected_payload":
      return t("sync_reach_unexpected");
    default:
      if (reason !== undefined && reason.startsWith("http_")) {
        return t("sync_reach_http", reason.slice(5));
      }
      return t("sync_reach_unknown");
  }
}

function humanConnectError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "locked") {
    return t("sync_err_locked");
  }
  if (message === "wrong master password") {
    return t("sync_err_master_mismatch");
  }
  if (message.includes("too_many_attempts")) {
    return t("sync_err_too_many");
  }
  return t("sync_err_generic", message);
}
