// Desktop-only git reads of the user's local folders (apps/desktop/src/main/local-git.ts).
// The desktop main process runs git on this machine; nothing here touches the
// Multica server. On web, where `window.desktopAPI` is absent, every call
// resolves to `unsupported`.

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
  old_line?: number;
  new_line?: number;
}

export interface LocalGitDiffHunk {
  header: string;
  lines: LocalGitDiffLine[];
}

export interface LocalGitDiffFile {
  path: string;
  old_path?: string;
  status: LocalGitFileStatus;
  binary: boolean;
  additions: number;
  deletions: number;
  hunks: LocalGitDiffHunk[];
  truncated: boolean;
}

export type LocalGitFailureReason =
  | "invalid_input"
  | "not_found"
  | "not_a_repo"
  | "no_commits"
  | "branch_not_found"
  | "git_unavailable"
  | "unsupported"
  | "error";

export interface LocalGitFailure {
  ok: false;
  reason: LocalGitFailureReason;
  /** Diagnostic text that may contain local paths; log it, never render it. */
  error?: string;
}

export type LocalGitCommitOrigin = "agent" | "baseline" | "carried_over";

export interface LocalGitCommit {
  sha: string;
  subject: string;
  origin: LocalGitCommitOrigin;
}

export type LocalGitWorkingCopyResult =
  | { ok: true; branch: string | null; files: LocalGitDiffFile[]; truncated: boolean }
  | LocalGitFailure;

export type LocalGitAgentBranchResult =
  | {
      ok: true;
      branch: string;
      merged: boolean;
      commits: LocalGitCommit[];
      files: LocalGitDiffFile[];
      truncated: boolean;
    }
  | LocalGitFailure;

interface DesktopLocalGitAPI {
  readLocalWorkingCopy?: (path: string) => Promise<LocalGitWorkingCopyResult>;
  readLocalAgentBranch?: (path: string, branch: string) => Promise<LocalGitAgentBranchResult>;
}

function readDesktopAPI(): DesktopLocalGitAPI | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { desktopAPI?: DesktopLocalGitAPI }).desktopAPI;
}

/** Whether this shell can read git in local folders (an older desktop build cannot). */
export function canReadLocalGit(): boolean {
  const api = readDesktopAPI();
  return (
    typeof api?.readLocalWorkingCopy === "function" &&
    typeof api.readLocalAgentBranch === "function"
  );
}

export async function readLocalWorkingCopy(path: string): Promise<LocalGitWorkingCopyResult> {
  const api = readDesktopAPI();
  if (!api?.readLocalWorkingCopy) return { ok: false, reason: "unsupported" };
  return api.readLocalWorkingCopy(path);
}

export async function readLocalAgentBranch(
  path: string,
  branch: string,
): Promise<LocalGitAgentBranchResult> {
  const api = readDesktopAPI();
  if (!api?.readLocalAgentBranch) return { ok: false, reason: "unsupported" };
  return api.readLocalAgentBranch(path, branch);
}
