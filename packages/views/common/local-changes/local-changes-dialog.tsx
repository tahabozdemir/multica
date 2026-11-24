"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Columns2, RefreshCw, Rows3 } from "@multica/ui/icons";
import { IconButton } from "@multica/ui/components/common/icon-button";
import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { cn } from "@multica/ui/lib/utils";
import { isEditableShortcutTarget } from "@multica/core/shortcuts";
import { isImeComposing } from "@multica/core/utils";
import {
  diffFingerprint,
  useLocalChangesReviewStore,
} from "@multica/core/local-changes/review-store";
import {
  localEditors,
  openLocalFile,
  readLocalAgentBranch,
  readLocalWorkingCopy,
  type LocalGitAgentBranchOptions,
  type LocalGitAgentBranchResult,
  type LocalGitCommit,
  type LocalGitDiffFile,
  type LocalGitEditor,
  type LocalGitFailureReason,
  type LocalGitWorkingCopyResult,
} from "../../platform/local-git";
import { useT } from "../../i18n";
import { DiffFileSection } from "./diff-file-section";
import { DiffFileList } from "./diff-file-list";

/** Files at or under this count open expanded; longer lists start collapsed. */
const EXPAND_ALL_UP_TO = 8;
/** How often a live run's worktree is read again while the dialog is open. */
const LIVE_REFRESH_MS = 5000;

export const localGitKeys = {
  all: ["local-git"] as const,
  workingCopy: (path: string, options: object = {}) => ["local-git", "working-copy", path, options] as const,
  agentBranch: (path: string, branch: string, options: object = {}) =>
    ["local-git", "agent-branch", path, branch, options] as const,
  agentBranches: (path: string) => ["local-git", "agent-branches", path] as const,
  editors: ["local-git", "editors"] as const,
};

// Read from disk on every open: the folder changes outside Multica, so a
// cached answer would be stale the moment the user edits a file.
const freshLocalRead = { staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: false } as const;

type DiffSource =
  | { kind: "working-copy"; path: string; label: string }
  | { kind: "agent-branch"; path: string; branch: string };

type DiffResult = LocalGitWorkingCopyResult | LocalGitAgentBranchResult;

function readSource(source: DiffSource, options: LocalGitAgentBranchOptions): Promise<DiffResult> {
  if (source.kind === "working-copy") {
    return readLocalWorkingCopy(source.path, options.file ? { file: options.file, fullContext: options.fullContext } : undefined);
  }
  return readLocalAgentBranch(source.path, source.branch, options);
}

function sourceKey(source: DiffSource, options: LocalGitAgentBranchOptions) {
  return source.kind === "working-copy"
    ? localGitKeys.workingCopy(source.path, options)
    : localGitKeys.agentBranch(source.path, source.branch, options);
}

/** Changes a viewed mark is tied to: a new version of the diff clears it. */
function fileFingerprint(file: LocalGitDiffFile): string {
  return diffFingerprint(
    [file.status, file.old_path ?? "", file.binary ? "binary" : "", ...file.hunks.flatMap((h) => [h.header, ...h.lines.map((l) => l.kind[0] + l.text)])].join("\n"),
  );
}

/** Content for a `<Dialog>`: the uncommitted changes in a local folder. */
export function WorkingCopyChangesDialogContent({ path, label }: { path: string; label: string }) {
  return <ChangesDialog source={{ kind: "working-copy", path, label }} />;
}

/** Content for a `<Dialog>`: an agent branch's work, compared with the default branch. */
export function AgentBranchChangesDialogContent({ path, branch }: { path: string; branch: string }) {
  return <ChangesDialog source={{ kind: "agent-branch", path, branch }} />;
}

