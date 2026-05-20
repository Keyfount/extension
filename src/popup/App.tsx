import { useEffect } from "preact/hooks";
import { send } from "./api.js";
import { LoadingScreen } from "./components/LoadingScreen.js";
import { MainScreen } from "./components/MainScreen.js";
import { SetupScreen } from "./components/SetupScreen.js";
import { UnlockScreen } from "./components/UnlockScreen.js";
import { registrableDomain } from "../shared/domain.js";
import { activeDomain, activeEmail, errorMessage, fingerprint, hasPin, screen } from "./state.js";

export function App() {
  useEffect(() => {
    void bootstrap();
  }, []);

  switch (screen.value) {
    case "loading":
      return <LoadingScreen />;
    case "setup":
      return <SetupScreen />;
    case "unlock":
      return <UnlockScreen hasPin={hasPin.value} />;
    case "main":
      return <MainScreen />;
  }
}

async function bootstrap() {
  try {
    const status = await send({ kind: "status" });
    fingerprint.value = status.fingerprint;

    try {
      const state = await send({ kind: "getState" });
      hasPin.value = state.hasPin;
    } catch {
      hasPin.value = false;
    }

    if (status.isFirstRun) {
      screen.value = "setup";
    } else if (status.locked) {
      screen.value = "unlock";
    } else {
      screen.value = "main";
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      activeDomain.value = registrableDomain(tab.url);
    }
    activeEmail.value = "";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "could not initialise";
    screen.value = "unlock";
  }
}
