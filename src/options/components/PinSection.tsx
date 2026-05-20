import { useState } from "preact/hooks";
import { BackgroundError, send } from "../api.js";

interface Props {
  hasPin: boolean;
  onChange: () => Promise<void>;
}

export function PinSection({ hasPin, onChange }: Props) {
  const [confirmingEnable, setConfirmingEnable] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enable = async () => {
    setError(null);
    setBusy(true);
    try {
      await send({ kind: "setPin", pin });
      setConfirmingEnable(false);
      setPin("");
      await onChange();
    } catch (e) {
      setError(e instanceof BackgroundError ? e.message : "could not set the PIN");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await send({ kind: "removePin" });
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card">
      <h2>PIN unlock</h2>
      <p class="muted">
        Lets you unlock with a 4–6 digit PIN instead of your master password. The master is stored
        on this computer encrypted with the PIN.
      </p>
      <div class="warning">
        <strong>Warning.</strong> Activating the PIN means your master password is written to disk
        in encrypted form. Anyone with access to this user account and your PIN can derive every
        password you generate. Cancel if unsure — the default mode never stores anything.
      </div>

      {hasPin ? (
        <div class="field-row">
          <span class="muted">PIN is set.</span>
          <button class="button--ghost" type="button" disabled={busy} onClick={disable}>
            Remove PIN
          </button>
        </div>
      ) : confirmingEnable ? (
        <div class="field-row">
          <label class="field">
            <span>Choose a PIN</span>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              minLength={4}
              maxLength={6}
              value={pin}
              onInput={(e) => setPin((e.target as HTMLInputElement).value.replace(/\D/g, ""))}
            />
          </label>
          <button type="button" disabled={busy || pin.length < 4} onClick={enable}>
            {busy ? "Saving…" : "Enable PIN"}
          </button>
          <button
            class="button--ghost"
            type="button"
            onClick={() => {
              setConfirmingEnable(false);
              setPin("");
              setError(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button class="button--ghost" type="button" onClick={() => setConfirmingEnable(true)}>
          Enable PIN…
        </button>
      )}

      {error !== null ? <div class="error">{error}</div> : null}
    </section>
  );
}
