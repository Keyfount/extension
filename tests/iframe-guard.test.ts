/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { isTopFrame } from "../src/content/iframe-guard.js";

describe("isTopFrame", () => {
  it("returns true when window === window.top", () => {
    const win = {} as unknown as Window & { top: Window };
    win.top = win as Window;
    expect(isTopFrame(win)).toBe(true);
  });

  it("returns false in a same-origin subframe (window !== window.top)", () => {
    const top = {} as Window;
    const child = { top } as unknown as Window;
    expect(isTopFrame(child)).toBe(false);
  });

  it("returns false when reading `top` throws a SecurityError (cross-origin)", () => {
    const win = {
      get top(): Window {
        throw new DOMException("Blocked a frame from accessing a cross-origin frame.");
      },
    } as unknown as Window;
    expect(isTopFrame(win)).toBe(false);
  });
});
