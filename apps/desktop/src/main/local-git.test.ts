// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() }, shell: { showItemInFolder: vi.fn() } }));

import {
  availableEditors,
  commitOrigin,
  listAgentBranches,
  openLocalFile,
  parseAgentBranchName,
  readAgentBranch,
  readWorkingCopy,
  type OpenFileDeps,
} from "./local-git";

// These run real git against throwaway repositories: the module's job is to
// drive git correctly, which a mocked child process cannot show.

let repo: string;

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  }).trim();
}

function write(path: string, content: string) {
  const full = join(repo, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "multica-local-git-")));
  git("init", "--quiet", "--initial-branch=main");
  write("README.md", "one\ntwo\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "initial");
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("readWorkingCopy", () => {
  it("lists tracked edits and untracked files, honouring .gitignore", async () => {
    write("README.md", "one\nTWO\n");
    write(".gitignore", "ignored.log\n");
    write("ignored.log", "noise\n");
    write("src/new.ts", "export {};\n");

    const result = await readWorkingCopy(repo);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.branch).toBe("main");
    expect(result.files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ["README.md", "modified", 1, 1],
      [".gitignore", "untracked", 1, 0],
      ["src/new.ts", "untracked", 1, 0],
    ]);
  });

  it("scopes the changes to a subfolder of the repository", async () => {
    write("app/a.txt", "a\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "app");
    write("app/a.txt", "A\n");
    write("README.md", "changed outside\n");

    const result = await readWorkingCopy(join(repo, "app"));
    expect(result.ok && result.files.map((f) => f.path)).toEqual(["app/a.txt"]);
  });

  it("does not stage anything or touch the index", async () => {
    write("README.md", "edited\n");
    await readWorkingCopy(repo);
    expect(git("diff", "--cached", "--name-only")).toBe("");
  });

  it("reports a folder outside any repository", async () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), "multica-not-git-")));
    try {
      await expect(readWorkingCopy(plain)).resolves.toMatchObject({ ok: false, reason: "not_a_repo" });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("rejects relative and missing paths", async () => {
    await expect(readWorkingCopy("relative/path")).resolves.toMatchObject({ reason: "invalid_input" });
    await expect(readWorkingCopy(join(repo, "missing"))).resolves.toMatchObject({ reason: "not_found" });
  });
});

/** An agent branch the way the daemon builds one: baseline, then agent work. */
function agentBranch(name: string, withUserWork: boolean, from = "main") {
  git("switch", "--quiet", "-c", name, from);
  if (withUserWork) write("draft.txt", "the user's own work\n");
  git("add", "-A");
  git(
    "commit", "--quiet", "--allow-empty", "-m",
    withUserWork
      ? "chore(agent): baseline — uncommitted work from the local directory"
      : "chore(agent): baseline — the task worktree started here",
  );
  // Content unique to the branch, so `git cherry` never matches another one.
  write("feature.ts", `export const feature = "${name}";\n`);
  git("add", "-A");
  git("commit", "--quiet", "-m", "feat: add feature");
  git("switch", "--quiet", "main");
}