function ChangesDialog({ source }: { source: DiffSource }) {
  const { t } = useT("projects");
  const [commit, setCommit] = useState<string | null>(null);
  const options: LocalGitAgentBranchOptions =
    source.kind === "agent-branch" ? (commit ? { commit } : { live: true }) : {};
  const query = useQuery({
    queryKey: sourceKey(source, options),
    queryFn: () => readSource(source, options),
    ...freshLocalRead,
    refetchOnWindowFocus: source.kind === "working-copy",
    refetchInterval: (q) => {
      const data = q.state.data;
      return data?.ok && "live" in data && data.live ? LIVE_REFRESH_MS : false;
    },
  });
  const result = query.data;
  const branchResult = result?.ok && "commits" in result ? result : null;
  const files = result?.ok ? result.files : undefined;
  const layout = useLocalChangesReviewStore((s) => s.layout);
  const setLayout = useLocalChangesReviewStore((s) => s.setLayout);
  const keyHandler = useRef<((event: React.KeyboardEvent) => void) | null>(null);

  const subtitle =
    source.kind === "working-copy"
      ? result?.ok && "branch" in result && result.branch
        ? `${source.label} · ${result.branch}`
        : source.label
      : source.branch;
  const additions = files?.reduce((sum, f) => sum + f.additions, 0) ?? 0;
  const deletions = files?.reduce((sum, f) => sum + f.deletions, 0) ?? 0;

  return (
    // DialogContent's base `sm:max-w-sm` needs `!` to lose, as in the runs dialog.
    <DialogContent
      className="flex !h-[min(56rem,calc(100%-4rem))] !w-[calc(100%-4rem)] !max-w-6xl flex-col !gap-0 overflow-hidden !p-0"
      onKeyDown={(event) => keyHandler.current?.(event)}
    >
      <DialogHeader className="border-b px-6 pt-5 pb-4">
        <DialogTitle>
          {source.kind === "working-copy"
            ? t(($) => $.local_changes.working_copy_title)
            : t(($) => $.local_changes.agent_branch_title)}
        </DialogTitle>
        <div className="flex min-w-0 items-center gap-3 pr-8">
          <DialogDescription className="min-w-0 flex-1 truncate font-mono">{subtitle}</DialogDescription>
          {branchResult?.live && (
            <span
              className="flex shrink-0 items-center gap-1.5 text-micro text-success"
              title={t(($) => $.local_changes.live_hint)}
            >
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              {t(($) => $.local_changes.live)}
            </span>
          )}
          {files && files.length > 0 && (
            <span className="shrink-0 text-micro text-muted-foreground tabular-nums">
              {t(($) => $.local_changes.files_count, { count: files.length })}
              {" · "}
              <span className="text-success">+{additions}</span>{" "}
              <span className="text-destructive">−{deletions}</span>
            </span>
          )}
          <div className="flex shrink-0 items-center" role="group" aria-label={t(($) => $.local_changes.layout_label)}>
            <IconButton
              size="icon-xs"
              variant="ghost"
              label={t(($) => $.local_changes.layout_unified)}
              aria-pressed={layout === "unified"}
              className={cn(layout === "unified" && "bg-muted text-foreground")}
              onClick={() => setLayout("unified")}
            >
              <Rows3 className="size-3.5" />
            </IconButton>
            <IconButton
              size="icon-xs"
              variant="ghost"
              label={t(($) => $.local_changes.layout_split)}
              aria-pressed={layout === "split"}
              className={cn(layout === "split" && "bg-muted text-foreground")}
              onClick={() => setLayout("split")}
            >
              <Columns2 className="size-3.5" />
            </IconButton>
          </div>
          <IconButton
            size="icon-xs"
            variant="ghost"
            label={t(($) => $.local_changes.refresh)}
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            aria-busy={query.isFetching}
          >
            <RefreshCw className={cn("size-3.5", query.isFetching && "animate-spin motion-reduce:animate-none")} />
          </IconButton>
        </div>
      </DialogHeader>

      {query.isPending ? (
        <div className="px-6 py-4">
          <ChangesSkeleton />
        </div>
      ) : !result || !result.ok ? (
        <div className="px-6 py-4">
          <FailureNotice reason={result?.ok === false ? result.reason : "error"} />
        </div>
      ) : (
        <ReviewBody
          // A different commit is a different set of files: start fresh.
          key={commit ?? "all"}
          source={source}
          options={options}
          files={result.files}
          truncated={result.truncated}
          branch={branchResult}
          selectedCommit={commit}
          onSelectCommit={setCommit}
          layout={layout}
          registerKeyHandler={(handler) => {
            keyHandler.current = handler;
          }}
        />
      )}
    </DialogContent>
  );
}

