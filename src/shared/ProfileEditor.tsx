/**
 * Reusable profile editor — used by both the options page and the inline
 * badge. Plain Preact + the shared theme tokens.
 */
import type { MemorableProfile, Profile, RandomProfile } from "./types.js";
import { DEFAULT_MEMORABLE_PROFILE, DEFAULT_RANDOM_PROFILE } from "./types.js";
import { t } from "./i18n.js";

interface Props {
  profile: Profile;
  onChange: (next: Profile) => void;
  /** When true, hides the counter row to save vertical space. */
  compact?: boolean;
}

const CLASS_KEYS = ["lower", "upper", "digits", "symbols"] as const;

export function ProfileEditor({ profile, onChange, compact = false }: Props) {
  return (
    <div class="profile-editor">
      <div class="segmented" role="tablist">
        <button
          type="button"
          class="segmented__button"
          role="tab"
          aria-pressed={profile.mode === "random"}
          onClick={() =>
            onChange(
              profile.mode === "random"
                ? profile
                : { ...DEFAULT_RANDOM_PROFILE, counter: profile.counter },
            )
          }
        >
          {t("profile_mode_random")}
        </button>
        <button
          type="button"
          class="segmented__button"
          role="tab"
          aria-pressed={profile.mode === "memorable"}
          onClick={() =>
            onChange(
              profile.mode === "memorable"
                ? profile
                : { ...DEFAULT_MEMORABLE_PROFILE, counter: profile.counter },
            )
          }
        >
          {t("profile_mode_memorable")}
        </button>
      </div>

      {profile.mode === "random" ? (
        <RandomEditor profile={profile} onChange={onChange} />
      ) : (
        <MemorableEditor profile={profile} onChange={onChange} />
      )}

      {!compact ? (
        <CounterField
          counter={profile.counter}
          onChange={(c) => onChange({ ...profile, counter: c })}
        />
      ) : null}
    </div>
  );
}

function RandomEditor({
  profile,
  onChange,
}: {
  profile: RandomProfile;
  onChange: (next: RandomProfile) => void;
}) {
  return (
    <>
      <div class="range-row">
        <div class="range-row__head">
          <span class="field__label">{t("profile_length_label")}</span>
          <span class="range-row__value">{profile.length}</span>
        </div>
        <input
          type="range"
          min={5}
          max={35}
          value={profile.length}
          aria-label={t("profile_length_label")}
          onInput={(e) =>
            onChange({
              ...profile,
              length: Number.parseInt((e.target as HTMLInputElement).value, 10),
            })
          }
        />
      </div>
      <div class="field">
        <span class="field__label">{t("profile_classes_label")}</span>
        <div class="classes-grid">
          {CLASS_KEYS.map((key) => (
            <Toggle
              key={key}
              label={t(`profile_class_${key}`)}
              checked={profile[key]}
              onChange={(checked) => onChange({ ...profile, [key]: checked })}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function MemorableEditor({
  profile,
  onChange,
}: {
  profile: MemorableProfile;
  onChange: (next: MemorableProfile) => void;
}) {
  return (
    <>
      <div class="range-row">
        <div class="range-row__head">
          <span class="field__label">{t("profile_words_label")}</span>
          <span class="range-row__value">{profile.wordCount}</span>
        </div>
        <input
          type="range"
          min={5}
          max={8}
          value={profile.wordCount}
          aria-label={t("profile_words_label")}
          onInput={(e) =>
            onChange({
              ...profile,
              wordCount: Number.parseInt((e.target as HTMLInputElement).value, 10),
            })
          }
        />
      </div>
      <div class="field">
        <span class="field__label">{t("profile_separator_label")}</span>
        <div class="segmented" style="grid-template-columns: repeat(3, 1fr);">
          {(["-", ".", "_"] as const).map((sep) => (
            <button
              key={sep}
              type="button"
              class="segmented__button mono"
              aria-pressed={profile.separator === sep}
              onClick={() => onChange({ ...profile, separator: sep })}
            >
              {sep}
            </button>
          ))}
        </div>
      </div>
      <Toggle
        label={t("profile_capitalise_label")}
        checked={profile.capitalise}
        onChange={(checked) => onChange({ ...profile, capitalise: checked })}
      />
      <Toggle
        label={t("profile_suffix_label")}
        checked={profile.suffix}
        onChange={(checked) => onChange({ ...profile, suffix: checked })}
      />
    </>
  );
}

function CounterField({ counter, onChange }: { counter: number; onChange: (n: number) => void }) {
  return (
    <label class="field">
      <span class="field__label">{t("profile_counter_label")}</span>
      <input
        class="input input--mono"
        type="number"
        min={1}
        value={counter}
        onChange={(e) => {
          const n = Number.parseInt((e.target as HTMLInputElement).value, 10);
          if (Number.isFinite(n) && n >= 1) onChange(n);
        }}
      />
      <span class="field__hint">{t("profile_counter_hint")}</span>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label class="row" style="padding: 0; cursor: pointer;">
      <span class="row__title">{label}</span>
      <span class="switch">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
        <span class="switch__track" />
        <span class="switch__thumb" />
      </span>
    </label>
  );
}
