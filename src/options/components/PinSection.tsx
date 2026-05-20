import { useState } from "preact/hooks";
import { BackgroundError, send } from "../api.js";
import { IconShield } from "../../shared/icons.js";
import { t } from "../../shared/i18n.js";

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
    <section class="section">
      <div class="section__header">
        <div class="row__text">
          <h2 class="h-section">{t("options_pin_section")}</h2>
          <span class="row__hint">{t("options_pin_hint")}</span>
        </div>
      </div>

      <div class="section__body">
        <div class="callout">
          <span style="margin-top: 1px; color: var(--c-warning); flex-shrink: 0;">
            <IconShield size={16} />
          </span>
          <span>{t("options_pin_warning")}</span>
        </div>

        {hasPin ? (
          <div class="row">
            <span class="row__title">{t("options_pin_enabled")}</span>
            <button class="btn btn--danger btn--sm" type="button" disabled={busy} onClick={disable}>
              {t("options_pin_remove")}
            </button>
          </div>
        ) : confirmingEnable ? (
          <>
            <label class="field">
              <span class="field__label">{t("options_pin_choose")}</span>
              <input
                class="input input--mono"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                minLength={4}
                maxLength={6}
                autoFocus
                value={pin}
                onInput={(e) => setPin((e.target as HTMLInputElement).value.replace(/\D/g, ""))}
              />
            </label>
            <div class="actions">
              <button type="button" class="btn" disabled={busy || pin.length < 4} onClick={enable}>
                {busy ? t("options_pin_saving") : t("options_pin_confirm_enable")}
              </button>
              <button
                class="btn btn--ghost"
                type="button"
                onClick={() => {
                  setConfirmingEnable(false);
                  setPin("");
                  setError(null);
                }}
              >
                {t("common_cancel")}
              </button>
            </div>
          </>
        ) : (
          <div class="row">
            <span class="row__title">
              {t("common_remove")} / {t("options_pin_enable")}
            </span>
            <button
              class="btn btn--ghost btn--sm"
              type="button"
              onClick={() => setConfirmingEnable(true)}
            >
              {t("options_pin_enable")}
            </button>
          </div>
        )}

        {error !== null ? (
          <div class="field__error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </section>
  );
}
