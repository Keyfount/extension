/**
 * Per-row dropdown menu. Owns its own open state and a click-outside
 * dismisser. Lets the user copy the username, recompute and copy the
 * password, open the detail page, or delete the entry — without leaving
 * the list.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { send } from "../api.js";
import { copyWithAutoClear } from "../clipboard.js";
import { t } from "../../shared/i18n.js";
import { IconCheck, IconMore } from "../../shared/icons.js";
import type { AccountEntry } from "../../shared/types.js";
import { allAccounts, screen, selectedAccount } from "../state.js";

interface Props {
  entry: AccountEntry;
}

export function AccountRowMenu({ entry }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"username" | "password" | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (ref.current === null) return;
      if (!ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const copyUsername = async (event: Event) => {
    event.stopPropagation();
    try {
      await copyWithAutoClear(entry.username);
      setCopied("username");
      setTimeout(() => {
        setCopied(null);
        setOpen(false);
      }, 900);
    } catch {
      setOpen(false);
    }
  };

  const copyPassword = async (event: Event) => {
    event.stopPropagation();
    try {
      const res = await send({
        kind: "generate",
        domain: entry.domain,
        email: entry.username,
        profile: entry.profile,
      });
      await copyWithAutoClear(res.password);
      setCopied("password");
      setTimeout(() => {
        setCopied(null);
        setOpen(false);
      }, 900);
    } catch {
      setOpen(false);
    }
  };

  const openDetail = (event: Event) => {
    event.stopPropagation();
    selectedAccount.value = entry;
    screen.value = "account-detail";
  };

  const remove = async (event: Event) => {
    event.stopPropagation();
    await send({ kind: "deleteAccount", domain: entry.domain, username: entry.username });
    allAccounts.value = allAccounts.value.filter(
      (e) => !(e.domain === entry.domain && e.username === entry.username),
    );
  };

  return (
    <div ref={ref} class="relative">
      <button
        type="button"
        class="btn btn-quiet btn-icon btn-sm"
        aria-label={t("row_menu_aria")}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <IconMore size={14} />
      </button>
      {open ? (
        <div class="account-row__menu" role="menu">
          <button type="button" role="menuitem" onClick={copyUsername}>
            {copied === "username" ? <IconCheck size={12} /> : null}
            <span>{t("row_menu_copy_username")}</span>
          </button>
          <button type="button" role="menuitem" onClick={copyPassword}>
            {copied === "password" ? <IconCheck size={12} /> : null}
            <span>{t("row_menu_copy_password")}</span>
          </button>
          <div class="account-row__menu-sep" />
          <button type="button" role="menuitem" onClick={openDetail}>
            {t("row_menu_open")}
          </button>
          <button type="button" role="menuitem" class="account-row__menu-danger" onClick={remove}>
            {t("common_delete")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
