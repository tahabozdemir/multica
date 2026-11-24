"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FilePen, GitBranch } from "@multica/ui/icons";
import { IconButton } from "@multica/ui/components/common/icon-button";
import { Dialog } from "@multica/ui/components/ui/dialog";
import { useWorkspaceId } from "@multica/core/hooks";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { projectResourcesOptions } from "@multica/core/projects";
import type { AgentTask, LocalDirectoryResourceRef, ProjectResource } from "@multica/core/types";
import { canReadLocalGit } from "../../platform/local-git";
import { readLocalDaemonStatus } from "../../platform/use-local-daemon-status";
import { localDirectoryLabel } from "../../projects/components/local-directory-label";
import { useT } from "../../i18n";
import {
  AgentBranchChangesDialogContent,
  WorkingCopyChangesDialogContent,
} from "./local-changes-dialog";

type LocalFolder = { path: string; label: string };

/**
 * The project's local folder on this machine, or null: on web, on a desktop
 * build without the git bridge, or when the folder lives on another machine.
 * Folders are registered per daemon, and the local daemon is this machine.
 */
export function useLocalProjectFolder(projectId: string | null | undefined): LocalFolder | null {
  const wsId = useWorkspaceId();
  const supported = canReadLocalGit();
  // One shared read for every card and section, not a status subscription each.
  const { data: daemonId = null } = useQuery({
    queryKey: ["local-daemon", "id"],
    queryFn: async () => (await readLocalDaemonStatus()).daemonId,
    enabled: supported,
    staleTime: 30_000,
  });
  const { data: resources } = useQuery({
    ...projectResourcesOptions(wsId, projectId ?? ""),
    enabled: supported && Boolean(projectId) && Boolean(daemonId),
  });
  if (!supported || !daemonId || !resources) return null;
  const folder = resources.find(
    (r): r is ProjectResource & { resource_ref: LocalDirectoryResourceRef } =>
      r.resource_type === "local_directory" &&
      (r.resource_ref as Partial<LocalDirectoryResourceRef>).daemon_id === daemonId,
  );
  if (!folder) return null;
  return { path: folder.resource_ref.local_path, label: localDirectoryLabel(folder) };
}

/**
 * Opens the diff of the `agent/...` branch a run delivered, read from the
 * project's folder on this machine. Renders nothing when the run delivered no
 * branch or the folder is not here.
 */
export function AgentBranchChangesButton({ task, issueId }: { task: AgentTask; issueId: string }) {
  const branch = task.branch_name?.trim() ?? "";
  // Checked before any hook runs, so web (and runs without a branch) do no
  // lookups at all. Bridge presence is fixed for the life of the window.
  if (!branch || !canReadLocalGit()) return null;
  return <LocalAgentBranchChangesButton branch={branch} issueId={issueId} />;
}

function LocalAgentBranchChangesButton({ branch, issueId }: { branch: string; issueId: string }) {
  const { t } = useT("projects");
  const wsId = useWorkspaceId();
  const [open, setOpen] = useState(false);
  const { data: projectId } = useQuery({
    ...issueDetailOptions(wsId, issueId),
    select: (issue) => issue.project_id,
  });
  const folder = useLocalProjectFolder(projectId);
  if (!folder) return null;

  return (
    <>
      <IconButton
        size="icon-xs"
        variant="ghost"
        label={t(($) => $.local_changes.agent_branch_button)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <GitBranch className="size-3.5" />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <AgentBranchChangesDialogContent path={folder.path} branch={branch} />}
      </Dialog>
    </>
  );
}

/** Opens the uncommitted changes of a local folder registered on this machine. */
export function WorkingCopyChangesButton({ path, label }: { path: string; label: string }) {
  const { t } = useT("projects");
  const [open, setOpen] = useState(false);
  if (!canReadLocalGit()) return null;

  return (
    <>
      <IconButton
        size="icon-xs"
        variant="ghost"
        label={t(($) => $.local_changes.working_copy_button)}
        onClick={() => setOpen(true)}
      >
        <FilePen className="size-3.5" />
      </IconButton>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <WorkingCopyChangesDialogContent path={path} label={label} />}
      </Dialog>
    </>
  );
}
