import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_VIEWED_FILES,
  diffFingerprint,
  useLocalChangesReviewStore,
  withViewed,
} from "./review-store";

beforeEach(() => {
  useLocalChangesReviewStore.setState({ layout: "unified", viewed: {} });
});

describe("local changes review store", () => {
  it("remembers a viewed file only for the diff it was marked on", () => {
    const store = useLocalChangesReviewStore.getState();
    const before = diffFingerprint("-a\n+b");
    store.setViewed("repo::branch::a.ts", before, true);
    const viewed = useLocalChangesReviewStore.getState().viewed;
    expect(viewed["repo::branch::a.ts"]).toBe(before);
    expect(diffFingerprint("-a\n+c")).not.toBe(before);

    store.setViewed("repo::branch::a.ts", before, false);
    expect(useLocalChangesReviewStore.getState().viewed).toEqual({});
  });

  it("drops the least recently marked files beyond the cap", () => {
    let viewed: Record<string, string> = {};
    for (let i = 0; i < MAX_VIEWED_FILES + 5; i++) viewed = withViewed(viewed, `k${i}`, "f");
    const keys = Object.keys(viewed);
    expect(keys).toHaveLength(MAX_VIEWED_FILES);
    expect(keys[0]).toBe("k5");
    // Marking again makes a key the most recent.
    viewed = withViewed(viewed, "k5", "f");
    expect(Object.keys(viewed).at(-1)).toBe("k5");
  });

  it("keeps the chosen layout", () => {
    useLocalChangesReviewStore.getState().setLayout("split");
    expect(useLocalChangesReviewStore.getState().layout).toBe("split");
  });
});
