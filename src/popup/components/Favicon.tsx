/**
 * Site icon with a graceful fallback chain.
 *
 * 1. Chrome's `_favicon/` service (cache local, no network)
 * 2. Google's s2 favicon CDN — opt-in, gated by `faviconFallbackEnabled`
 * 3. Two-letter initials inside a coloured box
 *
 * Each onError advances the step until we land on the initials. The chain
 * is stateless across renders for the same domain so changing the toggle
 * makes the next render reuse the right source.
 */
import { useEffect, useState } from "preact/hooks";
import { faviconUrl } from "../../shared/favicon.js";
import { t } from "../../shared/i18n.js";
import { faviconFallbackEnabled } from "../state.js";

interface Props {
  domain: string;
  size?: number;
  /** When set, overlays a small status dot at the bottom-right corner.
   *   - "synced"   green ✓ (a successful server push for this entry exists)
   *   - "pending"  amber dot (server connected but no push yet)
   *   - undefined  no overlay (no server, or feature disabled) */
  syncBadge?: "synced" | "pending";
}

export function Favicon({ domain, size = 32, syncBadge }: Props) {
  const allowGoogle = faviconFallbackEnabled.value;
  const sources: string[] = [];
  const chrome = faviconUrl(domain, size);
  if (chrome !== null) sources.push(chrome);
  if (allowGoogle) sources.push(`https://www.google.com/s2/favicons?sz=${size}&domain=${domain}`);

  const [step, setStep] = useState(0);
  useEffect(() => {
    setStep(0);
  }, [domain, allowGoogle]);

  const current = sources[step];
  const dimension = Math.round(size * 0.62);
  const inner =
    current !== undefined ? (
      <img
        src={current}
        alt=""
        width={dimension}
        height={dimension}
        referrerPolicy="no-referrer"
        onError={() => setStep((s) => s + 1)}
      />
    ) : (
      <span class="font-mono uppercase" style={{ fontSize: Math.round(size * 0.35) }}>
        {domain.replace(/^www\./, "").slice(0, 2)}
      </span>
    );
  return (
    <span
      class="account-row__favicon relative"
      aria-hidden="true"
      style={{ width: size, height: size }}
    >
      {inner}
      {syncBadge !== undefined ? <SyncBadge state={syncBadge} parentSize={size} /> : null}
    </span>
  );
}

function SyncBadge({ state, parentSize }: { state: "synced" | "pending"; parentSize: number }) {
  const dotSize = Math.max(8, Math.round(parentSize * 0.32));
  const label = state === "synced" ? t("favicon_synced") : t("favicon_sync_pending");
  const color =
    state === "synced"
      ? "background: var(--color-success, oklch(0.55 0.13 150));"
      : "background: var(--color-warn, oklch(0.62 0.13 75));";
  return (
    <span
      class="absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-(--color-surface)"
      role="img"
      aria-label={label}
      title={label}
      style={`${color} width: ${dotSize}px; height: ${dotSize}px;`}
    >
      {state === "synced" ? (
        <svg
          viewBox="0 0 12 12"
          width={dotSize}
          height={dotSize}
          aria-hidden="true"
          style="display:block;color:#fff;"
        >
          <path
            d="M3 6.2 L5 8.2 L9 4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      ) : null}
    </span>
  );
}
