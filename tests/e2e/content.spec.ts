import type { BrowserContext } from "@playwright/test";
import { expect, test } from "./fixtures.js";

async function completeFirstRun(context: BrowserContext, extensionId: string): Promise<void> {
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
}

test("badge is injected next to password fields on a real http origin", async ({
  context,
  extensionId,
  fixtureServer,
}) => {
  await completeFirstRun(context, extensionId);

  const tab = await context.newPage();
  await tab.goto(fixtureServer.url);

  // Two badges are attached per login form (one on the password field,
  // one on its associated username/email field).
  await expect(tab.locator("keyfount-badge").first()).toBeAttached({ timeout: 15_000 });
  await expect(tab.locator("keyfount-badge")).toHaveCount(2, { timeout: 15_000 });
});

test("no badge is attached inside a cross-origin iframe (ext#51)", async ({
  context,
  extensionId,
  framedFixtureServer,
}) => {
  await completeFirstRun(context, extensionId);

  const tab = await context.newPage();
  await tab.goto(framedFixtureServer.parentUrl);

  // The top frame still gets the usual pair of badges on its own login form.
  await expect(tab.locator("keyfount-badge").first()).toBeAttached({ timeout: 15_000 });
  await expect(tab.locator("keyfount-badge")).toHaveCount(2, { timeout: 15_000 });

  // The cross-origin iframe must not receive a badge — otherwise an attacker
  // page could exfiltrate the derived password via postMessage.
  const childFrame = tab.frame({ url: (u) => u.toString().startsWith(framedFixtureServer.childUrl) });
  if (childFrame === null) throw new Error("iframe did not load");
  await childFrame.locator('input[type="password"]').waitFor({ state: "attached" });
  // Give the content script a moment to be (incorrectly) injected if the
  // guard ever regressed.
  await tab.waitForTimeout(1000);
  await expect(childFrame.locator("keyfount-badge")).toHaveCount(0);
});
