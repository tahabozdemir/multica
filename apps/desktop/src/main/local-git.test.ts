// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import { commitOrigin, readAgentBranch, readWorkingCopy } from "./local-git";

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

describe("readAgentBranch", () => {
  function agentBranch(name: string, withUserWork: boolean) {
    git("switch", "--quiet", "-c", name);
    if (withUserWork) write("draft.txt", "the user's own work\n");
    git("add", "-A");
    git(
      "commit", "--quiet", "--allow-empty", "-m",
      withUserWork
        ? "chore(agent): baseline — uncommitted work from the local directory"
        : "chore(agent): baseline — the task worktree started here",
    );
    write("feature.ts", "export const feature = true;\n");
    git("add", "-A");
    git("commit", "--quiet", "-m", "feat: add feature");
    git("switch", "--quiet", "main");
  }

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

  it("reports a branch already merged into HEAD", async () => {
    agentBranch("agent/builder/mul-2", false);
    git("merge", "--quiet", "--no-edit", "agent/builder/mul-2");
    await expect(readAgentBranch(repo, "agent/builder/mul-2")).resolves.toMatchObject({
      ok: true,
      merged: true,
      files: [],
    });
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
