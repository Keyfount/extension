import { useState } from "preact/hooks";
import type { Profile } from "../../shared/types.js";
import { send } from "../api.js";
import { ProfileEditor } from "../../shared/ProfileEditor.js";
import { IconDownload, IconTrash, IconUpload } from "../../shared/icons.js";
import { t } from "../../shared/i18n.js";

interface Props {
  sites: Record<string, Profile>;
  onChange: () => Promise<void>;
}

export function SitesSection({ sites, onChange }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const domains = Object.keys(sites).sort();

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(sites, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "itsmypassword-sites.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = async (file: File) => {
    const text = await file.text();
    const parsed = JSON.parse(text) as Record<string, Profile>;
    for (const [domain, profile] of Object.entries(parsed)) {
      await send({ kind: "setProfile", domain, profile });
    }
    await onChange();
  };

  return (
    <section class="section">
      <div class="section__header">
        <div class="row__text">
          <h2 class="h-section">{t("options_sites_section")}</h2>
        </div>
        <div class="actions">
          <label class="btn btn--ghost btn--sm file-trigger">
            <IconUpload size={14} />
            {t("options_sites_import")}
            <input
              type="file"
              accept="application/json"
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) void importJson(file);
              }}
            />
          </label>
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            disabled={domains.length === 0}
            onClick={exportJson}
          >
            <IconDownload size={14} />
            {t("options_sites_export")}
          </button>
        </div>
      </div>

      <div class="section__body">
        {domains.length === 0 ? (
          <p class="muted">{t("options_sites_empty")}</p>
        ) : (
          <ul class="sites">
            {domains.map((domain) => {
              const isExpanded = expanded === domain;
              return (
                <li class={`site ${isExpanded ? "site--expanded" : ""}`} key={domain}>
                  <div class="site__row">
                    <span class="site__name mono">{domain}</span>
                    <div class="site__actions">
                      <button
                        type="button"
                        class="btn btn--ghost btn--sm"
                        onClick={() => setExpanded((c) => (c === domain ? null : domain))}
                      >
                        {isExpanded ? t("common_close") : t("common_edit")}
                      </button>
                      <button
                        type="button"
                        class="btn btn--danger btn--sm"
                        aria-label={t("common_delete")}
                        onClick={async () => {
                          await send({ kind: "deleteProfile", domain });
                          await onChange();
                        }}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                  {isExpanded && sites[domain] !== undefined ? (
                    <div class="site__editor">
                      <ProfileEditor
                        profile={sites[domain]!}
                        onChange={async (next) => {
                          await send({ kind: "setProfile", domain, profile: next });
                          await onChange();
                        }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
