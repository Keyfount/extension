import { useEffect } from "preact/hooks";
import { AnimatePresence } from "framer-motion";
import { send } from "./api.js";
import { AccountDetailScreen } from "./components/AccountDetailScreen.js";
import { LoadingScreen } from "./components/LoadingScreen.js";
import { MainScreen } from "./components/MainScreen.js";
import { SettingsScreen } from "./components/SettingsScreen.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { UnlockScreen } from "./components/UnlockScreen.js";
import { DotGrid } from "../shared/DotGrid.js";
import { errorMessage, fingerprint, hasPin, screen } from "./state.js";
import { loadVaultData } from "./vault.js";
import { installClipboardClearListener } from "./clipboard.js";

export function App() {
  useEffect(() => {
    installClipboardClearListener();
    void bootstrap();
  }, []);

  return (
    <>
      <DotGrid />
      <div class="relative z-10">
        <AnimatePresence mode="wait" initial={false}>
          {renderScreen()}
        </AnimatePresence>
      </div>
    </>
  );
}

function renderScreen() {
  switch (screen.value) {
    case "loading":
      return <LoadingScreen key="loading" />;
    case "setup":
      return <SetupScreen key="setup" />;
    case "unlock":
      return <UnlockScreen key="unlock" hasPin={hasPin.value} />;
    case "main":
      return <MainScreen key="main" />;
    case "account-detail":
      return <AccountDetailScreen key="account-detail" />;
    case "settings":
      return <SettingsScreen key="settings" />;
  }
}

async function bootstrap() {
  try {
    const status = await send({ kind: "status" });
    fingerprint.value = status.fingerprint;

    if (status.isFirstRun) {
      // Still need hasPin for the unlock screen later.
      try {
        const state = await send({ kind: "getState" });
        hasPin.value = state.hasPin;
      } catch {
        hasPin.value = false;
      }
      screen.value = "setup";
      return;
    }

    if (status.locked) {
      hasPin.value = status.hasPin;
      screen.value = "unlock";
      return;
    }

    await loadVaultData();
    screen.value = "main";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "could not initialise";
    screen.value = "unlock";
  }
}
