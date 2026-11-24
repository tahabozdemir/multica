// @vitest-environment jsdom

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { Dialog } from "@multica/ui/components/ui/dialog";
import { useLocalChangesReviewStore } from "@multica/core/local-changes/review-store";
import { renderWithI18n } from "../../test/i18n";
import {
  localEditors,
  openLocalFile,
  readLocalAgentBranch,
  readLocalWorkingCopy,
  type LocalGitAgentBranch,
  type LocalGitDiffFile,
} from "../../platform/local-git";
import {
  AgentBranchChangesDialogContent,
  WorkingCopyChangesDialogContent,
} from "./local-changes-dialog";

vi.mock("../../platform/local-git", () => ({
  readLocalWorkingCopy: vi.fn(),
  readLocalAgentBranch: vi.fn(),
  localEditors: vi.fn(),
  openLocalFile: vi.fn(),
}));

beforeEach(() => {
  useLocalChangesReviewStore.setState({ layout: "unified", viewed: {} });
  vi.mocked(localEditors).mockResolvedValue(["finder", "xcode"]);
  vi.mocked(openLocalFile).mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.mocked(readLocalWorkingCopy).mockReset();
  vi.mocked(readLocalAgentBranch).mockReset();
});

function renderInDialog(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithI18n(
    <QueryClientProvider client={client}>
      <Dialog open>{ui}</Dialog>
    </QueryClientProvider>,
  );
}

function fileFixture(path: string, text = "const b = 3;"): LocalGitDiffFile {
  return {
    path,
    status: "modified",
    binary: false,
    additions: 1,
    deletions: 1,
    truncated: false,
    hunks: [
      {
        header: "@@ -4,2 +4,2 @@",
        lines: [
          { kind: "context", text: "const a = 1;", old_line: 4, new_line: 4 },
          { kind: "remove", text: "const b = 2;", old_line: 5 },
          { kind: "add", text, new_line: 5 },
        ],
      },
    ],
  };
}

function branchResult(overrides: Partial<LocalGitAgentBranch> = {}): LocalGitAgentBranch {
  return {
    ok: true,
    branch: "agent/builder/siri-4",
    default_branch: "main",
    merged: false,
    live: false,
    worktree_available: false,
    commits: [],
    commit: null,
    files: [fileFixture("src/app.ts")],
    truncated: false,
    ...overrides,
  };
}

const fileHeader = (path: string) =>
  screen.getAllByRole("button").find((b) => b.getAttribute("aria-expanded") !== null && b.textContent?.includes(path));

describe("WorkingCopyChangesDialogContent", () => {
  it("lists the changed files beside their diffs, with totals", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({
      ok: true,
      branch: "main",
      truncated: false,
      files: [
        fileFixture("src/app.ts"),
        { path: "logo.png", status: "untracked", binary: true, additions: 0, deletions: 0, hunks: [], truncated: false },
      ],
    });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);

    const list = await screen.findByRole("navigation", { name: "Changed files" });
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("app · main")).toBeInTheDocument();
    expect(screen.getByText(/^2 files/)).toBeInTheDocument();
    // Highlighting splits the line into token spans.
    expect(document.body).toHaveTextContent("const b = 3;");
    expect(readLocalWorkingCopy).toHaveBeenCalledWith("/work/app", undefined);
  });

  it("marks a file viewed, folds it away, and remembers it", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({ ok: true, branch: "main", truncated: false, files: [fileFixture("src/app.ts")] });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);

    await screen.findByRole("navigation", { name: "Changed files" });
    expect(fileHeader("src/app.ts")).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(screen.getByRole("checkbox", { name: "Viewed" }));
    expect(fileHeader("src/app.ts")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("1 of 1 viewed")).toBeInTheDocument();
    expect(Object.keys(useLocalChangesReviewStore.getState().viewed)).toEqual(["/work/app::working-copy::src/app.ts"]);
  });

  it("forgets a viewed mark when the file's diff changes", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({ ok: true, branch: "main", truncated: false, files: [fileFixture("src/app.ts")] });
    const { unmount } = renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);
    await screen.findByRole("navigation", { name: "Changed files" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Viewed" }));
    unmount();

    vi.mocked(readLocalWorkingCopy).mockResolvedValue({
      ok: true, branch: "main", truncated: false, files: [fileFixture("src/app.ts", "const b = 4;")],
    });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);
    await screen.findByRole("navigation", { name: "Changed files" });
    expect(screen.getByRole("checkbox", { name: "Viewed" })).not.toBeChecked();
  });

  it("switches to the side-by-side layout and keeps the choice", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({ ok: true, branch: "main", truncated: false, files: [fileFixture("src/app.ts")] });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);
    await screen.findByRole("navigation", { name: "Changed files" });

    await userEvent.click(screen.getByRole("button", { name: "Side by side" }));
    expect(useLocalChangesReviewStore.getState().layout).toBe("split");
    expect(screen.getByRole("button", { name: "Side by side" })).toHaveAttribute("aria-pressed", "true");
  });

  it("moves between files with j and k and marks the current one with v", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({
      ok: true, branch: "main", truncated: false, files: [fileFixture("a.ts"), fileFixture("b.ts")],
    });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);
    const list = await screen.findByRole("navigation", { name: "Changed files" });
    const [first, second] = within(list).getAllByRole("button");
    expect(first).toHaveAttribute("aria-current", "true");

    await userEvent.keyboard("j");
    expect(second).toHaveAttribute("aria-current", "true");
    await userEvent.keyboard("v");
    expect(screen.getByText("1 of 2 viewed")).toBeInTheDocument();
    await userEvent.keyboard("k");
    expect(first).toHaveAttribute("aria-current", "true");
  });

  it("reads one file again with full context on request", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({ ok: true, branch: "main", truncated: false, files: [fileFixture("src/app.ts")] });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);
    await screen.findByRole("navigation", { name: "Changed files" });

    await userEvent.click(screen.getByRole("button", { name: "Show full file" }));
    await waitFor(() =>
      expect(readLocalWorkingCopy).toHaveBeenCalledWith("/work/app", { file: "src/app.ts", fullContext: true }),
    );
  });

  it("explains a failure without showing the diagnostic text", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({
      ok: false,
      reason: "not_a_repo",
      error: "fatal: not a git repository: /Users/someone/secret",
    });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);
    expect(await screen.findByText("This folder is not in a git repository.")).toBeInTheDocument();
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  });

  it("says so when there is nothing to show", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({ ok: true, branch: "main", truncated: false, files: [] });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);
    expect(await screen.findByText("No uncommitted changes.")).toBeInTheDocument();
  });
});