describe("readAgentBranch", () => {

  it("diffs from the baseline so the user's starting state is not shown as agent work", async () => {
    agentBranch("agent/builder/mul-1", true);
    const result = await readAgentBranch(repo, "agent/builder/mul-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.merged).toBe(false);
    expect(result.commits.map((c) => [c.subject, c.origin])).toEqual([
      ["chore(agent): baseline — uncommitted work from the local directory", "baseline"],
      ["feat: add feature", "agent"],
    ]);
    expect(result.files.map((f) => f.path)).toEqual(["feature.ts"]);
  });

  it("reports a branch merged into the default branch", async () => {
    agentBranch("agent/builder/mul-2", false);
    git("merge", "--quiet", "--no-edit", "agent/builder/mul-2");
    await expect(readAgentBranch(repo, "agent/builder/mul-2")).resolves.toMatchObject({
      ok: true,
      merged: true,
      files: [],
    });
  });

  it("leaves out commits of the branch the run started from", async () => {
    git("switch", "--quiet", "-c", "site/redesign");
    write("site.html", "<p>site</p>\n");
    git("add", "-A");
    git("commit", "--quiet", "-m", "site: redesign");
    git("switch", "--quiet", "main");
    agentBranch("agent/builder/mul-4", false, "site/redesign");

    const result = await readAgentBranch(repo, "agent/builder/mul-4");
    if (!result.ok) throw new Error(result.reason);
    expect(result.default_branch).toBe("main");
    expect(result.commits.map((c) => c.origin)).toEqual(["baseline", "agent"]);
    expect(result.files.map((f) => f.path)).toEqual(["feature.ts"]);
  });

  it("counts a branch as merged once its agent commits were cherry-picked onto main", async () => {
    agentBranch("agent/builder/mul-5", false);
    const work = git("rev-parse", "agent/builder/mul-5");
    git("cherry-pick", "--quiet", work);

    const result = await readAgentBranch(repo, "agent/builder/mul-5");
    if (!result.ok) throw new Error(result.reason);
    expect(result.merged).toBe(true);
    expect(result.commits.find((c) => c.origin === "agent")?.in_default).toBe(true);
    expect(result.files.map((f) => f.path)).toEqual(["feature.ts"]);
  });

  it("shows one commit on its own, and refuses a commit outside the branch", async () => {
    agentBranch("agent/builder/mul-6", true);
    const baseline = git("rev-parse", "agent/builder/mul-6~1");
    const result = await readAgentBranch(repo, "agent/builder/mul-6", { commit: baseline });
    if (!result.ok) throw new Error(result.reason);
    expect(result.commit).toBe(baseline);
    expect(result.files.map((f) => f.path)).toEqual(["draft.txt"]);

    const outside = git("rev-parse", "main");
    await expect(readAgentBranch(repo, "agent/builder/mul-6", { commit: outside })).resolves.toMatchObject({
      reason: "invalid_input",
    });
    await expect(readAgentBranch(repo, "agent/builder/mul-6", { commit: "HEAD" })).resolves.toMatchObject({
      reason: "invalid_input",
    });
  });

  it("gives one file its full context", async () => {
    write("long.txt", Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
    git("add", "-A");
    git("commit", "--quiet", "-m", "long file");
    git("switch", "--quiet", "-c", "agent/builder/mul-7");
    git("commit", "--quiet", "--allow-empty", "-m", "chore(agent): baseline — the task worktree started here");
    write("long.txt", Array.from({ length: 30 }, (_, i) => (i === 14 ? "changed" : `line ${i + 1}`)).join("\n") + "\n");
    git("commit", "--quiet", "-am", "edit one line");
    git("switch", "--quiet", "main");

    const short = await readAgentBranch(repo, "agent/builder/mul-7", { file: "long.txt" });
    const full = await readAgentBranch(repo, "agent/builder/mul-7", { file: "long.txt", fullContext: true });
    if (!short.ok || !full.ok) throw new Error("read failed");
    const count = (r: typeof full) => r.files[0]?.hunks.flatMap((h) => h.lines).length ?? 0;
    expect(count(short)).toBeLessThan(count(full));
    expect(count(full)).toBe(31);
    await expect(readAgentBranch(repo, "agent/builder/mul-7", { file: "../outside" })).resolves.toMatchObject({
      reason: "invalid_input",
    });
  });

  it("includes a live run's uncommitted and untracked work when asked", async () => {
    agentBranch("agent/builder/mul-8", false);
    const tree = realpathSync(mkdtempSync(join(tmpdir(), "multica-wt-")));
    rmSync(tree, { recursive: true, force: true });
    git("worktree", "add", "--quiet", tree, "agent/builder/mul-8");
    try {
      writeFileSync(join(tree, "feature.ts"), "export const feature = false;\n");
      writeFileSync(join(tree, "scratch.ts"), "export {};\n");

      const committed = await readAgentBranch(repo, "agent/builder/mul-8");
      const live = await readAgentBranch(repo, "agent/builder/mul-8", { live: true });
      if (!committed.ok || !live.ok) throw new Error("read failed");
      expect(committed.worktree_available).toBe(true);
      expect(committed.live).toBe(false);
      expect(live.live).toBe(true);
      expect(live.files.map((f) => [f.path, f.status])).toEqual([
        ["feature.ts", "added"],
        ["scratch.ts", "untracked"],
      ]);
      expect(live.files[0]?.hunks[0]?.lines.map((l) => l.text)).toContain("export const feature = false;");
    } finally {
      git("worktree", "remove", "--force", tree);
    }
  });

  it("reports a missing branch and refuses names that could be read as options", async () => {
    await expect(readAgentBranch(repo, "agent/nobody/mul-3")).resolves.toMatchObject({ reason: "branch_not_found" });
    await expect(readAgentBranch(repo, "--output=/tmp/x")).resolves.toMatchObject({ reason: "invalid_input" });
    await expect(readAgentBranch(repo, "agent/../main")).resolves.toMatchObject({ reason: "invalid_input" });
  });
});

describe("commitOrigin", () => {
  it("recognises the daemon's commit subjects", () => {
    expect(commitOrigin("chore(agent): baseline — the task worktree started here")).toBe("baseline");
    expect(
      commitOrigin("chore(agent): uncommitted work from the local directory since the previous turn"),
    ).toBe("carried_over");
    expect(commitOrigin("chore(agent): uncommitted changes from task")).toBe("agent");
  });
});

describe("parseAgentBranchName", () => {
  it("reads the agent and issue key, with or without the daemon's suffixes", () => {
    expect(parseAgentBranchName("agent/app-engineer/siri-118")).toEqual({ agent_segment: "app-engineer", issue_key: "siri-118" });
    expect(parseAgentBranchName("agent/app-engineer/siri-118-0123456789ab")).toMatchObject({ issue_key: "siri-118" });
    expect(parseAgentBranchName("agent/app-engineer/siri-118-1732450000-2")).toMatchObject({ issue_key: "siri-118" });
    expect(parseAgentBranchName("agent/tester/chat-0123456789ab")).toEqual({ agent_segment: "tester", issue_key: null });
    expect(parseAgentBranchName("feature/x")).toBeNull();
  });
});

describe("listAgentBranches", () => {
  it("summarises every agent branch with its issue, agent, state and size", async () => {
    agentBranch("agent/builder/siri-1", false);
    agentBranch("agent/builder/siri-2", false);
    git("cherry-pick", "--quiet", git("rev-parse", "agent/builder/siri-2"));
    // The daemon's branch record carries the agent id as a trailer.
    const record = git(
      "commit-tree", "agent/builder/siri-1^{tree}", "-p", "agent/builder/siri-1",
      "-m", "multica local state\n\nMulti" + "ca-Agent: 11111111-2222-3333-4444-555555555555",
    );
    git("update-ref", "refs/multica/local-state/agent/builder/siri-1", record);

    const result = await listAgentBranches(repo);
    if (!result.ok) throw new Error(result.reason);
    expect(result.default_branch).toBe("main");
    expect(result.branches).toEqual([
      expect.objectContaining({
        name: "agent/builder/siri-1",
        issue_key: "siri-1",
        agent_segment: "builder",
        agent_id: "11111111-2222-3333-4444-555555555555",
        merged: false,
        live: false,
        files: 1,
        additions: 1,
        deletions: 0,
      }),
      expect.objectContaining({ name: "agent/builder/siri-2", merged: true, agent_id: null }),
    ]);
  });
});

describe("openLocalFile", () => {
  const calls: { reveal: string[]; launch: [string, string[]][] } = { reveal: [], launch: [] };
  const deps = (installed: string[] = []): OpenFileDeps => ({
    reveal: (p) => calls.reveal.push(p),
    launch: (c, a) => calls.launch.push([c, a]),
    exists: (p) => installed.includes(p),
  });
  beforeEach(() => {
    calls.reveal = [];
    calls.launch = [];
  });

  it("reveals a file of the folder in Finder", async () => {
    await expect(openLocalFile({ folder: repo, path: "README.md", app: "finder" }, deps())).resolves.toEqual({ ok: true });
    expect(calls.reveal).toEqual([join(repo, "README.md")]);
  });

  it("opens Xcode or VS Code at a line when installed", async () => {
    const both = deps(["/usr/bin/xed", "/Applications/Xcode.app", "/usr/local/bin/code"]);
    await openLocalFile({ folder: repo, path: "README.md", line: 2, app: "xcode" }, both);
    await openLocalFile({ folder: repo, path: "README.md", line: 2, app: "vscode" }, both);
    expect(calls.launch).toEqual([
      ["/usr/bin/xed", ["--line", "2", join(repo, "README.md")]],
      ["/usr/local/bin/code", ["--goto", `${join(repo, "README.md")}:2`]],
    ]);
    await expect(openLocalFile({ folder: repo, path: "README.md", app: "xcode" }, deps())).resolves.toMatchObject({
      reason: "editor_unavailable",
    });
  });

  it("refuses paths outside the repository, missing files and bad input", async () => {
    await expect(openLocalFile({ folder: repo, path: "../etc/passwd", app: "finder" }, deps())).resolves.toMatchObject({ reason: "invalid_input" });
    await expect(openLocalFile({ folder: repo, path: "/etc/passwd", app: "finder" }, deps())).resolves.toMatchObject({ reason: "invalid_input" });
    await expect(openLocalFile({ folder: repo, path: "missing.txt", app: "finder" }, deps())).resolves.toMatchObject({ reason: "not_found" });
    await expect(openLocalFile({ folder: repo, path: "README.md", app: "terminal" }, deps())).resolves.toMatchObject({ reason: "invalid_input" });
    await expect(
      openLocalFile({ folder: repo, path: "README.md", branch: "agent/nobody/siri-1", app: "finder" }, deps()),
    ).resolves.toMatchObject({ reason: "not_found" });
    expect(calls.reveal).toEqual([]);
  });

  it("lists Finder always and editors only when present", () => {
    expect(availableEditors({ exists: () => false })).toEqual(["finder"]);
    expect(availableEditors({ exists: () => true })).toEqual(["finder", "xcode", "vscode"]);
  });
});

describe("readWorkingCopy options", () => {
  it("narrows to one file", async () => {
    write("README.md", "one\nTWO\n");
    write("other.txt", "x\n");
    const result = await readWorkingCopy(repo, { file: "README.md", fullContext: true });
    if (!result.ok) throw new Error(result.reason);
    expect(result.files.map((f) => f.path)).toEqual(["README.md"]);
  });
});
