/**
 * Connection wizard for self-hosted sync. Three steps:
 *   1. Server URL  — user pastes the URL, we ping /health
 *   2. Credentials — email + master, we run OPAQUE (login else register)
 *   3. Done        — success summary + Close
 *
 * The master is asked at this step (it has to be: OPAQUE needs it to
 * derive the login key). It's sent to the background via `chrome.runtime`
 * which keeps it inside the SW process — never persisted, never returned.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { send } from "../api.js";
import { SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";

type Step = "url" | "auth" | "done";

interface DoneState {
  baseUrl: string;
  email: string;
  loggedIn: boolean;
}

interface Props {
  onClose: () => void;
  /** Called with a success summary after we land on the "done" step. */
  onConnected: () => void | Promise<void>;
}

export function SyncWizard({ onClose, onConnected }: Props) {
  const [step, setStep] = useState<Step>("url");
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [master, setMaster] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);
  const masterRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (step === "auth") {
      // Defer focus until the transition completes.
      const t = setTimeout(() => masterRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [step]);

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
      const res = await send({
        kind: "syncConnect",
        baseUrl,
        email: email.trim(),
        master,
      });
      setDone({ baseUrl: res.session.baseUrl, email: res.session.email, loggedIn: res.loggedIn });
      setStep("done");
      // Clear the master from memory immediately — the SW has what it
      // needs (the persisted session).
      setMaster("");
      await onConnected();
    } catch (err) {
      setError(humanConnectError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      class="card p-5 flex-col gap-4"
      variants={{
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
      }}
    >
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col gap-0.5 min-w-0">
          <strong class="text-sm text-(--color-ink)">Connecter un serveur</strong>
          <span class="text-xs text-(--color-ink-muted)">
            Étape {step === "url" ? 1 : step === "auth" ? 2 : 3} / 3
          </span>
        </div>
        <motion.button
          type="button"
          class="btn btn-ghost text-xs"
          onClick={onClose}
          whileTap={TAP_SCALE}
        >
          Fermer
        </motion.button>
      </div>

      <StepBar step={step} />

      {step === "url" ? (
        <div class="flex flex-col gap-3">
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
            Saisis l'URL publique de ton serveur ItsMyPassword. On envoie un{" "}
            <code>GET /health</code> pour vérifier qu'il répond.
          </p>
          {error ? <ErrorBox message={error} /> : null}
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
        <div class="flex flex-col gap-3">
          <div class="callout callout-info text-xs leading-relaxed">
            <strong>À quoi servent ces champs ?</strong>
            <ul class="m-0 mt-1.5 pl-4 list-disc flex flex-col gap-1">
              <li>
                L'<strong>email</strong> est ton identifiant sur ce serveur. Il ne sera jamais
                utilisé pour t'envoyer un message — il sert uniquement à reconnaître ton compte
                quand tu te connectes depuis un nouvel appareil. Choisis-en un et garde-le. Si tu te
                reconnectes plus tard avec un email différent, le serveur créera un nouveau compte
                distinct.
              </li>
              <li>
                Le <strong>mot de passe maître</strong> est <em>exactement le même</em> que celui
                que tu saisis déjà dans l'extension pour la générer les mots de passe. C'est ce qui
                garantit que tu retrouves tes mots de passe identiques sur tes autres appareils. Il
                ne quitte jamais ce navigateur — le serveur ne voit qu'une dérivation OPAQUE
                incapable d'être brute-forcée.
              </li>
            </ul>
          </div>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-(--color-ink-muted)">Email</span>
            <input
              type="email"
              class="input"
              placeholder="tu@exemple.com"
              autoComplete="email"
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              disabled={busy}
            />
          </label>
          <label class="flex flex-col gap-1.5">
            <span class="text-xs text-(--color-ink-muted)">
              Mot de passe maître (le même que dans l'extension)
            </span>
            <input
              ref={masterRef}
              type="password"
              class="input"
              autoComplete="current-password"
              value={master}
              onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
              disabled={busy}
            />
          </label>
          {error ? <ErrorBox message={error} /> : null}
          <div class="flex justify-between gap-2">
            <motion.button
              type="button"
              class="btn btn-ghost"
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
              disabled={busy || email.trim().length < 3 || master.length === 0}
              whileTap={TAP_SCALE}
            >
              {busy ? "Connexion…" : "Se connecter"}
            </motion.button>
          </div>
        </div>
      ) : null}

      {step === "done" && done ? (
        <div class="flex flex-col gap-3">
          <div class="callout callout-success">
            {done.loggedIn ? (
              <span>
                Reconnecté à <code>{done.baseUrl}</code> avec succès.
              </span>
            ) : (
              <span>
                Compte créé sur <code>{done.baseUrl}</code> avec succès.
              </span>
            )}
          </div>
          <p class="text-xs text-(--color-ink-muted) leading-relaxed">
            Ce navigateur est maintenant lié à ton serveur sous l'identité <code>{done.email}</code>
            . La synchronisation automatique sera activée dans une prochaine version.
          </p>
          <div class="flex justify-end">
            <motion.button
              type="button"
              class="btn btn-primary"
              onClick={onClose}
              whileTap={TAP_SCALE}
            >
              Terminé
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
    <div class="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          class={`h-1 flex-1 rounded-full ${i <= idx ? "bg-(--color-accent)" : "bg-(--color-stroke-soft)"}`}
        />
      ))}
    </div>
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
      return "Impossible de joindre l'URL. Vérifie qu'elle est accessible et que CORS est configuré (la valeur attendue est l'origine de l'extension).";
    case "unexpected_payload":
      return "L'URL répond mais ne ressemble pas à un serveur ItsMyPassword.";
    default:
      if (reason?.startsWith("http_")) return `Le serveur a répondu ${reason.slice(5)}.`;
      return "Erreur inconnue lors du test.";
  }
}

function humanConnectError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "wrong master password") {
    return "Mot de passe maître refusé par le serveur.";
  }
  if (message.includes("too_many_attempts")) {
    return "Trop de tentatives échouées récentes. Réessaie dans quelques minutes.";
  }
  return `Échec de la connexion : ${message}`;
}
