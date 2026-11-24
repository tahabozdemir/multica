// Shapes the local-git IPC returns (main/local-git.ts). Shared with the preload
// declarations so the renderer types them without importing main-process code.

export type LocalGitFileStatus =
  | "added"
  | "deleted"
  | "modified"
  | "renamed"
  | "copied"
  | "untracked";

export interface LocalGitDiffLine {
  kind: "add" | "remove" | "context";
  text: string;
  /** Line number on the old side; absent on added lines. */
  old_line?: number;
  /** Line number on the new side; absent on removed lines. */
  new_line?: number;
}

export interface LocalGitDiffHunk {
  /** The `@@ -a,b +c,d @@ context` line as git printed it. */
  header: string;
  lines: LocalGitDiffLine[];
}

export interface LocalGitDiffFile {
  /** Repository-relative path on the new side (the old one for a deletion). */
  path: string;
  /** Repository-relative path before a rename or copy. */
  old_path?: string;
  status: LocalGitFileStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: LocalGitDiffHunk[];
  /** Lines were dropped to stay under the per-file limit; counts stay exact. */
  truncated: boolean;
}

export type LocalGitFailureReason =
  | "invalid_input"
  | "not_found"
  | "not_a_repo"
  | "no_commits"
  | "branch_not_found"
  | "git_unavailable"
  | "error";

export interface LocalGitFailure {
  ok: false;
  reason: LocalGitFailureReason;
  /** Diagnostic text for logs. May contain local paths; never render it. */
  error?: string;
}

export interface LocalGitWorkingCopy {
  ok: true;
  /** Checked-out branch, or null on a detached HEAD. */
  branch: string | null;
  files: LocalGitDiffFile[];
  /** Some output was dropped to stay under the size limits. */
  truncated: boolean;
}

/**
 * Where a commit on an agent branch came from. The daemon writes the first two
 * with fixed subjects (server/internal/daemon/execenv/local_worktree.go):
 * `baseline` records the folder's state when the branch started, and
 * `carried_over` is the user's own uncommitted work replayed between runs.
 */
export type LocalGitCommitOrigin = "agent" | "baseline" | "carried_over";

export interface LocalGitCommit {
  sha: string;
  subject: string;
  origin: LocalGitCommitOrigin;
}

export interface LocalGitAgentBranch {
  ok: true;
  branch: string;
  /** The branch tip is already part of the checked-out HEAD. */
  merged: boolean;
  /** Commits not yet in HEAD, oldest first. */
  commits: LocalGitCommit[];
  files: LocalGitDiffFile[];
  truncated: boolean;
}

export type LocalGitWorkingCopyResult = LocalGitWorkingCopy | LocalGitFailure;
export type LocalGitAgentBranchResult = LocalGitAgentBranch | LocalGitFailure;
