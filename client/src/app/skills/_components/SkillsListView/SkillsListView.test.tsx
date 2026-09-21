import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { SkillSummary } from "@devdigest/shared";
import messages from "../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const { updateMutate, deleteMutate } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  deleteMutate: vi.fn(),
}));

vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false, isError: false, refetch: () => {} }),
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteSkill: () => ({ mutate: deleteMutate, isPending: false }),
}));

// The list view wraps in AppShell (router/repo-context heavy) — render children.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// The preview drawer's footer navigates to the detail editor.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { SkillsListView } from "./SkillsListView";

afterEach(cleanup);

const SKILLS: SkillSummary[] = [
  {
    id: "sk1",
    name: "breaking-change",
    description: "Flag breaks of existing callers.",
    type: "convention",
    source: "manual",
    body: "# Rule",
    enabled: true,
    version: 3,
    agent_count: 1,
  },
  {
    id: "sk2",
    name: "flake-watch",
    description: "Flag flake vectors.",
    type: "convention",
    source: "imported_file",
    body: "# Rule 2",
    enabled: false,
    version: 1,
    agent_count: 2,
  },
];

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <SkillsListView />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  updateMutate.mockReset();
  deleteMutate.mockReset();
});

describe("SkillsListView", () => {
  it("renders cards with name, type, description, version, agent count and source", () => {
    renderView();
    expect(screen.getByText("breaking-change")).toBeInTheDocument();
    expect(screen.getByText("Flag breaks of existing callers.")).toBeInTheDocument();
    expect(screen.getAllByText("convention").length).toBe(2); // one chip per card
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("1 agent")).toBeInTheDocument();
    expect(screen.getByText("2 agents")).toBeInTheDocument();
    expect(screen.getByText("Imported")).toBeInTheDocument();
  });

  it("the enabled toggle calls the update mutation with {enabled}", async () => {
    const user = userEvent.setup();
    renderView();
    const card = screen.getByText("breaking-change").closest("div")!;
    await user.click(card.querySelector('button[role="switch"]')!);
    expect(updateMutate).toHaveBeenCalledWith({ id: "sk1", patch: { enabled: false } });
  });

  it("delete opens a confirmation modal; confirming calls the delete mutation", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getAllByRole("button", { name: "Delete skill" })[0]!);
    // Confirm modal appears with the skill's name, NOT deleted yet.
    expect(screen.getByText(/Delete skill “breaking-change”/)).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(deleteMutate).toHaveBeenCalledWith("sk1", expect.anything());
  });

  it("card click opens the SIDE preview drawer (with rendered body + editor link), not the create modal", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByText("breaking-change"));
    // Drawer content: the untrusted-free manual skill shows badges + footer link.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Open full editor →")).toBeInTheDocument();
    expect(screen.queryByText("Create skill")).not.toBeInTheDocument();
  });

  it("search filters the grid by name", async () => {
    const user = userEvent.setup();
    renderView();
    await user.type(screen.getByPlaceholderText("Search skills…"), "flake");
    expect(screen.getByText("flake-watch")).toBeInTheDocument();
    expect(screen.queryByText("breaking-change")).not.toBeInTheDocument();
  });
});
