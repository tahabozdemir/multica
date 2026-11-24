import { ipcMain } from "electron";
import { spawn } from "child_process";
import { lstat, open, realpath, stat } from "fs/promises";
import { isAbsolute, resolve, sep } from "path";
import { DEFAULT_PARSE_LIMITS, parseGitDiff, untrackedFileDiff } from "./local-git-diff";
import type {
  LocalGitAgentBranchResult,
  LocalGitCommit,
  LocalGitCommitOrigin,
  LocalGitDiffFile,
  LocalGitFailure,
  LocalGitWorkingCopyResult,
} from "../shared/local-git";

// Read-only git views of the user's own repositories: the uncommitted changes
// in a project's local folder, and the work an agent delivered on its
// `agent/...` branch. Everything runs here in the main process against the
// local disk; no diff is sent to the Multica server or anywhere else.


const GIT_TIMEOUT_MS = 20_000;
const MAX_DIFF_BYTES = 4 * 1024 * 1024;
const MAX_LOG_COMMITS = 200;
const MAX_UNTRACKED_FILES = 300;
const MAX_UNTRACKED_FILE_BYTES = 256 * 1024;
const MAX_UNTRACKED_TOTAL_BYTES = 4 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8000;

const BASELINE_SUBJECT_PREFIX = "chore(agent): baseline";
const CARRIED_OVER_SUBJECT =
  "chore(agent): uncommitted work from the local directory since the previous turn";

// Settings a user's git config could set that would change what these
// commands print or make them run something: quoted non-ASCII paths, an
// fsmonitor hook, path rewriting relative to the working directory.
const SAFE_CONFIG = [
  "-c", "core.quotepath=false",
  "-c", "core.fsmonitor=false",
  "-c", "diff.relative=false",
  "-c", "color.ui=false",
];

// Fixed prefixes override `diff.noprefix` / `diff.mnemonicPrefix`; the other
// flags keep external diff drivers and textconv filters from running.
const DIFF_FLAGS = [
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--find-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

interface GitOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

class GitUnavailableError extends Error {}

function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Never take index.lock for a status refresh: the user (or an agent) may
    // be committing in this repo at the same time.
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY"]) {
    delete env[key];
  }
  return env;
}

function runGit(
  args: string[],
  cwd: string,
  maxBytes = 256 * 1024,
): Promise<GitOutput> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", [...SAFE_CONFIG, ...args], {
      cwd,
      env: gitEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`git ${args[0]} timed out`));
    }, GIT_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      if (truncated) return;
      const room = maxBytes - size;
      if (chunk.length > room) {
        chunks.push(chunk.subarray(0, room));
        size = maxBytes;
        truncated = true;
        child.kill("SIGTERM");
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(err.code === "ENOENT" ? new GitUnavailableError(err.message) : err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let stdout = Buffer.concat(chunks).toString("utf8");
      // A cut can land inside a line; drop the partial one.
      if (truncated) stdout = stdout.slice(0, stdout.lastIndexOf("\n") + 1);
      resolvePromise({ code: truncated ? 0 : code, stdout, stderr, truncated });
    });
  });
}

async function gitLine(args: string[], cwd: string): Promise<string | null> {
  const out = await runGit(args, cwd);
  if (out.code !== 0) return null;
  const line = out.stdout.trim();
  return line.length > 0 ? line : null;
}

function failure(err: unknown): LocalGitFailure {
  if (err instanceof GitUnavailableError) {
    return { ok: false, reason: "git_unavailable", error: err.message };
  }
  return { ok: false, reason: "error", error: err instanceof Error ? err.message : String(err) };
}

/** Validates the folder and resolves the top of its git working tree. */
async function openRepository(
  folder: unknown,
): Promise<{ folder: string; root: string } | LocalGitFailure> {
  if (typeof folder !== "string" || !isAbsolute(folder)) {
    return { ok: false, reason: "invalid_input" };
  }
  try {
    if (!(await stat(folder)).isDirectory()) return { ok: false, reason: "not_found" };
  } catch {
    return { ok: false, reason: "not_found" };
  }
  const root = await gitLine(["rev-parse", "--show-toplevel"], folder);
  if (!root) return { ok: false, reason: "not_a_repo" };
  return { folder, root: await realpath(root) };
}

/** Uncommitted changes, untracked files included, under `folder`. */
export async function readWorkingCopy(folder: unknown): Promise<LocalGitWorkingCopyResult> {
  try {
    const repo = await openRepository(folder);
    if ("ok" in repo) return repo;

    const head = await gitLine(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], repo.folder);
    // An unborn branch has no HEAD to compare with; the empty tree stands in.
    const base = head ?? (await gitLine(["hash-object", "-t", "tree", "/dev/null"], repo.folder));
    if (!base) return { ok: false, reason: "error", error: "could not resolve a base tree" };

    const diff = await runGit([...DIFF_FLAGS, base, "--", "."], repo.folder, MAX_DIFF_BYTES);
    if (diff.code !== 0) return { ok: false, reason: "error", error: diff.stderr.trim() };
    const files = parseGitDiff(diff.stdout);

    const untracked = await readUntracked(repo);
    const branch = await gitLine(["symbolic-ref", "--quiet", "--short", "HEAD"], repo.folder);
    return {
      ok: true,
      branch,
      files: [...files, ...untracked.files],
      truncated: diff.truncated || untracked.truncated,
    };
  } catch (err) {
    return failure(err);
  }
}

