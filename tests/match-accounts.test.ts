import { describe, expect, it } from "vitest";
import { domainMatches, fullHost, matchAccounts } from "../src/shared/domain.js";

interface Row {
  domain: string;
  username: string;
  linkedDomains?: string[];
  lastUsedAt: number;
}
const acc = (domain: string, lastUsedAt = 0, linkedDomains?: string[]): Row =>
  linkedDomains
    ? { domain, username: "u", linkedDomains, lastUsedAt }
    : { domain, username: "u", lastUsedAt };

describe("fullHost", () => {
  it("returns the lowercased hostname for http(s) URLs", () => {
    expect(fullHost("https://Accounts.Google.com/signin")).toBe("accounts.google.com");
    expect(fullHost("https://example.com")).toBe("example.com");
  });
  it("returns null for non-web URLs", () => {
    expect(fullHost("chrome://extensions")).toBeNull();
    expect(fullHost("file:///x")).toBeNull();
    expect(fullHost("")).toBeNull();
  });
});

describe("domainMatches", () => {
  it("registrable domain matches its root and every subdomain (broad)", () => {
    expect(domainMatches("y.com", "y.com")).toBe(true);
    expect(domainMatches("y.com", "x.y.com")).toBe(true);
    expect(domainMatches("y.com", "a.b.y.com")).toBe(true);
  });
  it("full-host domain matches only the exact host (narrow)", () => {
    expect(domainMatches("w.y.com", "w.y.com")).toBe(true);
    expect(domainMatches("w.y.com", "y.com")).toBe(false);
    expect(domainMatches("w.y.com", "z.y.com")).toBe(false);
  });
  it("does not cross registrable boundaries", () => {
    expect(domainMatches("y.com", "evil-y.com")).toBe(false);
    expect(domainMatches("y.com", "yy.com")).toBe(false);
  });
});

describe("matchAccounts", () => {
  it("offers a broad (registrable) account on subdomains", () => {
    const out = matchAccounts("https://gist.github.com", [acc("github.com")]);
    expect(out.map((e) => e.domain)).toEqual(["github.com"]);
  });
  it("offers a narrow (full-host) account only on its exact host", () => {
    expect(matchAccounts("https://w.y.com", [acc("w.y.com")]).length).toBe(1);
    expect(matchAccounts("https://y.com", [acc("w.y.com")]).length).toBe(0);
    expect(matchAccounts("https://z.y.com", [acc("w.y.com")]).length).toBe(0);
  });
  it("offers a linked account on the linked host (carries the source salt)", () => {
    const out = matchAccounts("https://z.y.com", [acc("w.y.com", 5, ["z.y.com"])]);
    expect(out.map((e) => e.domain)).toEqual(["w.y.com"]);
  });
  it("ranks exact-host above registrable, then by lastUsedAt", () => {
    const broadOld = acc("y.com", 1);
    const narrowNew = acc("x.y.com", 2);
    const out = matchAccounts("https://x.y.com", [broadOld, narrowNew]);
    expect(out.map((e) => e.domain)).toEqual(["x.y.com", "y.com"]);
  });
  it("returns nothing for localhost / non-web URLs", () => {
    expect(matchAccounts("http://localhost:3000", [acc("localhost")])).toEqual([]);
    expect(matchAccounts("chrome://extensions", [acc("github.com")])).toEqual([]);
  });
});
