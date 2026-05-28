/**
 * Test fixture: launches a persistent Chromium with the built extension
 * loaded, and exposes the extension ID + a worker page that proxies
 * messages to the background service worker. Also starts a tiny HTTP
 * server so we can host login-form fixtures on a real http:// origin
 * (content scripts are not injected on data: or about: URLs).
 */
import { test as base, chromium, type BrowserContext, type Worker } from "@playwright/test";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import http from "node:http";

const EXTENSION_PATH = path.resolve(process.cwd(), ".output", "chrome-mv3");

export interface ExtensionFixture {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  fixtureServer: { url: string };
  /**
   * A parent page hosted on one origin that embeds a cross-origin iframe
   * (different port = different origin per the same-origin policy) carrying a
   * password input. Used to assert the content script never attaches inside
   * subframes (ext#51).
   */
  framedFixtureServer: { parentUrl: string; childUrl: string };
}

export const test = base.extend<ExtensionFixture>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "imp-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      channel: "chromium",
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--no-first-run",
        // Force English UI so tests can rely on English message strings.
        "--lang=en-US",
      ],
      locale: "en-US",
    });
    await use(context);
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  },

  serviceWorker: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    if (worker === undefined) {
      worker = await context.waitForEvent("serviceworker");
    }
    await use(worker);
  },

  extensionId: async ({ serviceWorker }, use) => {
    const url = serviceWorker.url();
    const match = /chrome-extension:\/\/([a-z]+)\//.exec(url);
    if (match === null) throw new Error(`could not derive extension id from ${url}`);
    await use(match[1]!);
  },

  // eslint-disable-next-line no-empty-pattern
  fixtureServer: async ({}, use) => {
    const server = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html>
<html><body>
  <form>
    <label>Email <input type="email" name="email" autocomplete="email" /></label>
    <label>Password <input type="password" name="password" autocomplete="current-password" /></label>
    <button type="submit">Sign in</button>
  </form>
</body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("server failed to bind");
    const url = `http://127.0.0.1:${address.port}/`;
    await use({ url });
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  },

  // eslint-disable-next-line no-empty-pattern
  framedFixtureServer: async ({}, use) => {
    // Child server: a single password input on its own origin.
    const child = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html>
<html><body>
  <form>
    <input type="password" name="trap" autocomplete="current-password" />
  </form>
</body></html>`);
    });
    await new Promise<void>((resolve) => child.listen(0, "127.0.0.1", resolve));
    const childAddr = child.address();
    if (childAddr === null || typeof childAddr === "string") {
      throw new Error("child server failed to bind");
    }
    const childUrl = `http://127.0.0.1:${childAddr.port}/`;

    // Parent server on a different port (= different origin) that embeds the
    // child page in a cross-origin iframe plus its own login form.
    const parent = http.createServer((_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html>
<html><body>
  <form>
    <label>Email <input type="email" name="email" autocomplete="email" /></label>
    <label>Password <input type="password" name="password" autocomplete="current-password" /></label>
  </form>
  <iframe src="${childUrl}" width="320" height="240" title="trap"></iframe>
</body></html>`);
    });
    await new Promise<void>((resolve) => parent.listen(0, "127.0.0.1", resolve));
    const parentAddr = parent.address();
    if (parentAddr === null || typeof parentAddr === "string") {
      throw new Error("parent server failed to bind");
    }
    const parentUrl = `http://127.0.0.1:${parentAddr.port}/`;

    await use({ parentUrl, childUrl });

    parent.closeAllConnections();
    child.closeAllConnections();
    await new Promise<void>((resolve) => parent.close(() => resolve()));
    await new Promise<void>((resolve) => child.close(() => resolve()));
  },
});

export const expect = test.expect;
