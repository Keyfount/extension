import { useCallback, useEffect, useState } from "preact/hooks";
import { send } from "../api.js";
import { Header } from "./Header.js";
import {
  IconCheck,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconLock,
  IconSettings,
} from "../../shared/icons.js";
import { t } from "../../shared/i18n.js";
import {
  activeDomain,
  activeEmail,
  busy,
  canGenerate,
  errorMessage,
  fingerprint,
  generated,
  screen,
} from "../state.js";

export function MainScreen() {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    generated.value = null;
    setRevealed(false);
    setCopied(false);
  }, [activeDomain.value, activeEmail.value]);

  const generate = useCallback(async () => {
    if (activeDomain.value === null) return;
    errorMessage.value = null;
    busy.value = true;
    try {
      const response = await send({
        kind: "generate",
        domain: activeDomain.value,
        email: activeEmail.value.trim(),
      });
      generated.value = response.password;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : "generation failed";
    } finally {
      busy.value = false;
    }
  }, []);

  const copy = useCallback(async () => {
    if (generated.value === null) return;
    try {
      await navigator.clipboard.writeText(generated.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // swallowed — clipboard API may be unavailable
    }
  }, []);

  const onLock = useCallback(async () => {
    await send({ kind: "lock" });
    generated.value = null;
    screen.value = "unlock";
  }, []);

  const onSettings = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  return (
    <div class="popup">
      <Header
        subtitle={activeDomain.value ?? undefined}
        fingerprint={fingerprint.value}
        actions={
          <>
            <button
              type="button"
              class="btn btn--quiet btn--icon"
              onClick={onSettings}
              aria-label={t("common_settings")}
            >
              <IconSettings />
            </button>
            <button
              type="button"
              class="btn btn--quiet btn--icon"
              onClick={onLock}
              aria-label={t("common_lock")}
            >
              <IconLock />
            </button>
          </>
        }
      />

      {activeDomain.value === null ? (
        <p class="popup__intro">{t("main_no_site")}</p>
      ) : (
        <>
          <label class="field">
            <span class="field__label">{t("main_username_label")}</span>
            <input
              class="input"
              type="text"
              value={activeEmail.value}
              autocomplete="off"
              placeholder={t("main_username_placeholder")}
              onInput={(e) => {
                activeEmail.value = (e.target as HTMLInputElement).value;
              }}
            />
          </label>

          <button
            type="button"
            class="btn"
            onClick={generate}
            disabled={busy.value || !canGenerate.value}
          >
            {busy.value ? t("common_generating") : t("common_generate")}
          </button>

          {generated.value !== null ? (
            <div class="generated">
              <code
                class={revealed ? "generated__value" : "generated__value generated__value--masked"}
              >
                {revealed ? generated.value : "•".repeat(Math.min(generated.value.length, 24))}
              </code>
              <div class="generated__actions">
                <button
                  type="button"
                  class="btn btn--ghost btn--sm"
                  onClick={() => setRevealed((v) => !v)}
                >
                  {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  {revealed ? t("common_hide") : t("common_reveal")}
                </button>
                <button type="button" class="btn btn--ghost btn--sm" onClick={copy}>
                  {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  {copied ? t("common_copied") : t("common_copy")}
                </button>
              </div>
            </div>
          ) : !canGenerate.value ? (
            <p class="field__hint">{t("main_no_email")}</p>
          ) : null}

          {errorMessage.value !== null ? (
            <div class="field__error" role="alert">
              {errorMessage.value}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
