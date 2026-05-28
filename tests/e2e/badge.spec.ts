import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

/**
 * Deep content-script badge behaviour.
 *
 * Requires the e2e build (open shadow root) so Playwright can drive the panel:
 *   npm run build:e2e            # KEYFOUNT_E2E=1 → SHADOW_MODE = "open"
 * The production build keeps the shadow closed; these specs assert open mode
 * and skip otherwise rather than fail spuriously.
 *
 * The e2e UI renders in French (host locale), so panel selectors use French.
 */
const MASTER = "a-very-long-master-pass";

async function completeFirstRun(context: BrowserContext, extensionId: string): Promise<void> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const inputs = popup.locator('input[type="password"]');
  await inputs.nth(0).fill(MASTER);
  await inputs.nth(1).fill(MASTER);
  await popup.locator('button[type="submit"]').click();
  await popup.locator("button.btn-ghost").click(); // skip history opt-in
  await expect(popup.locator("header button[aria-label]").first()).toBeVisible({ timeout: 30_000 });
  await popup.close();
}

/** Skip the test unless this is an open-shadow (e2e) build. */
async function requireOpenShadow(tab: Page): Promise<void> {
  await expect(tab.locator("keyfount-badge").first()).toBeAttached({ timeout: 15_000 });
  const open = await tab
    .locator("keyfount-badge")
    .first()
    .evaluate((el) => el.shadowRoot !== null);
  test.skip(!open, "badge shadow is closed — run `npm run build:e2e` for badge specs");
}

const openBadges = (tab: Page) => tab.locator('keyfount-badge[data-open="true"]');

test.describe("content-script badge — attach & open/close", () => {
  test("attaches to the password and username fields", async ({
    context,
    extensionId,
    fixtureServer,
  }) => {
    await completeFirstRun(context, extensionId);
    const tab = await context.newPage();
    await tab.goto(fixtureServer.url);
    // One badge on the password field, one on its detected username field.
    await expect(tab.locator("keyfount-badge")).toHaveCount(2, { timeout: 15_000 });
  });

  test("opens when the password field is focused", async ({
    context,
    extensionId,
    fixtureServer,
  }) => {
    await completeFirstRun(context, extensionId);
    const tab = await context.newPage();
    await tab.goto(fixtureServer.url);
    await requireOpenShadow(tab);

    await expect(openBadges(tab)).toHaveCount(0);
    await tab.locator('input[type="password"]').focus();
    await expect(openBadges(tab)).toHaveCount(1);
  });

  test("tabbing from username to password keeps exactly one badge open (no stale badge)", async ({
    context,
    extensionId,
    fixtureServer,
  }) => {
    await completeFirstRun(context, extensionId);
    const tab = await context.newPage();
    await tab.goto(fixtureServer.url);
    await requireOpenShadow(tab);

    // Focus the username/email field → its badge opens.
    await tab.locator('input[type="email"]').focus();
    await expect(openBadges(tab)).toHaveCount(1);

    // Tab to the password field → the old badge must close as the new one
    // opens, so never two at once (the bug the user reported).
    await tab.locator('input[type="email"]').press("Tab");
    await expect
      .poll(
        async () =>
          (await tab.evaluate(() => (document.activeElement as HTMLInputElement)?.type)) ?? "",
      )
      .toBe("password");
    await expect(openBadges(tab)).toHaveCount(1);
  });
});

// The badge only reaches its "ready" (generate) state on a real registrable
// domain — 127.0.0.1 has none, so the panel shows "no-domain" there. We serve
// a login page on a routed https domain to exercise detection + fill.
const LOGIN_HTML = `<!doctype html><html><body>
  <form>
    <label>Email <input type="email" name="email" autocomplete="email" /></label>
    <label>Password <input type="password" name="password" autocomplete="current-password" /></label>
    <button type="submit">Sign in</button>
  </form>
</body></html>`;

const EMAIL_PAGE_HTML = `<!doctype html><html><body>
  <form><input type="email" name="email" autocomplete="email" placeholder="email" /></form>
</body></html>`;

const PASSWORD_PAGE_HTML = `<!doctype html><html><body>
  <form><input type="password" name="password" autocomplete="current-password" /></form>
</body></html>`;

test.describe("content-script badge — detection, fill, multi-page", () => {
  test("detects the typed email and fills the password field", async ({ context, extensionId }) => {
    await completeFirstRun(context, extensionId);

    await context.route("https://login.example.org/**", (route) =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: LOGIN_HTML }),
    );
    const tab = await context.newPage();
    await tab.goto("https://login.example.org/");
    await requireOpenShadow(tab);

    // Type an email; the badge should detect it via the form.
    await tab.locator('input[type="email"]').fill("alice@example.com");
    await tab.locator('input[type="password"]').focus();

    // Reaching the Fill button means the badge found the email + generated
    // (an undetected email would show the "enter your email" prompt instead).
    const fill = tab.getByRole("button", { name: "Remplir" });
    await expect(fill).toBeVisible({ timeout: 15_000 });
    await fill.click();

    // The password field is now populated with the derived password.
    await expect
      .poll(async () => (await tab.locator('input[type="password"]').inputValue()).length)
      .toBeGreaterThan(0);
  });

  test("carries the email across a two-page login (stash on page 1, used on page 2)", async ({
    context,
    extensionId,
  }) => {
    await completeFirstRun(context, extensionId);

    await context.route("https://acme.example.org/**", (route) => {
      const url = route.request().url();
      const body = url.includes("/step2") ? PASSWORD_PAGE_HTML : EMAIL_PAGE_HTML;
      return route.fulfill({ contentType: "text/html; charset=utf-8", body });
    });

    // Page 1: type the email and blur — the content script stashes it for the
    // domain so the next page can pick it up.
    const tab = await context.newPage();
    await tab.goto("https://acme.example.org/");
    await tab.locator('input[type="email"]').fill("bob@example.com");
    await tab.locator('input[type="email"]').blur();
    await tab.waitForTimeout(300); // let the debounced stash message land

    // Page 2: only a password field. The badge has no username field here, so
    // it must fall back to the stashed email and still reach the ready state.
    await tab.goto("https://acme.example.org/step2");
    await requireOpenShadow(tab);
    await tab.locator('input[type="password"]').focus();
    await expect(tab.getByRole("button", { name: "Remplir" })).toBeVisible({ timeout: 15_000 });
  });
});
