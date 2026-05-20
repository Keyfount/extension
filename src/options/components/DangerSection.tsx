import { useState } from "preact/hooks";
import { send } from "../api.js";

interface Props {
  onChange: () => Promise<void>;
}

export function DangerSection({ onChange }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const wipe = async () => {
    setBusy(true);
    try {
      await send({ kind: "wipe" });
      setConfirming(false);
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card card--danger">
      <h2>Forget everything</h2>
      <p class="muted">
        Removes the master fingerprint, all site overrides, the PIN blob and the auto-lock
        configuration. The extension returns to first-run state. Your generated passwords are{" "}
        <strong>not</strong> stored anywhere — only your <em>memory</em> of the master recovers
        them.
      </p>
      {confirming ? (
        <div class="field-row">
          <button type="button" disabled={busy} onClick={wipe}>
            {busy ? "Wiping…" : "Yes, forget everything"}
          </button>
          <button class="button--ghost" type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button class="button--ghost" type="button" onClick={() => setConfirming(true)}>
          Reset to first-run
        </button>
      )}
    </section>
  );
}
