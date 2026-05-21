/**
 * Vault-style list of saved accounts. Search box at the top, rows below
 * with favicon + domain + username. Clicking a row expands it inline to
 * reveal the (recomputed) password with copy and — when the active tab
 * matches the entry's domain — a fill button that writes into the page.
 */
import { useMemo, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { send } from "../api.js";
import { t } from "../../shared/i18n.js";
import { faviconUrl } from "../../shared/favicon.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import { IconCheck, IconCopy, IconEye, IconEyeOff, IconClose } from "../../shared/icons.js";
import type { AccountEntry } from "../../shared/types.js";
import { activeDomain, allAccounts } from "../state.js";

interface Props {
  onAddNew: () => void;
}

interface Expanded {
  entry: AccountEntry;
  password: string | null;
  revealed: boolean;
  copied: boolean;
}

export function AccountList({ onAddNew }: Props) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Expanded | null>(null);

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
      // Active-tab matches float to the top, then most-recently-used.
      const aMatch = a.domain === activeDomain.value ? 1 : 0;
      const bMatch = b.domain === activeDomain.value ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
      return b.lastUsedAt - a.lastUsedAt;
    });
  }, [allAccounts.value, query]);

  const open = async (entry: AccountEntry) => {
    if (expanded?.entry.domain === entry.domain && expanded.entry.username === entry.username) {
      setExpanded(null);
      return;
    }
    setExpanded({ entry, password: null, revealed: false, copied: false });
    try {
      const res = await send({
        kind: "generate",
        domain: entry.domain,
        email: entry.username,
      });
      setExpanded((prev) =>
        prev !== null && prev.entry === entry ? { ...prev, password: res.password } : prev,
      );
    } catch {
      setExpanded(null);
    }
  };

  const copy = async () => {
    if (expanded?.password === null) return;
    try {
      await navigator.clipboard.writeText(expanded!.password);
      setExpanded((prev) => (prev !== null ? { ...prev, copied: true } : prev));
      setTimeout(
        () => setExpanded((prev) => (prev !== null ? { ...prev, copied: false } : prev)),
        1500,
      );
    } catch {
      /* swallowed */
    }
  };

  const fillActiveTab = async () => {
    if (expanded === null || expanded.password === null) return;
    if (expanded.entry.domain !== activeDomain.value) return;
    const password = expanded.password;
    const username = expanded.entry.username;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (u: string, p: string) => {
          const setVal = (input: HTMLInputElement, value: string) => {
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value",
            )?.set;
            if (setter !== undefined) setter.call(input, value);
            else input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          };
          const pwd = document.querySelector<HTMLInputElement>('input[type="password"]');
          if (pwd !== null) setVal(pwd, p);
          const candidates = Array.from(
            document.querySelectorAll<HTMLInputElement>(
              'input[type="email"], input[type="text"], input:not([type])',
            ),
          ).filter((el) => el.offsetParent !== null);
          const target =
            candidates.find((el) =>
              /user|email|login/i.test([el.name, el.id, el.placeholder].join(" ")),
            ) ?? candidates[0];
          if (target !== undefined) setVal(target, u);
        },
        args: [username, password],
      });
      window.close();
    } catch {
      /* swallowed */
    }
  };

  const remove = async (entry: AccountEntry) => {
    await send({ kind: "deleteAccount", domain: entry.domain, username: entry.username });
    allAccounts.value = allAccounts.value.filter(
      (e) => !(e.domain === entry.domain && e.username === entry.username),
    );
    setExpanded(null);
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
            const isOpen =
              expanded?.entry.domain === entry.domain && expanded.entry.username === entry.username;
            const isActiveDomain = entry.domain === activeDomain.value;
            return (
              <li key={entry.domain + entry.username} class="flex flex-col">
                <button
                  type="button"
                  class={`account-row${isActiveDomain ? " account-row--active" : ""}`}
                  onClick={() => void open(entry)}
                  aria-expanded={isOpen}
                >
                  <Favicon domain={entry.domain} />
                  <span class="flex flex-col flex-1 min-w-0 text-left">
                    <span class="text-sm font-medium truncate text-(--color-ink)">
                      {entry.domain}
                    </span>
                    <span class="text-xs text-(--color-ink-muted) truncate">{entry.username}</span>
                  </span>
                  {isActiveDomain ? <span class="account-row__dot" aria-hidden="true" /> : null}
                </button>

                <AnimatePresence>
                  {isOpen ? (
                    <motion.div
                      key="exp"
                      class="account-row__details"
                      variants={POP_IN}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                    >
                      <code
                        class={
                          expanded!.revealed
                            ? "font-mono text-sm break-all select-all text-(--color-ink)"
                            : "font-mono text-sm break-all select-all text-(--color-ink-muted) tracking-[0.15em]"
                        }
                      >
                        {expanded!.password === null
                          ? "•".repeat(20)
                          : expanded!.revealed
                            ? expanded!.password
                            : "•".repeat(Math.min(expanded!.password.length, 24))}
                      </code>
                      <div class="flex gap-2 flex-wrap">
                        <motion.button
                          type="button"
                          class="btn btn-ghost btn-sm flex-1"
                          whileTap={TAP_SCALE}
                          onClick={() =>
                            setExpanded((prev) =>
                              prev !== null ? { ...prev, revealed: !prev.revealed } : prev,
                            )
                          }
                        >
                          {expanded!.revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                          {expanded!.revealed ? t("common_hide") : t("common_reveal")}
                        </motion.button>
                        <motion.button
                          type="button"
                          class="btn btn-ghost btn-sm flex-1"
                          whileTap={TAP_SCALE}
                          onClick={copy}
                          disabled={expanded!.password === null}
                        >
                          {expanded!.copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                          {expanded!.copied ? t("common_copied") : t("common_copy")}
                        </motion.button>
                        {isActiveDomain ? (
                          <motion.button
                            type="button"
                            class="btn btn-sm flex-1"
                            whileTap={TAP_SCALE}
                            onClick={fillActiveTab}
                            disabled={expanded!.password === null}
                          >
                            {t("common_fill")}
                          </motion.button>
                        ) : null}
                        <motion.button
                          type="button"
                          class="btn btn-danger btn-sm btn-icon"
                          whileTap={TAP_SCALE}
                          onClick={() => void remove(entry)}
                          aria-label={t("history_delete_aria")}
                        >
                          <IconClose size={14} />
                        </motion.button>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}

function Favicon({ domain }: { domain: string }) {
  const url = faviconUrl(domain, 32);
  return (
    <span class="account-row__favicon" aria-hidden="true">
      {url !== null ? (
        <img src={url} alt="" width={20} height={20} />
      ) : (
        <span class="text-[11px] font-mono uppercase">{domain.slice(0, 2)}</span>
      )}
    </span>
  );
}
