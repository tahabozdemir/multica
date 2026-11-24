// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectResourceKeys } from "@multica/core/projects";
import type { ListProjectResourcesResponse } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";
import { listLocalAgentBranches, type LocalGitBranchSummary } from "../../platform/local-git";
import { IssueLocalChangesBadge } from "./issue-changes-badge";

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "ws" }));
vi.mock("../../platform/use-local-daemon-status", () => ({
  readLocalDaemonStatus: async () => ({ daemonId: "this-mac", deviceName: null, running: true }),
}));
vi.mock("../../platform/local-git", () => ({
  canReadLocalGit: () => true,
  canListLocalAgentBranches: () => true,
  listLocalAgentBranches: vi.fn(),
}));

const summary = (overrides: Partial<LocalGitBranchSummary>): LocalGitBranchSummary => ({
  name: "agent/app-engineer/siri-118",
  issue_key: "siri-118",
  agent_segment: "app-engineer",
  agent_id: null,
  merged: false,
  live: false,
  files: 2,
  additions: 10,
  deletions: 3,
  ...overrides,
});

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(projectResourceKeys.list("ws", "project-1"), {
    resources: [
      { id: "r", project_id: "project-1", resource_type: "local_directory", resource_ref: { local_path: "/work/eqbase", daemon_id: "this-mac" } },
    ],
  } as unknown as ListProjectResourcesResponse);
});
afterEach(cleanup);

function renderBadge(identifier: string) {
  return renderWithI18n(
    <QueryClientProvider client={client}>
      <IssueLocalChangesBadge issue={{ identifier, project_id: "project-1" }} />
    </QueryClientProvider>,
  );
}

describe("IssueLocalChangesBadge", () => {
  it("sums the issue's unmerged agent branches", async () => {
    vi.mocked(listLocalAgentBranches).mockResolvedValue({
      ok: true,
      default_branch: "main",
      branches: [
        summary({}),
        summary({ name: "agent/tester/siri-118", agent_segment: "tester", additions: 5, deletions: 1 }),
        summary({ name: "agent/app-engineer/siri-118-1", merged: true, additions: 99 }),
        summary({ name: "agent/app-engineer/siri-7", issue_key: "siri-7", additions: 50 }),
      ],
    });
    renderBadge("SIRI-118");
    expect(await screen.findByLabelText("Agent changes not yet merged: +15 −4")).toBeInTheDocument();
  });

  it("renders nothing once everything is merged", async () => {
    vi.mocked(listLocalAgentBranches).mockResolvedValue({
      ok: true,
      default_branch: "main",
      branches: [summary({ merged: true })],
    });
    const { container } = renderBadge("SIRI-118");
    await vi.waitFor(() => expect(listLocalAgentBranches).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
