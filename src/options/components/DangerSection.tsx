import { useState } from "preact/hooks";
import { send } from "../api.js";
import { t } from "../../shared/i18n.js";

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
    <section class="section">
      <div class="section__header">
        <div class="row__text">
          <h2 class="h-section">{t("options_danger_section")}</h2>
          <span class="row__hint">{t("options_danger_hint")}</span>
        </div>
      </div>
      <div class="section__body">
        {confirming ? (
          <div class="actions">
            <button type="button" class="btn btn--danger" disabled={busy} onClick={wipe}>
              {busy ? t("options_danger_wiping") : t("options_danger_confirm")}
            </button>
            <button class="btn btn--ghost" type="button" onClick={() => setConfirming(false)}>
              {t("common_cancel")}
            </button>
          </div>
        ) : (
          <div class="row">
            <span class="row__title">{t("options_danger_reset")}</span>
            <button
              class="btn btn--danger btn--sm"
              type="button"
              onClick={() => setConfirming(true)}
            >
              {t("options_danger_reset")}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
