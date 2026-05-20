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
