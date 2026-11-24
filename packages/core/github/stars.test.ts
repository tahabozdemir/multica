// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { configStore } from "../config";
import { fetchGithubStars, formatStarCount } from "./stars";

describe("fetchGithubStars", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    configStore.getState().setPrivacyMode(true);
  });

  it("makes no request in privacy mode", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    configStore.getState().setPrivacyMode(true);
    expect(await fetchGithubStars()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the count from GitHub with privacy mode off", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ stargazers_count: 42 }))));
    configStore.getState().setPrivacyMode(false);
    expect(await fetchGithubStars()).toBe(42);
  });
});

describe("formatStarCount", () => {
  it("renders counts below 1,000 exactly", () => {
    expect(formatStarCount(0)).toBe("0");
    expect(formatStarCount(7)).toBe("7");
    expect(formatStarCount(999)).toBe("999");
  });

  it("formats thousands with one decimal, GitHub-style", () => {
    expect(formatStarCount(37_600)).toBe("37.6k");
    expect(formatStarCount(1_234)).toBe("1.2k");
    expect(formatStarCount(12_300)).toBe("12.3k");
  });

  it("trims a trailing .0 ('1k', not '1.0k')", () => {
    expect(formatStarCount(1_000)).toBe("1k");
    expect(formatStarCount(2_000)).toBe("2k");
  });

  it("rounds to one decimal like the repo header", () => {
    expect(formatStarCount(1_949)).toBe("1.9k");
    expect(formatStarCount(1_990)).toBe("2k");
  });

  it("formats millions with an 'm' suffix", () => {
    expect(formatStarCount(1_200_000)).toBe("1.2m");
    expect(formatStarCount(2_000_000)).toBe("2m");
  });
});
