// @vitest-environment node
import { describe, expect, it } from "vitest";
import { privacyModeFrom } from "./privacy";

describe("privacyModeFrom", () => {
  it("is on unless explicitly turned off", () => {
    expect(privacyModeFrom(undefined)).toBe(true);
    expect(privacyModeFrom("1")).toBe(true);
    expect(privacyModeFrom("0")).toBe(false);
    expect(privacyModeFrom(" OFF ")).toBe(false);
  });
});
