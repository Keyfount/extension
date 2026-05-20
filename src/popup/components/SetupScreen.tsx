import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { send } from "../api.js";
import {
  busy,
  errorMessage,
  fingerprint as fingerprintSignal,
  livePreview,
  screen,
} from "../state.js";

const MIN_LENGTH = 12;

export function SetupScreen() {
  const [master, setMaster] = useState("");
  const [confirm, setConfirm] = useState("");
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce live fingerprint preview so we don't slam Argon2id on every keystroke.
  useEffect(() => {
    if (previewTimer.current !== null) clearTimeout(previewTimer.current);
    if (master.length < MIN_LENGTH) {
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
      if (master.length < MIN_LENGTH) {
        errorMessage.value = `master password must be at least ${MIN_LENGTH} characters`;
        return;
      }
      if (master !== confirm) {
        errorMessage.value = "passwords do not match";
        return;
      }
      busy.value = true;
      try {
        const response = await send({ kind: "setup", master });
        fingerprintSignal.value = response.fingerprint;
        screen.value = "main";
      } catch (error) {
        errorMessage.value = error instanceof Error ? error.message : "setup failed";
      } finally {
        busy.value = false;
      }
    },
    [master, confirm],
  );

  return (
    <form class="screen" onSubmit={submit}>
      <h1>Welcome</h1>
      <p class="muted">
        ItsMyPassword does not store your passwords — it recomputes them from your master password
        each time. Choose a master you can remember. We cannot recover it.
      </p>

      <label class="field">
        <span>Master password</span>
        <input
          type="password"
          value={master}
          minLength={MIN_LENGTH}
          required
          autocomplete="new-password"
          onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
        />
      </label>

      <label class="field">
        <span>Confirm</span>
        <input
          type="password"
          value={confirm}
          autocomplete="new-password"
          onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
        />
      </label>

      {livePreview.value !== null ? (
        <div class="fingerprint" aria-live="polite">
          <span class="muted">Your fingerprint:</span>{" "}
          <span class="fingerprint__value">{livePreview.value}</span>
          <p class="muted small">
            Memorise these emojis — you should see the same three every time you unlock.
          </p>
        </div>
      ) : null}

      {errorMessage.value !== null ? <div class="error">{errorMessage.value}</div> : null}

      <button type="submit" disabled={busy.value}>
        {busy.value ? "Setting up…" : "Create"}
      </button>
    </form>
  );
}
