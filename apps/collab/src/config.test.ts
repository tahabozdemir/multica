// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const base = { COLLAB_SECRET: "s", MULTICA_API_URL: "http://127.0.0.1:8080" };

describe("loadConfig host", () => {
  it("listens on loopback by default (privacy mode)", () => {
    expect(loadConfig({ ...base }).host).toBe("127.0.0.1");
  });

  it("uses MULTICA_BIND_HOST when set", () => {
    expect(loadConfig({ ...base, MULTICA_BIND_HOST: "0.0.0.0" }).host).toBe("0.0.0.0");
  });

  it("keeps upstream's every-interface default with privacy mode off", () => {
    expect(loadConfig({ ...base, MULTICA_PRIVACY_MODE: "0" }).host).toBe("0.0.0.0");
  });
});
