"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../platform/storage";

// How the user reads local git diffs: the layout they picked, and which files
// they have marked as viewed. A viewed mark stores a fingerprint of the file's
// diff, so it lapses on its own when an agent changes that file again.

export type DiffLayout = "unified" | "split";

/** Viewed marks kept; the oldest are dropped first. */
export const MAX_VIEWED_FILES = 1000;

interface LocalChangesReviewState {
  layout: DiffLayout;
  /** File key → fingerprint of the diff marked viewed, least recent first. */
  viewed: Record<string, string>;
  setLayout: (layout: DiffLayout) => void;
  setViewed: (key: string, fingerprint: string, viewed: boolean) => void;
}

/** FNV-1a, enough to tell one version of a file's diff from the next. */
export function diffFingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0") + text.length.toString(16);
}

/** Marks `key` (most recent last) and drops the oldest beyond the cap. */
export function withViewed(
  viewed: Record<string, string>,
  key: string,
  fingerprint: string | null,
): Record<string, string> {
  const next = { ...viewed };
  delete next[key];
  if (fingerprint !== null) next[key] = fingerprint;
  const keys = Object.keys(next);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_VIEWED_FILES))) delete next[stale];
  return next;
}

export const useLocalChangesReviewStore = create<LocalChangesReviewState>()(
  persist(
    (set) => ({
      layout: "unified",
      viewed: {},
      setLayout: (layout) => set({ layout }),
      setViewed: (key, fingerprint, viewed) =>
        set((state) => ({ viewed: withViewed(state.viewed, key, viewed ? fingerprint : null) })),
    }),
    {
      name: "multica_local_changes_review",
      storage: createJSONStorage(() => defaultStorage),
      partialize: (state) => ({ layout: state.layout, viewed: state.viewed }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LocalChangesReviewState>;
        const viewed: Record<string, string> = {};
        if (p.viewed && typeof p.viewed === "object") {
          for (const [key, value] of Object.entries(p.viewed)) {
            if (typeof value === "string") viewed[key] = value;
          }
        }
        return {
          ...current,
          layout: p.layout === "split" ? "split" : "unified",
          viewed: withViewed(viewed, "", null),
        };
      },
    },
  ),
);
