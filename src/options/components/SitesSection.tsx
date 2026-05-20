import { useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import type { Profile } from "../../shared/types.js";
import { send } from "../api.js";
import { ProfileEditor } from "../../shared/ProfileEditor.js";
import { IconDownload, IconTrash, IconUpload } from "../../shared/icons.js";
import { t } from "../../shared/i18n.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";

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
    <motion.section
      class="flex flex-col gap-4"
      variants={{
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
      }}
    >
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="m-0 text-base font-semibold tracking-[-0.015em]">
          {t("options_sites_section")}
        </h2>
        <div class="flex gap-2">
          <label class="btn btn-ghost btn-sm cursor-pointer relative overflow-hidden">
            <IconUpload size={14} />
            {t("options_sites_import")}
            <input
              type="file"
              accept="application/json"
              class="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) void importJson(file);
              }}
            />
          </label>
          <motion.button
            type="button"
            class="btn btn-ghost btn-sm"
            whileTap={TAP_SCALE}
            disabled={domains.length === 0}
            onClick={exportJson}
          >
            <IconDownload size={14} />
            {t("options_sites_export")}
          </motion.button>
        </div>
      </div>

      <div class="card p-6 shadow-sm">
        {domains.length === 0 ? (
          <p class="text-(--color-ink-muted) text-sm">{t("options_sites_empty")}</p>
        ) : (
          <ul class="list-none m-0 p-0 flex flex-col gap-3">
            <AnimatePresence initial={false}>
              {domains.map((domain) => {
                const isExpanded = expanded === domain;
                return (
                  <motion.li
                    layout
                    key={domain}
                    class={`overflow-hidden rounded-[10px] border bg-(--color-surface-elev) transition-colors duration-150 ${
                      isExpanded ? "border-(--color-line-strong)" : "border-(--color-line)"
                    }`}
                    variants={POP_IN}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                  >
                    <div class="flex justify-between items-center gap-3 px-4 py-3">
                      <span class="font-medium font-mono text-sm">{domain}</span>
                      <div class="flex gap-2">
                        <motion.button
                          type="button"
                          class="btn btn-ghost btn-sm"
                          whileTap={TAP_SCALE}
                          onClick={() => setExpanded((c) => (c === domain ? null : domain))}
                        >
                          {isExpanded ? t("common_close") : t("common_edit")}
                        </motion.button>
                        <motion.button
                          type="button"
                          class="btn btn-danger btn-sm"
                          whileTap={TAP_SCALE}
                          aria-label={t("common_delete")}
                          onClick={async () => {
                            await send({ kind: "deleteProfile", domain });
                            await onChange();
                          }}
                        >
                          <IconTrash size={14} />
                        </motion.button>
                      </div>
                    </div>
                    <AnimatePresence>
                      {isExpanded && sites[domain] !== undefined ? (
                        <motion.div
                          key="editor"
                          class="p-5 border-t border-(--color-line) bg-(--color-surface-sunken) flex flex-col gap-4 overflow-hidden"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1, transition: SOFT_SPRING }}
                          exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
                        >
                          <ProfileEditor
                            profile={sites[domain]!}
                            onChange={async (next) => {
                              await send({ kind: "setProfile", domain, profile: next });
                              await onChange();
                            }}
                          />
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </motion.section>
  );
}
