import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import { ToastProvider } from "@/lib/toast";

const { updateMutate } = vi.hoisted(() => ({ updateMutate: vi.fn() }));

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: updateMutate, isPending: false, isSuccess: false, data: undefined }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

import { AgentEditor } from "./AgentEditor";

afterEach(cleanup);

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
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
  });
});

describe("AgentEditor — save flow", () => {
  beforeEach(() => {
    updateMutate.mockReset();
  });

  it("editing a field and saving posts the update mutation with the edited payload", async () => {
    const user = userEvent.setup();
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);

    const nameInput = screen.getByDisplayValue("Security Reviewer");
    await user.clear(nameInput);
    await user.type(nameInput, "Pentest Agent");
    await user.click(screen.getByRole("button", { name: /save agent/i }));

    expect(updateMutate).toHaveBeenCalledTimes(1);
    const [input] = updateMutate.mock.calls[0]!;
    expect(input.id).toBe("ag1");
    expect(input.patch).toMatchObject({
      name: "Pentest Agent",
      provider: "openai",
      model: "gpt-4.1",
      enabled: true,
    });
  });
});
