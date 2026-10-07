import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ProjectDocList } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../../../messages/en/context.json";

const { agentMutate, skillMutate } = vi.hoisted(() => ({
  agentMutate: vi.fn(),
  skillMutate: vi.fn(),
}));
const box = vi.hoisted(() => ({
  agentPaths: { current: ["specs/api-layering.md"] },
  docs: { current: undefined as ProjectDocList | undefined },
}));

// The picker follows the GLOBAL repo selector — render inside the real
// RepoProvider (needs usePathname + the useRepos the provider reads from the
// "@/lib/hooks" barrel; both mocked per the fetch-mocked rule).
vi.mock("next/navigation", () => ({
  usePathname: () => "/agents/ag1",
}));
vi.mock("@/lib/hooks", () => ({
  useRepos: () => ({
    data: [
      {
        id: "r1",
        workspace_id: "w1",
        owner: "acme",
        name: "payments-api",
        full_name: "acme/payments-api",
        default_branch: "main",
        clone_path: "clones/acme/payments-api",
        last_polled_at: null,
        created_by: null,
      },
    ],
    isSuccess: true,
  }),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  useProjectDocuments: () => ({ data: box.docs.current, isLoading: false }),
  useProjectDocument: () => ({ data: undefined }),
  useAgentContextSet: () => ({
    data: { owner_id: "ag1", repo_id: "r1", paths: box.agentPaths.current },
  }),
  useSkillContextSet: () => ({ data: undefined }),
  useSetAgentContext: () => ({ mutate: agentMutate, isPending: false }),
  useSetSkillContext: () => ({ mutate: skillMutate, isPending: false }),
}));

import { RepoProvider } from "@/lib/repo-context";
import { ContextTab } from "./ContextTab";

afterEach(cleanup);
afterEach(() => localStorage.removeItem("dd-repo"));

const DOC_LIST: ProjectDocList = {
  repo_id: "r1",
  cloned: true,
  notice: null,
  documents: [
    { path: "specs/api-layering.md", root: "specs", size_bytes: 400, tokens_estimate: 100 },
    { path: "docs/architecture.md", root: "docs", size_bytes: 800, tokens_estimate: 200 },
  ],
  roots: ["specs", "docs", "insights"],
  refreshed_at: "2026-10-02T10:00:00Z",
  total_tokens_estimate: 300,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, context: contextMessages }}>
      <RepoProvider>{ui}</RepoProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  agentMutate.mockReset();
  skillMutate.mockReset();
  localStorage.removeItem("dd-repo");
  box.docs.current = DOC_LIST;
  box.agentPaths.current = ["specs/api-layering.md"];
});

describe("AgentEditor ContextTab", () => {
  it("renders the shared picker as the agent's context surface with the AC-21 footer note", () => {
    renderWithIntl(<ContextTab agentId="ag1" />);
    expect(screen.getByText("Project context")).toBeInTheDocument();
    expect(screen.getByText(/per repo/i)).toBeInTheDocument();
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();
    // the footer note: untrusted "## Project context" block into every run
    expect(
      screen.getByText(/untrusted “## Project context” block into every run of this agent/),
    ).toBeInTheDocument();
  });

  it("attaches a document through the agent context save (whole-set replace)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ContextTab agentId="ag1" />);
    await user.click(
      screen.getByText("docs/architecture.md").closest("div")!.querySelector('button[role="checkbox"]')!,
    );
    expect(agentMutate).toHaveBeenCalledWith({
      ownerId: "ag1",
      repoId: "r1",
      paths: ["specs/api-layering.md", "docs/architecture.md"],
    });
    expect(skillMutate).not.toHaveBeenCalled();
  });
});
