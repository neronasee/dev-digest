import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ProjectDocList } from "@devdigest/shared";
import contextMessages from "../../../messages/en/context.json";

const { agentMutate, skillMutate } = vi.hoisted(() => ({ agentMutate: vi.fn(), skillMutate: vi.fn() }));
const box = vi.hoisted(() => ({
  agentPaths: { current: { r1: ["specs/api-layering.md"] } as Record<string, string[]> },
  skillPaths: { current: { r1: [] as string[] } as Record<string, string[]> },
  docs: { current: {} as Record<string, ProjectDocList | undefined> },
}));

// The picker follows the GLOBAL repo selector (repo-context.tsx), so tests run
// inside the real RepoProvider. It needs usePathname (next/navigation) and
// useRepos (the "@/lib/hooks" barrel) — both mocked (fetch-mocked rule,
// INSIGHT 2026-09-20); immutable fixtures are inlined in the factories, mutable
// state lives in the hoisted `box`, keyed per repo id.
vi.mock("next/navigation", () => ({
  usePathname: () => "/agents",
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
      {
        id: "r2",
        workspace_id: "w1",
        owner: "acme",
        name: "checkout",
        full_name: "acme/checkout",
        default_branch: "main",
        clone_path: "clones/acme/checkout",
        last_polled_at: null,
        created_by: null,
      },
    ],
    isSuccess: true,
  }),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  useProjectDocuments: (repoId: string | null) => ({
    data: repoId != null ? box.docs.current[repoId] : undefined,
    isLoading: false,
  }),
  useProjectDocument: (_repoId: string | null, path: string | null) => ({
    data: path != null
      ? { path, content: "# Api layering\n\nThe module `api/` must not import `db/` directly." }
      : undefined,
  }),
  useAgentContextSet: (agentId: string | null, repoId: string | null) => ({
    data:
      agentId != null && repoId != null
        ? { owner_id: agentId, repo_id: repoId, paths: box.agentPaths.current[repoId] ?? [] }
        : undefined,
  }),
  useSkillContextSet: (skillId: string | null, repoId: string | null) => ({
    data:
      skillId != null && repoId != null
        ? { owner_id: skillId, repo_id: repoId, paths: box.skillPaths.current[repoId] ?? [] }
        : undefined,
  }),
  useSetAgentContext: () => ({ mutate: agentMutate, isPending: false }),
  useSetSkillContext: () => ({ mutate: skillMutate, isPending: false }),
}));

import { RepoProvider, useActiveRepo } from "@/lib/repo-context";
import { ProjectContextPicker } from "./ProjectContextPicker";

afterEach(cleanup);
afterEach(() => localStorage.removeItem("dd-repo"));

const DOC_LIST: ProjectDocList = {
  repo_id: "r1",
  cloned: true,
  notice: null,
  documents: [
    { path: "specs/api-layering.md", root: "specs", size_bytes: 400, tokens_estimate: 100 },
    { path: "docs/architecture.md", root: "docs", size_bytes: 800, tokens_estimate: 200 },
    { path: "insights/postmortems.md", root: "insights", size_bytes: 120, tokens_estimate: 30 },
  ],
  roots: ["specs", "docs", "insights"],
  refreshed_at: "2026-10-02T10:00:00Z",
  total_tokens_estimate: 330,
};

const DOC_LIST_R2: ProjectDocList = {
  repo_id: "r2",
  cloned: true,
  notice: null,
  documents: [
    { path: "specs/checkout-conventions.md", root: "specs", size_bytes: 300, tokens_estimate: 75 },
    { path: "docs/r2-guide.md", root: "docs", size_bytes: 500, tokens_estimate: 125 },
  ],
  roots: ["specs", "docs", "insights"],
  refreshed_at: "2026-10-02T10:00:00Z",
  total_tokens_estimate: 200,
};

/**
 * Stands in for the chrome's global RepoSwitcher (the top-left selector): same
 * repo context, same setRepoId — the ONLY way the picker's repo may change,
 * since the picker itself renders no repo selection.
 */
function GlobalRepoSwitcherStub({ repoId }: { repoId: string }) {
  const { setRepoId } = useActiveRepo();
  return (
    <button type="button" onClick={() => setRepoId(repoId)}>
      {`Switch global repo to ${repoId}`}
    </button>
  );
}

function renderWithIntl(ui: React.ReactElement, switchTo?: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <RepoProvider>
        {ui}
        {switchTo ? <GlobalRepoSwitcherStub repoId={switchTo} /> : null}
      </RepoProvider>
    </NextIntlClientProvider>,
  );
}

