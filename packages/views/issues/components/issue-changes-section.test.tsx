// @vitest-environment jsdom

import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectResourceKeys } from "@multica/core/projects";
import { agentListOptions } from "@multica/core/workspace/queries";
import type { ListProjectResourcesResponse } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";
import {
  canListLocalAgentBranches,
  listLocalAgentBranches,
  readLocalAgentBranch,
  type LocalGitBranchSummary,
} from "../../platform/local-git";
import { IssueChangesSection } from "./issue-changes-section";

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws" }));
vi.mock("../../platform/use-local-daemon-status", () => ({
  readLocalDaemonStatus: async () => ({ daemonId: "this-mac", deviceName: null, running: true }),
}));
vi.mock("../../platform/local-git", () => ({
  canReadLocalGit: vi.fn(() => true),
  canListLocalAgentBranches: vi.fn(() => true),
  listLocalAgentBranches: vi.fn(),
  readLocalAgentBranch: vi.fn(),
  readLocalWorkingCopy: vi.fn(),
  localEditors: vi.fn(async () => []),
  openLocalFile: vi.fn(),
}));

const branch = (overrides: Partial<LocalGitBranchSummary>): LocalGitBranchSummary => ({
  name: "agent/app-engineer/siri-118",
  issue_key: "siri-118",
  agent_segment: "app-engineer",
  agent_id: null,
  merged: false,
  live: false,
  files: 3,
  additions: 40,
  deletions: 2,
  ...overrides,
});

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canListLocalAgentBranches).mockReturnValue(true);
  vi.mocked(listLocalAgentBranches).mockResolvedValue({
    ok: true,
    default_branch: "main",
    branches: [
      branch({ agent_id: "agent-app" }),
      branch({ name: "agent/tester/siri-118", agent_segment: "tester", live: true, files: 0, additions: 0, deletions: 0 }),
      branch({ name: "agent/app-engineer/siri-119", issue_key: "siri-119" }),
    ],
  });
  vi.mocked(readLocalAgentBranch).mockResolvedValue({ ok: false, reason: "branch_not_found" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(projectResourceKeys.list("ws", "project-1"), {
    resources: [
      {
        id: "res-1",
        project_id: "project-1",
        resource_type: "local_directory",
        resource_ref: { local_path: "/work/eqbase", daemon_id: "this-mac" },
        label: "eqbase",
      },
    ],
  } as unknown as ListProjectResourcesResponse);
  client.setQueryData(agentListOptions("ws").queryKey, [
    { id: "agent-app", name: "App Engineer" },
    { id: "agent-tester-local", name: "Tester" },
  ] as never);
});

afterEach(cleanup);

function renderSection(status: string) {
  return renderWithI18n(
    <QueryClientProvider client={client}>
      <IssueChangesSection issue={{ identifier: "SIRI-118", project_id: "project-1", status: status as never }} />
    </QueryClientProvider>,
  );
}

describe("IssueChangesSection", () => {
  it("lists only this issue's branches, live first, with their agents and size", async () => {
    renderSection("in_progress");
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Tester"),
      expect.stringContaining("App Engineer"),
    ]);
    expect(rows[0]).toHaveTextContent("Live");
    expect(rows[1]).toHaveTextContent("3 files · +40 −2");
    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(2);
  });

  it("leads with a Review button while the issue is in review", async () => {
    renderSection("code_review");
    expect(await screen.findByRole("button", { name: "Review" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "View" })).toHaveLength(1);
  });

  it("opens the branch's diff", async () => {
    renderSection("code_review");
    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    await waitFor(() =>
      expect(readLocalAgentBranch).toHaveBeenCalledWith("/work/eqbase", "agent/app-engineer/siri-118", { live: true }),
    );
  });

  it("renders nothing and reads nothing where git cannot be read", () => {
    vi.mocked(canListLocalAgentBranches).mockReturnValue(false);
    const { container } = renderSection("code_review");
    expect(container).toBeEmptyDOMElement();
    expect(listLocalAgentBranches).not.toHaveBeenCalled();
  });
});
