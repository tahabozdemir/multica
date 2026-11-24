"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "@multica/ui/icons";
import { IconButton } from "@multica/ui/components/common/icon-button";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { cn } from "@multica/ui/lib/utils";
import {
  readLocalAgentBranch,
  readLocalWorkingCopy,
  type LocalGitAgentBranchResult,
  type LocalGitCommit,
  type LocalGitDiffFile,
  type LocalGitFailureReason,
  type LocalGitWorkingCopyResult,
} from "../../platform/local-git";
import { useT } from "../../i18n";
import { DiffFileSection } from "./diff-file-section";

/** Files at or under this count open expanded; longer lists start collapsed. */
const EXPAND_ALL_UP_TO = 8;

export const localGitKeys = {
  workingCopy: (path: string) => ["local-git", "working-copy", path] as const,
  agentBranch: (path: string, branch: string) => ["local-git", "agent-branch", path, branch] as const,
};

// Read from disk on every open: the folder changes outside Multica, so a
// cached answer would be stale the moment the user edits a file.
const freshLocalRead = { staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false } as const;

/** Content for a `<Dialog>`: the uncommitted changes in a local folder. */
export function WorkingCopyChangesDialogContent({ path, label }: { path: string; label: string }) {
  const { t } = useT("projects");
  const query = useQuery({
    queryKey: localGitKeys.workingCopy(path),
    queryFn: () => readLocalWorkingCopy(path),
    ...freshLocalRead,
  });
  const result: LocalGitWorkingCopyResult | undefined = query.data;

  return (
    <ChangesDialogShell
      title={t(($) => $.local_changes.working_copy_title)}
      subtitle={result?.ok && result.branch ? `${label} · ${result.branch}` : label}
      files={result?.ok ? result.files : undefined}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
    >
      {query.isPending ? (
        <ChangesSkeleton />
      ) : !result || !result.ok ? (
        <FailureNotice reason={result?.ok === false ? result.reason : "error"} />
      ) : result.files.length === 0 ? (
        <Notice>{t(($) => $.local_changes.empty_working_copy)}</Notice>
      ) : (
        <FileList files={result.files} truncated={result.truncated} />
      )}
    </ChangesDialogShell>
  );
}

/** Content for a `<Dialog>`: what an agent branch would bring into the folder's HEAD. */
export function AgentBranchChangesDialogContent({ path, branch }: { path: string; branch: string }) {
  const { t } = useT("projects");
  const query = useQuery({
    queryKey: localGitKeys.agentBranch(path, branch),
    queryFn: () => readLocalAgentBranch(path, branch),
    ...freshLocalRead,
  });
  const result: LocalGitAgentBranchResult | undefined = query.data;
  const carriesUserWork = result?.ok === true && result.commits.some((c) => c.origin === "carried_over");

  return (
    <ChangesDialogShell
      title={t(($) => $.local_changes.agent_branch_title)}
      subtitle={branch}
      files={result?.ok ? result.files : undefined}
      refreshing={query.isFetching}
      onRefresh={() => void query.refetch()}
    >
      {query.isPending ? (
        <ChangesSkeleton />
      ) : !result || !result.ok ? (
        <FailureNotice reason={result?.ok === false ? result.reason : "error"} />
      ) : result.merged ? (
        <Notice>{t(($) => $.local_changes.merged)}</Notice>
      ) : (
        <>
          <CommitList commits={result.commits} />
          {carriesUserWork && (
            <p className="text-caption text-muted-foreground">{t(($) => $.local_changes.carried_over_note)}</p>
          )}
          {result.files.length === 0 ? (
            <Notice>{t(($) => $.local_changes.empty_branch)}</Notice>
          ) : (
            <FileList files={result.files} truncated={result.truncated} />
          )}
        </>
      )}
    </ChangesDialogShell>
  );
}

