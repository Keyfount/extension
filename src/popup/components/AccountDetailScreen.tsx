/**
 * Detail page for one saved account.
 *
 * The screen is dedicated (a top-level Screen value), reached by clicking
 * a row in AccountList. It owns the entry's profile editor so changes only
 * affect this account — the per-site default is no longer involved once
 * the entry exists.
 */
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { AnimatePresence, motion } from "framer-motion";
import { send, BackgroundError } from "../api.js";
import { copyWithAutoClear } from "../clipboard.js";
import { Header } from "./Header.js";
import { Favicon } from "./Favicon.js";
import { IconCheck, IconChevronRight, IconCopy, IconEye, IconEyeOff } from "../../shared/icons.js";
import { ProfileEditor } from "../../shared/ProfileEditor.js";
import { t } from "../../shared/i18n.js";
import { POP_IN, SOFT_SPRING, TAP_SCALE } from "../../shared/motion.js";
import type { SyncStamp } from "../../shared/messages.js";
import type { Profile } from "../../shared/types.js";
import {
  activeDomain,
  activeHost,
  allAccounts,
  fingerprint,
  screen,
  selectedAccount,
} from "../state.js";
import { domainMatches, fullHost, registrableDomain } from "../../shared/domain.js";

export function AccountDetailScreen() {
  const entry = selectedAccount.value;
  const [usernameDraft, setUsernameDraft] = useState(entry?.username ?? "");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"password" | "username" | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [previewPassword, setPreviewPassword] = useState<string | null>(null);
  const [previewRevealed, setPreviewRevealed] = useState(false);
  const [previewCopied, setPreviewCopied] = useState(false);
  const [postRenameToast, setPostRenameToast] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<SyncStamp | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  // When the pasted value resolves to a host AND a distinct registrable
  // domain, we ask the user which one to link instead of guessing.
  const [linkChoice, setLinkChoice] = useState<{ host: string; registrable: string } | null>(null);

  // Fetch sync info whenever the entry changes (rename keeps the old key
  // entry's timestamp; we refresh after a sync-ack via the cursor below).
  useEffect(() => {
    if (entry === null) return;
    let cancelled = false;
    void send({
      kind: "getAccountSyncInfo",
      domain: entry.domain,
      username: entry.username,
    }).then((res) => {
      if (!cancelled) setLastSyncedAt(res.lastSyncedAt);
    });
    return () => {
      cancelled = true;
    };
  }, [entry?.domain, entry?.username]);
  // Rotation flow: an inline panel that previews both the current and
  // the bumped-counter password so the user can copy the values that
  // most "change password" forms demand (current + new ×2). Persistence
  // is gated behind an explicit Confirm.
  const [rotatePreview, setRotatePreview] = useState<{
    oldPassword: string;
    newPassword: string;
  } | null>(null);
  const [rotateOldRevealed, setRotateOldRevealed] = useState(false);
  const [rotateNewRevealed, setRotateNewRevealed] = useState(false);
  const [rotateCopied, setRotateCopied] = useState<"old" | "new" | null>(null);

  // Recompute password whenever the entry's profile changes (initial mount
  // + every profile mutation below).
  useEffect(() => {
    if (entry === null) return;
    let cancelled = false;
    setPassword(null);
    setRevealed(false);
    send({
      kind: "generate",
      domain: entry.domain,
      email: entry.username,
      profile: entry.profile,
    })
      .then((res) => {
        if (!cancelled) setPassword(res.password);
      })
      .catch(() => {
        if (!cancelled) setPassword(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entry?.domain, entry?.username, entry?.profile]);

  // Reset the username draft when the user navigates to a different entry.
  useEffect(() => {
    setUsernameDraft(entry?.username ?? "");
    setRenameError(null);
    setPreviewPassword(null);
    setPreviewRevealed(false);
  }, [entry?.domain, entry?.username]);

  // Live preview of the password that would be produced after renaming.
  // The deterministic algorithm derives from the username, so a rename
  // necessarily changes the password — we surface that here before the
  // user commits, with the new value ready to copy.
  useEffect(() => {
    if (entry === null) return;
    const draft = usernameDraft.trim();
    if (draft.length === 0 || draft === entry.username) {
      setPreviewPassword(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      send({
        kind: "generate",
        domain: entry.domain,
        email: draft,
        profile: entry.profile,
      })
        .then((res) => {
          if (!cancelled) setPreviewPassword(res.password);
        })
        .catch(() => {
          if (!cancelled) setPreviewPassword(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [usernameDraft, entry?.domain, entry?.username, entry?.profile]);

  const isActive = useMemo(
    () => entry !== null && entry.domain === activeDomain.value,
    [entry?.domain],
  );

  const back = useCallback(() => {
    screen.value = "main";
  }, []);

  if (entry === null) {
    return (
      <motion.div
        class="flex flex-col gap-4 p-5"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SOFT_SPRING}
      >
        <Header
          subtitle={undefined}
          fingerprint={fingerprint.value}
          actions={
            <motion.button
              type="button"
              class="btn btn-quiet btn-icon"
              whileTap={TAP_SCALE}
              onClick={back}
              aria-label={t("common_back")}
            >
              <IconChevronRight size={18} style={{ transform: "rotate(180deg)" }} />
            </motion.button>
          }
        />
        <p class="text-(--color-ink-muted) text-sm">{t("detail_missing")}</p>
      </motion.div>
    );
  }

  const renameSubmit = async (event: Event) => {
    event.preventDefault();
    setRenameError(null);
    const next = usernameDraft.trim();
    if (next.length === 0 || next === entry.username) return;
    setBusy(true);
    try {
      const res = await send({
        kind: "renameAccount",
        domain: entry.domain,
        oldUsername: entry.username,
        newUsername: next,
      });
      const updated = res.entry;
      allAccounts.value = allAccounts.value.map((e) =>
        e.domain === entry.domain && e.username === entry.username ? updated : e,
      );
      selectedAccount.value = updated;
      // After rename, the derivation uses the new username so the
      // password just changed. Remind the user to update it on the
      // site too, and let them copy the freshly-computed value.
      try {
        const res2 = await send({
          kind: "generate",
          domain: updated.domain,
          email: updated.username,
          profile: updated.profile,
        });
        setPostRenameToast(res2.password);
        setTimeout(() => setPostRenameToast(null), 12_000);
      } catch {
        /* swallowed — the detail page will recompute on next render */
      }
    } catch (error) {
      setRenameError(error instanceof BackgroundError ? error.message : t("detail_rename_failed"));
    } finally {
      setBusy(false);
    }
  };

  const updateProfile = async (next: Profile) => {
    setBusy(true);
    try {
      const res = await send({
        kind: "updateAccountProfile",
        domain: entry.domain,
        username: entry.username,
        profile: next,
      });
      const updated = res.entry;
      allAccounts.value = allAccounts.value.map((e) =>
        e.domain === entry.domain && e.username === entry.username ? updated : e,
      );
      selectedAccount.value = updated;
    } catch {
      /* swallowed */
    } finally {
      setBusy(false);
    }
  };

  // Persist one linked domain. Shared by the text field, the paste-choice
  // buttons, and the current-site banner.
  const doLink = async (value: string) => {
    const linked = value.trim().toLowerCase();
    if (linked.length === 0) return;
    setLinkError(null);
    try {
      const res = await send({
        kind: "linkAccountDomain",
        domain: entry.domain,
        username: entry.username,
        linked,
      });
      const updated = res.entry;
      allAccounts.value = allAccounts.value.map((e) =>
        e.domain === entry.domain && e.username === entry.username ? updated : e,
      );
      selectedAccount.value = updated;
      setLinkDraft("");
      setLinkChoice(null);
    } catch (error) {
      setLinkError(error instanceof BackgroundError ? error.message : t("detail_link_failed"));
    }
  };

  // Pasting a URL like `https://login.example.org/...` is ambiguous: the
  // user may want the exact host or the whole registrable site. Offer the
  // choice when they differ; otherwise link straight away.
  const addLink = (event: Event) => {
    event.preventDefault();
    const draft = linkDraft.trim();
    if (draft.length === 0) return;
    const host = fullHost(draft);
    const registrable = registrableDomain(draft);
    if (host !== null && registrable !== null && host !== registrable) {
      setLinkError(null);
      setLinkChoice({ host, registrable });
    } else {
      void doLink(registrable ?? host ?? draft);
    }
  };

  const removeLink = async (linked: string) => {
    try {
      const res = await send({
        kind: "unlinkAccountDomain",
        domain: entry.domain,
        username: entry.username,
        linked,
      });
      const updated = res.entry;
      allAccounts.value = allAccounts.value.map((e) =>
        e.domain === entry.domain && e.username === entry.username ? updated : e,
      );
      selectedAccount.value = updated;
    } catch {
      /* swallowed — the row stays as-is */
    }
  };

  // One selectable domain row (the whole row is the button): shows the
  // domain and a short scope hint, and links it on click.
  const linkOptionRow = (domain: string, hint: string) => (
    <motion.button
      type="button"
      whileTap={TAP_SCALE}
      class="flex w-full flex-col items-start gap-0.5 rounded-xl border border-(--color-line) bg-(--color-surface-sunken) px-3 py-2 text-left hover:border-(--color-line-strong)"
      onClick={() => void doLink(domain)}
    >
      <span class="font-mono text-xs truncate text-(--color-ink)">{domain}</span>
      <span class="text-[11px] text-(--color-ink-muted)">{hint}</span>
    </motion.button>
  );

  const copyText = async (text: string, kind: "password" | "username") => {
    try {
      await copyWithAutoClear(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* swallowed */
    }
  };

  const fillActiveTab = async () => {
    if (!isActive || password === null) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return;
      const u = entry.username;
      const p = password;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (uVal: string, pVal: string) => {
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
          if (pwd !== null) setVal(pwd, pVal);
          const candidates = Array.from(
            document.querySelectorAll<HTMLInputElement>(
              'input[type="email"], input[type="text"], input:not([type])',
            ),
          ).filter((el) => el.offsetParent !== null);
          const target =
            candidates.find((el) =>
              /user|email|login/i.test([el.name, el.id, el.placeholder].join(" ")),
            ) ?? candidates[0];
          if (target !== undefined) setVal(target, uVal);
        },
        args: [u, p],
      });
      window.close();
    } catch {
      /* swallowed */
    }
  };

  /**
   * Open the rotation preview: compute the current password (with the
   * stored counter) and the would-be new password (counter + 1). Both
   * are surfaced as copy/reveal pills; nothing is persisted yet.
   */
  const startRotation = async () => {
    const bumped: Profile = {
      ...entry.profile,
      counter: (entry.profile.counter ?? 1) + 1,
    };
    try {
      const [oldRes, newRes] = await Promise.all([
        send({
          kind: "generate",
          domain: entry.domain,
          email: entry.username,
          profile: entry.profile,
        }),
        send({
          kind: "generate",
          domain: entry.domain,
          email: entry.username,
          profile: bumped,
        }),
      ]);
      setRotatePreview({ oldPassword: oldRes.password, newPassword: newRes.password });
      setRotateOldRevealed(false);
      setRotateNewRevealed(false);
    } catch {
      /* swallowed */
    }
  };

  /**
   * Commit the rotation: persist counter + 1, refresh the in-memory list
   * and the displayed entry, then collapse the preview panel.
   */
  const confirmRotation = async () => {
    const bumped: Profile = {
      ...entry.profile,
      counter: (entry.profile.counter ?? 1) + 1,
    };
    try {
      const res = await send({
        kind: "updateAccountProfile",
        domain: entry.domain,
        username: entry.username,
        profile: bumped,
      });
      const updated = res.entry;
      allAccounts.value = allAccounts.value.map((e) =>
        e.domain === entry.domain && e.username === entry.username ? updated : e,
      );
      selectedAccount.value = updated;
    } catch {
      /* swallowed */
    }
    setRotatePreview(null);
  };

  const copyRotation = async (which: "old" | "new") => {
    if (rotatePreview === null) return;
    const value = which === "old" ? rotatePreview.oldPassword : rotatePreview.newPassword;
    await copyWithAutoClear(value);
    setRotateCopied(which);
    setTimeout(() => setRotateCopied(null), 1500);
  };

  const remove = async () => {
    await send({ kind: "deleteAccount", domain: entry.domain, username: entry.username });
    allAccounts.value = allAccounts.value.filter(
      (e) => !(e.domain === entry.domain && e.username === entry.username),
    );
    selectedAccount.value = null;
    screen.value = "main";
  };

  const usernameDirty = usernameDraft.trim().length > 0 && usernameDraft.trim() !== entry.username;

  // Current-site quick-add: when the open tab is a web page this account is
  // NOT already offered on, surface a one-tap banner to link it (with the
  // same host-vs-registrable choice when they differ).
  const curHost = activeHost.value;
  const curRegistrable = activeDomain.value;
  const matchSet = [entry.domain, ...(entry.linkedDomains ?? [])];
  const alreadyOnSite = curHost !== null && matchSet.some((m) => domainMatches(m, curHost));
  const showSiteBanner = curHost !== null && curRegistrable !== null && !alreadyOnSite;

  return (
    <motion.div
      class="flex flex-col gap-4 p-5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <Header
        subtitle={entry.domain}
        fingerprint={fingerprint.value}
        actions={
          <motion.button
            type="button"
            class="btn btn-quiet btn-icon"
            whileTap={TAP_SCALE}
            onClick={back}
            aria-label={t("common_back")}
          >
            <IconChevronRight size={18} style={{ transform: "rotate(180deg)" }} />
          </motion.button>
        }
      />

      <div class="flex items-center gap-3">
        <Favicon domain={entry.domain} size={40} />
        <div class="flex flex-col min-w-0">
          <span class="text-sm font-semibold truncate text-(--color-ink)">{entry.domain}</span>
          <span class="text-xs text-(--color-ink-muted)">
            {new Date(entry.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      <form class="flex flex-col gap-2" onSubmit={renameSubmit}>
        <span class="field-label">{t("main_username_label")}</span>
        <div class="flex gap-2">
          <input
            class="input flex-1"
            type="text"
            value={usernameDraft}
            onInput={(e) => setUsernameDraft((e.target as HTMLInputElement).value)}
          />
          <AnimatePresence>
            {usernameDirty ? (
              <motion.button
                key="save-username"
                type="submit"
                class="btn btn-sm"
                whileTap={TAP_SCALE}
                disabled={busy}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
              >
                {t("common_save")}
              </motion.button>
            ) : null}
          </AnimatePresence>
        </div>
        {renameError !== null ? (
          <div class="field-error" role="alert">
            {renameError}
          </div>
        ) : null}

        <AnimatePresence>
          {usernameDirty ? (
            <motion.div
              key="rename-warn"
              class="callout flex-col gap-2"
              role="status"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <strong>{t("detail_rename_warning_title")}</strong>
              <span>{t("detail_rename_warning_body")}</span>
              {previewPassword !== null ? (
                <div class="flex flex-col gap-2 pt-1">
                  <span class="field-label">{t("detail_rename_preview_label")}</span>
                  <code
                    class={
                      previewRevealed
                        ? "font-mono text-sm break-all select-all text-(--color-ink)"
                        : "font-mono text-sm break-all select-all text-(--color-ink-muted) tracking-[0.15em]"
                    }
                  >
                    {previewRevealed
                      ? previewPassword
                      : "•".repeat(Math.min(previewPassword.length, 24))}
                  </code>
                  <div class="flex gap-2 flex-wrap">
                    <motion.button
                      type="button"
                      class="btn btn-ghost btn-sm flex-1"
                      whileTap={TAP_SCALE}
                      onClick={() => setPreviewRevealed((v) => !v)}
                    >
                      {previewRevealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                      {previewRevealed ? t("common_hide") : t("common_reveal")}
                    </motion.button>
                    <motion.button
                      type="button"
                      class="btn btn-ghost btn-sm flex-1"
                      whileTap={TAP_SCALE}
                      onClick={async () => {
                        if (previewPassword === null) return;
                        await copyWithAutoClear(previewPassword);
                        setPreviewCopied(true);
                        setTimeout(() => setPreviewCopied(false), 1500);
                      }}
                    >
                      {previewCopied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      {previewCopied ? t("common_copied") : t("common_copy")}
                    </motion.button>
                  </div>
                </div>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </form>

      <motion.div
        class="flex flex-col gap-3 p-4 rounded-2xl bg-(--color-surface-sunken) border border-(--color-line)"
        variants={POP_IN}
        initial="initial"
        animate="animate"
      >
        <span class="field-label">{t("detail_password_label")}</span>
        <code
          class={
            revealed
              ? "font-mono text-sm break-all select-all cursor-text text-(--color-ink) min-h-5"
              : "font-mono text-sm break-all select-all cursor-text text-(--color-ink-muted) min-h-5 tracking-[0.15em]"
          }
        >
          {password === null
            ? "•".repeat(20)
            : revealed
              ? password
              : "•".repeat(Math.min(password.length, 24))}
        </code>
        <div class="flex gap-2 flex-wrap">
          <motion.button
            type="button"
            class="btn btn-ghost btn-sm flex-1"
            whileTap={TAP_SCALE}
            onClick={() => setRevealed((v) => !v)}
            disabled={password === null}
          >
            {revealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            {revealed ? t("common_hide") : t("common_reveal")}
          </motion.button>
          <motion.button
            type="button"
            class="btn btn-ghost btn-sm flex-1"
            whileTap={TAP_SCALE}
            onClick={() => password !== null && void copyText(password, "password")}
            disabled={password === null}
          >
            {copied === "password" ? <IconCheck size={14} /> : <IconCopy size={14} />}
            {copied === "password" ? t("common_copied") : t("common_copy")}
          </motion.button>
          {isActive ? (
            <motion.button
              type="button"
              class="btn btn-sm flex-1"
              whileTap={TAP_SCALE}
              onClick={fillActiveTab}
              disabled={password === null}
            >
              {t("common_fill")}
            </motion.button>
          ) : null}
        </div>
      </motion.div>

      <motion.section
        class="flex flex-col gap-3"
        variants={{
          initial: { opacity: 0, y: 6 },
          animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
        }}
      >
        <div class="flex flex-col gap-0.5">
          <h2 class="m-0 text-sm font-semibold tracking-[-0.01em]">
            {t("detail_profile_section")}
          </h2>
          <span class="text-xs text-(--color-ink-muted) leading-snug">
            {t("detail_profile_hint")}
          </span>
        </div>
        <div class="card p-4">
          <ProfileEditor profile={entry.profile} onChange={updateProfile} />
        </div>
      </motion.section>

      <div class="flex flex-col gap-2 pt-1">
        <h2 class="m-0 text-sm font-semibold tracking-[-0.01em]">{t("detail_linked_section")}</h2>
        <span class="text-xs text-(--color-ink-muted) leading-snug">{t("detail_linked_hint")}</span>

        {showSiteBanner && curHost !== null && curRegistrable !== null ? (
          <div class="flex flex-col gap-2 rounded-2xl border border-(--color-accent-soft) bg-(--color-accent-soft)/30 p-3">
            <span class="text-xs font-semibold text-(--color-ink)">
              {t("detail_link_current_title")}
            </span>
            <div class="flex flex-col gap-1.5">
              {linkOptionRow(curRegistrable, t("detail_linked_scope_site"))}
              {curHost !== curRegistrable
                ? linkOptionRow(curHost, t("detail_linked_scope_host"))
                : null}
            </div>
          </div>
        ) : null}

        {entry.linkedDomains !== undefined && entry.linkedDomains.length > 0 ? (
          <ul class="flex flex-col gap-1">
            {entry.linkedDomains.map((linked) => (
              <li
                key={linked}
                class="flex items-center justify-between gap-2 rounded-xl bg-(--color-surface-sunken) border border-(--color-line) px-3 py-2"
              >
                <span class="font-mono text-xs truncate text-(--color-ink)">{linked}</span>
                <motion.button
                  type="button"
                  class="btn btn-quiet btn-sm"
                  whileTap={TAP_SCALE}
                  onClick={() => void removeLink(linked)}
                >
                  {t("detail_linked_remove")}
                </motion.button>
              </li>
            ))}
          </ul>
        ) : (
          <span class="text-xs text-(--color-ink-muted)">{t("detail_linked_empty")}</span>
        )}

        {linkChoice !== null ? (
          <div class="flex flex-col gap-2 rounded-2xl border border-(--color-line) bg-(--color-surface-sunken) p-3">
            <span class="text-xs font-semibold text-(--color-ink)">
              {t("detail_linked_choose_title")}
            </span>
            {linkOptionRow(linkChoice.registrable, t("detail_linked_scope_site"))}
            {linkOptionRow(linkChoice.host, t("detail_linked_scope_host"))}
            <motion.button
              type="button"
              class="btn btn-quiet btn-sm self-start"
              whileTap={TAP_SCALE}
              onClick={() => setLinkChoice(null)}
            >
              {t("common_cancel")}
            </motion.button>
          </div>
        ) : (
          <form class="flex gap-2" onSubmit={addLink}>
            <input
              class="input flex-1"
              type="text"
              inputMode="url"
              placeholder={t("detail_linked_placeholder")}
              value={linkDraft}
              onInput={(e) => setLinkDraft((e.target as HTMLInputElement).value)}
            />
            <motion.button
              type="submit"
              class="btn btn-sm"
              whileTap={TAP_SCALE}
              disabled={linkDraft.trim().length === 0}
            >
              {t("detail_linked_add")}
            </motion.button>
          </form>
        )}
        {linkError !== null ? (
          <div class="field-error" role="alert">
            {linkError}
          </div>
        ) : null}
      </div>

      <div class="flex flex-col gap-2 pt-1">
        <h2 class="m-0 text-sm font-semibold tracking-[-0.01em]">{t("detail_rotate_section")}</h2>
        <span class="text-xs text-(--color-ink-muted) leading-snug">{t("detail_rotate_hint")}</span>
        {rotatePreview === null ? (
          <motion.button
            type="button"
            class="btn btn-ghost self-start"
            whileTap={TAP_SCALE}
            onClick={() => void startRotation()}
          >
            {t("detail_rotate_cta")}
          </motion.button>
        ) : (
          <motion.div
            class="flex flex-col gap-3 p-3 rounded-2xl bg-(--color-surface-sunken) border border-(--color-line)"
            variants={POP_IN}
            initial="initial"
            animate="animate"
          >
            <div class="flex flex-col gap-2">
              <span class="field-label">{t("detail_rotate_old_label")}</span>
              <code
                class={
                  rotateOldRevealed
                    ? "font-mono text-sm break-all select-all text-(--color-ink)"
                    : "font-mono text-sm break-all select-all text-(--color-ink-muted) tracking-[0.15em]"
                }
              >
                {rotateOldRevealed
                  ? rotatePreview.oldPassword
                  : "•".repeat(Math.min(rotatePreview.oldPassword.length, 24))}
              </code>
              <div class="flex gap-2">
                <motion.button
                  type="button"
                  class="btn btn-ghost btn-sm flex-1"
                  whileTap={TAP_SCALE}
                  onClick={() => setRotateOldRevealed((v) => !v)}
                >
                  {rotateOldRevealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  {rotateOldRevealed ? t("common_hide") : t("common_reveal")}
                </motion.button>
                <motion.button
                  type="button"
                  class="btn btn-ghost btn-sm flex-1"
                  whileTap={TAP_SCALE}
                  onClick={() => void copyRotation("old")}
                >
                  {rotateCopied === "old" ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  {rotateCopied === "old" ? t("common_copied") : t("common_copy")}
                </motion.button>
              </div>
            </div>

            <div class="flex flex-col gap-2">
              <span class="field-label">{t("detail_rotate_new_label")}</span>
              <code
                class={
                  rotateNewRevealed
                    ? "font-mono text-sm break-all select-all text-(--color-ink)"
                    : "font-mono text-sm break-all select-all text-(--color-ink-muted) tracking-[0.15em]"
                }
              >
                {rotateNewRevealed
                  ? rotatePreview.newPassword
                  : "•".repeat(Math.min(rotatePreview.newPassword.length, 24))}
              </code>
              <div class="flex gap-2">
                <motion.button
                  type="button"
                  class="btn btn-ghost btn-sm flex-1"
                  whileTap={TAP_SCALE}
                  onClick={() => setRotateNewRevealed((v) => !v)}
                >
                  {rotateNewRevealed ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                  {rotateNewRevealed ? t("common_hide") : t("common_reveal")}
                </motion.button>
                <motion.button
                  type="button"
                  class="btn btn-ghost btn-sm flex-1"
                  whileTap={TAP_SCALE}
                  onClick={() => void copyRotation("new")}
                >
                  {rotateCopied === "new" ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  {rotateCopied === "new" ? t("common_copied") : t("common_copy")}
                </motion.button>
              </div>
            </div>

            <div class="flex gap-2 pt-1">
              <motion.button
                type="button"
                class="btn flex-1"
                whileTap={TAP_SCALE}
                onClick={() => void confirmRotation()}
              >
                {t("detail_rotate_confirm")}
              </motion.button>
              <motion.button
                type="button"
                class="btn btn-ghost flex-1"
                whileTap={TAP_SCALE}
                onClick={() => setRotatePreview(null)}
              >
                {t("common_cancel")}
              </motion.button>
            </div>
          </motion.div>
        )}
      </div>

      <div class="flex flex-col gap-2 pt-2">
        <span class="text-xs text-(--color-ink-subtle)">
          {t("detail_last_used", new Date(entry.lastUsedAt).toLocaleString())}
        </span>
        {lastSyncedAt !== null ? (
          <span class="text-xs text-(--color-ink-subtle)">
            Synchronisé {formatRelativeAge(lastSyncedAt.ts)}{" "}
            {directionPreposition(lastSyncedAt.dir)} le serveur.
          </span>
        ) : null}
        {confirmingDelete ? (
          <div class="callout callout-danger flex-col gap-3" role="alertdialog">
            <span>{t("detail_delete_confirm")}</span>
            <div class="flex gap-2">
              <motion.button
                type="button"
                class="btn btn-danger flex-1"
                whileTap={TAP_SCALE}
                onClick={() => void remove()}
              >
                {t("common_delete")}
              </motion.button>
              <motion.button
                type="button"
                class="btn btn-ghost flex-1"
                whileTap={TAP_SCALE}
                onClick={() => setConfirmingDelete(false)}
              >
                {t("common_cancel")}
              </motion.button>
            </div>
          </div>
        ) : (
          <motion.button
            type="button"
            class="btn btn-danger self-start"
            whileTap={TAP_SCALE}
            onClick={() => setConfirmingDelete(true)}
          >
            {t("detail_delete_cta")}
          </motion.button>
        )}
      </div>

      <AnimatePresence>
        {copied === "username" ? (
          <motion.span
            class="text-xs text-(--color-ink-muted) self-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {t("common_copied")}
          </motion.span>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {postRenameToast !== null ? (
          <motion.div
            key="rename-toast"
            class="callout flex-col gap-2"
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <strong>{t("detail_rename_done_title")}</strong>
            <span>{t("detail_rename_done_body")}</span>
            <motion.button
              type="button"
              class="btn btn-sm self-start"
              whileTap={TAP_SCALE}
              onClick={async () => {
                await copyWithAutoClear(postRenameToast);
                setPostRenameToast(null);
              }}
            >
              <IconCopy size={14} />
              {t("detail_rename_done_copy")}
            </motion.button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Returns the preposition that fits the sync direction:
 *  - push (we uploaded our state) → "vers"
 *  - pull (we received remote state) → "depuis"
 *  - unknown (legacy entry) → "avec"
 */
function directionPreposition(dir: SyncStamp["dir"]): string {
  if (dir === "push") return "vers";
  if (dir === "pull") return "depuis";
  return "avec";
}

/** Returns "à l'instant" / "il y a 12 min" / "il y a 3 h" / "il y a 2 j". */
function formatRelativeAge(ts: number): string {
  const diffMs = Date.now() - ts;
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 30) return "à l'instant";
  if (sec < 90) return "il y a 1 min";
  const min = Math.round(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `il y a ${hr} h`;
  const day = Math.round(hr / 24);
  return `il y a ${day} j`;
}
