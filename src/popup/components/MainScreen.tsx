import { useCallback, useEffect, useState } from "preact/hooks";
import { send } from "../api.js";
import {
  activeDomain,
  activeEmail,
  busy,
  canGenerate,
  errorMessage,
  fingerprint,
  generated,
  screen,
} from "../state.js";

export function MainScreen() {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    generated.value = null;
    setRevealed(false);
    setCopied(false);
  }, [activeDomain.value, activeEmail.value]);

  const generate = useCallback(async () => {
    if (activeDomain.value === null) return;
    errorMessage.value = null;
    busy.value = true;
    try {
      const response = await send({
        kind: "generate",
        domain: activeDomain.value,
        email: activeEmail.value.trim(),
      });
      generated.value = response.password;
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : "generation failed";
    } finally {
      busy.value = false;
    }
  }, []);

  const copy = useCallback(async () => {
    if (generated.value === null) return;
    await navigator.clipboard.writeText(generated.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const onLock = useCallback(async () => {
    await send({ kind: "lock" });
    generated.value = null;
    screen.value = "unlock";
  }, []);

  return (
    <div class="screen">
      <header class="header">
        <div class="header__title">
          <strong>{activeDomain.value ?? "—"}</strong>
          {fingerprint.value !== null ? (
            <span class="fingerprint__value small">{fingerprint.value}</span>
          ) : null}
        </div>
        <div class="actions">
          <button
            type="button"
            class="button--ghost"
            onClick={() => chrome.runtime.openOptionsPage()}
            title="Settings"
          >
            ⚙
          </button>
          <button type="button" class="button--ghost" onClick={onLock}>
            Lock
          </button>
        </div>
      </header>

      {activeDomain.value === null ? (
        <p class="muted">
          This tab is not a regular web page. Open a site (https://…) to generate a password for it.
        </p>
      ) : (
        <>
          <label class="field">
            <span>Email or username</span>
            <input
              type="text"
              value={activeEmail.value}
              autocomplete="off"
              placeholder="you@example.com"
              onInput={(e) => {
                activeEmail.value = (e.target as HTMLInputElement).value;
              }}
            />
          </label>

          <button type="button" onClick={generate} disabled={busy.value || !canGenerate.value}>
            {busy.value ? "Generating…" : "Generate"}
          </button>

          {generated.value !== null ? (
            <div class="generated">
              <code class={revealed ? "generated__value" : "generated__value masked"}>
                {revealed ? generated.value : "•".repeat(Math.min(generated.value.length, 24))}
              </code>
              <div class="generated__actions">
                <button type="button" class="button--ghost" onClick={() => setRevealed((v) => !v)}>
                  {revealed ? "Hide" : "Reveal"}
                </button>
                <button type="button" class="button--ghost" onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ) : null}

          {errorMessage.value !== null ? <div class="error">{errorMessage.value}</div> : null}
        </>
      )}
    </div>
  );
}