function ChangesDialogShell({
  title,
  subtitle,
  files,
  refreshing,
  onRefresh,
  children,
}: {
  title: string;
  subtitle: string;
  files: LocalGitDiffFile[] | undefined;
  refreshing: boolean;
  onRefresh: () => void;
  children: React.ReactNode;
}) {
  const { t } = useT("projects");
  const additions = files?.reduce((sum, f) => sum + f.additions, 0) ?? 0;
  const deletions = files?.reduce((sum, f) => sum + f.deletions, 0) ?? 0;

  return (
    // DialogContent's base `sm:max-w-sm` needs `!` to lose, as in the runs dialog.
    <DialogContent className="flex !h-[min(56rem,calc(100%-4rem))] !w-[calc(100%-4rem)] !max-w-5xl flex-col !gap-0 overflow-hidden !p-0">
      <DialogHeader className="px-6 pt-5 pb-4">
        <DialogTitle>{title}</DialogTitle>
        <div className="flex min-w-0 items-center gap-3 pr-8">
          <DialogDescription className="min-w-0 flex-1 truncate font-mono">{subtitle}</DialogDescription>
          {files && files.length > 0 && (
            <span className="shrink-0 text-micro text-muted-foreground tabular-nums">
              {t(($) => $.local_changes.files_count, { count: files.length })}
              {" · "}
              <span className="text-success">+{additions}</span>{" "}
              <span className="text-destructive">−{deletions}</span>
            </span>
          )}
          <IconButton
            size="icon-xs"
            variant="ghost"
            label={t(($) => $.local_changes.refresh)}
            onClick={onRefresh}
            disabled={refreshing}
            aria-busy={refreshing}
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin motion-reduce:animate-none")} />
          </IconButton>
        </div>
      </DialogHeader>
      {/* `min-h-0`: a flex item otherwise sizes to its content and never scrolls. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-5">{children}</div>
    </DialogContent>
  );
}

function FileList({ files, truncated }: { files: LocalGitDiffFile[]; truncated: boolean }) {
  const { t } = useT("projects");
  const expandAll = files.length <= EXPAND_ALL_UP_TO;
  return (
    <>
      {truncated && (
        <p className="text-caption text-muted-foreground">{t(($) => $.local_changes.truncated)}</p>
      )}
      <div className="flex flex-col gap-2">
        {files.map((file) => (
          <DiffFileSection key={`${file.status}:${file.path}`} file={file} defaultOpen={expandAll} />
        ))}
      </div>
    </>
  );
}

function CommitList({ commits }: { commits: LocalGitCommit[] }) {
  const { t } = useT("projects");
  if (commits.length === 0) return null;
  return (
    <section aria-label={t(($) => $.local_changes.commits)} className="rounded-md border px-3 py-2">
      <ol className="flex flex-col gap-1">
        {commits.map((commit) => {
          const origin = commit.origin;
          return (
            <li key={commit.sha} className="flex min-w-0 items-baseline gap-2 text-caption">
              <span className="shrink-0 font-mono text-micro text-faint-foreground">{commit.sha.slice(0, 8)}</span>
              <span className={cn("min-w-0 flex-1 truncate", origin !== "agent" && "text-muted-foreground")}>
                {commit.subject}
              </span>
              {origin !== "agent" && (
                <span className="shrink-0 text-micro text-muted-foreground">
                  {t(($) => $.local_changes.commit_origin[origin])}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function FailureNotice({ reason }: { reason: LocalGitFailureReason }) {
  const { t } = useT("projects");
  const key = (
    ["not_found", "not_a_repo", "no_commits", "branch_not_found", "git_unavailable", "unsupported"] as const
  ).find((known) => known === reason);
  return <Notice>{key ? t(($) => $.local_changes.error[key]) : t(($) => $.local_changes.error.generic)}</Notice>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-body text-muted-foreground">{children}</p>;
}

function ChangesSkeleton() {
  const { t } = useT("projects");
  return (
    <div role="status" aria-label={t(($) => $.local_changes.loading)} className="flex flex-col gap-2">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-2/3" />
    </div>
  );
}
