// @vitest-environment node
import { describe, expect, it } from "vitest";
import { privacyModeFromEnv } from "./index";

describe("privacyModeFromEnv", () => {
  it("is on when unset or set to anything but an explicit off", () => {
    expect(privacyModeFromEnv({})).toBe(true);
    expect(privacyModeFromEnv({ MULTICA_PRIVACY_MODE: "1" })).toBe(true);
    expect(privacyModeFromEnv({ MULTICA_PRIVACY_MODE: "junk" })).toBe(true);
  });

  it("is off for 0, false, off, or no", () => {
    for (const value of ["0", "false", " OFF ", "no"]) {
      expect(privacyModeFromEnv({ MULTICA_PRIVACY_MODE: value })).toBe(false);
    }
  });
});
