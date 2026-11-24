import { ipcMain, shell } from "electron";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { lstat, open, realpath, stat } from "fs/promises";
import { isAbsolute, resolve, sep } from "path";
import { DEFAULT_PARSE_LIMITS, parseGitDiff, untrackedFileDiff } from "./local-git-diff";
import type {
  LocalGitAgentBranchOptions,
  LocalGitAgentBranchResult,
  LocalGitAgentBranchesResult,
  LocalGitBranchSummary,
  LocalGitCommit,
  LocalGitCommitOrigin,
  LocalGitDiffFile,
  LocalGitEditor,
  LocalGitFailure,
  LocalGitOpenFileResult,
  LocalGitWorkingCopyOptions,
  LocalGitWorkingCopyResult,
} from "../shared/local-git";

// Read-only git views of the user's own repositories: the uncommitted changes
// in a project's local folder, and the work an agent delivered on its
// `agent/...` branch. Everything runs here in the main process against the
// local disk; no diff is sent to the Multica server or anywhere else.


const GIT_TIMEOUT_MS = 20_000;
const MAX_DIFF_BYTES = 4 * 1024 * 1024;
const MAX_LOG_COMMITS = 200;
const MAX_BRANCHES = 200;
const BRANCH_SUMMARY_CONCURRENCY = 4;
/** `-U` large enough that git prints a file whole. */
const FULL_CONTEXT_LINES = 1_000_000;
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

/**
 * A repository-relative path as a pathspec that git reads from the top of the
 * work tree and never as a glob, or null when the input is not such a path.
 */
function topLevelPathspec(file: unknown): string | null | undefined {
  if (file === undefined) return undefined;
  if (typeof file !== "string" || file.length === 0 || file.length > 4096) return null;
  if (file.includes("\0") || isAbsolute(file) || file.split(/[\\/]/).includes("..")) return null;
  return `:(top,literal)${file}`;
}

/** Uncommitted changes, untracked files included, under `folder`. */
export async function readWorkingCopy(
  folder: unknown,
  options: LocalGitWorkingCopyOptions = {},
): Promise<LocalGitWorkingCopyResult> {
  const pathspec = topLevelPathspec(options?.file);
  if (pathspec === null) return { ok: false, reason: "invalid_input" };
  try {
    const repo = await openRepository(folder);
    if ("ok" in repo) return repo;

    const head = await gitLine(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], repo.folder);
    // An unborn branch has no HEAD to compare with; the empty tree stands in.
    const base = head ?? (await emptyTree(repo.folder));
    if (!base) return { ok: false, reason: "error", error: "could not resolve a base tree" };

    const scope = pathspec ? [pathspec] : ["."];
    const context = pathspec && options.fullContext ? [`--unified=${FULL_CONTEXT_LINES}`] : [];
    const diff = await runGit([...DIFF_FLAGS, ...context, base, "--", ...scope], repo.folder, MAX_DIFF_BYTES);
    if (diff.code !== 0) return { ok: false, reason: "error", error: diff.stderr.trim() };
    const files = parseGitDiff(diff.stdout);

    const untracked = await readUntracked(repo, scope);
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

function emptyTree(cwd: string): Promise<string | null> {
  return gitLine(["hash-object", "-t", "tree", "/dev/null"], cwd);
}

async function readUntracked(
  repo: { folder: string; root: string },
  scope: string[] = ["."],
): Promise<{ files: LocalGitDiffFile[]; truncated: boolean }> {
  const out = await runGit(
    ["ls-files", "--others", "--exclude-standard", "--full-name", "-z", "--", ...scope],
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

/** The branch agent work is merged into: main, else master, else HEAD. */
async function defaultBranch(root: string): Promise<{ name: string; ref: string } | null> {
  for (const name of ["main", "master"]) {
    if (await gitLine(["rev-parse", "--verify", "--quiet", `refs/heads/${name}^{commit}`], root)) {
      return { name, ref: `refs/heads/${name}` };
    }
  }
  if (!(await gitLine(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], root))) return null;
  const name = await gitLine(["symbolic-ref", "--quiet", "--short", "HEAD"], root);
  return { name: name ?? "HEAD", ref: "HEAD" };
}

interface AgentRange {
  tip: string;
  /** Where the agent's own work starts: the first baseline, else the merge base. */
  base: string;
  /** Commits from the baseline on, oldest first. */
  commits: LocalGitCommit[];
  merged: boolean;
  truncated: boolean;
}

/**
 * The part of `branch` that is the agent's. A branch forks from whatever the
 * live checkout had out (not necessarily main), so commits before the first
 * baseline belong to that branch, not to the agent, and are left out.
 */
async function agentRange(
  root: string,
  defaultRef: string,
  tip: string,
): Promise<AgentRange | LocalGitFailure> {
  const mergeBase = await gitLine(["merge-base", defaultRef, tip], root);
  if (!mergeBase) return { ok: false, reason: "error", error: "branch shares no history with the default branch" };
  // Already part of the default branch's history (a real merge or fast-forward).
  if (mergeBase === tip) return { tip, base: tip, commits: [], merged: true, truncated: false };

  const log = await runGit(
    ["log", "--first-parent", "--no-color", `--max-count=${MAX_LOG_COMMITS}`, "--format=%H%x1f%s%x1e", `${mergeBase}..${tip}`],
    root,
  );
  // `git cherry` marks a commit "-" when an equivalent patch is already on the
  // default branch, which is how cherry-picked (merged) work shows.
  const cherry = await runGit(["cherry", defaultRef, tip, mergeBase], root);
  const inDefault = new Set(
    cherry.stdout.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2).trim()),
  );
  const all: LocalGitCommit[] = log.stdout
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha = "", subject = ""] = entry.split("\x1f");
      return { sha, subject, origin: commitOrigin(subject), in_default: inDefault.has(sha) };
    })
    .reverse();

  const baselineIndex = all.findIndex((c) => c.origin === "baseline");
  const commits = baselineIndex >= 0 ? all.slice(baselineIndex) : all;
  const base = baselineIndex >= 0 ? (all[baselineIndex] as LocalGitCommit).sha : mergeBase;
  const agentCommits = commits.filter((c) => c.origin === "agent");
  return {
    tip,
    base,
    commits,
    merged: agentCommits.length > 0 && agentCommits.every((c) => c.in_default),
    truncated: log.truncated || all.length >= MAX_LOG_COMMITS,
  };
}