async function readUntracked(repo: {
  folder: string;
  root: string;
}): Promise<{ files: LocalGitDiffFile[]; truncated: boolean }> {
  const out = await runGit(
    ["ls-files", "--others", "--exclude-standard", "--full-name", "-z", "--", "."],
    repo.folder,
    MAX_DIFF_BYTES,
  );
  if (out.code !== 0) return { files: [], truncated: false };
  const paths = out.stdout.split("\0").filter(Boolean).sort();
  let truncated = out.truncated || paths.length > MAX_UNTRACKED_FILES;
  let budget = MAX_UNTRACKED_TOTAL_BYTES;
  const files: LocalGitDiffFile[] = [];

  for (const path of paths.slice(0, MAX_UNTRACKED_FILES)) {
    const listed: LocalGitDiffFile = {
      path,
      status: "untracked",
      binary: false,
      additions: 0,
      deletions: 0,
      hunks: [],
      truncated: false,
    };
    const absolute = resolve(repo.root, path);
    // git only lists paths inside the work tree; refuse anything else anyway.
    if (!absolute.startsWith(repo.root + sep)) continue;
    const info = await lstat(absolute).catch(() => null);
    if (!info?.isFile()) {
      files.push(listed);
      continue;
    }
    if (budget <= 0) {
      files.push({ ...listed, truncated: true });
      truncated = true;
      continue;
    }
    const limit = Math.min(MAX_UNTRACKED_FILE_BYTES, budget);
    const bytes = await readHead(absolute, limit);
    budget -= bytes.length;
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      files.push({ ...listed, binary: true });
      continue;
    }
    const diff = untrackedFileDiff(path, bytes.toString("utf8"), DEFAULT_PARSE_LIMITS);
    if (info.size > bytes.length) {
      diff.truncated = true;
      truncated = true;
    }
    files.push(diff);
  }
  return { files, truncated };
}

async function readHead(path: string, limit: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

const AGENT_BRANCH = /^[A-Za-z0-9._/-]+$/;

function isAgentBranchName(branch: unknown): branch is string {
  return (
    typeof branch === "string" &&
    branch.length > 0 &&
    branch.length <= 255 &&
    AGENT_BRANCH.test(branch) &&
    !branch.startsWith("-") &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.endsWith(".lock") &&
    !branch.includes("..") &&
    !branch.includes("//")
  );
}

export function commitOrigin(subject: string): LocalGitCommitOrigin {
  if (subject.startsWith(BASELINE_SUBJECT_PREFIX)) return "baseline";
  if (subject === CARRIED_OVER_SUBJECT) return "carried_over";
  return "agent";
}

/**
 * What merging `branch` into the checked-out HEAD would bring. When the
 * branch opens with the daemon's baseline commit, the diff starts after it,
 * so the folder's state at the start of the first run is not shown as the
 * agent's work.
 */
export async function readAgentBranch(
  folder: unknown,
  branch: unknown,
): Promise<LocalGitAgentBranchResult> {
  if (!isAgentBranchName(branch)) return { ok: false, reason: "invalid_input" };
  try {
    const repo = await openRepository(folder);
    if ("ok" in repo) return repo;

    const tip = await gitLine(
      ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`],
      repo.root,
    );
    if (!tip) return { ok: false, reason: "branch_not_found" };
    const head = await gitLine(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], repo.root);
    if (!head) return { ok: false, reason: "no_commits" };
    const mergeBase = await gitLine(["merge-base", head, tip], repo.root);
    if (!mergeBase) return { ok: false, reason: "error", error: "branch shares no history with HEAD" };

    if (mergeBase === tip) {
      return { ok: true, branch, merged: true, commits: [], files: [], truncated: false };
    }

    const log = await runGit(
      [
        "log",
        "--first-parent",
        "--no-color",
        `--max-count=${MAX_LOG_COMMITS}`,
        "--format=%H%x1f%s%x1e",
        `${mergeBase}..${tip}`,
      ],
      repo.root,
    );
    const commits: LocalGitCommit[] = log.stdout
      .split("\x1e")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [sha = "", subject = ""] = entry.split("\x1f");
        return { sha, subject, origin: commitOrigin(subject) };
      })
      .reverse();

    const first = commits[0];
    const base = first?.origin === "baseline" ? first.sha : mergeBase;
    const diff = await runGit([...DIFF_FLAGS, base, tip], repo.root, MAX_DIFF_BYTES);
    if (diff.code !== 0) return { ok: false, reason: "error", error: diff.stderr.trim() };
    return {
      ok: true,
      branch,
      merged: false,
      commits,
      files: parseGitDiff(diff.stdout),
      truncated: diff.truncated || log.truncated || commits.length >= MAX_LOG_COMMITS,
    };
  } catch (err) {
    return failure(err);
  }
}

export function setupLocalGit(): void {
  ipcMain.handle("local-git:working-copy", (_event, folder: unknown) => readWorkingCopy(folder));
  ipcMain.handle("local-git:agent-branch", (_event, folder: unknown, branch: unknown) =>
    readAgentBranch(folder, branch),
  );
}
