"use client";

import { useQuery } from "@tanstack/react-query";
import {
  canListLocalAgentBranches,
  listLocalAgentBranches,
  type LocalGitAgentBranchesResult,
  type LocalGitBranchSummary,
} from "../../platform/local-git";
import { localGitKeys } from "./local-changes-dialog";

/** While any branch has a live run, its size is read again this often. */
const LIVE_SUMMARY_REFRESH_MS = 10_000;

/**
 * Every agent branch in a local folder's repository, with sizes. One query per
 * folder, shared by the issue sidebar and the board badges.
 */
export function useLocalAgentBranches(folderPath: string | null, enabled = true) {
  return useQuery({
    queryKey: localGitKeys.agentBranches(folderPath ?? ""),
    queryFn: () => listLocalAgentBranches(folderPath as string),
    enabled: enabled && Boolean(folderPath) && canListLocalAgentBranches(),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.ok && data.branches.some((b) => b.live) ? LIVE_SUMMARY_REFRESH_MS : false;
    },
  });
}

/** An issue's branches (the daemon names them after the lowercase identifier). */
export function branchesForIssue(
  result: LocalGitAgentBranchesResult | undefined,
  identifier: string | null | undefined,
): LocalGitBranchSummary[] {
  if (!result?.ok || !identifier) return [];
  const key = identifier.toLowerCase();
  return result.branches.filter((b) => b.issue_key === key);
}

/**
 * The daemon's agent-name segment for a branch (sanitizeName in
 * server/internal/daemon/execenv/git.go), to recognise an agent when the
 * branch record names one from another server.
 */
export function agentBranchSegment(name: string): string {
  let segment = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (segment.length > 30) segment = segment.slice(0, 30).replace(/-+$/, "");
  return segment || "agent";
}
