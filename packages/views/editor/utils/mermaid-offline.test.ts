// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MERMAID_SECURE_KEYS, withoutRemoteMermaidImages } from "./mermaid-offline";

describe("withoutRemoteMermaidImages", () => {
  it("replaces remote image URLs, quoted or not", () => {
    const chart = [
      'flowchart TD',
      '  A@{ img: "https://track.example/p.png", label: "a", w: 60, h: 60 }',
      "  B@{ img: 'http://x.example/i.png' }",
      "  C@{ img: //cdn.example/c.png, pos: t }",
    ].join("\n");
    const out = withoutRemoteMermaidImages(chart);
    expect(out).not.toMatch(/example/);
    expect(out.match(/img: "data:image\/gif;base64,/g)).toHaveLength(3);
    expect(out).toContain('label: "a", w: 60, h: 60');
  });

  it("leaves inline images and ordinary text alone", () => {
    const chart = 'flowchart TD\n  A@{ img: "data:image/png;base64,AAAA" }\n  B["see https://example.com"]';
    expect(withoutRemoteMermaidImages(chart)).toBe(chart);
  });
});

it("locks themeCSS against diagram directives", () => {
  expect(MERMAID_SECURE_KEYS).toContain("themeCSS");
  expect(MERMAID_SECURE_KEYS).toContain("securityLevel");
});
