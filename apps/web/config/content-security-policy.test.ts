// @vitest-environment node
import { describe, expect, it } from "vitest";
import { privacyModeEnabled, webContentSecurityPolicy } from "./content-security-policy";

function directive(policy: string, name: string): string[] {
  return (policy.split("; ").find((d) => d.startsWith(`${name} `)) ?? "").split(" ").slice(1);
}

describe("webContentSecurityPolicy", () => {
  const env = {
    LOCAL_UPLOAD_BASE_URL: "http://localhost:8080",
    FRONTEND_ORIGIN: "http://localhost:3000",
  };

  it("allows images and connections only from this origin and the local backend", () => {
    const policy = webContentSecurityPolicy(env, { dev: false, backendUrl: "http://localhost:8080" });
    expect(directive(policy, "img-src")).toEqual(["'self'", "data:", "blob:", "http://localhost:8080"]);
    expect(directive(policy, "connect-src")).toEqual([
      "'self'",
      "http://localhost:8080",
      "ws://localhost:8080",
      "ws://localhost:3000",
    ]);
    expect(policy).not.toMatch(/https:\/\/|\*/);
    expect(directive(policy, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("adds a configured CDN and allows eval only in dev", () => {
    const policy = webContentSecurityPolicy({ ...env, MULTICA_CDN_DOMAIN: "files.internal.example" }, { dev: true });
    expect(directive(policy, "img-src")).toContain("https://files.internal.example");
    expect(directive(policy, "script-src")).toContain("'unsafe-eval'");
  });

  it("ignores values that are not origins", () => {
    const policy = webContentSecurityPolicy({ NEXT_PUBLIC_API_URL: "/api", REMOTE_API_URL: "javascript:alert(1)" }, { dev: false });
    expect(directive(policy, "img-src")).toEqual(["'self'", "data:", "blob:"]);
  });
});

it("privacyModeEnabled matches the core rule", () => {
  expect(privacyModeEnabled({})).toBe(true);
  expect(privacyModeEnabled({ MULTICA_PRIVACY_MODE: "off" })).toBe(false);
});
