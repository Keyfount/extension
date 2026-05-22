/**
 * Settings section for self-hosted sync. Connection flow lives on a
 * dedicated full-page entrypoint (sync.html) so the user has room to
 * read explanations and isn't fighting the popup viewport. This
 * component is just the entry point: status + open-wizard / disconnect.
 */
import { useEffect, useState } from "preact/hooks";
import { motion } from "framer-motion";

import { send } from "../api.js";
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
    // Refresh when the popup regains focus — the user may have just
    // completed the wizard in another tab.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  function openWizard(): void {
    const url = chrome.runtime.getURL("sync.html");
    // Standalone window (no tab strip, no address bar) so the wizard
    // feels like a system dialog rather than a normal browser tab.
    void chrome.windows.create({
      url,
      type: "popup",
      width: 640,
      height: 760,
      focused: true,
    });
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
      ) : session ? (
        <div class="card p-5 flex-col gap-3">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-(--color-ink-muted)">Serveur</span>
            <code class="text-sm text-(--color-ink) break-all">{session.baseUrl}</code>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs text-(--color-ink-muted)">Identifiant</span>
            <code class="text-sm text-(--color-ink) break-all">{session.email}</code>
          </div>
          <div class="flex flex-col gap-1">
            <span class="text-xs text-(--color-ink-muted)">Appareil</span>
            <code class="text-xs text-(--color-ink-muted) break-all">{session.deviceId}</code>
          </div>
          {confirmDisconnect ? (
            <div class="callout callout-danger flex-col gap-3" role="alertdialog">
              <span>
                Déconnecter retire la session de cet appareil. Le serveur conserve ton compte ; tu
                peux te reconnecter quand tu veux.
              </span>
              <div class="flex justify-end gap-2">
                <motion.button
                  type="button"
                  class="btn btn-ghost"
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
            <div class="flex justify-end">
              <motion.button
                type="button"
                class="btn btn-ghost text-xs"
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
            L'assistant s'ouvre dans un nouvel onglet pour t'expliquer chaque étape (URL du serveur,
            test de connexion, identifiant).
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
