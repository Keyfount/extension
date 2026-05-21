import { expect, test } from "./fixtures.js";

test("opt-in history records and surfaces an entry after the round-trip", async ({
  context,
  extensionId,
}) => {
  // First-run setup, enable history at the wizard's opt-in step.
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/popup.html`);
  const masterInputs = setup.locator('input[type="password"]');
  await masterInputs.nth(0).fill("a-very-long-master-pass");
  await masterInputs.nth(1).fill("a-very-long-master-pass");
  await setup.locator('button[type="submit"]').click();
  // History opt-in step: the primary `.btn` (not the ghost) is "Enable".
  await setup.locator("button.btn:not(.btn-ghost)").click();
  await expect(setup.locator("header button[aria-label]").first()).toBeVisible({
    timeout: 30_000,
  });
  await setup.close();

  // The popup is a privileged page so it can speak to the background via
  // chrome.runtime — we use it to exercise the encrypted round-trip end to
  // end, the same way the badge and the popup UI do at runtime.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate(async () => {
    await chrome.runtime.sendMessage({
      kind: "recordAccount",
      domain: "127.0.0.1",
      username: "alice@example.com",
    });
  });
  const entries = await popup.evaluate(async () => {
    const response = (await chrome.runtime.sendMessage({
      kind: "listAccounts",
    })) as { ok: true; entries: { domain: string; username: string }[] };
    return response.entries;
  });
  expect(entries.length).toBeGreaterThan(0);
  expect(entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ domain: "127.0.0.1", username: "alice@example.com" }),
    ]),
  );
});