function ReviewBody({
  source,
  options,
  files,
  truncated,
  branch,
  selectedCommit,
  onSelectCommit,
  layout,
  registerKeyHandler,
}: {
  source: DiffSource;
  options: LocalGitAgentBranchOptions;
  files: LocalGitDiffFile[];
  truncated: boolean;
  branch: Extract<LocalGitAgentBranchResult, { ok: true }> | null;
  selectedCommit: string | null;
  onSelectCommit: (sha: string | null) => void;
  layout: "unified" | "split";
  registerKeyHandler: (handler: ((event: React.KeyboardEvent) => void) | null) => void;
}) {
  const { t } = useT("projects");
  const scope = `${source.path}::${source.kind === "agent-branch" ? source.branch : "working-copy"}`;
  const viewedMap = useLocalChangesReviewStore((s) => s.viewed);
  const setViewed = useLocalChangesReviewStore((s) => s.setViewed);
  const fingerprints = useMemo(() => files.map(fileFingerprint), [files]);
  const viewed = files.map((file, i) => viewedMap[`${scope}::${file.path}`] === fingerprints[i]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openState, setOpenState] = useState<Record<string, boolean>>({});
  const [fullFiles, setFullFiles] = useState<Record<string, boolean>>({});
  const sections = useRef(new Map<string, HTMLDivElement>());
  const editorsQuery = useQuery({ queryKey: localGitKeys.editors, queryFn: localEditors, staleTime: Infinity });

  const expandAll = files.length <= EXPAND_ALL_UP_TO;
  const isOpen = (index: number) => {
    const file = files[index];
    if (!file) return false;
    return openState[file.path] ?? (expandAll && !viewed[index]);
  };

  const select = useCallback(
    (index: number) => {
      const file = files[index];
      if (!file) return;
      setActiveIndex(index);
      setOpenState((state) => ({ ...state, [file.path]: true }));
      requestAnimationFrame(() => sections.current.get(file.path)?.scrollIntoView({ block: "start" }));
    },
    [files],
  );

  const markViewed = useCallback(
    (index: number, value: boolean) => {
      const file = files[index];
      const fingerprint = fingerprints[index];
      if (!file || !fingerprint) return;
      setViewed(`${scope}::${file.path}`, fingerprint, value);
      // A file marked viewed folds away; unmarking leaves it as it is.
      if (value) setOpenState((state) => ({ ...state, [file.path]: false }));
    },
    [files, fingerprints, scope, setViewed],
  );

  useEffect(() => {
    registerKeyHandler((event) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isImeComposing(event) ||
        isEditableShortcutTarget(event.target)
      ) {
        return;
      }
      if (files.length === 0) return;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        const next = Math.min(files.length - 1, Math.max(0, activeIndex + (event.key === "j" ? 1 : -1)));
        select(next);
      } else if (event.key === "v") {
        event.preventDefault();
        markViewed(activeIndex, !viewed[activeIndex]);
      }
    });
    return () => registerKeyHandler(null);
  }, [activeIndex, files.length, markViewed, registerKeyHandler, select, viewed]);

  const canOpenFiles =
    source.kind === "working-copy" || (branch?.worktree_available === true && selectedCommit === null);
  const editors = canOpenFiles ? (editorsQuery.data ?? []) : [];
  const openIn = (file: LocalGitDiffFile, app: LocalGitEditor, line?: number) => {
    void openLocalFile({
      folder: source.path,
      branch: source.kind === "agent-branch" ? source.branch : undefined,
      path: file.path,
      line,
      app,
    }).then((res) => {
      if (!res.ok) toast.error(t(($) => $.local_changes.open_failed));
    });
  };

  const carriesUserWork = branch?.commits.some((c) => c.origin === "carried_over") ?? false;

  return (
    <div className="flex min-h-0 flex-1">
      {files.length > 0 && (
        <aside className="flex w-64 shrink-0 flex-col border-r">
          <DiffFileList files={files} activeIndex={activeIndex} viewed={viewed} onSelect={select} />
        </aside>
      )}
      {/* `min-h-0`: a flex item otherwise sizes to its content and never scrolls. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {branch && branch.commits.length > 0 && (
          <CommitPicker
            commits={branch.commits}
            defaultBranch={branch.default_branch}
            selected={selectedCommit}
            onSelect={onSelectCommit}
          />
        )}
        {branch?.merged && (
          <Notice>{t(($) => $.local_changes.merged_into, { branch: branch.default_branch })}</Notice>
        )}
        {carriesUserWork && selectedCommit === null && (
          <p className="text-caption text-muted-foreground">{t(($) => $.local_changes.carried_over_note)}</p>
        )}
        {truncated && <p className="text-caption text-muted-foreground">{t(($) => $.local_changes.truncated)}</p>}
        {files.length === 0 ? (
          <Notice>
            {source.kind === "working-copy"
              ? t(($) => $.local_changes.empty_working_copy)
              : t(($) => $.local_changes.empty_branch)}
          </Notice>
        ) : (
          <div className="flex flex-col gap-2">
            {files.map((file, index) => (
              <FileEntry
                key={`${file.status}:${file.path}`}
                ref={(node) => {
                  if (node) sections.current.set(file.path, node);
                  else sections.current.delete(file.path);
                }}
                source={source}
                options={options}
                file={file}
                open={isOpen(index)}
                onOpenChange={(open) => {
                  setActiveIndex(index);
                  setOpenState((state) => ({ ...state, [file.path]: open }));
                }}
                active={index === activeIndex}
                viewed={viewed[index] ?? false}
                onViewedChange={(value) => markViewed(index, value)}
                layout={layout}
                fullShown={fullFiles[file.path] ?? false}
                onToggleFull={() => setFullFiles((state) => ({ ...state, [file.path]: !state[file.path] }))}
                editors={file.status === "deleted" ? [] : editors}
                onOpenIn={(app, line) => openIn(file, app, line)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One file of the review. Asking for its whole content reads just that file
 * again with full context; the rest of the diff is untouched.
 */
function FileEntry({
  ref,
  source,
  options,
  file,
  fullShown,
  onToggleFull,
  ...section
}: {
  ref: (node: HTMLDivElement | null) => void;
  source: DiffSource;
  options: LocalGitAgentBranchOptions;
  file: LocalGitDiffFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: boolean;
  viewed: boolean;
  onViewedChange: (viewed: boolean) => void;
  layout: "unified" | "split";
  fullShown: boolean;
  onToggleFull: () => void;
  editors: LocalGitEditor[];
  onOpenIn: (app: LocalGitEditor, line?: number) => void;
}) {
  const offersFull = !file.binary && file.status !== "untracked" && file.status !== "added" && file.status !== "deleted";
  const fullOptions = { ...options, file: file.path, fullContext: true };
  const full = useQuery({
    queryKey: sourceKey(source, fullOptions),
    queryFn: () => readSource(source, fullOptions),
    enabled: offersFull && fullShown,
    ...freshLocalRead,
  });
  const fullFile = full.data?.ok ? full.data.files.find((f) => f.path === file.path) : undefined;
  const shown = fullShown && fullFile ? fullFile : file;

  return (
    <DiffFileSection
      ref={ref}
      {...section}
      file={shown}
      fullFile={offersFull ? { shown: fullShown, loading: fullShown && full.isFetching, toggle: onToggleFull } : null}
    />
  );
}

function CommitPicker({
  commits,
  defaultBranch,
  selected,
  onSelect,
}: {
  commits: LocalGitCommit[];
  defaultBranch: string;
  selected: string | null;
  onSelect: (sha: string | null) => void;
}) {
  const { t } = useT("projects");
  const row = "flex w-full min-w-0 items-baseline gap-2 rounded-xs px-2 py-1 text-left text-caption transition-colors hover:bg-accent/40";
  return (
    <section aria-label={t(($) => $.local_changes.commits)} className="rounded-md border p-1">
      <ol className="flex max-h-40 flex-col overflow-y-auto">
        <li>
          <button
            type="button"
            aria-pressed={selected === null}
            onClick={() => onSelect(null)}
            className={cn(row, selected === null && "bg-accent hover:bg-accent")}
          >
            <span className="min-w-0 flex-1 truncate">{t(($) => $.local_changes.all_changes)}</span>
          </button>
        </li>
        {commits.map((commit) => {
          const origin = commit.origin;
          return (
            <li key={commit.sha}>
              <button
                type="button"
                aria-pressed={selected === commit.sha}
                onClick={() => onSelect(commit.sha)}
                className={cn(row, selected === commit.sha && "bg-accent hover:bg-accent")}
              >
                <span className="shrink-0 font-mono text-micro text-faint-foreground">{commit.sha.slice(0, 8)}</span>
                <span className={cn("min-w-0 flex-1 truncate", origin !== "agent" && "text-muted-foreground")}>
                  {commit.subject}
                </span>
                {origin !== "agent" && (
                  <span className="shrink-0 text-micro text-muted-foreground">
                    {t(($) => $.local_changes.commit_origin[origin])}
                  </span>
                )}
                {commit.in_default && origin === "agent" && (
                  <span className="shrink-0 text-micro text-success">
                    {t(($) => $.local_changes.in_default, { branch: defaultBranch })}
                  </span>
                )}
              </button>
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
