import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

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
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    permissions: ["storage", "activeTab", "scripting", "alarms"],
    host_permissions: [],
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    action: {
      default_title: "__MSG_extName__",
      default_icon: {
        16: "icons/icon-16.png",
        32: "icons/icon-32.png",
        48: "icons/icon-48.png",
      },
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
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        react: "preact/compat",
        "react-dom": "preact/compat",
        "react/jsx-runtime": "preact/jsx-runtime",
        "react-dom/client": "preact/compat/client",
      },
    },
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "preact",
    },
  }),
});
