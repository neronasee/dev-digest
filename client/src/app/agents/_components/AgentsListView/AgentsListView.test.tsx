import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentSummary } from "@devdigest/shared";
import messages from "../../../../../messages/en/agents.json";

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: AGENTS, isLoading: false, isError: false, refetch: () => {} }),
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false }),
  // AgentCard leans on the delete hook for its (unopened) confirm modal.
  useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The list view wraps in AppShell (router/repo-context heavy) — render children.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { AgentsListView } from "./AgentsListView";

afterEach(cleanup);

const AGENTS: AgentSummary[] = [
  {
    id: "ag1",
    name: "Test Quality Reviewer",
    description: "Tests the skill_count badge.",
    provider: "openai",
    model: "gpt-4o-mini",
    system_prompt: "Review the diff.",
    output_schema: null,
    enabled: true,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skill_count: 4,
  },
  {
    id: "ag2",
    name: "Plain Reviewer",
    description: "No linked skills.",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "Review the diff.",
    output_schema: null,
    enabled: false,
    version: 1,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    skill_count: 0,
  },
];

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <AgentsListView />
    </NextIntlClientProvider>,
  );
}

describe("AgentsListView — skill counts", () => {
  it("renders the AgentSummary skill_count badge on every card", () => {
    renderView();
    expect(screen.getByText("Test Quality Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Plain Reviewer")).toBeInTheDocument();
    // AgentCard's "{count} skills" badge — present only when skillCount is passed.
    expect(screen.getByText("4 skills")).toBeInTheDocument();
    expect(screen.getByText("0 skills")).toBeInTheDocument();
  });
});
