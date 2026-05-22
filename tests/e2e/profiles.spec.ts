import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

const HEADER_ACTION = "header button[aria-label]";
const PROFILE_CHIP = "header .fingerprint";

async function completeSetup(page: Page, master: string): Promise<void> {
  const passwordInputs = page.locator('input[type="password"]');
  await passwordInputs.nth(0).fill(master);
  await passwordInputs.nth(1).fill(master);
  await page.locator('button[type="submit"]').click();
  // Setup wizard step 2: account-history opt-in. Skip it.
  await page.locator("button.btn-ghost").click();
  await expect(page.locator(HEADER_ACTION).first()).toBeVisible({ timeout: 30_000 });
}

test.describe("multi-profile (vaults)", () => {
  test("a fresh install creates the first vault implicitly", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await completeSetup(page, "first-vault-master-pass");

    // Open the vaults screen by tapping the fingerprint chip in the header.
    await page.locator(PROFILE_CHIP).first().click();

    // Exactly one profile, marked as active.
    const rows = page.locator(".account-row");
    await expect(rows).toHaveCount(1, { timeout: 10_000 });
    await expect(rows.first()).toHaveClass(/account-row--active/);
  });

  test("Ajouter un profil routes to setup and creates an isolated second vault", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await completeSetup(page, "first-vault-master-pass");
    const firstFingerprint = await page.locator(PROFILE_CHIP).first().textContent();

    // Open the vaults screen.
    await page.locator(PROFILE_CHIP).first().click();
    // Tap "Ajouter un profil".
    await page.locator("button.btn", { hasText: "Ajouter un profil" }).click();

    // The setup screen now expects a *different* master for the new vault.
    await completeSetup(page, "second-vault-master-pass-different");
    const secondFingerprint = await page.locator(PROFILE_CHIP).first().textContent();
    expect(secondFingerprint).not.toBe(firstFingerprint);

    // The vaults list should now show both profiles, with the new one active.
    await page.locator(PROFILE_CHIP).first().click();
    const rows = page.locator(".account-row");
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
  });

  test("Switching profile locks the session and asks for the destination's master", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await completeSetup(page, "first-vault-master-pass");
    const firstFingerprint = (await page.locator(PROFILE_CHIP).first().textContent()) ?? "";

    // Create a second vault.
    await page.locator(PROFILE_CHIP).first().click();
    await page.locator("button.btn", { hasText: "Ajouter un profil" }).click();
    await completeSetup(page, "second-vault-master-pass-different");

    // Switch back to the first vault via the vaults screen.
    await page.locator(PROFILE_CHIP).first().click();
    const rows = page.locator(".account-row");
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
    // Click the fingerprint chip inside the inactive row — clicking the row
    // itself is fragile because the trash icon button intercepts the hit.
    await rows.filter({ hasText: firstFingerprint }).locator(".fingerprint").click();

    // We expect an unlock screen: a single password input plus the first
    // vault's fingerprint shown as the "expected" chip.
    await expect(page.locator('input[type="password"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".fingerprint").first()).toHaveText(firstFingerprint, {
      timeout: 15_000,
    });

    // Unlocking with the first vault's master should now bring us back to main.
    await page.locator('input[type="password"]').first().fill("first-vault-master-pass");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator(HEADER_ACTION).first()).toBeVisible({ timeout: 30_000 });
  });
});
