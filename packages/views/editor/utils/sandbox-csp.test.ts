// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SANDBOXED_HTML_CSP, withSandboxCsp } from "./sandbox-csp";

describe("withSandboxCsp", () => {
  it("puts the policy before the author's markup", () => {
    const doc = withSandboxCsp('<script src="https://cdn.example/x.js"></script>');
    expect(doc.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc).toContain('<script src="https://cdn.example/x.js"></script>');
  });

  it("keeps a leading doctype first", () => {
    const doc = withSandboxCsp("  <!DOCTYPE html><html><body>x</body></html>");
    expect(doc).toMatch(/^\s*<!DOCTYPE html><meta http-equiv="Content-Security-Policy"/);
  });

  it("allows no remote source of any kind", () => {
    expect(SANDBOXED_HTML_CSP).toContain("default-src 'none'");
    expect(SANDBOXED_HTML_CSP).not.toMatch(/https?:|\*|'self'/);
  });
});
