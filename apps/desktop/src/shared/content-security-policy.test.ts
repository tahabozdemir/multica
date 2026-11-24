// @vitest-environment node
import { describe, expect, it } from "vitest";
import { desktopContentSecurityPolicy, parseExtraOrigins } from "./content-security-policy";

function directive(policy: string, name: string): string {
  return policy.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
}

describe("desktopContentSecurityPolicy", () => {
  it("lets images, connections, and frames reach only this machine", () => {
    const policy = desktopContentSecurityPolicy();
    const local = /^(?:'[a-z-]+'|file:|data:|blob:|(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1):\*)$/;
    for (const name of ["default-src", "img-src", "media-src", "connect-src", "frame-src", "font-src", "worker-src"]) {
      const sources = directive(policy, name).split(" ").slice(1);
      expect(sources.length, name).toBeGreaterThan(0);
      for (const source of sources) expect(source, `${name} ${source}`).toMatch(local);
    }
    expect(directive(policy, "connect-src")).toContain("ws://localhost:*");
    expect(directive(policy, "img-src")).toContain("http://127.0.0.1:*");
    // Chromium ignores IPv6-literal host-sources with a console warning.
    expect(policy).not.toContain("[::1]");
  });

  it("adds build-time origins with their WebSocket twin", () => {
    const policy = desktopContentSecurityPolicy({ extraOrigins: ["https://multica.lan"] });
    expect(directive(policy, "img-src")).toContain("https://multica.lan");
    expect(directive(policy, "connect-src")).toContain("wss://multica.lan");
  });
});

describe("parseExtraOrigins", () => {
  it("keeps only bare http(s) origins", () => {
    expect(parseExtraOrigins(" https://a.lan, http://10.0.0.2:8080/ bogus https://b.lan/path ")).toEqual([
      "https://a.lan",
      "http://10.0.0.2:8080",
    ]);
    expect(parseExtraOrigins(undefined)).toEqual([]);
  });
});
