import type { JSX, ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { motion } from "framer-motion";
import { send } from "./api.js";
import { SitesSection } from "./components/SitesSection.js";
import { PinSection } from "./components/PinSection.js";
import { DangerSection } from "./components/DangerSection.js";
import { ProfileEditor } from "../shared/ProfileEditor.js";
import { IconBolt } from "../shared/icons.js";
import { t } from "../shared/i18n.js";
import { SOFT_SPRING } from "../shared/motion.js";
import type { Profile } from "../shared/types.js";

interface State {
  defaultProfile: Profile;
  autoLockMinutes: number;
  hasPin: boolean;
  sites: Record<string, Profile>;
}

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await send({ kind: "getState" });
      setState({
        defaultProfile: res.defaultProfile,
        autoLockMinutes: res.autoLockMinutes,
        hasPin: res.hasPin,
        sites: res.sites,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load state");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  if (error !== null) {
    return (
      <main class="max-w-3xl mx-auto px-6 pt-12 pb-16 flex flex-col gap-8">
        <PageHeader />
        <div class="callout callout-danger" role="alert">
          {error}
        </div>
      </main>
    );
  }

  if (state === null) {
    return (
      <main class="max-w-3xl mx-auto px-6 pt-12 pb-16 flex flex-col gap-8">
        <PageHeader />
        <div class="card">
          <div class="skeleton h-5 w-2/5" />
          <div class="skeleton h-3.5 w-3/4" />
          <div class="skeleton h-16" />
        </div>
      </main>
    );
  }

  return (
    <motion.main
      class="max-w-3xl mx-auto px-6 pt-12 pb-16 flex flex-col gap-8"
      initial="initial"
      animate="animate"
      variants={{
        initial: {},
        animate: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
      }}
    >
      <PageHeader />

      <Section title={t("options_default_section")} hint={t("options_default_hint")}>
        <ProfileEditor
          profile={state.defaultProfile}
          onChange={async (next) => {
            await send({ kind: "setDefaultProfile", profile: next });
            await refresh();
          }}
        />
      </Section>

      <Section title={t("options_autolock_section")} hint={t("options_autolock_hint")}>
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm font-medium text-(--color-ink)">{t("options_autolock_label")}</span>
          <input
            class="input input-mono w-24"
            type="number"
            min={0}
            max={1440}
            value={state.autoLockMinutes}
            onChange={async (e) => {
              const minutes = Number.parseInt((e.target as HTMLInputElement).value, 10);
              if (Number.isFinite(minutes)) {
                await send({ kind: "setAutoLockMinutes", minutes });
                await refresh();
              }
            }}
          />
        </div>
      </Section>

      <PinSection hasPin={state.hasPin} onChange={refresh} />

      <SitesSection sites={state.sites} onChange={refresh} />

      <DangerSection onChange={refresh} />
    </motion.main>
  );
}

function PageHeader() {
  return (
    <motion.header
      class="flex flex-col gap-2 pb-4"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SOFT_SPRING}
    >
      <div class="flex items-center gap-3">
        <span class="grid place-items-center w-8 h-8 rounded-[10px] bg-(--color-accent-500)/12 text-(--color-accent-600) dark:text-(--color-accent-400)">
          <IconBolt size={18} />
        </span>
        <h1 class="m-0 text-2xl font-semibold tracking-[-0.025em]">{t("extName")}</h1>
      </div>
      <p class="text-(--color-ink-muted) text-sm">{t("options_subtitle")}</p>
    </motion.header>
  );
}

function Section({
  title,
  hint,
  actions,
  children,
}: {
  title: string;
  hint?: string;
  actions?: JSX.Element;
  children: ComponentChildren;
}) {
  return (
    <motion.section
      class="flex flex-col gap-4"
      variants={{
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0, transition: SOFT_SPRING },
      }}
    >
      <div class="flex items-baseline justify-between gap-3">
        <div class="flex flex-col gap-0.5 flex-1 min-w-0">
          <h2 class="m-0 text-base font-semibold tracking-[-0.015em] text-(--color-ink)">
            {title}
          </h2>
          {hint !== undefined ? (
            <span class="text-xs text-(--color-ink-muted) leading-snug">{hint}</span>
          ) : null}
        </div>
        {actions !== undefined ? <div class="flex gap-2">{actions}</div> : null}
      </div>
      <div class="card p-6 shadow-sm">{children}</div>
    </motion.section>
  );
}