describe("AgentBranchChangesDialogContent", () => {
  it("asks for the live worktree, lists commits and labels the ones already merged", async () => {
    vi.mocked(readLocalAgentBranch).mockResolvedValue(
      branchResult({
        commits: [
          { sha: "aaaaaaaa1111", subject: "chore(agent): baseline — the task worktree started here", origin: "baseline", in_default: false },
          { sha: "bbbbbbbb2222", subject: "feat: add feature", origin: "agent", in_default: true },
          {
            sha: "cccccccc3333",
            subject: "chore(agent): uncommitted work from the local directory since the previous turn",
            origin: "carried_over",
            in_default: false,
          },
        ],
      }),
    );
    renderInDialog(<AgentBranchChangesDialogContent path="/work/app" branch="agent/builder/siri-4" />);

    const commits = await screen.findByRole("region", { name: "Commits" });
    expect(within(commits).getByText("feat: add feature")).toBeInTheDocument();
    expect(within(commits).getByText("In main")).toBeInTheDocument();
    expect(within(commits).getByText("Starting point")).toBeInTheDocument();
    expect(within(commits).getByText("Your work")).toBeInTheDocument();
    expect(screen.getByText("Includes your own uncommitted work that was carried over between runs.")).toBeInTheDocument();
    expect(readLocalAgentBranch).toHaveBeenCalledWith("/work/app", "agent/builder/siri-4", { live: true });
  });

  it("shows one commit when it is picked", async () => {
    vi.mocked(readLocalAgentBranch).mockResolvedValue(
      branchResult({ commits: [{ sha: "bbbbbbbb2222", subject: "feat: add feature", origin: "agent", in_default: false }] }),
    );
    renderInDialog(<AgentBranchChangesDialogContent path="/work/app" branch="agent/builder/siri-4" />);
    const commits = await screen.findByRole("region", { name: "Commits" });

    await userEvent.click(within(commits).getByRole("button", { name: /feat: add feature/ }));
    await waitFor(() =>
      expect(readLocalAgentBranch).toHaveBeenCalledWith("/work/app", "agent/builder/siri-4", { commit: "bbbbbbbb2222" }),
    );
  });

  it("still shows the diff of a merged branch, under a note", async () => {
    vi.mocked(readLocalAgentBranch).mockResolvedValue(branchResult({ merged: true }));
    renderInDialog(<AgentBranchChangesDialogContent path="/work/app" branch="agent/builder/siri-4" />);
    expect(await screen.findByText("Everything on this branch is already in main.")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Changed files" })).toBeInTheDocument();
  });

  it("marks a live run and offers opening files only while they are on disk", async () => {
    vi.mocked(readLocalAgentBranch).mockResolvedValue(branchResult({ live: true, worktree_available: true }));
    const { unmount } = renderInDialog(<AgentBranchChangesDialogContent path="/work/app" branch="agent/builder/siri-4" />);
    expect(await screen.findByText("Live")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Open in" })).toBeInTheDocument());
    unmount();

    vi.mocked(readLocalAgentBranch).mockResolvedValue(branchResult());
    renderInDialog(<AgentBranchChangesDialogContent path="/work/app" branch="agent/builder/siri-4" />);
    await screen.findByRole("navigation", { name: "Changed files" });
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in" })).not.toBeInTheDocument();
  });

  it("reports a branch that is gone from the repository", async () => {
    vi.mocked(readLocalAgentBranch).mockResolvedValue({ ok: false, reason: "branch_not_found" });
    renderInDialog(<AgentBranchChangesDialogContent path="/work/app" branch="agent/builder/siri-4" />);
    expect(await screen.findByText(/This branch is not in the folder's repository/)).toBeInTheDocument();
  });
});
