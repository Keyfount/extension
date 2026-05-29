import type { BrowserContext } from "@playwright/test";
import { expect, test } from "./fixtures.js";

/**
 * End-to-end matching: subdomains + linked domains, exercised through the
 * real encrypted background round-trip via the privileged popup page (same
 * channel the popup/badge use at runtime). No open-shadow build required.
 */
const MASTER = "a-very-long-master-pass";

const PROFILE = {
  mode: "random",
  length: 16,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  counter: 1,
} as const;

async function setupWithHistory(context: BrowserContext, extensionId: string): Promise<void> {
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/popup.html`);
  const masterInputs = setup.locator('input[type="password"]');
  await masterInputs.nth(0).fill(MASTER);
  await masterInputs.nth(1).fill(MASTER);
  await setup.locator('button[type="submit"]').click();
  // History opt-in step: the primary `.btn` (not the ghost) is "Enable".
  await setup.locator("button.btn:not(.btn-ghost)").click();
  await expect(setup.locator("header button[aria-label]").first()).toBeVisible({
    timeout: 30_000,
  });
  await setup.close();
}

test("offers accounts across subdomains and linked domains", async ({ context, extensionId }) => {
  await setupWithHistory(context, extensionId);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  // A broad (registrable) account and a narrow (full-host) account.
  await popup.evaluate(async (profile) => {
    await chrome.runtime.sendMessage({
      kind: "recordAccount",
      domain: "example.org",
      username: "broad@x.com",
      profile,
    });
    await chrome.runtime.sendMessage({
      kind: "recordAccount",
      domain: "w.example.org",
      username: "narrow@x.com",
      profile,
    });
  }, PROFILE);

  const usernamesFor = (url: string) =>
    popup.evaluate(async (u) => {
      const res = (await chrome.runtime.sendMessage({ kind: "listAccounts", url: u })) as {
        entries: { domain: string; username: string }[];
      };
      return res.entries.map((e) => `${e.username}|${e.domain}`);
    }, url);

  // Broad account is offered on a subdomain; the narrow one is not.
  expect(await usernamesFor("https://app.example.org/login")).toEqual(["broad@x.com|example.org"]);

  // On the registrable root, the narrow full-host account is NOT offered.
  expect(await usernamesFor("https://example.org/")).toEqual(["broad@x.com|example.org"]);

  // On the narrow host itself, both match — exact-host ranked above registrable.
  expect(await usernamesFor("https://w.example.org/")).toEqual([
    "narrow@x.com|w.example.org",
    "broad@x.com|example.org",
  ]);

  // Link an UNRELATED site to the narrow account — the core "use account x on
  // site y" requirement. It becomes offered there, carrying its own salt.
  await popup.evaluate(async () => {
    await chrome.runtime.sendMessage({
      kind: "linkAccountDomain",
      domain: "w.example.org",
      username: "narrow@x.com",
      linked: "other-site.com",
    });
  });

  // On the unrelated linked site only the linked account matches (the broad
  // example.org account does not cross the registrable boundary).
  expect(await usernamesFor("https://app.other-site.com/")).toEqual(["narrow@x.com|w.example.org"]);

  // Salt correctness: the linked account derives from its OWN domain
  // (w.example.org), NOT the visited site — so the offered password is the
  // source account's password, and differs from deriving against the host.
  const { sourcePw, hostPw } = await popup.evaluate(async () => {
    const gen = async (domain: string, email: string) => {
      const r = (await chrome.runtime.sendMessage({ kind: "generate", domain, email })) as {
        password: string;
      };
      return r.password;
    };
    return {
      sourcePw: await gen("w.example.org", "narrow@x.com"),
      hostPw: await gen("other-site.com", "narrow@x.com"),
    };
  });
  expect(sourcePw).not.toBe(hostPw);
});
