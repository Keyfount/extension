/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { findPasswordFields, findUsernameFieldFor, readUsername } from "../src/content/detect.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("findPasswordFields", () => {
  it("finds standard password inputs", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="user" />
        <input type="password" name="pw" />
      </form>
    `;
    const fields = findPasswordFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]!.name).toBe("pw");
  });

  it("ignores one-time-code inputs", () => {
    document.body.innerHTML = `
      <input type="password" autocomplete="one-time-code" />
      <input type="password" autocomplete="current-password" />
    `;
    const fields = findPasswordFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]!.getAttribute("autocomplete")).toBe("current-password");
  });

  it("finds password inputs inside open shadow roots", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<input type="password" name="shadowPw" />`;
    const fields = findPasswordFields();
    expect(fields).toHaveLength(1);
    expect(fields[0]!.name).toBe("shadowPw");
  });
});

describe("findUsernameFieldFor", () => {
  it("returns the field with autocomplete=username when present", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="other" />
        <input type="text" name="user" autocomplete="username" />
        <input type="password" id="pw" />
      </form>
    `;
    const pw = document.querySelector<HTMLInputElement>("#pw")!;
    expect(findUsernameFieldFor(pw)?.name).toBe("user");
  });

  it("matches on name/id/placeholder when no autocomplete hint", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="firstName" />
        <input type="text" placeholder="email@example.com" />
        <input type="password" id="pw" />
      </form>
    `;
    const pw = document.querySelector<HTMLInputElement>("#pw")!;
    const username = findUsernameFieldFor(pw);
    expect(username?.placeholder).toBe("email@example.com");
  });

  it("falls back to the closest preceding text input", () => {
    document.body.innerHTML = `
      <form>
        <input type="text" id="firstField" />
        <input type="password" id="pw" />
      </form>
    `;
    const pw = document.querySelector<HTMLInputElement>("#pw")!;
    expect(findUsernameFieldFor(pw)?.id).toBe("firstField");
  });

  it("returns null when no text-like inputs exist", () => {
    document.body.innerHTML = `
      <form>
        <input type="password" id="pw" />
        <button type="submit">Login</button>
      </form>
    `;
    const pw = document.querySelector<HTMLInputElement>("#pw")!;
    expect(findUsernameFieldFor(pw)).toBeNull();
  });

  it("ignores hidden inputs", () => {
    document.body.innerHTML = `
      <form>
        <input type="hidden" name="csrf" />
        <input type="text" name="user" autocomplete="username" />
        <input type="password" id="pw" />
      </form>
    `;
    const pw = document.querySelector<HTMLInputElement>("#pw")!;
    expect(findUsernameFieldFor(pw)?.name).toBe("user");
  });

  it("works without a containing <form>", () => {
    document.body.innerHTML = `
      <div>
        <input type="email" />
        <input type="password" id="pw" />
      </div>
    `;
    const pw = document.querySelector<HTMLInputElement>("#pw")!;
    expect(findUsernameFieldFor(pw)?.type).toBe("email");
  });
});

describe("readUsername", () => {
  it("returns the trimmed value of the detected username field", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" value="  alice@example.com  " autocomplete="email" />
        <input type="password" id="pw" />
      </form>
    `;
    const pw = document.querySelector<HTMLInputElement>("#pw")!;
    expect(readUsername(pw)).toBe("alice@example.com");
  });

  it("returns an empty string when no username field is found", () => {
    document.body.innerHTML = `<input type="password" id="pw" />`;
    const pw = document.querySelector<HTMLInputElement>("#pw")!;
    expect(readUsername(pw)).toBe("");
  });
});
