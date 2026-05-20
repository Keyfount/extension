/**
 * Typed wrapper around `chrome.runtime.sendMessage` for the options page.
 * Kept separate from the popup wrapper to allow independent bundling.
 */
import type { ErrorResponse, Request, Response as MessageResponse } from "../shared/messages.js";

export class BackgroundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackgroundError";
  }
}

export async function send<T extends Request>(request: T): Promise<MessageResponse<T>> {
  const raw = (await chrome.runtime.sendMessage(request)) as
    | MessageResponse<T>
    | ErrorResponse
    | undefined;
  if (raw === undefined) {
    throw new BackgroundError("no response from background");
  }
  if (raw.ok === false) {
    throw new BackgroundError(raw.error);
  }
  return raw;
}
