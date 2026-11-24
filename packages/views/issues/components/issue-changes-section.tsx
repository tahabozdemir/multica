"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@multica/ui/components/ui/button";
import { Dialog } from "@multica/ui/components/ui/dialog";
import { cn } from "@multica/ui/lib/utils";
import { useWorkspaceId } from "@multica/core/hooks";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { Issue } from "@multica/core/types";
import { canListLocalAgentBranches, type LocalGitBranchSummary } from "../../platform/local-git";
import {
  AgentBranchChangesDialogContent,
  useLocalProjectFolder,
} from "../../common/local-changes";
import {
  agentBranchSegment,
  branchesForIssue,
  useLocalAgentBranches,
} from "../../common/local-changes/use-local-agent-branches";
import { useT } from "../../i18n";
import { IssueSidebarCollapsible, IssueSidebarSectionHeader } from "./issue-sidebar-section";

/** Statuses where the owner reads the diff: the review button leads there. */
const REVIEW_STATUSES = new Set(["code_review", "in_review"]);

type ChangesIssue = Pick<Issue, "identifier" | "project_id" | "status">;

/**
 * The issue's agent branches in its project's folder on this machine, with
 * their size and state, each one click from its diff. Desktop only; renders
 * nothing when the issue has no branch here.
 */
export function IssueChangesSection({ issue }: { issue: ChangesIssue }) {
  if (!canListLocalAgentBranches()) return null;
  return <LocalIssueChangesSection issue={issue} />;
}

function LocalIssueChangesSection({ issue }: { issue: ChangesIssue }) {
  const { t } = useT("issues");
  const wsId = useWorkspaceId();
  const [open, setOpen] = useState(true);
  const [openBranch, setOpenBranch] = useState<string | null>(null);
  const folder = useLocalProjectFolder(issue.project_id);
  const { data } = useLocalAgentBranches(folder?.path ?? null);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));

  const branches = sortBranches(branchesForIssue(data, issue.identifier));
  if (!folder || branches.length === 0) return null;

  const agentName = (branch: LocalGitBranchSummary) =>
    agents.find((a) => a.id === branch.agent_id)?.name ??
    agents.find((a) => agentBranchSegment(a.name) === branch.agent_segment)?.name ??
    branch.agent_segment;
  const reviewing = REVIEW_STATUSES.has(issue.status);
  const leadBranch = branches.find((b) => !b.merged && b.files > 0)?.name;
  const live = branches.some((b) => b.live);
  const additions = branches.reduce((sum, b) => sum + b.additions, 0);
  const deletions = branches.reduce((sum, b) => sum + b.deletions, 0);

  const status = live ? (
    <span className="inline-flex shrink-0 items-center gap-1 text-caption text-success">
      <span aria-hidden className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" />
      {t(($) => $.changes.live)}
    </span>
  ) : (
    <span className="shrink-0 font-mono text-caption tabular-nums">
      <span className="text-success">+{additions}</span> <span className="text-destructive">−{deletions}</span>
    </span>
  );

  return (
    <div>
      <IssueSidebarSectionHeader
        title={t(($) => $.changes.section)}
        open={open}
        onOpenChange={setOpen}
        count={branches.length}
        status={status}
      />
      <IssueSidebarCollapsible open={open}>
        <ul className="flex flex-col gap-1 pb-1">
          {branches.map((branch) => {
            const lead = branch.name === leadBranch;
            return (
              <li key={branch.name} className="flex min-w-0 items-center gap-2 rounded-xs px-1 py-1 text-caption">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{agentName(branch)}</span>
                    {branch.live && (
                      <span className="shrink-0 text-micro text-success">{t(($) => $.changes.live)}</span>
                    )}
                    {branch.merged && (
                      <span className="shrink-0 text-micro text-muted-foreground">{t(($) => $.changes.merged)}</span>
                    )}
                  </div>
                  <div className="truncate text-micro text-muted-foreground tabular-nums" title={branch.name}>
                    {t(($) => $.changes.files_count, { count: branch.files })}
                    {branch.files > 0 && (
                      <>
                        {" · "}
                        <span className="text-success">+{branch.additions}</span>{" "}
                        <span className="text-destructive">−{branch.deletions}</span>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  size="xs"
                  variant={reviewing && lead ? "default" : "outline"}
                  className={cn("shrink-0")}
                  onClick={() => setOpenBranch(branch.name)}
                >
                  {reviewing && lead ? t(($) => $.changes.review) : t(($) => $.changes.view)}
                </Button>
              </li>
            );
          })}
        </ul>
      </IssueSidebarCollapsible>
      <Dialog open={openBranch !== null} onOpenChange={(next) => !next && setOpenBranch(null)}>
        {openBranch && <AgentBranchChangesDialogContent path={folder.path} branch={openBranch} />}
      </Dialog>
    </div>
  );
}

/** Live runs first, then branches still to merge, then merged ones; by name within. */
function sortBranches(branches: LocalGitBranchSummary[]): LocalGitBranchSummary[] {
  const rank = (b: LocalGitBranchSummary) => (b.live ? 0 : b.merged ? 2 : 1);
  return [...branches].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
