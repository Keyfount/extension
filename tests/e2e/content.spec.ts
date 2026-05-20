import { expect, test } from "./fixtures.js";

test("badge is injected next to password fields on a real http origin", async ({
  context,
  extensionId,
  fixtureServer,
}) => {
  // Set up the extension first so the badge has a fingerprint to work with.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const inputs = popup.locator('input[type="password"]');
  await inputs.nth(0).fill("a-very-long-master-pass");
  await inputs.nth(1).fill("a-very-long-master-pass");
  await popup.locator('button[type="submit"]').click();
  await expect(popup.locator(".popup__header-actions button").first()).toBeVisible({
    timeout: 30_000,
  });
  await popup.close();

  const tab = await context.newPage();
  await tab.goto(fixtureServer.url);

  await expect(tab.locator("itsmypassword-badge")).toBeAttached({ timeout: 15_000 });
});
