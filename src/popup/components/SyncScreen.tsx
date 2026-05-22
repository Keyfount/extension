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
      const t = setTimeout(() => emailRef.current?.focus(), 120);
      return () => clearTimeout(t);
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
        subtitle="Synchronisation"
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
            <span class="text-xs text-(--color-ink-muted)">URL du serveur</span>
            <input
              type="url"
              class="input"
              placeholder="https://sync.exemple.com"
              value={baseUrl}
              onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
              disabled={busy}
              autoFocus
            />
          </label>
          <p class="text-xs text-(--color-ink-muted) leading-relaxed">
            On envoie un <code>GET /health</code> pour vérifier qu'il répond.
          </p>
          {error !== null ? <ErrorBox message={error} /> : null}
          <div class="flex justify-end">
            <motion.button
              type="button"
              class="btn btn-primary"
              onClick={() => void testAndAdvance()}
              disabled={busy || baseUrl.trim().length < 8}
              whileTap={TAP_SCALE}
            >
              {busy ? "Test en cours…" : "Tester la connexion"}
            </motion.button>
          </div>
        </div>
      ) : null}

      {step === "auth" ? (
        <div class="card p-5 flex-col gap-3">
          <div class="callout callout-info text-xs leading-relaxed flex-col">
            <strong>Ton mot de passe maître n'est pas redemandé</strong>
            <span class="text-(--color-ink-muted)">
              L'extension utilise le master de la session courante. S'il n'est pas le bon, le
              serveur refusera la connexion à l'étape 2 et tu pourras réessayer.
            </span>
          </div>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-(--color-ink-muted)">
              Email (ton identifiant sur ce serveur)
            </span>
            <input
              ref={emailRef}
              type="email"
              class="input"
              placeholder="tu@exemple.com"
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
              Retour
            </motion.button>
            <motion.button
              type="button"
              class="btn btn-primary"
              onClick={() => void connect()}
              disabled={busy || email.trim().length < 3}
              whileTap={TAP_SCALE}
            >
              {busy ? "Connexion…" : "Se connecter"}
            </motion.button>
          </div>
        </div>
      ) : null}

      {step === "pending" ? (
        <div class="card p-5 flex-col gap-3 items-center">
          <Spinner />
          <strong class="text-sm text-(--color-ink)">En attente d'approbation</strong>
          <p class="text-xs text-(--color-ink-muted) leading-relaxed text-center max-w-sm">
            L'administrateur de <code>{baseUrl}</code> doit approuver ton compte. Cette page se
            mettra à jour automatiquement dès qu'il aura statué.
          </p>
          <motion.button
            type="button"
            class="btn btn-quiet text-xs"
            onClick={() => void cancelPending()}
            whileTap={TAP_SCALE}
          >
            Annuler la demande
          </motion.button>
        </div>
      ) : null}

      {step === "approved" && done !== null ? (
        <div class="card p-5 flex-col gap-3">
          <div class="callout callout-success">
            Connecté à <code>{done.baseUrl}</code> en tant que <code>{done.email}</code>.
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
              Terminé
            </motion.button>
          </div>
        </div>
      ) : null}

      {step === "rejected" && done !== null ? (
        <div class="card p-5 flex-col gap-3">
          <div class="callout callout-danger">
            <strong>Connexion refusée</strong>
            {done.rejectionReason !== undefined ? (
              <p class="m-0 mt-1 text-xs">Raison : {done.rejectionReason}</p>
            ) : (
              <p class="m-0 mt-1 text-xs">
                L'administrateur a refusé ta demande. Contacte-le si tu penses que c'est une erreur.
              </p>
            )}
          </div>
          <div class="flex justify-end">
            <motion.button
              type="button"
              class="btn btn-primary"
              onClick={() => void cancelPending()}
              whileTap={TAP_SCALE}
            >
              Retour
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
      return "URL invalide. Utilise http:// ou https://.";
    case "timeout":
      return "Le serveur n'a pas répondu en 5 secondes.";
    case "network_error":
      return "Impossible de joindre l'URL. Vérifie qu'elle est accessible et que CORS est configuré pour cette extension.";
    case "unexpected_payload":
      return "L'URL répond mais ne ressemble pas à un serveur ItsMyPassword.";
    default:
      if (reason !== undefined && reason.startsWith("http_")) {
        return `Le serveur a répondu ${reason.slice(5)}.`;
      }
      return "Erreur inconnue lors du test.";
  }
}

function humanConnectError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "locked") {
    return "L'extension est verrouillée. Reviens à l'écran d'accueil pour saisir ton master, puis relance.";
  }
  if (message === "wrong master password") {
    return "Mot de passe maître refusé par le serveur. Vérifie que le master de l'extension est bien celui que tu utilisais à l'enregistrement.";
  }
  if (message.includes("too_many_attempts")) {
    return "Trop de tentatives échouées récentes. Réessaie dans quelques minutes.";
  }
  return `Échec de la connexion : ${message}`;
}
