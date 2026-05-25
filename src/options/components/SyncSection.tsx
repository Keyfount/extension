/**
 * Settings entry for self-hosted sync. The wizard is now a real popup
 * screen (`screen.value = "sync"`), no new window. Shows a status badge
 * for at-a-glance feedback once a session exists.
 */
import { useEffect, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { send } from "../api.js";
import { screen } from "../../popup/state.js";
import { IconDownload, IconUpload } from "../../shared/icons.js";
import { t } from "../../shared/i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import type { SyncSessionView } from "../../shared/messages.js";

type ForceFeedback =
  | { dir: "push"; pushed: number | null; failed: number | null }
  | { dir: "pull"; applied: number | null; skipped: number | null }
  | { dir: "push" | "pull"; error: string };

export function SyncSection() {
  const [session, setSession] = useState<SyncSessionView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [forceBusy, setForceBusy] = useState<"push" | "pull" | null>(null);
  const [forceResult, setForceResult] = useState<ForceFeedback | null>(null);

  async function refresh(): Promise<void> {
    const res = await send({ kind: "syncStatus" });
    setSession(res.session);
    setLoaded(true);
  }

  useEffect(() => {
    void refresh();
  }, []);

  function openWizard(): void {
    screen.value = "sync";
  }

  async function disconnect(): Promise<void> {
    await send({ kind: "syncDisconnect" });
    setConfirmDisconnect(false);
    await refresh();
  }

  async function forcePush(): Promise<void> {
    setForceBusy("push");
    setForceResult(null);
    try {
      const r = await send({ kind: "syncPushAll" });
      setForceResult({ dir: "push", pushed: r.pushed, failed: r.failed });
    } catch (err) {
      setForceResult({ dir: "push", error: err instanceof Error ? err.message : String(err) });
    } finally {
      setForceBusy(null);
    }
  }

  async function forcePull(): Promise<void> {
    setForceBusy("pull");
    setForceResult(null);
    try {
      const r = await send({ kind: "syncPull" });
      setForceResult({ dir: "pull", applied: r.applied, skipped: r.skipped });
    } catch (err) {
      setForceResult({ dir: "pull", error: err instanceof Error ? err.message : String(err) });
    } finally {
      setForceBusy(null);
    }
  }

  return (
    <motion.section
      class="flex flex-col gap-4"
      variants={{
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
      }}
    >
      <div class="flex items-baseline justify-between gap-3">
        <div class="flex flex-col gap-0.5 flex-1 min-w-0">
          <h2 class="m-0 text-base font-semibold tracking-[-0.015em] text-(--color-ink)">
            Synchronisation
          </h2>
          <span class="text-xs text-(--color-ink-muted) leading-snug">
            Relie cette extension à un serveur self-hosted pour partager tes paramètres et la liste
            de tes comptes entre appareils. Aucun mot de passe n'est stocké côté serveur.
          </span>
        </div>
      </div>

      {!loaded ? (
        <div class="card p-5 text-xs text-(--color-ink-muted)">Chargement…</div>
      ) : session !== null ? (
        <div class="card p-5 flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <strong class="text-sm text-(--color-ink)">Compte serveur</strong>
            <StatusBadge status={session.approvalStatus} />
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs text-(--color-ink-muted)">Serveur</span>
            <code class="text-sm text-(--color-ink) break-all">{session.baseUrl}</code>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs text-(--color-ink-muted)">Identifiant</span>
            <code class="text-sm text-(--color-ink) break-all">{session.email}</code>
          </div>
          {session.approvalStatus === "pending" ? (
            <p class="text-xs text-(--color-ink-muted) leading-relaxed m-0">
              En attente d'approbation par l'administrateur du serveur. Ouvre la page
              Synchronisation pour suivre le statut en temps réel.
            </p>
          ) : (
            <div class="flex-col gap-2">
              <div class="flex gap-2">
                <motion.button
                  type="button"
                  class="btn btn-quiet text-xs flex-1 justify-center"
                  onClick={() => void forcePush()}
                  disabled={forceBusy !== null}
                  whileTap={TAP_SCALE}
                  title={t("sync_force_send_hint")}
                >
                  <IconUpload size={14} />
                  {forceBusy === "push" ? t("sync_force_send_busy") : t("sync_force_send")}
                </motion.button>
                <motion.button
                  type="button"
                  class="btn btn-quiet text-xs flex-1 justify-center"
                  onClick={() => void forcePull()}
                  disabled={forceBusy !== null}
                  whileTap={TAP_SCALE}
                  title={t("sync_force_receive_hint")}
                >
                  <IconDownload size={14} />
                  {forceBusy === "pull" ? t("sync_force_receive_busy") : t("sync_force_receive")}
                </motion.button>
              </div>
              {forceResult !== null ? <ForceResultBox result={forceResult} /> : null}
            </div>
          )}
          {confirmDisconnect ? (
            <div class="callout callout-danger flex-col gap-3" role="alertdialog">
              <span>
                Déconnecter retire la session de cet appareil. Le serveur conserve ton compte ; tu
                peux te reconnecter quand tu veux.
              </span>
              <div class="flex justify-end gap-2">
                <motion.button
                  type="button"
                  class="btn btn-quiet"
                  onClick={() => setConfirmDisconnect(false)}
                  whileTap={TAP_SCALE}
                >
                  Annuler
                </motion.button>
                <motion.button
                  type="button"
                  class="btn btn-danger"
                  onClick={() => void disconnect()}
                  whileTap={TAP_SCALE}
                >
                  Déconnecter
                </motion.button>
              </div>
            </div>
          ) : (
            <div class="flex justify-between gap-2">
              {session.approvalStatus === "pending" ? (
                <motion.button
                  type="button"
                  class="btn btn-primary text-xs"
                  onClick={openWizard}
                  whileTap={TAP_SCALE}
                >
                  Voir le statut
                </motion.button>
              ) : (
                <span />
              )}
              <motion.button
                type="button"
                class="btn btn-quiet text-xs"
                onClick={() => setConfirmDisconnect(true)}
                whileTap={TAP_SCALE}
              >
                Déconnecter cet appareil
              </motion.button>
            </div>
          )}
        </div>
      ) : (
        <div class="card p-5 flex-col gap-3">
          <span class="text-sm text-(--color-ink)">Pas encore de serveur connecté.</span>
          <p class="text-xs text-(--color-ink-muted) leading-relaxed">
            L'assistant ouvre une page dédiée dans l'extension pour saisir l'URL du serveur et ton
            identifiant. Le mot de passe maître n'est plus redemandé — l'extension utilise celui de
            la session courante.
          </p>
          <div class="flex justify-end">
            <motion.button
              type="button"
              class="btn btn-primary"
              onClick={openWizard}
              whileTap={TAP_SCALE}
            >
              Connecter un serveur
            </motion.button>
          </div>
        </div>
      )}
    </motion.section>
  );
}

function ForceResultBox({ result }: { result: ForceFeedback }) {
  if ("error" in result) {
    return (
      <div class="callout callout-danger text-xs" role="status">
        {t("sync_force_error", result.error)}
      </div>
    );
  }
  if (result.dir === "push") {
    if (result.pushed === null) {
      return (
        <div class="callout text-xs" role="status">
          {t("sync_force_no_session")}
        </div>
      );
    }
    const message =
      result.failed !== null && result.failed > 0
        ? t("sync_force_push_ok_with_failures", String(result.pushed), String(result.failed))
        : t("sync_force_push_ok", String(result.pushed));
    return (
      <div class="callout callout-success text-xs" role="status">
        {message}
      </div>
    );
  }
  if (result.applied === null) {
    return (
      <div class="callout text-xs" role="status">
        {t("sync_force_no_session")}
      </div>
    );
  }
  const message =
    result.skipped !== null && result.skipped > 0
      ? t("sync_force_pull_ok_with_skipped", String(result.applied), String(result.skipped))
      : t("sync_force_pull_ok", String(result.applied));
  return (
    <div class="callout callout-success text-xs" role="status">
      {message}
    </div>
  );
}

function StatusBadge({ status }: { status: "pending" | "approved" }) {
  if (status === "approved") {
    return (
      <span class="chip chip-success" aria-label="Connecté">
        <span class="status-dot" aria-hidden="true" />
        Connecté
      </span>
    );
  }
  return (
    <span class="chip chip-warning" aria-label="En attente">
      <span class="status-dot" aria-hidden="true" />
      En attente
    </span>
  );
}
