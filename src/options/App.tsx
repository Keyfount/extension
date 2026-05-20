import type { JSX, ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { send } from "./api.js";
import { SitesSection } from "./components/SitesSection.js";
import { PinSection } from "./components/PinSection.js";
import { DangerSection } from "./components/DangerSection.js";
import { ProfileEditor } from "../shared/ProfileEditor.js";
import { IconBolt } from "../shared/icons.js";
import { t } from "../shared/i18n.js";
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
      <main class="page">
        <Header />
        <div class="callout callout--danger" role="alert">
          {error}
        </div>
      </main>
    );
  }

  if (state === null) {
    return (
      <main class="page">
        <Header />
        <div class="section__body">
          <div class="skeleton" style="height: 18px; width: 40%;" />
          <div class="skeleton" style="height: 14px; width: 70%;" />
          <div class="skeleton" style="height: 60px;" />
        </div>
      </main>
    );
  }

  return (
    <main class="page">
      <Header />

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
        <div class="row">
          <span class="row__title">{t("options_autolock_label")}</span>
          <input
            class="input input--mono"
            type="number"
            min={0}
            max={1440}
            style="width: 100px;"
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
    </main>
  );
}

function Header() {
  return (
    <header class="page__header">
      <div class="page__title-row">
        <span class="page__brand-bolt">
          <IconBolt size={18} />
        </span>
        <h1 class="h-title">{t("extName")}</h1>
      </div>
      <p class="muted">{t("options_subtitle")}</p>
    </header>
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
    <section class="section">
      <div class="section__header">
        <div class="row__text">
          <h2 class="h-section">{title}</h2>
          {hint !== undefined ? <span class="row__hint">{hint}</span> : null}
        </div>
        {actions !== undefined ? <div class="actions">{actions}</div> : null}
      </div>
      <div class="section__body">{children}</div>
    </section>
  );
}
