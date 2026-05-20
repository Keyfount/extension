import { useEffect, useState } from "preact/hooks";
import { send } from "./api.js";
import { ProfileEditor } from "./components/ProfileEditor.js";
import { SitesSection } from "./components/SitesSection.js";
import { PinSection } from "./components/PinSection.js";
import { DangerSection } from "./components/DangerSection.js";
import type { Profile } from "../shared/types.js";

interface State {
  defaultProfile: Profile;
  autoLockMinutes: number;
  hasPin: boolean;
  sites: Record<string, Profile>;
}

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await send({ kind: "getState" });
      setState({
        defaultProfile: res.defaultProfile,
        autoLockMinutes: res.autoLockMinutes,
        hasPin: res.hasPin,
        sites: res.sites,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load state");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (error !== null) {
    return (
      <main class="page">
        <h1>ItsMyPassword</h1>
        <div class="error">{error}</div>
      </main>
    );
  }

  if (state === null) {
    return (
      <main class="page">
        <h1>ItsMyPassword</h1>
        <p class="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main class="page">
      <h1>ItsMyPassword</h1>
      <p class="muted">Settings stay on this machine. No password is ever stored.</p>

      <section class="card">
        <h2>Default profile</h2>
        <p class="muted">
          Used on sites without a specific override. Changing this does not affect existing
          passwords on overridden sites.
        </p>
        <ProfileEditor
          profile={state.defaultProfile}
          onChange={async (next) => {
            await send({ kind: "setDefaultProfile", profile: next });
            await refresh();
          }}
        />
      </section>

      <section class="card">
        <h2>Auto-lock</h2>
        <p class="muted">
          The master password is wiped from memory after this many minutes of inactivity. Set to 0
          to disable auto-lock (not recommended).
        </p>
        <label class="field">
          <span>Minutes</span>
          <input
            type="number"
            min={0}
            max={1440}
            value={state.autoLockMinutes}
            onChange={async (e) => {
              const minutes = Number.parseInt((e.target as HTMLInputElement).value, 10);
              if (Number.isFinite(minutes)) {
                await send({ kind: "setAutoLockMinutes", minutes });
                await refresh();
              }
            }}
          />
        </label>
      </section>

      <PinSection hasPin={state.hasPin} onChange={refresh} />

      <SitesSection sites={state.sites} onChange={refresh} />

      <DangerSection onChange={refresh} />
    </main>
  );
}