function rowFor(path: string): HTMLElement {
  return screen.getByText(path).closest("div")!;
}

beforeEach(() => {
  agentMutate.mockReset();
  skillMutate.mockReset();
  localStorage.removeItem("dd-repo");
  box.docs.current = { r1: DOC_LIST, r2: DOC_LIST_R2 };
  box.agentPaths.current = { r1: ["specs/api-layering.md"], r2: ["specs/checkout-conventions.md"] };
  box.skillPaths.current = { r1: [] };
});

describe("ProjectContextPicker — listing", () => {
  it("renders attached rows first in saved order (numbered, draggable), then unattached docs", () => {
    box.agentPaths.current = { ...box.agentPaths.current, r1: ["docs/architecture.md", "specs/api-layering.md"] };
    renderWithIntl(<ProjectContextPicker ownerKind="agent" ownerId="ag1" />);
    // attached first in saved order, then unattached sorted by path
    const rows = screen.getAllByText(/\.md/).map((r) => r.textContent);
    expect(rows).toEqual(["docs/architecture.md", "specs/api-layering.md", "insights/postmortems.md"]);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    // only attached rows carry the draggable attr (INSIGHT 2026-09-21)
    expect(rowFor("docs/architecture.md").getAttribute("draggable")).toBe("true");
    expect(rowFor("insights/postmortems.md").getAttribute("draggable")).toBeNull();
    // badge + root-type tags + per-doc estimates
    expect(screen.getByText("2 of 3 attached")).toBeInTheDocument();
    expect(screen.getByText("specs")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("insights")).toBeInTheDocument();
    expect(screen.getByText("≈100 tk")).toBeInTheDocument();
  });

  it("shows the combined-token footer and the untrusted-block note", () => {
    renderWithIntl(<ProjectContextPicker ownerKind="agent" ownerId="ag1" />);
    expect(screen.getByText("≈100 tokens")).toBeInTheDocument();
    expect(
      screen.getByText(/untrusted “## Project context” block into every run of this agent/),
    ).toBeInTheDocument();
  });

  it("renders attached-but-undiscovered paths as clearly-marked missing entries", () => {
    box.agentPaths.current = { ...box.agentPaths.current, r1: ["specs/deleted.md", "specs/api-layering.md"] };
    renderWithIntl(<ProjectContextPicker ownerKind="agent" ownerId="ag1" />);
    expect(screen.getByText("specs/deleted.md")).toBeInTheDocument();
    expect(screen.getByText("missing")).toBeInTheDocument();
    // missing paths contribute 0 tokens to the footer
    expect(screen.getByText("≈100 tokens")).toBeInTheDocument();
  });

  it("offers no in-surface repo selection (the global selector owns the choice)", () => {
    renderWithIntl(<ProjectContextPicker ownerKind="agent" ownerId="ag1" />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("ProjectContextPicker — editing the set", () => {
  it("ticking an unattached doc PUTs the whole ordered list with it appended", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ProjectContextPicker ownerKind="agent" ownerId="ag1" />);
    await user.click(rowFor("docs/architecture.md").querySelector('button[role="checkbox"]')!);
    expect(agentMutate).toHaveBeenCalledWith({
      ownerId: "ag1",
      repoId: "r1",
      paths: ["specs/api-layering.md", "docs/architecture.md"],
    });
  });

  it("unticking an attached doc PUTs the list without it (missing entries clean up the same way)", async () => {
    const user = userEvent.setup();
    box.agentPaths.current = { ...box.agentPaths.current, r1: ["specs/api-layering.md", "docs/architecture.md"] };
    renderWithIntl(<ProjectContextPicker ownerKind="agent" ownerId="ag1" />);
    await user.click(rowFor("specs/api-layering.md").querySelector('button[role="checkbox"]')!);
    expect(agentMutate).toHaveBeenCalledWith({
      ownerId: "ag1",
      repoId: "r1",
      paths: ["docs/architecture.md"],
    });
  });

  it("keyboard move down on the first attached row PUTs the reordered list", async () => {
    const user = userEvent.setup();
    box.agentPaths.current = { ...box.agentPaths.current, r1: ["specs/api-layering.md", "docs/architecture.md"] };
    renderWithIntl(<ProjectContextPicker ownerKind="agent" ownerId="ag1" />);
    await user.click(rowFor("specs/api-layering.md").querySelector('button[aria-label="Move down"]')!);
    expect(agentMutate).toHaveBeenCalledWith({
      ownerId: "ag1",
      repoId: "r1",
      paths: ["docs/architecture.md", "specs/api-layering.md"],
    });
  });

  it("the text filter narrows rows by path", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ProjectContextPicker ownerKind="agent" ownerId="ag1" />);
    await user.type(screen.getByLabelText("Filter documents"), "architecture");
    expect(screen.getByText("docs/architecture.md")).toBeInTheDocument();
    expect(screen.queryByText("specs/api-layering.md")).not.toBeInTheDocument();
    expect(screen.queryByText("insights/postmortems.md")).not.toBeInTheDocument();
  });
});

describe("ProjectContextPicker — preview + skill variant", () => {
  it("opens a markdown preview modal for a discovered doc", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ProjectContextPicker ownerKind="agent" ownerId="ag1" />);
    await user.click(screen.getAllByRole("button", { name: "Preview" })[0]!);
    const dialog = screen.getByRole("dialog");
    expect(screen.getByRole("heading", { name: "Api layering" })).toBeInTheDocument();
    // rendered markdown, not raw source (code span rendered, no backticks)
    expect(dialog.textContent).toContain("must not import");
    expect(dialog.textContent).not.toContain("`");
  });

  it("skill variant saves through the skill endpoint and shows the inheritance note + serialization preview", async () => {
    const user = userEvent.setup();
    box.skillPaths.current = { r1: ["specs/api-layering.md", "docs/architecture.md"] };
    renderWithIntl(<ProjectContextPicker ownerKind="skill" ownerId="sk1" showSkillNote />);
    expect(screen.getByText(/Any agent using this skill inherits these documents/)).toBeInTheDocument();
    expect(screen.getByText("SERIALIZES AS")).toBeInTheDocument();
    const serializesPre = screen
      .getAllByText(/specs\/api-layering\.md/)
      .find((el) => el.tagName === "PRE")!;
    expect(serializesPre.textContent).toBe("specs/api-layering.md\ndocs/architecture.md");
    // edits go through the skill mutation, not the agent one
    await user.click(rowFor("insights/postmortems.md").querySelector('button[role="checkbox"]')!);
    expect(skillMutate).toHaveBeenCalledWith({
      ownerId: "sk1",
      repoId: "r1",
      paths: ["specs/api-layering.md", "docs/architecture.md", "insights/postmortems.md"],
    });
    expect(agentMutate).not.toHaveBeenCalled();
  });

  it("explains itself when the repo has no clone and when nothing is discovered", () => {
    box.docs.current = { r1: { ...DOC_LIST, cloned: false, notice: "no clone", documents: [] }, r2: DOC_LIST_R2 };
    const { rerender } = renderWithIntl(<ProjectContextPicker ownerKind="agent" ownerId="ag1" />);
    expect(screen.getByText(/Import or sync this repository first/)).toBeInTheDocument();
    box.docs.current = { r1: { ...DOC_LIST, documents: [] }, r2: DOC_LIST_R2 };
    rerender(
      <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
        <RepoProvider>
          <ProjectContextPicker ownerKind="agent" ownerId="ag1" />
        </RepoProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/No markdown documents discovered/)).toBeInTheDocument();
  });
});

