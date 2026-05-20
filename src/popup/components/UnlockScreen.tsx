import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { send } from "../api.js";
import { busy, errorMessage, fingerprint, livePreview, screen } from "../state.js";

type Mode = "master" | "pin";

interface Props {
  hasPin: boolean;
}

export function UnlockScreen({ hasPin }: Props) {
  const [mode, setMode] = useState<Mode>(hasPin ? "pin" : "master");
  const [master, setMaster] = useState("");
  const [pin, setPin] = useState("");
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (mode !== "master") {
      livePreview.value = null;
      return;
    }
    if (previewTimer.current !== null) clearTimeout(previewTimer.current);
    if (master.length === 0) {
      livePreview.value = null;
      return;
    }
    previewTimer.current = setTimeout(() => {
      void send({ kind: "fingerprint", master }).then(
        (response) => {
          livePreview.value = response.fingerprint;
        },
        () => {
          livePreview.value = null;
        },
      );
    }, 500);
    return () => {
      if (previewTimer.current !== null) clearTimeout(previewTimer.current);
    };
  }, [master, mode]);

  const submitMaster = useCallback(
    async (event: Event) => {
      event.preventDefault();
      errorMessage.value = null;
      busy.value = true;
      try {
        const response = await send({ kind: "unlock", master });
        fingerprint.value = response.fingerprint;
        screen.value = "main";
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : "unlock failed";
      } finally {
        busy.value = false;
      }
    },
    [master],
  );

  const submitPin = useCallback(
    async (event: Event) => {
      event.preventDefault();
      errorMessage.value = null;
      busy.value = true;
      try {
        const response = await send({ kind: "unlockWithPin", pin });
        fingerprint.value = response.fingerprint;
        screen.value = "main";
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : "unlock failed";
      } finally {
        busy.value = false;
      }
    },
    [pin],
  );

  const expected = fingerprint.value;

  return (
    <div class="screen">
      <h1>Unlock</h1>

      {expected !== null ? (
        <div class="fingerprint">
          <span class="muted">Expected fingerprint:</span>{" "}
          <span class="fingerprint__value">{expected}</span>
        </div>
      ) : null}

      {hasPin ? (
        <div class="field-row">
          <button
            type="button"
            class={mode === "pin" ? "" : "button--ghost"}
            onClick={() => setMode("pin")}
          >
            PIN
          </button>
          <button
            type="button"
            class={mode === "master" ? "" : "button--ghost"}
            onClick={() => setMode("master")}
          >
            Master password
          </button>
        </div>
      ) : null}

      {mode === "master" ? (
        <form class="screen" onSubmit={submitMaster}>
          <label class="field">
            <span>Master password</span>
            <input
              type="password"
              value={master}
              autocomplete="current-password"
              autoFocus
              required
              onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
            />
          </label>

          {livePreview.value !== null && livePreview.value !== expected ? (
            <div class="fingerprint fingerprint--warning">
              <span class="muted">Typed fingerprint:</span>{" "}
              <span class="fingerprint__value">{livePreview.value}</span>
              <p class="muted small">Fingerprints do not match — check your master password.</p>
            </div>
          ) : null}

          {errorMessage.value !== null ? <div class="error">{errorMessage.value}</div> : null}

          <button type="submit" disabled={busy.value}>
            {busy.value ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      ) : (
        <form class="screen" onSubmit={submitPin}>
          <label class="field">
            <span>PIN</span>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              minLength={4}
              maxLength={6}
              value={pin}
              autoFocus
              required
              onInput={(e) => setPin((e.target as HTMLInputElement).value.replace(/\D/g, ""))}
            />
          </label>
          {errorMessage.value !== null ? <div class="error">{errorMessage.value}</div> : null}
          <button type="submit" disabled={busy.value || pin.length < 4}>
            {busy.value ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      )}
    </div>
  );
}
