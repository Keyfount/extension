import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

// The e2e Chromium renders the extension UI in French (the host locale,
// matching the existing profiles.spec.ts), so selectors use French labels.
const HEADER_ACTION = "header button[aria-label]";
const MASTER = "a-very-long-master-pass";
const PIN = "135790";

async function completeSetup(page: Page): Promise<void> {
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill(MASTER);
  await pw.nth(1).fill(MASTER);
  await page.locator('button[type="submit"]').click();
  // History opt-in step → skip (the ghost button).
  await page.locator("button.btn-ghost").click();
  await expect(page.locator(HEADER_ACTION).first()).toBeVisible({ timeout: 30_000 });
}

/** Open Settings → Security sub-page (where the PIN section lives). */
async function openSecurity(page: Page): Promise<void> {
  await page.locator('header button[aria-label="Paramètres"]').click();
  await page.locator("button", { hasText: "Sécurité" }).click();
}

/** Enable a PIN from the Security sub-page, then return to the main screen. */
async function enablePin(page: Page): Promise<void> {
  await openSecurity(page);
  // "Activer le PIN…" (toggle) → reveals the form whose confirm button is
  // "Activer le PIN"; both share the prefix but never coexist. The PIN field
  // is the password-typed mono input (the auto-lock field is type=number).
  await page.locator("button", { hasText: "Activer le PIN" }).click();
  await page.locator('input[type="password"].input-mono').fill(PIN);
  await page.locator("button", { hasText: "Activer le PIN" }).click();
  await expect(page.getByText("Le PIN est actif")).toBeVisible({ timeout: 10_000 });
  // Back out: sub-page → settings menu → main screen.
  await page.locator('header button[aria-label="Retour"]').click();
  await page.locator('header button[aria-label="Retour"]').click();
  await expect(page.locator('header button[aria-label="Verrouiller"]')).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Lock the vault and reopen a fresh popup. Reopening mirrors real usage —
 * the toolbar popup is ephemeral — and the fresh `status()` read is what
 * surfaces the PIN tab on the unlock screen.
 */
async function lockAndReopen(
  page: Page,
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  await page.locator('header button[aria-label="Verrouiller"]').click();
  await page.close();
  const next = await context.newPage();
  await next.goto(`chrome-extension://${extensionId}/popup.html`);
  return next;
}

test.describe("PIN lifecycle through the popup UI", () => {
  test("set a PIN, lock, unlock with the PIN, then remove it", async ({ context, extensionId }) => {
    let page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await completeSetup(page);
    await enablePin(page);

    page = await lockAndReopen(page, context, extensionId);

    // The reopened popup defaults to the PIN tab; unlock with the PIN.
    const pinTab = page.locator('[role="tab"]', { hasText: "Code PIN" });
    await expect(pinTab).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    await page.locator('input[type="password"].input-mono').fill(PIN);
    await page.locator('button[type="submit"]').click();

    // Back on the main screen.
    await expect(page.locator('header button[aria-label="Verrouiller"]')).toBeVisible({
      timeout: 30_000,
    });

    // Remove the PIN; the enable affordance returns.
    await openSecurity(page);
    await page.locator("button", { hasText: "Retirer le PIN" }).click();
    await expect(page.locator("button", { hasText: "Activer le PIN" })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("a wrong PIN is rejected, and the master tab still unlocks", async ({
    context,
    extensionId,
  }) => {
    let page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await completeSetup(page);
    await enablePin(page);

    page = await lockAndReopen(page, context, extensionId);

    // Wrong PIN → still locked.
    await expect(page.locator('[role="tab"]', { hasText: "Code PIN" })).toBeVisible({
      timeout: 15_000,
    });
    await page.locator('input[type="password"].input-mono').fill("000000");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator(".field-error")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('header button[aria-label="Verrouiller"]')).toHaveCount(0);

    // Switch to the master tab and unlock with the master instead. The
    // master field is the plain `.input` (the PIN field is `.input-mono`).
    await page.locator('[role="tab"]', { hasText: "Mot de passe maître" }).click();
    const masterField = page.locator("input.input:not(.input-mono)");
    await expect(masterField).toBeVisible({ timeout: 10_000 });
    await masterField.fill(MASTER);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator('header button[aria-label="Verrouiller"]')).toBeVisible({
      timeout: 30_000,
    });
  });
});
