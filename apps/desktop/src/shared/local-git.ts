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
  | "editor_unavailable"
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
  /**
   * An equivalent change is already on the default branch. The Merger
   * cherry-picks agent commits, so this, not ancestry, is what "merged" means.
   */
  in_default: boolean;
}

export interface LocalGitAgentBranch {
  ok: true;
  branch: string;
  /** The branch agent work is merged into: main, else master, else HEAD. */
  default_branch: string;
  /** Every agent commit already has an equivalent on the default branch. */
  merged: boolean;
  /** The files include the uncommitted state of the run's live worktree. */
  live: boolean;
  /** A run has this branch checked out right now, so its files are on disk. */
  worktree_available: boolean;
  /** Commits from the baseline on, oldest first. */
  commits: LocalGitCommit[];
  /** The commit this diff shows on its own, when one was asked for. */
  commit: string | null;
  files: LocalGitDiffFile[];
  truncated: boolean;
}

export interface LocalGitAgentBranchOptions {
  /** Show one commit of the branch on its own. */
  commit?: string;
  /** Limit the diff to one repository-relative path. */
  file?: string;
  /** With `file`: the whole file as context instead of three lines. */
  fullContext?: boolean;
  /** Include the live worktree's uncommitted and untracked changes. */
  live?: boolean;
}

export interface LocalGitWorkingCopyOptions {
  file?: string;
  fullContext?: boolean;
}

export interface LocalGitBranchSummary {
  name: string;
  /** Lowercase issue key the branch was created for (`siri-118`), if any. */
  issue_key: string | null;
  /** The sanitized agent name segment of the branch. */
  agent_segment: string;
  /** Agent id from the daemon's branch record; may belong to another server. */
  agent_id: string | null;
  merged: boolean;
  live: boolean;
  files: number;
  additions: number;
  deletions: number;
}

export interface LocalGitAgentBranches {
  ok: true;
  default_branch: string;
  branches: LocalGitBranchSummary[];
}

export type LocalGitEditor = "xcode" | "vscode" | "finder";

export interface LocalGitOpenFileRequest {
  /** The project folder; the file is resolved inside its repository. */
  folder: string;
  /** Open the file from this branch's live worktree instead of the folder. */
  branch?: string;
  /** Repository-relative path. */
  path: string;
  line?: number;
  app: LocalGitEditor;
}

export type LocalGitWorkingCopyResult = LocalGitWorkingCopy | LocalGitFailure;
export type LocalGitAgentBranchResult = LocalGitAgentBranch | LocalGitFailure;
export type LocalGitAgentBranchesResult = LocalGitAgentBranches | LocalGitFailure;
export type LocalGitOpenFileResult = { ok: true } | LocalGitFailure;
