import { useState } from "preact/hooks";
import type { Profile } from "../../shared/types.js";
import { send } from "../api.js";
import { ProfileEditor } from "./ProfileEditor.js";

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
    <section class="card">
      <header class="card__header">
        <h2>Per-site overrides</h2>
        <div class="actions">
          <label class="button--ghost" role="button">
            <input
              type="file"
              accept="application/json"
              hidden
              onChange={(e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) void importJson(file);
              }}
            />
            Import
          </label>
          <button
            class="button--ghost"
            type="button"
            disabled={domains.length === 0}
            onClick={exportJson}
          >
            Export
          </button>
        </div>
      </header>

      {domains.length === 0 ? (
        <p class="muted">
          No overrides yet. Any site you customise from the popup will appear here.
        </p>
      ) : (
        <ul class="sites">
          {domains.map((domain) => (
            <li class="site" key={domain}>
              <div class="site__row">
                <strong>{domain}</strong>
                <div class="actions">
                  <button
                    class="button--ghost"
                    type="button"
                    onClick={() => setExpanded((c) => (c === domain ? null : domain))}
                  >
                    {expanded === domain ? "Hide" : "Edit"}
                  </button>
                  <button
                    class="button--ghost"
                    type="button"
                    onClick={async () => {
                      await send({ kind: "deleteProfile", domain });
                      await onChange();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {expanded === domain && sites[domain] !== undefined ? (
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
          ))}
        </ul>
      )}
    </section>
  );
}
