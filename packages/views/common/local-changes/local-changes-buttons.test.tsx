// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueDetailOptions } from "@multica/core/issues/queries";
import { projectResourceKeys } from "@multica/core/projects";
import type { AgentTask, ListProjectResourcesResponse } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";
import { canReadLocalGit } from "../../platform/local-git";
import { AgentBranchChangesButton, WorkingCopyChangesButton } from "./local-changes-buttons";

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws" }));
vi.mock("../../platform/use-local-daemon-status", () => ({
  useLocalDaemonStatus: () => ({ daemonId: "this-mac", deviceName: null, running: true }),
}));
vi.mock("../../platform/local-git", () => ({
  canReadLocalGit: vi.fn(() => true),
  readLocalWorkingCopy: vi.fn(),
  readLocalAgentBranch: vi.fn(),
}));

const task = { id: "task-1", issue_id: "issue-1", branch_name: "agent/builder/siri-4" } as AgentTask;

let client: QueryClient;

beforeEach(() => {
  vi.mocked(canReadLocalGit).mockReturnValue(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(issueDetailOptions("ws", "issue-1").queryKey, { id: "issue-1", project_id: "project-1" } as never);
});

afterEach(cleanup);

function seedFolders(daemonId: string) {
  const response = {
    resources: [
      {
        id: "res-1",
        project_id: "project-1",
        resource_type: "local_directory",
        resource_ref: { local_path: "/work/app", daemon_id: daemonId },
        label: "app",
      },
    ],
  } as unknown as ListProjectResourcesResponse;
  client.setQueryData(projectResourceKeys.list("ws", "project-1"), response);
}

function renderButton(ui: React.ReactElement) {
  return renderWithI18n(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("AgentBranchChangesButton", () => {
  it("appears for a run whose project folder is on this machine", async () => {
    seedFolders("this-mac");
    renderButton(<AgentBranchChangesButton task={task} issueId="issue-1" />);
    expect(await screen.findByRole("button", { name: "View branch changes" })).toBeInTheDocument();
  });

  it("stays hidden when the folder is registered on another machine", () => {
    seedFolders("other-mac");
    renderButton(<AgentBranchChangesButton task={task} issueId="issue-1" />);
    expect(screen.queryByRole("button", { name: "View branch changes" })).not.toBeInTheDocument();
  });

  it("stays hidden for a run that delivered no branch", () => {
    seedFolders("this-mac");
    renderButton(<AgentBranchChangesButton task={{ ...task, branch_name: undefined } as AgentTask} issueId="issue-1" />);
    expect(screen.queryByRole("button", { name: "View branch changes" })).not.toBeInTheDocument();
  });

  it("stays hidden where git cannot be read, such as the web app", () => {
    vi.mocked(canReadLocalGit).mockReturnValue(false);
    seedFolders("this-mac");
    renderButton(<AgentBranchChangesButton task={task} issueId="issue-1" />);
    expect(screen.queryByRole("button", { name: "View branch changes" })).not.toBeInTheDocument();
  });
});

describe("WorkingCopyChangesButton", () => {
  it("renders only where git can be read", () => {
    const { unmount } = renderButton(<WorkingCopyChangesButton path="/work/app" label="app" />);
    expect(screen.getByRole("button", { name: "View uncommitted changes" })).toBeInTheDocument();
    unmount();
    vi.mocked(canReadLocalGit).mockReturnValue(false);
    renderButton(<WorkingCopyChangesButton path="/work/app" label="app" />);
    expect(screen.queryByRole("button", { name: "View uncommitted changes" })).not.toBeInTheDocument();
  });
});
