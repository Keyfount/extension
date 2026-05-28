import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";

// The e2e Chromium renders the extension UI in French (host locale), so
// selectors use French labels — matching the other popup specs.
const HEADER_ACTION = "header button[aria-label]";
const MASTER = "a-very-long-master-pass";

async function setupWithHistory(page: Page): Promise<void> {
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill(MASTER);
  await pw.nth(1).fill(MASTER);
  await page.locator('button[type="submit"]').click();
  // History opt-in step: the primary (non-ghost) button enables it.
  await page.locator("button.btn:not(.btn-ghost)").click();
  await expect(page.locator(HEADER_ACTION).first()).toBeVisible({ timeout: 30_000 });
}

/** Seed an account through the background (same path the badge uses). */
async function recordAccount(page: Page, domain: string, username: string): Promise<void> {
  await page.evaluate(
    async ([d, u]) => {
      await chrome.runtime.sendMessage({ kind: "recordAccount", domain: d, username: u });
    },
    [domain, username] as const,
  );
}

async function listAccounts(page: Page): Promise<Array<{ domain: string; username: string }>> {
  return page.evaluate(async () => {
    const res = (await chrome.runtime.sendMessage({ kind: "listAccounts" })) as {
      entries: { domain: string; username: string }[];
    };
    return res.entries;
  });
}

test.describe("popup account detail", () => {
  test("opens a saved account and renames it from the popup UI", async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await setupWithHistory(page);
    await recordAccount(page, "example.com", "alice@example.com");

    // Reopen so the popup loads the freshly-saved account into its list.
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    const row = page.locator(".account-row").first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.click();

    // Detail screen: edit the username and save.
    const username = page.locator("input.input.flex-1").first();
    await expect(username).toHaveValue("alice@example.com");
    await username.fill("alice-2@example.com");
    await page.locator("button", { hasText: "Enregistrer" }).click();

    await expect
      .poll(async () =>
        (await listAccounts(page)).some((a) => a.username === "alice-2@example.com"),
      )
      .toBe(true);
  });

  test("deletes a saved account from the popup UI", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await setupWithHistory(page);
    await recordAccount(page, "github.com", "octocat");

    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.locator(".account-row").first().click();

    // Delete via the confirmation dialog.
    await page.locator("button", { hasText: "Supprimer ce compte" }).click();
    await page.locator("button", { hasText: "Supprimer" }).last().click();

    await expect.poll(async () => (await listAccounts(page)).length).toBe(0);
  });
});
