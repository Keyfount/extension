import { expect, test } from "./fixtures.js";

test.describe("popup setup, lock and unlock", () => {
  test("first-run setup transitions to the main screen", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill("a-very-long-master-pass");
    await passwordInputs.nth(1).fill("a-very-long-master-pass");
    await page.locator('button[type="submit"]').click();

    // Main screen exposes the Lock icon button — selectable by its lock SVG path.
    await expect(page.locator(".popup__header-actions button").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("lock then unlock preserves the fingerprint", async ({ context, extensionId }) => {
    const setup = await context.newPage();
    await setup.goto(`chrome-extension://${extensionId}/popup.html`);
    const setupInputs = setup.locator('input[type="password"]');
    await setupInputs.nth(0).fill("a-very-long-master-pass");
    await setupInputs.nth(1).fill("a-very-long-master-pass");
    await setup.locator('button[type="submit"]').click();
    // Wait for unlocked state — text input becomes visible.
    await expect(setup.locator(".popup__header-actions button").first()).toBeVisible({ timeout: 30_000 });

    const fingerprint = await setup.locator(".fingerprint").first().textContent();
    expect(fingerprint?.length).toBeGreaterThan(0);

    // Click the lock button — second header action button.
    const headerButtons = setup.locator(".popup__header-actions button");
    await headerButtons.last().click();
    await setup.close();

    const unlock = await context.newPage();
    await unlock.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(unlock.locator(".fingerprint").first()).toHaveText(fingerprint ?? "", {
      timeout: 10_000,
    });

    await unlock.locator('input[type="password"]').first().fill("a-very-long-master-pass");
    await unlock.locator('button[type="submit"]').click();
    await expect(unlock.locator(".popup__header-actions button").first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
