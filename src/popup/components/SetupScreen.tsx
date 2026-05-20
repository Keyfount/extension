import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { send } from "../api.js";
import { Header } from "./Header.js";
import { t } from "../../shared/i18n.js";
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
        errorMessage.value = t("setup_min_length_error", String(MIN_LENGTH));
        return;
      }
      if (master !== confirm) {
        errorMessage.value = t("setup_mismatch_error");
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
    <form class="popup" onSubmit={submit}>
      <Header subtitle={t("setup_welcome")} />

      <p class="popup__intro">{t("setup_intro")}</p>

      <label class="field">
        <span class="field__label">{t("setup_master_label")}</span>
        <input
          class="input"
          type="password"
          value={master}
          minLength={MIN_LENGTH}
          required
          autocomplete="new-password"
          onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
        />
      </label>

      <label class="field">
        <span class="field__label">{t("setup_confirm_label")}</span>
        <input
          class="input"
          type="password"
          value={confirm}
          autocomplete="new-password"
          onInput={(e) => setConfirm((e.target as HTMLInputElement).value)}
        />
      </label>

      {livePreview.value !== null ? (
        <div class="fp-surface fade-in" aria-live="polite">
          <span class="fingerprint">{livePreview.value}</span>
          <span class="field__hint">{t("setup_fingerprint_hint")}</span>
        </div>
      ) : null}

      {errorMessage.value !== null ? (
        <div class="field__error" role="alert">
          {errorMessage.value}
        </div>
      ) : null}

      <button type="submit" class="btn" disabled={busy.value}>
        {busy.value ? t("setup_creating") : t("setup_create_button")}
      </button>
    </form>
  );
}
