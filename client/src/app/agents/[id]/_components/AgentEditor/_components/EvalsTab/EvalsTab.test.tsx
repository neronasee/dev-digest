import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalCase, EvalSweep } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/eval.json";

const { runCaseMutate, runSweepMutate, deleteMutate } = vi.hoisted(() => ({
  runCaseMutate: vi.fn(),
  runSweepMutate: vi.fn(),
  deleteMutate: vi.fn(),
}));

// Controllable per-test state for the run-case mutation (AC-16 pending gate).
let runCaseState: { mutate: ReturnType<typeof vi.fn>; isPending: boolean; variables?: string } = {
  mutate: runCaseMutate,
  isPending: false,
};

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: vi.fn(),
  useEvalSweeps: vi.fn(),
  useRunEvalCase: () => runCaseState,
  useRunEvalSweep: () => ({ mutate: runSweepMutate, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: deleteMutate, isPending: false }),
}));

// The shared modal and compare modal are stubbed — their own behavior has
// dedicated tests; here only the OPEN/INTERACT wiring of the tab is asserted.
vi.mock("@/components/eval-case-modal", () => ({
  EvalCaseModal: () => <div data-testid="eval-case-modal-stub" />,
}));
vi.mock("../CompareRunsModal", () => ({
  CompareRunsModal: () => <div data-testid="compare-stub" />,
}));

import { EvalsTab } from "./EvalsTab";
import * as evalsHooks from "@/lib/hooks/evals";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "review",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 2,
};

const CASE = (id: string, name: string): EvalCase => ({
  id,
  owner_kind: "agent",
  owner_id: "ag1",
  name,
  input_diff: "diff",
  input_files: null,
  input_meta: null,
  expected_output: {},
  notes: null,
});

const TRACE = (caseId: string, pass: boolean, recall = pass ? 1 : 0.5) => ({
  name: "case",
  pass,
  expected: {},
  actual: {},
  case_id: caseId,
  recall,
  precision: 1,
  citation_accuracy: 1,
  duration_ms: 100,
  cost_usd: 0.01,
  error: null,
});

const SWEEP = (sweepId: string, version: number, perTrace: ReturnType<typeof TRACE>[]): EvalSweep =>
  ({
    recall: 0.75,
    precision: 1,
    citation_accuracy: 1,
    traces_passed: perTrace.filter((tr) => tr.pass).length,
    traces_total: perTrace.length,
    duration_ms: 1000,
    cost_usd: 0.02,
    sweep_id: sweepId,
    agent_id: "ag1",
    agent_version: version,
    ran_at: "2026-10-10T12:00:00Z",
    errored: 0,
    per_trace: perTrace,
  }) as EvalSweep;

function mockData(cases: EvalCase[] | undefined, sweeps: EvalSweep[]) {
  vi.mocked(evalsHooks.useEvalCases).mockReturnValue({
    data: cases,
    isLoading: false,
  } as never);
  vi.mocked(evalsHooks.useEvalSweeps).mockReturnValue({ data: sweeps } as never);
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalsTab agent={AGENT} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  runCaseState = { mutate: runCaseMutate, isPending: false };
  runCaseMutate.mockReset();
  runSweepMutate.mockReset();
  deleteMutate.mockReset();
});

describe("EvalsTab — cases table latest outcome", () => {
  it("shows passed/failed/never run from the newest trace per case", () => {
    mockData(
      [CASE("c1", "stripe-key"), CASE("c2", "n-plus-one"), CASE("c3", "clean-diff")],
      [
        SWEEP("sw-new", 2, [TRACE("c1", true)]),
        SWEEP("sw-old", 1, [TRACE("c1", false), TRACE("c2", false, 0.5)]),
      ],
    );
    renderTab();

    const row1 = screen.getByText("stripe-key").closest("tr")!;
    expect(within(row1).getByText("passed")).toBeInTheDocument();
    expect(within(row1).getByText(/recall 100%/)).toBeInTheDocument();

    const row2 = screen.getByText("n-plus-one").closest("tr")!;
    expect(within(row2).getByText("failed")).toBeInTheDocument();
    expect(within(row2).getByText(/recall 50%/)).toBeInTheDocument();

    const row3 = screen.getByText("clean-diff").closest("tr")!;
    expect(within(row3).getByText("never run")).toBeInTheDocument();
  });

  it("shows the empty state and a disabled sweep trigger when there are no cases", () => {
    mockData([], []);
    renderTab();
    expect(
      screen.getByText(/No eval cases yet/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run eval \(0\)/ })).toBeDisabled();
  });
});

describe("EvalsTab — case actions", () => {
  it("a running case disables only ITS OWN Run trigger (AC-16)", () => {
    mockData([CASE("c1", "stripe-key"), CASE("c2", "n-plus-one")], []);
    runCaseState = { mutate: runCaseMutate, isPending: true, variables: "c2" };
    renderTab();

    const row2 = screen.getByText("n-plus-one").closest("tr")!;
    expect(within(row2).getByRole("button", { name: "Running…" })).toBeDisabled();

    const row1 = screen.getByText("stripe-key").closest("tr")!;
    const run1 = within(row1).getByRole("button", { name: "Run" });
    expect(run1).toBeEnabled();
  });

  it("Run triggers the single-case mutation; Delete opens the confirm; New case opens the modal", async () => {
    const user = userEvent.setup();
    mockData([CASE("c1", "stripe-key")], []);
    renderTab();

    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(runCaseMutate).toHaveBeenCalledWith("c1");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("dialog");
    expect(within(confirm).getByText("Delete eval case")).toBeInTheDocument();
    expect(within(confirm).getByText(/stripe-key/)).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "New case" }));
    expect(screen.getByTestId("eval-case-modal-stub")).toBeInTheDocument();
  });

  it("Run eval posts the sweep mutation with the case count on the trigger", async () => {
    const user = userEvent.setup();
    mockData([CASE("c1", "stripe-key"), CASE("c2", "n-plus-one")], []);
    renderTab();
    await user.click(screen.getByRole("button", { name: "Run eval (2)" }));
    expect(runSweepMutate).toHaveBeenCalledTimes(1);
  });
});

describe("EvalsTab — run history + compare", () => {
  it("renders history rows with version, pass state, and cost; compare opens the modal", async () => {
    const user = userEvent.setup();
    mockData(
      [CASE("c1", "stripe-key")],
      [SWEEP("sw-new", 2, [TRACE("c1", true)]), SWEEP("sw-old", 1, [TRACE("c1", false)])],
    );
    renderTab();

    expect(screen.getByText("v2")).toBeInTheDocument();
    // formatCost keeps 2 significant digits: 0.02 → "$0.020" (never $0.00).
    expect(screen.getAllByText("$0.020").length).toBe(2);
    expect(screen.getAllByText("failed").length).toBeGreaterThan(0);

    // Both picks default to the two newest sweeps → compare opens directly.
    await user.click(screen.getByRole("button", { name: "Compare runs" }));
    expect(screen.getByTestId("compare-stub")).toBeInTheDocument();
  });

  it("disables Compare until two DIFFERENT sweeps are picked", () => {
    mockData([CASE("c1", "stripe-key")], [SWEEP("sw-new", 2, [TRACE("c1", true)])]);
    renderTab();
    // Only one sweep → pickA === pickB (both default to it) → disabled.
    expect(screen.getByRole("button", { name: "Compare runs" })).toBeDisabled();
  });
});