describe("ProjectContextPicker — follows the global repo selector (edge case)", () => {
  it("switching the global repo presents the new repo's documents and set, discarding unsaved local state; edits target the new repo", async () => {
    const user = userEvent.setup();
    // unsaved local state for r1: a filter narrowing its rows
    renderWithIntl(<ProjectContextPicker ownerKind="agent" ownerId="ag1" />, "r2");
    await user.type(screen.getByLabelText("Filter documents"), "postmortem");
    expect(screen.getByText("insights/postmortems.md")).toBeInTheDocument();
    expect(screen.queryByText("specs/api-layering.md")).not.toBeInTheDocument();

    // flip the GLOBAL selector (the chrome's RepoSwitcher stand-in)
    await user.click(screen.getByRole("button", { name: "Switch global repo to r2" }));

    // the new repo's documents and SAVED set render (attached-first, numbered)
    const rows = screen.getAllByText(/\.md/).map((r) => r.textContent);
    expect(rows).toEqual(["specs/checkout-conventions.md", "docs/r2-guide.md"]);
    expect(screen.getByText("1 of 2 attached")).toBeInTheDocument();
    // the previous repo's rows are gone and the unsaved filter was discarded
    expect(screen.queryByText("specs/api-layering.md")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Filter documents")).toHaveValue("");

    // edits now write the new repo's (agent, repo) set
    await user.click(rowFor("docs/r2-guide.md").querySelector('button[role="checkbox"]')!);
    expect(agentMutate).toHaveBeenCalledWith({
      ownerId: "ag1",
      repoId: "r2",
      paths: ["specs/checkout-conventions.md", "docs/r2-guide.md"],
    });
  });
});
