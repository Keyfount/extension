import type { MemorableProfile, Profile, RandomProfile } from "../../shared/types.js";
import { DEFAULT_MEMORABLE_PROFILE, DEFAULT_RANDOM_PROFILE } from "../../shared/types.js";

interface Props {
  profile: Profile;
  onChange: (next: Profile) => void;
}

export function ProfileEditor({ profile, onChange }: Props) {
  return (
    <>
      <div class="field-row">
        <label class="radio">
          <input
            type="radio"
            name="mode"
            checked={profile.mode === "random"}
            onChange={() =>
              onChange(
                profile.mode === "random" ? profile : { ...DEFAULT_RANDOM_PROFILE, counter: 1 },
              )
            }
          />
          Random characters
        </label>
        <label class="radio">
          <input
            type="radio"
            name="mode"
            checked={profile.mode === "memorable"}
            onChange={() =>
              onChange(
                profile.mode === "memorable"
                  ? profile
                  : { ...DEFAULT_MEMORABLE_PROFILE, counter: 1 },
              )
            }
          />
          Memorable passphrase
        </label>
      </div>

      {profile.mode === "random" ? (
        <RandomEditor profile={profile} onChange={onChange} />
      ) : (
        <MemorableEditor profile={profile} onChange={onChange} />
      )}
    </>
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
      <label class="field">
        <span>Length: {profile.length}</span>
        <input
          type="range"
          min={5}
          max={35}
          value={profile.length}
          onInput={(e) =>
            onChange({
              ...profile,
              length: Number.parseInt((e.target as HTMLInputElement).value, 10),
            })
          }
        />
      </label>
      <div class="field-row">
        {(["lower", "upper", "digits", "symbols"] as const).map((key) => (
          <label class="check" key={key}>
            <input
              type="checkbox"
              checked={profile[key]}
              onChange={(e) =>
                onChange({ ...profile, [key]: (e.target as HTMLInputElement).checked })
              }
            />
            {key}
          </label>
        ))}
      </div>
      <CounterField
        counter={profile.counter}
        onChange={(c) => onChange({ ...profile, counter: c })}
      />
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
      <label class="field">
        <span>Words: {profile.wordCount}</span>
        <input
          type="range"
          min={5}
          max={8}
          value={profile.wordCount}
          onInput={(e) =>
            onChange({
              ...profile,
              wordCount: Number.parseInt((e.target as HTMLInputElement).value, 10),
            })
          }
        />
      </label>
      <label class="field">
        <span>Separator</span>
        <select
          value={profile.separator}
          onChange={(e) =>
            onChange({
              ...profile,
              separator: (e.target as HTMLSelectElement).value as MemorableProfile["separator"],
            })
          }
        >
          <option value=".">.</option>
          <option value="-">-</option>
          <option value="_">_</option>
        </select>
      </label>
      <div class="field-row">
        <label class="check">
          <input
            type="checkbox"
            checked={profile.capitalise}
            onChange={(e) =>
              onChange({ ...profile, capitalise: (e.target as HTMLInputElement).checked })
            }
          />
          Capitalise one word
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={profile.suffix}
            onChange={(e) =>
              onChange({ ...profile, suffix: (e.target as HTMLInputElement).checked })
            }
          />
          Append digit + symbol
        </label>
      </div>
      <CounterField
        counter={profile.counter}
        onChange={(c) => onChange({ ...profile, counter: c })}
      />
    </>
  );
}

function CounterField({ counter, onChange }: { counter: number; onChange: (n: number) => void }) {
  return (
    <label class="field">
      <span>Counter</span>
      <input
        type="number"
        min={1}
        value={counter}
        onChange={(e) => {
          const n = Number.parseInt((e.target as HTMLInputElement).value, 10);
          if (Number.isFinite(n) && n >= 1) onChange(n);
        }}
      />
      <small class="muted">
        Bump the counter to rotate a compromised password without changing your master.
      </small>
    </label>
  );
}
