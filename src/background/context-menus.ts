/**
 * Right-click context menus.
 *
 *   - "Generate for this site" — visible everywhere; opens the popup.
 *   - "Fill with Keyfount" — visible only on editable fields; asks
 *     the page-side content script to focus the password input and open
 *     its badge panel.
 */
import { registrableDomain } from "../shared/domain.js";

const OPEN_VAULT_ID = "keyfount:open-vault";
const FILL_FIELD_ID = "keyfount:fill-field";

export function registerContextMenus(): void {
  const create = () => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: OPEN_VAULT_ID,
        title: chrome.i18n.getMessage("ctx_open_vault") || "Open Keyfount",
        contexts: ["all"],
      });
      chrome.contextMenus.create({
        id: FILL_FIELD_ID,
        title: chrome.i18n.getMessage("ctx_fill") || "Fill with Keyfount",
        contexts: ["editable"],
      });
    });
  };

  chrome.runtime.onInstalled.addListener(create);
  chrome.runtime.onStartup.addListener(create);

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === OPEN_VAULT_ID) {
      void chrome.action.openPopup().catch(() => {
        /* Some Chrome versions disallow programmatic openPopup; ignore. */
      });
      return;
    }
    if (info.menuItemId === FILL_FIELD_ID && tab?.id !== undefined) {
      const domain = tab.url ? registrableDomain(tab.url) : null;
      chrome.tabs
        .sendMessage(tab.id, {
          kind: "keyfount:fill-here",
          domain,
        })
        .catch(() => {
          /* content script not loaded on this page */
        });
    }
  });
}