/** Branch name → path of the worktree that has it checked out, for live runs. */
async function liveWorktrees(root: string): Promise<Map<string, string>> {
  const out = await runGit(["worktree", "list", "--porcelain", "-z"], root);
  const found = new Map<string, string>();
  if (out.code !== 0) return found;
  let path: string | null = null;
  for (const field of out.stdout.split("\0")) {
    if (field.startsWith("worktree ")) path = field.slice("worktree ".length);
    else if (field.startsWith("branch refs/heads/") && path) {
      found.set(field.slice("branch refs/heads/".length), path);
    } else if (field === "") path = null;
  }
  for (const [branch, wt] of found) {
    const real = await realpath(wt).catch(() => null);
    const isDir = real ? (await stat(real).catch(() => null))?.isDirectory() : false;
    if (!real || !isDir || real === root) found.delete(branch);
    else found.set(branch, real);
  }
  return found;
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

// `agent/<agent>/<issue key>`, where the daemon may append `-<12 hex>` (another
// owner had the name) or `-<number>` (a sibling run held it); see
// resolveTaskBranch in server/internal/daemon/execenv/local_worktree.go.
const AGENT_BRANCH_PARTS = /^agent\/([^/]+)\/([a-z0-9]{1,10}-\d+)(?:-[0-9a-f]{12}|-\d+)*$/;

export function parseAgentBranchName(name: string): { agent_segment: string; issue_key: string | null } | null {
  if (!name.startsWith("agent/")) return null;
  const match = AGENT_BRANCH_PARTS.exec(name);
  if (match) return { agent_segment: match[1] as string, issue_key: match[2] as string };
  const segment = name.split("/")[1];
  return segment ? { agent_segment: segment, issue_key: null } : null;
}

const SHA = /^[0-9a-f]{7,64}$/;

/**
 * The diff of an agent branch: what it would bring into the default branch,
 * from its baseline on. Options narrow it to one commit or one file, give a
 * file its full context, or include the live run's uncommitted work.
 */
export async function readAgentBranch(
  folder: unknown,
  branch: unknown,
  options: LocalGitAgentBranchOptions = {},
): Promise<LocalGitAgentBranchResult> {
  if (!isAgentBranchName(branch)) return { ok: false, reason: "invalid_input" };
  const pathspec = topLevelPathspec(options?.file);
  const commitArg = options?.commit;
  if (pathspec === null || (commitArg !== undefined && (typeof commitArg !== "string" || !SHA.test(commitArg)))) {
    return { ok: false, reason: "invalid_input" };
  }
  try {
    const repo = await openRepository(folder);
    if ("ok" in repo) return repo;
    const target = await defaultBranch(repo.root);
    if (!target) return { ok: false, reason: "no_commits" };
    const tip = await gitLine(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`], repo.root);
    if (!tip) return { ok: false, reason: "branch_not_found" };

    const range = await agentRange(repo.root, target.ref, tip);
    if ("ok" in range) return range;
    const worktree = (await liveWorktrees(repo.root)).get(branch) ?? null;

    const commit = commitArg ? range.commits.find((c) => c.sha.startsWith(commitArg)) : undefined;
    if (commitArg && !commit) return { ok: false, reason: "invalid_input" };

    const scope = pathspec ? ["--", pathspec] : [];
    const context = pathspec && options.fullContext ? [`--unified=${FULL_CONTEXT_LINES}`] : [];
    const live = Boolean(options.live && worktree && !commit);
    let files: LocalGitDiffFile[];
    let truncated = range.truncated;

    if (commit) {
      const parent = await gitLine(["rev-parse", "--verify", "--quiet", `${commit.sha}^`], repo.root);
      const from = parent ?? (await emptyTree(repo.root));
      if (!from) return { ok: false, reason: "error", error: "could not resolve the commit's parent" };
      const diff = await runGit([...DIFF_FLAGS, ...context, from, commit.sha, ...scope], repo.root, MAX_DIFF_BYTES);
      if (diff.code !== 0) return { ok: false, reason: "error", error: diff.stderr.trim() };
      files = parseGitDiff(diff.stdout);
      truncated ||= diff.truncated;
    } else if (live && worktree) {
      // The run's worktree as it is now: commits since the baseline plus
      // whatever it has not committed yet, untracked files included.
      const diff = await runGit([...DIFF_FLAGS, ...context, range.base, ...scope], worktree, MAX_DIFF_BYTES);
      if (diff.code !== 0) return { ok: false, reason: "error", error: diff.stderr.trim() };
      const untracked = await readUntracked(
        { folder: worktree, root: worktree },
        pathspec ? [pathspec] : ["."],
      );
      files = [...parseGitDiff(diff.stdout), ...untracked.files];
      truncated ||= diff.truncated || untracked.truncated;
    } else {
      const diff = await runGit([...DIFF_FLAGS, ...context, range.base, tip, ...scope], repo.root, MAX_DIFF_BYTES);
      if (diff.code !== 0) return { ok: false, reason: "error", error: diff.stderr.trim() };
      files = parseGitDiff(diff.stdout);
      truncated ||= diff.truncated;
    }

    return {
      ok: true,
      branch,
      default_branch: target.name,
      merged: range.merged,
      live,
      worktree_available: worktree !== null,
      commits: range.commits,
      commit: commit?.sha ?? null,
      files,
      truncated,
    };
  } catch (err) {
    return failure(err);
  }
}

const SHORTSTAT = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;

function parseShortstat(text: string): { files: number; additions: number; deletions: number } {
  const match = SHORTSTAT.exec(text);
  return {
    files: Number(match?.[1] ?? 0),
    additions: Number(match?.[2] ?? 0),
    deletions: Number(match?.[3] ?? 0),
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Every `agent/...` branch in the folder's repository with its size, so a
 * screen can show an issue's branches (and a board their totals) from one call.
 */
export async function listAgentBranches(folder: unknown): Promise<LocalGitAgentBranchesResult> {
  try {
    const repo = await openRepository(folder);
    if ("ok" in repo) return repo;
    const target = await defaultBranch(repo.root);
    if (!target) return { ok: false, reason: "no_commits" };

    const refs = await runGit(
      ["for-each-ref", `--count=${MAX_BRANCHES}`, "--format=%(refname:lstrip=2)%00%(objectname)", "refs/heads/agent/"],
      repo.root,
    );
    const records = await runGit(
      ["for-each-ref", "--format=%(refname:lstrip=3)%00%(trailers:key=Multica-Agent,valueonly,separator=%x2C)", "refs/multica/local-state/"],
      repo.root,
    );
    const agentByBranch = new Map<string, string>();
    for (const line of records.stdout.split("\n")) {
      const [name, agent] = line.split("\0");
      const id = agent?.split(",")[0]?.trim();
      if (name && id) agentByBranch.set(name, id);
    }
    const worktrees = await liveWorktrees(repo.root);

    const entries = refs.stdout
      .split("\n")
      .map((line) => line.split("\0"))
      .filter((parts): parts is [string, string] => Boolean(parts[0] && parts[1]))
      .filter(([name]) => isAgentBranchName(name));

    const summaries = await mapLimit(entries, BRANCH_SUMMARY_CONCURRENCY, async ([name, tip]) => {
      const parts = parseAgentBranchName(name);
      const range = await agentRange(repo.root, target.ref, tip);
      const worktree = worktrees.get(name);
      let stat = { files: 0, additions: 0, deletions: 0 };
      if (!("ok" in range)) {
        const out = worktree
          ? await runGit(["diff", "--shortstat", "--no-ext-diff", "--no-textconv", range.base], worktree)
          : await runGit(["diff", "--shortstat", "--no-ext-diff", "--no-textconv", range.base, tip], repo.root);
        stat = parseShortstat(out.stdout);
      }
      const summary: LocalGitBranchSummary = {
        name,
        issue_key: parts?.issue_key ?? null,
        agent_segment: parts?.agent_segment ?? "",
        agent_id: agentByBranch.get(name) ?? null,
        merged: "ok" in range ? false : range.merged,
        live: worktree !== undefined,
        ...stat,
      };
      return summary;
    });
    return { ok: true, default_branch: target.name, branches: summaries };
  } catch (err) {
    return failure(err);
  }
}

const XED = "/usr/bin/xed";
const XCODE_APP = "/Applications/Xcode.app";
const CODE_CANDIDATES = [
  "/usr/local/bin/code",
  "/opt/homebrew/bin/code",
  "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
];

export interface OpenFileDeps {
  reveal: (path: string) => void;
  launch: (command: string, args: string[]) => void;
  exists: (path: string) => boolean;
}

const defaultOpenDeps: OpenFileDeps = {
  reveal: (path) => shell.showItemInFolder(path),
  launch: (command, args) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  },
  exists: (path) => existsSync(path),
};

/** Editors this Mac can open a file in at a line, plus Finder. */
export function availableEditors(deps: Pick<OpenFileDeps, "exists"> = defaultOpenDeps): LocalGitEditor[] {
  const editors: LocalGitEditor[] = ["finder"];
  if (deps.exists(XED) && deps.exists(XCODE_APP)) editors.push("xcode");
  if (CODE_CANDIDATES.some((c) => deps.exists(c))) editors.push("vscode");
  return editors;
}

/**
 * Opens a changed file from the folder (or a branch's live worktree) in an
 * editor or Finder. The renderer names the file by its repository path; the
 * root it resolves against is worked out here, never taken from the caller.
 */
export async function openLocalFile(
  request: unknown,
  deps: OpenFileDeps = defaultOpenDeps,
): Promise<LocalGitOpenFileResult> {
  const req = (request ?? {}) as Record<string, unknown>;
  const app = req.app;
  const line = req.line;
  if (
    (app !== "xcode" && app !== "vscode" && app !== "finder") ||
    topLevelPathspec(req.path) == null ||
    (req.branch !== undefined && !isAgentBranchName(req.branch)) ||
    (line !== undefined && (typeof line !== "number" || !Number.isInteger(line) || line < 1))
  ) {
    return { ok: false, reason: "invalid_input" };
  }
  try {
    const repo = await openRepository(req.folder);
    if ("ok" in repo) return repo;
    let root = repo.root;
    if (typeof req.branch === "string") {
      const worktree = (await liveWorktrees(repo.root)).get(req.branch);
      if (!worktree) return { ok: false, reason: "not_found" };
      root = worktree;
    }
    const absolute = resolve(root, req.path as string);
    if (!absolute.startsWith(root + sep)) return { ok: false, reason: "invalid_input" };
    const info = await lstat(absolute).catch(() => null);
    if (!info?.isFile()) return { ok: false, reason: "not_found" };

    if (app === "finder") {
      deps.reveal(absolute);
      return { ok: true };
    }
    if (!availableEditors(deps).includes(app)) return { ok: false, reason: "editor_unavailable" };
    if (app === "xcode") {
      deps.launch(XED, line ? ["--line", String(line), absolute] : [absolute]);
    } else {
      const code = CODE_CANDIDATES.find((c) => deps.exists(c)) as string;
      deps.launch(code, ["--goto", line ? `${absolute}:${line}` : absolute]);
    }
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export function setupLocalGit(): void {
  ipcMain.handle("local-git:working-copy", (_event, folder: unknown, options?: LocalGitWorkingCopyOptions) =>
    readWorkingCopy(folder, options ?? {}),
  );
  ipcMain.handle(
    "local-git:agent-branch",
    (_event, folder: unknown, branch: unknown, options?: LocalGitAgentBranchOptions) =>
      readAgentBranch(folder, branch, options ?? {}),
  );
  ipcMain.handle("local-git:agent-branches", (_event, folder: unknown) => listAgentBranches(folder));
  ipcMain.handle("local-git:open-file", (_event, request: unknown) => openLocalFile(request));
  ipcMain.handle("local-git:editors", () => availableEditors());
}
