import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { send } from "../api.js";
import { Header } from "./Header.js";
import { t } from "../../shared/i18n.js";
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
        errorMessage.value = error instanceof Error ? error.message : t("unlock_incorrect");
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
        errorMessage.value = error instanceof Error ? error.message : t("unlock_incorrect_pin");
      } finally {
        busy.value = false;
      }
    },
    [pin],
  );

  const expected = fingerprint.value;

  return (
    <div class="popup">
      <Header subtitle={t("unlock_title")} />

      {expected !== null ? (
        <div class="fp-surface">
          <span class="field__label">{t("unlock_expected_label")}</span>
          <span class="fingerprint">{expected}</span>
        </div>
      ) : null}

      {hasPin ? (
        <div class="tabs" role="tablist">
          <button
            type="button"
            class="tabs__button"
            role="tab"
            aria-pressed={mode === "pin"}
            onClick={() => setMode("pin")}
          >
            {t("unlock_pin_tab")}
          </button>
          <button
            type="button"
            class="tabs__button"
            role="tab"
            aria-pressed={mode === "master"}
            onClick={() => setMode("master")}
          >
            {t("unlock_master_tab")}
          </button>
        </div>
      ) : null}

      {mode === "master" ? (
        <form class="popup" onSubmit={submitMaster}>
          <label class="field">
            <span class="field__label">{t("setup_master_label")}</span>
            <input
              class="input"
              type="password"
              value={master}
              autocomplete="current-password"
              autoFocus
              required
              onInput={(e) => setMaster((e.target as HTMLInputElement).value)}
            />
          </label>

          {livePreview.value !== null && livePreview.value !== expected ? (
            <div class="fp-surface fp-surface--warning fade-in">
              <span class="field__label">{t("unlock_typed_label")}</span>
              <span class="fingerprint">{livePreview.value}</span>
              <span class="field__hint">{t("unlock_mismatch_hint")}</span>
            </div>
          ) : null}

          {errorMessage.value !== null ? (
            <div class="field__error" role="alert">
              {errorMessage.value}
            </div>
          ) : null}

          <button type="submit" class="btn" disabled={busy.value}>
            {busy.value ? t("unlock_unlocking") : t("common_unlock")}
          </button>
        </form>
      ) : (
        <form class="popup" onSubmit={submitPin}>
          <label class="field">
            <span class="field__label">{t("unlock_pin_label")}</span>
            <input
              class="input"
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

          {errorMessage.value !== null ? (
            <div class="field__error" role="alert">
              {errorMessage.value}
            </div>
          ) : null}

          <button type="submit" class="btn" disabled={busy.value || pin.length < 4}>
            {busy.value ? t("unlock_unlocking") : t("common_unlock")}
          </button>
        </form>
      )}
    </div>
  );
}
