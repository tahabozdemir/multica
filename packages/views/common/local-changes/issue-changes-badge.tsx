"use client";

import type { Issue } from "@multica/core/types";
import { useT } from "../../i18n";
import { useLocalProjectFolder } from "./local-changes-buttons";
import { branchesForIssue, useLocalAgentBranches } from "./use-local-agent-branches";

/**
 * "+N −M" for an issue's agent work not yet on the default branch, read from
 * its project's folder on this machine. Renders nothing when there is none.
 * Mount it only where the card setting is on and git can be read.
 */
export function IssueLocalChangesBadge({ issue }: { issue: Pick<Issue, "identifier" | "project_id"> }) {
  const { t } = useT("issues");
  const folder = useLocalProjectFolder(issue.project_id);
  const { data } = useLocalAgentBranches(folder?.path ?? null);
  const open = branchesForIssue(data, issue.identifier).filter((b) => !b.merged && (b.files > 0 || b.live));
  if (open.length === 0) return null;

  const additions = open.reduce((sum, b) => sum + b.additions, 0);
  const deletions = open.reduce((sum, b) => sum + b.deletions, 0);
  const live = open.some((b) => b.live);
  const label = t(($) => $.changes.badge_label);

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted/60 px-1.5 py-0.5 font-mono text-micro tabular-nums"
      title={label}
      aria-label={`${label}: +${additions} −${deletions}`}
    >
      {live && <span aria-hidden className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" />}
      <span aria-hidden className="text-success">+{additions}</span>
      <span aria-hidden className="text-destructive">−{deletions}</span>
    </span>
  );
}
