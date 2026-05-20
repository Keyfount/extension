import type { JSX } from "preact";
import { IconBolt } from "../../shared/icons.js";
import { t } from "../../shared/i18n.js";

interface Props {
  subtitle?: string | undefined;
  fingerprint?: string | null | undefined;
  actions?: JSX.Element | undefined;
}

/** Common popup header with the brand glyph + an optional subtitle/actions. */
export function Header({ subtitle, fingerprint, actions }: Props) {
  return (
    <header class="popup__header">
      <div class="popup__brand">
        <div class="popup__brand-line">
          <span class="popup__brand-bolt">
            <IconBolt size={14} />
          </span>
          <span class="popup__brand-name">{t("extName")}</span>
          {fingerprint !== undefined && fingerprint !== null ? (
            <span class="fingerprint fingerprint--sm" title={t("unlock_expected_label")}>
              {fingerprint}
            </span>
          ) : null}
        </div>
        {subtitle !== undefined ? <span class="popup__brand-sub">{subtitle}</span> : null}
      </div>
      {actions !== undefined ? <div class="popup__header-actions">{actions}</div> : null}
    </header>
  );
}
