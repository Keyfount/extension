import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

import { send } from "../../shared/api.js";
import { SyncWizard } from "../../options/components/SyncWizard.js";
import type { SyncSessionView } from "../../shared/messages.js";

import "../../popup/styles.css";

function ConnectedView({
  session,
  onDisconnect,
}: {
  session: SyncSessionView;
  onDisconnect: () => void;
}) {
  return (
    <div class="card p-5 flex-col gap-3">
      <strong class="text-base text-(--color-ink)">Déjà connecté</strong>
      <div class="flex flex-col gap-1">
        <span class="text-xs text-(--color-ink-muted)">Serveur</span>
        <code class="text-sm text-(--color-ink) break-all">{session.baseUrl}</code>
      </div>
      <div class="flex flex-col gap-1">
        <span class="text-xs text-(--color-ink-muted)">Identifiant</span>
        <code class="text-sm text-(--color-ink) break-all">{session.email}</code>
      </div>
      <p class="text-xs text-(--color-ink-muted) leading-relaxed">
        Cet appareil est déjà lié à un serveur. Reviens dans l'extension pour gérer la connexion ou
        la déconnecter, puis relance ce wizard si tu veux te rebrancher à un autre serveur.
      </p>
      <div class="flex justify-end">
        <button type="button" class="btn btn-ghost" onClick={onDisconnect}>
          Fermer cet onglet
        </button>
      </div>
    </div>
  );
}

function SyncPage() {
  const [session, setSession] = useState<SyncSessionView | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refresh(): Promise<void> {
    const res = await send({ kind: "syncStatus" });
    setSession(res.session);
    setLoaded(true);
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div class="min-h-screen w-full bg-(--color-canvas) text-(--color-ink) flex flex-col items-center px-4 py-10">
      <header class="w-full max-w-xl flex flex-col gap-2 mb-6">
        <h1 class="m-0 text-2xl font-semibold tracking-[-0.02em]">Synchronisation</h1>
        <p class="m-0 text-sm text-(--color-ink-muted) leading-relaxed">
          Cet assistant connecte cette installation de l'extension à un serveur ItsMyPassword
          self-hosted. Le serveur ne stocke jamais ton mot de passe maître ni tes mots de passe
          générés — seulement la liste chiffrée des comptes et tes préférences, pour les retrouver
          sur tes autres appareils.
        </p>
      </header>

      <main class="w-full max-w-xl">
        {!loaded ? (
          <div class="card p-5 text-sm text-(--color-ink-muted)">Chargement…</div>
        ) : session ? (
          <ConnectedView session={session} onDisconnect={() => window.close()} />
        ) : (
          <SyncWizard onClose={() => window.close()} onConnected={refresh} />
        )}
      </main>

      <footer class="w-full max-w-xl mt-8 text-xs text-(--color-ink-muted) text-center">
        Une fois la connexion établie, ferme cet onglet. La synchronisation est gérée en
        arrière-plan par l'extension.
      </footer>
    </div>
  );
}

const root = document.getElementById("app");
if (root === null) {
  throw new Error("sync root element #app is missing");
}
render(<SyncPage />, root);
