import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/prReview.json";

const { runMutateAsync } = vi.hoisted(() => ({ runMutateAsync: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
      { id: "a2", name: "Perf", model: "gpt-4.1-mini", enabled: false },
    ],
  }),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync: runMutateAsync, isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(cleanup);

beforeEach(() => {
  runMutateAsync.mockReset();
  runMutateAsync.mockResolvedValue({ runs: [{ run_id: "run-9" }] });
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("RunReviewDropdown (smoke)", () => {
  it("renders the trigger label", () => {
    renderWithIntl(<RunReviewDropdown prId="pr1" />);
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });
});

describe("RunReviewDropdown — run flows", () => {
  it("choosing an agent runs that agent and hands its runId up", async () => {
    const user = userEvent.setup();
    const onRunsStarted = vi.fn();
    renderWithIntl(<RunReviewDropdown prId="pr1" onRunsStarted={onRunsStarted} />);

    await user.click(screen.getByRole("button", { name: /run review/i }));
    await user.click(screen.getByRole("button", { name: /security/i }));

    await waitFor(() => expect(onRunsStarted).toHaveBeenCalledWith(["run-9"]));
    expect(runMutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentId: "a1" });
  });

  it("Run all targets the enabled agents via the all flag", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RunReviewDropdown prId="pr1" />);

    await user.click(screen.getByRole("button", { name: /run review/i }));
    await user.click(screen.getByRole("button", { name: /run all enabled agents/i }));

    expect(runMutateAsync).toHaveBeenCalledWith({ prId: "pr1", all: true });
  });
});
