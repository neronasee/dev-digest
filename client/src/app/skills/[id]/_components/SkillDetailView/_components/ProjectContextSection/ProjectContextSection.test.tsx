import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ProjectDocList } from "@devdigest/shared";
import skillsMessages from "../../../../../../../../messages/en/skills.json";
import contextMessages from "../../../../../../../../messages/en/context.json";

const { skillMutate, agentMutate } = vi.hoisted(() => ({
  skillMutate: vi.fn(),
  agentMutate: vi.fn(),
}));
const box = vi.hoisted(() => ({
  skillPaths: { current: ["specs/api-layering.md"] },
  docs: { current: undefined as ProjectDocList | undefined },
}));

// The picker follows the GLOBAL repo selector — render inside the real
// RepoProvider (needs usePathname + the useRepos the provider reads from the
// "@/lib/hooks" barrel; both mocked per the fetch-mocked rule).
vi.mock("next/navigation", () => ({
  usePathname: () => "/skills/sk1",
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
  useAgentContextSet: () => ({ data: undefined }),
  useSkillContextSet: () => ({
    data: { owner_id: "sk1", repo_id: "r1", paths: box.skillPaths.current },
  }),
  useSetAgentContext: () => ({ mutate: agentMutate, isPending: false }),
  useSetSkillContext: () => ({ mutate: skillMutate, isPending: false }),
}));

import { RepoProvider } from "@/lib/repo-context";
import { ProjectContextSection } from "./ProjectContextSection";

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
    <NextIntlClientProvider locale="en" messages={{ skills: skillsMessages, context: contextMessages }}>
      <RepoProvider>{ui}</RepoProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  skillMutate.mockReset();
  agentMutate.mockReset();
  localStorage.removeItem("dd-repo");
  box.docs.current = DOC_LIST;
  box.skillPaths.current = ["specs/api-layering.md"];
});

describe("Skill editor ProjectContextSection", () => {
  it("renders the skill-variant picker with the inheritance note and serialization preview (AC-22)", () => {
    renderWithIntl(<ProjectContextSection skillId="sk1" />);
    expect(screen.getByText("Project context to use")).toBeInTheDocument();
    expect(screen.getByText(/Any agent using this skill inherits these documents/)).toBeInTheDocument();
    expect(screen.getByText("SERIALIZES AS")).toBeInTheDocument();
    const serializesPre = screen
      .getAllByText(/specs\/api-layering\.md/)
      .find((el) => el.tagName === "PRE")!;
    expect(serializesPre.textContent).toBe("specs/api-layering.md");
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();
  });

  it("saves through the skill context endpoint (never the agent one)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ProjectContextSection skillId="sk1" />);
    await user.click(
      screen.getByText("docs/architecture.md").closest("div")!.querySelector('button[role="checkbox"]')!,
    );
    expect(skillMutate).toHaveBeenCalledWith({
      ownerId: "sk1",
      repoId: "r1",
      paths: ["specs/api-layering.md", "docs/architecture.md"],
    });
    expect(agentMutate).not.toHaveBeenCalled();
  });
});
