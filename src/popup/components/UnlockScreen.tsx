import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { send } from "../api.js";
import { busy, errorMessage, fingerprint, livePreview, screen } from "../state.js";

export function UnlockScreen() {
  const [master, setMaster] = useState("");
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
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
  }, [master]);

  const submit = useCallback(
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

  const expected = fingerprint.value;

  return (
    <form class="screen" onSubmit={submit}>
      <h1>Unlock</h1>

      {expected !== null ? (
        <div class="fingerprint">
          <span class="muted">Expected fingerprint:</span>{" "}
          <span class="fingerprint__value">{expected}</span>
        </div>
      ) : null}

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
  );
}
