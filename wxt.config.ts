import { defineConfig } from "wxt";

/**
 * WXT configuration for ItsMyPassword.
 *
 * Manifest V3 only. The extension does not request any host_permissions —
 * password-field interaction is opt-in via activeTab. Crypto, storage and
 * messaging are all handled in the background service worker.
 */
export default defineConfig({
  srcDir: "src",
  outDir: ".output",

  manifest: {
    name: "ItsMyPassword",
    description: "Deterministic password manager. No vault, no sync — just an algorithm.",
    permissions: ["storage", "activeTab", "scripting", "alarms"],
    host_permissions: [],
    action: {
      default_title: "ItsMyPassword",
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; base-uri 'none'",
    },
    minimum_chrome_version: "116",
  },

  vite: () => ({
    resolve: {
      alias: {
        react: "preact/compat",
        "react-dom": "preact/compat",
      },
    },
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "preact",
    },
  }),
});
