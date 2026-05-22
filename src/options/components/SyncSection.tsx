/**
 * Settings entry for self-hosted sync. The wizard is now a real popup
 * screen (`screen.value = "sync"`), no new window. Shows a status badge
 * for at-a-glance feedback once a session exists.
 */
import { useEffect, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { send } from "../api.js";
import { screen } from "../../popup/state.js";
import { SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import type { SyncSessionView } from "../../shared/messages.js";

export function SyncSection() {
  const [session, setSession] = useState<SyncSessionView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

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
          ) : null}
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
