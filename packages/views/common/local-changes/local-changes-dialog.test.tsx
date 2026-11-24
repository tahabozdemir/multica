// @vitest-environment jsdom

import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { Dialog } from "@multica/ui/components/ui/dialog";
import { renderWithI18n } from "../../test/i18n";
import {
  readLocalAgentBranch,
  readLocalWorkingCopy,
  type LocalGitDiffFile,
} from "../../platform/local-git";
import {
  AgentBranchChangesDialogContent,
  WorkingCopyChangesDialogContent,
} from "./local-changes-dialog";

vi.mock("../../platform/local-git", () => ({
  readLocalWorkingCopy: vi.fn(),
  readLocalAgentBranch: vi.fn(),
}));

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

const edited: LocalGitDiffFile = {
  path: "src/app.ts",
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
        { kind: "add", text: "const b = 3;", new_line: 5 },
      ],
    },
  ],
};

describe("WorkingCopyChangesDialogContent", () => {
  it("lists each changed file with its lines and totals", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({
      ok: true,
      branch: "main",
      truncated: false,
      files: [
        edited,
        { path: "logo.png", status: "untracked", binary: true, additions: 0, deletions: 0, hunks: [], truncated: false },
      ],
    });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);

    expect(await screen.findByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("app · main")).toBeInTheDocument();
    expect(screen.getByText(/^2 files/)).toBeInTheDocument();
    // Highlighting splits the line into token spans.
    expect(document.body).toHaveTextContent("const b = 3;");
    expect(screen.getByText("Binary")).toBeInTheDocument();
    expect(readLocalWorkingCopy).toHaveBeenCalledWith("/work/app");
  });

  it("collapses and expands a file", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({ ok: true, branch: "main", truncated: false, files: [edited] });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);

    const header = await screen.findByRole("button", { name: /src\/app\.ts/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("says so when there is nothing to show", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({ ok: true, branch: "main", truncated: false, files: [] });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);
    expect(await screen.findByText("No uncommitted changes.")).toBeInTheDocument();
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

  it("reads the folder again on refresh", async () => {
    vi.mocked(readLocalWorkingCopy).mockResolvedValue({ ok: true, branch: "main", truncated: false, files: [] });
    renderInDialog(<WorkingCopyChangesDialogContent path="/work/app" label="app" />);
    await screen.findByText("No uncommitted changes.");
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(readLocalWorkingCopy).toHaveBeenCalledTimes(2);
  });
});

describe("AgentBranchChangesDialogContent", () => {
  it("shows the branch's commits, marking the ones that are not the agent's", async () => {
    vi.mocked(readLocalAgentBranch).mockResolvedValue({
      ok: true,
      branch: "agent/builder/siri-4",
      merged: false,
      truncated: false,
      files: [edited],
      commits: [
        { sha: "aaaaaaaa1111", subject: "chore(agent): baseline — the task worktree started here", origin: "baseline" },
        { sha: "bbbbbbbb2222", subject: "feat: add feature", origin: "agent" },
        {
          sha: "cccccccc3333",
          subject: "chore(agent): uncommitted work from the local directory since the previous turn",
          origin: "carried_over",
        },
      ],
    });
    renderInDialog(<AgentBranchChangesDialogContent path="/work/app" branch="agent/builder/siri-4" />);

    const commits = await screen.findByRole("region", { name: "Commits" });
    expect(within(commits).getByText("feat: add feature")).toBeInTheDocument();
    expect(within(commits).getByText("Starting point")).toBeInTheDocument();
    expect(within(commits).getByText("Your work")).toBeInTheDocument();
    expect(
      screen.getByText("Includes your own uncommitted work that was carried over between runs."),
    ).toBeInTheDocument();
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(readLocalAgentBranch).toHaveBeenCalledWith("/work/app", "agent/builder/siri-4");
  });

  it("reports a branch that is already merged", async () => {
    vi.mocked(readLocalAgentBranch).mockResolvedValue({
      ok: true,
      branch: "agent/builder/siri-4",
      merged: true,
      truncated: false,
      files: [],
      commits: [],
    });
    renderInDialog(<AgentBranchChangesDialogContent path="/work/app" branch="agent/builder/siri-4" />);
    expect(
      await screen.findByText("This branch is already merged into the folder's current branch."),
    ).toBeInTheDocument();
  });

  it("reports a branch that is gone from the repository", async () => {
    vi.mocked(readLocalAgentBranch).mockResolvedValue({ ok: false, reason: "branch_not_found" });
    renderInDialog(<AgentBranchChangesDialogContent path="/work/app" branch="agent/builder/siri-4" />);
    expect(await screen.findByText(/This branch is not in the folder's repository/)).toBeInTheDocument();
  });
});
