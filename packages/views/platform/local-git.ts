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
  | "editor_unavailable"
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
  /** An equivalent change is already on the default branch. */
  in_default: boolean;
}

export type LocalGitWorkingCopyResult =
  | { ok: true; branch: string | null; files: LocalGitDiffFile[]; truncated: boolean }
  | LocalGitFailure;

export interface LocalGitAgentBranch {
  ok: true;
  branch: string;
  default_branch: string;
  merged: boolean;
  live: boolean;
  worktree_available: boolean;
  commits: LocalGitCommit[];
  commit: string | null;
  files: LocalGitDiffFile[];
  truncated: boolean;
}

export type LocalGitAgentBranchResult = LocalGitAgentBranch | LocalGitFailure;

export interface LocalGitAgentBranchOptions {
  commit?: string;
  file?: string;
  fullContext?: boolean;
  live?: boolean;
}

export interface LocalGitWorkingCopyOptions {
  file?: string;
  fullContext?: boolean;
}

export interface LocalGitBranchSummary {
  name: string;
  issue_key: string | null;
  agent_segment: string;
  agent_id: string | null;
  merged: boolean;
  live: boolean;
  files: number;
  additions: number;
  deletions: number;
}

export type LocalGitAgentBranchesResult =
  | { ok: true; default_branch: string; branches: LocalGitBranchSummary[] }
  | LocalGitFailure;

export type LocalGitEditor = "xcode" | "vscode" | "finder";

export interface LocalGitOpenFileRequest {
  folder: string;
  branch?: string;
  path: string;
  line?: number;
  app: LocalGitEditor;
}

export type LocalGitOpenFileResult = { ok: true } | LocalGitFailure;

interface DesktopLocalGitAPI {
  readLocalWorkingCopy?: (path: string, options?: LocalGitWorkingCopyOptions) => Promise<LocalGitWorkingCopyResult>;
  readLocalAgentBranch?: (
    path: string,
    branch: string,
    options?: LocalGitAgentBranchOptions,
  ) => Promise<LocalGitAgentBranchResult>;
  listLocalAgentBranches?: (path: string) => Promise<LocalGitAgentBranchesResult>;
  openLocalFile?: (request: LocalGitOpenFileRequest) => Promise<LocalGitOpenFileResult>;
  localEditors?: () => Promise<LocalGitEditor[]>;
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

/** Whether this shell can summarise agent branches (needed by the issue section and card badge). */
export function canListLocalAgentBranches(): boolean {
  return canReadLocalGit() && typeof readDesktopAPI()?.listLocalAgentBranches === "function";
}

export async function readLocalWorkingCopy(
  path: string,
  options?: LocalGitWorkingCopyOptions,
): Promise<LocalGitWorkingCopyResult> {
  const api = readDesktopAPI();
  if (!api?.readLocalWorkingCopy) return { ok: false, reason: "unsupported" };
  return api.readLocalWorkingCopy(path, options);
}

export async function readLocalAgentBranch(
  path: string,
  branch: string,
  options?: LocalGitAgentBranchOptions,
): Promise<LocalGitAgentBranchResult> {
  const api = readDesktopAPI();
  if (!api?.readLocalAgentBranch) return { ok: false, reason: "unsupported" };
  return api.readLocalAgentBranch(path, branch, options);
}

export async function listLocalAgentBranches(path: string): Promise<LocalGitAgentBranchesResult> {
  const api = readDesktopAPI();
  if (!api?.listLocalAgentBranches) return { ok: false, reason: "unsupported" };
  return api.listLocalAgentBranches(path);
}

export async function openLocalFile(request: LocalGitOpenFileRequest): Promise<LocalGitOpenFileResult> {
  const api = readDesktopAPI();
  if (!api?.openLocalFile) return { ok: false, reason: "unsupported" };
  return api.openLocalFile(request);
}

export async function localEditors(): Promise<LocalGitEditor[]> {
  const api = readDesktopAPI();
  if (!api?.localEditors) return [];
  return api.localEditors();
}
