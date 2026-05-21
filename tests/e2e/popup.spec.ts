import { expect, test } from "./fixtures.js";

/** Locale-agnostic selector for the header's lock/settings icon buttons. */
const HEADER_ACTION = "header button[aria-label]";

test.describe("popup setup, lock and unlock", () => {
  test("first-run setup transitions to the main screen", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill("a-very-long-master-pass");
    await passwordInputs.nth(1).fill("a-very-long-master-pass");
    await page.locator('button[type="submit"]').click();

    // Setup wizard step 2: account-history opt-in. Skip it.
    await page.locator("button.btn-ghost").click();

    await expect(page.locator(HEADER_ACTION).first()).toBeVisible({ timeout: 30_000 });
  });

  test("lock then unlock preserves the fingerprint", async ({ context, extensionId }) => {
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/popup.html`);
    const setupInputs = setup.locator('input[type="password"]');
    await setupInputs.nth(0).fill("a-very-long-master-pass");
    await setupInputs.nth(1).fill("a-very-long-master-pass");
    await setup.locator('button[type="submit"]').click();
    await setup.locator("button.btn-ghost").click();
    await expect(setup.locator(HEADER_ACTION).first()).toBeVisible({ timeout: 30_000 });

    const fingerprint = await setup.locator(".fingerprint").first().textContent();
    expect(fingerprint?.length).toBeGreaterThan(0);

    // Lock = the last header action button.
    await setup.locator(HEADER_ACTION).last().click();
    await setup.close();

    const unlock = await context.newPage();
    await unlock.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(unlock.locator(".fingerprint").first()).toHaveText(fingerprint ?? "", {
      timeout: 10_000,
    });

    await unlock.locator('input[type="password"]').first().fill("a-very-long-master-pass");
    await unlock.locator('button[type="submit"]').click();
    await expect(unlock.locator(HEADER_ACTION).first()).toBeVisible({ timeout: 30_000 });
  });
});
