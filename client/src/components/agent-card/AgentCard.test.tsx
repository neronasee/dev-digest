import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent } from "@devdigest/shared";
import messages from "../../../messages/en/agents.json";
import { AgentCard } from "./AgentCard";

const { deleteMutate } = vi.hoisted(() => ({ deleteMutate: vi.fn() }));

vi.mock("@/lib/hooks/agents", () => ({
  useDeleteAgent: () => ({ mutate: deleteMutate, isPending: false }),
}));

afterEach(cleanup);

beforeEach(() => {
  deleteMutate.mockReset();
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("AgentCard (smoke)", () => {
  it("renders the agent name, model chip and skill count", () => {
    renderWithIntl(<AgentCard ag={AGENT} skillCount={3} />);
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(screen.getByText("3 skills")).toBeInTheDocument();
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderWithIntl(<AgentCard ag={{ ...AGENT, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("delete opens the confirmation modal; confirming calls the delete mutation (no window.confirm)", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    renderWithIntl(<AgentCard ag={AGENT} />);
    await user.click(screen.getByRole("button", { name: "Delete agent" }));
    // The modal asks with the agent's name; nothing deleted yet.
    expect(screen.getByText(/Delete agent “Security Reviewer”\?/)).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(deleteMutate).toHaveBeenCalledWith("ag1");
    confirmSpy.mockRestore();
  });
});
