import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      // Coverage is enforced on testable logic only:
      //  - wordlist.ts is a generated table, not code
      //  - entrypoints/ are thin chrome.* wiring layers, tested via E2E
      //  - .tsx popup components are tested via E2E in a later milestone
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.tsx",
        "src/background/crypto/wordlist.ts",
        "src/entrypoints/**",
        "src/popup/**",
        "src/options/**",
        // Badge and messaging are exercised via E2E (Playwright);
        // their DOM-mutation side effects don't lend themselves to unit tests.
        "src/content/messaging.ts",
        // Pure chrome.contextMenus + chrome.action wiring with no logic.
        "src/background/context-menus.ts",
        // M5 sync layer: HTTP client + OPAQUE orchestration are exercised
        // end-to-end against the real server in server/test/auth.test.ts
        // and server/test/sync.test.ts; the crypto primitives (keys.ts,
        // crypto.ts) ARE unit-tested under tests/sync/. payload.ts is a
        // pure data shape, session-store.ts is a chrome.storage shim.
        // Full cross-repo E2E lands in M6.
        "src/shared/sync/auth.ts",
        "src/shared/sync/client.ts",
        "src/shared/sync/payload.ts",
        "src/background/sync/session-store.ts",
        // connect/disconnect inside the runner exercise the full OPAQUE
        // round-trip which is impractical to mock end-to-end here; they
        // are covered by the cross-repo E2E in server/test/auth.test.ts.
        // testConnection IS unit-tested in tests/sync/runner.test.ts.
        "src/background/sync/runner.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
