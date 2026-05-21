import { expect, test } from "./fixtures.js";

test("badge is injected next to password fields on a real http origin", async ({
  context,
  extensionId,
  fixtureServer,
}) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const inputs = popup.locator('input[type="password"]');
  await inputs.nth(0).fill("a-very-long-master-pass");
  await inputs.nth(1).fill("a-very-long-master-pass");
  await popup.locator('button[type="submit"]').click();
  await popup.locator("button.btn-ghost").click();
  await expect(popup.locator("header button[aria-label]").first()).toBeVisible({
    timeout: 30_000,
  });
  await popup.close();

  const tab = await context.newPage();
  await tab.goto(fixtureServer.url);

  // Two badges are attached per login form (one on the password field,
  // one on its associated username/email field).
  await expect(tab.locator("itsmypassword-badge").first()).toBeAttached({ timeout: 15_000 });
  await expect(tab.locator("itsmypassword-badge")).toHaveCount(2, { timeout: 15_000 });
});
