import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ProjectDocList, ProjectDocUsage } from "@devdigest/shared";
import contextMessages from "../../../../../../../messages/en/context.json";

const { rescanMutate } = vi.hoisted(() => ({ rescanMutate: vi.fn() }));
const box = vi.hoisted(() => ({
  docs: { current: undefined as ProjectDocList | undefined },
  usage: { current: [] as ProjectDocUsage[] },
}));

const CONTENT: Record<string, string> = {
  "specs/api-layering.md": "# Api layering\n\nThe module `api/` must not import `db/` directly.",
  "docs/architecture.md": "# Architecture\n\nLayered services.",
  "insights/postmortems.md": "# Postmortems\n\nRate-limit incidents.",
};

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/payments-api", default_branch: "main" },
  }),
  useRepoNotFound: () => false,
}));

vi.mock("@/lib/hooks/project-context", () => ({
  useProjectDocuments: () => ({ data: box.docs.current, isLoading: false, isError: false, refetch: vi.fn() }),
  useProjectDocument: (_repoId: string | null, path: string | null) => ({
    data: path != null ? { path, content: CONTENT[path] ?? "" } : undefined,
    isLoading: false,
  }),
  useDocumentUsage: () => ({ data: box.usage.current }),
  useRescanDocuments: () => ({ mutate: rescanMutate, isPending: false }),
}));

import { ProjectContextView } from "./ProjectContextView";

afterEach(cleanup);

function renderView() {
  render(
    <NextIntlClientProvider locale="en" messages={{ context: contextMessages }}>
      <ProjectContextView />
    </NextIntlClientProvider>,
  );
}

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

beforeEach(() => {
  rescanMutate.mockReset();
  box.docs.current = DOC_LIST;
  box.usage.current = [
    { path: "specs/api-layering.md", agent_count: 2 },
    { path: "docs/architecture.md", agent_count: 0 },
  ];
});

describe("ProjectContextView (read-only page)", () => {
  it("groups the tree by root folder, renders the selected doc as markdown, and shows the discovery-facts footer", async () => {
    renderView();
    // tree groups (roots alphabetical)
    expect(screen.getByText("docs/")).toBeInTheDocument();
    expect(screen.getByText("insights/")).toBeInTheDocument();
    expect(screen.getByText("specs/")).toBeInTheDocument();
    // default selection = first doc of the first group (docs/architecture.md)
    expect(screen.getByRole("heading", { name: "Architecture" })).toBeInTheDocument();
    expect(screen.getByText("Used by 0 agents")).toBeInTheDocument();
    // selecting the spec swaps the reader and shows its adoption
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /api-layering\.md/ }));
    expect(screen.getByRole("heading", { name: "Api layering" })).toBeInTheDocument();
    expect(screen.getByText("specs/api-layering.md")).toBeInTheDocument();
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();
    // footer: mechanical discovery facts only (AC-24)
    const footer = screen.getByText((_, el) => el?.textContent?.startsWith("3 files") ?? false);
    expect(footer.textContent).toContain("≈330 tokens");
    expect(footer.textContent).toContain("refreshed");
  });

  it("re-scans from the header button (AC-25)", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: /re-scan/i }));
    expect(rescanMutate).toHaveBeenCalledWith("r1");
  });

  it("shows the import-first empty state when the repo has no clone (AC-3)", () => {
    box.docs.current = { ...DOC_LIST, cloned: false, notice: "no clone", documents: [] };
    renderView();
    expect(screen.getByText("No local clone yet")).toBeInTheDocument();
    expect(screen.getByText(/Import or sync this repository first/)).toBeInTheDocument();
    // read-only page: no re-scan without a clone, no footer
    expect(screen.queryByRole("button", { name: /re-scan/i })).not.toBeInTheDocument();
    expect(screen.queryByText((_, el) => el?.textContent?.includes("files") ?? false)).not.toBeInTheDocument();
  });

  it("shows the repository-pointing empty state with a working re-scan when nothing is discovered (AC-23)", async () => {
    box.docs.current = { ...DOC_LIST, documents: [] };
    renderView();
    expect(screen.getByText("No markdown documents found")).toBeInTheDocument();
    expect(screen.getByText(/Add documents to the repository itself/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: /re-scan/i })[0]!);
    expect(rescanMutate).toHaveBeenCalledWith("r1");
  });
});
