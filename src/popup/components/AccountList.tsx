/**
 * Vault list. Each row opens the account-detail page on click; a per-row
 * "⋮" menu exposes copy username / copy password / open / delete inline.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import { motion } from "framer-motion";
import { Favicon } from "./Favicon.js";
import { AccountRowMenu } from "./AccountRowMenu.js";
import { send } from "../api.js";
import { t } from "../../shared/i18n.js";
import { SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import type { SyncStamp } from "../../shared/messages.js";
import type { AccountEntry } from "../../shared/types.js";
import { activeDomain, allAccounts, screen, selectedAccount } from "../state.js";

interface Props {
  onAddNew: () => void;
}

export function AccountList({ onAddNew }: Props) {
  const [query, setQuery] = useState("");
  const [syncConnected, setSyncConnected] = useState(false);
  const [syncMap, setSyncMap] = useState<Record<string, SyncStamp>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await send({ kind: "syncStatus" });
        if (cancelled) return;
        const approved = status.connected && status.session?.approvalStatus === "approved";
        setSyncConnected(approved);
        if (approved) {
          const m = await send({ kind: "getSyncMap" });
          if (!cancelled) setSyncMap(m.map);
        }
      } catch {
        /* silent */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const sorted = useMemo(() => {
    const entries = allAccounts.value;
    const q = query.trim().toLowerCase();
    const filtered =
      q.length === 0
        ? entries
        : entries.filter(
            (e) => e.domain.toLowerCase().includes(q) || e.username.toLowerCase().includes(q),
          );
    return [...filtered].sort((a, b) => {
      const aMatch = a.domain === activeDomain.value ? 1 : 0;
      const bMatch = b.domain === activeDomain.value ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return b.lastUsedAt - a.lastUsedAt;
    });
  }, [allAccounts.value, query]);

  const openDetail = (entry: AccountEntry) => {
    selectedAccount.value = entry;
    screen.value = "account-detail";
  };

  return (
    <motion.div
      class="flex flex-col gap-3"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <div class="flex items-center gap-2">
        <input
          class="input flex-1"
          type="search"
          placeholder={t("history_search_placeholder")}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <motion.button
          type="button"
          class="btn btn-icon"
          whileTap={TAP_SCALE}
          onClick={onAddNew}
          aria-label={t("main_add_new")}
          title={t("main_add_new")}
        >
          <span aria-hidden="true" class="text-base leading-none">
            +
          </span>
        </motion.button>
      </div>

      {sorted.length === 0 ? (
        <div class="flex flex-col gap-2 py-6 text-center">
          <span class="text-sm text-(--color-ink-muted)">{t("history_empty")}</span>
          <motion.button
            type="button"
            class="btn btn-ghost mx-auto"
            whileTap={TAP_SCALE}
            onClick={onAddNew}
          >
            {t("main_add_new")}
          </motion.button>
        </div>
      ) : (
        <ul class="flex flex-col gap-1.5 list-none p-0 m-0">
          {sorted.map((entry) => {
            const isActiveDomain = entry.domain === activeDomain.value;
            return (
              <li key={entry.domain + entry.username} class="flex flex-col">
                <div
                  class={`account-row${isActiveDomain ? " account-row--active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetail(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      openDetail(entry);
                    }
                  }}
                >
                  <Favicon
                    domain={entry.domain}
                    size={32}
                    {...(syncConnected
                      ? {
                          syncBadge: (syncMap[entry.domain + entry.username] !== undefined
                            ? "synced"
                            : "pending") as "synced" | "pending",
                        }
                      : {})}
                  />
                  <span class="flex flex-col flex-1 min-w-0 text-left">
                    <span class="text-sm font-medium truncate text-(--color-ink)">
                      {entry.domain}
                    </span>
                    <span class="text-xs text-(--color-ink-muted) truncate">{entry.username}</span>
                  </span>
                  {isActiveDomain ? <span class="account-row__dot" aria-hidden="true" /> : null}
                  <AccountRowMenu entry={entry} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}
