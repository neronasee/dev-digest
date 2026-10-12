import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboard, EvalOwnerSummary, EvalSweep, EvalTrendPoint } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

const { pushSpy } = vi.hoisted(() => ({ pushSpy: vi.fn() }));

// AppShell drags in router/repo-context/shortcut machinery — stub it to the
// children (SkillsListView.test.tsx precedent); the breadcrumbs are not this
// view's contract.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn() }),
}));

// Controllable data hooks — every case pins exactly what the two queries return.
let ownersData: EvalOwnerSummary[] | undefined;
let ownersLoading = false;
let dashData: EvalDashboard | undefined;
let dashLoading = false;

vi.mock("@/lib/hooks/evals", () => ({
  useEvalOwners: () => ({ data: ownersData, isLoading: ownersLoading }),
  useEvalDashboard: () => ({ data: dashData, isLoading: dashLoading }),
}));

import { EvalDashboardView } from "./EvalDashboardView";

afterEach(cleanup);

const TREND = (recall: number, ranAt: string): EvalTrendPoint => ({
  ran_at: ranAt,
  recall,
  precision: 1,
  citation_accuracy: 0.5,
  pass_rate: recall,
  cost_usd: 0.02,
});

const SWEEP = (recall: number): EvalSweep =>
  ({
    recall,
    precision: 1,
    citation_accuracy: 0.5,
    traces_passed: 2,
    traces_total: 3,
    duration_ms: 1000,
    cost_usd: 0.02,
    sweep_id: "11111111-1111-1111-1111-111111111111",
    agent_id: "ag1",
    agent_version: 2,
    ran_at: "2026-10-10T12:00:00Z",
    errored: 0,
    per_trace: [],
  }) as EvalSweep;

const OWNER: EvalOwnerSummary = {
  agent_id: "ag1",
  agent_name: "Security Reviewer",
  cases_total: 3,
  latest: SWEEP(0.75),
  trend: [TREND(0.5, "2026-10-09T12:00:00Z"), TREND(0.75, "2026-10-10T12:00:00Z")],
};

const DASH = (overrides: Partial<EvalDashboard> = {}): EvalDashboard => ({
  owner_kind: null,
  owner_id: null,
  cases_total: 3,
  current: {
    recall: 0.75,
    precision: 1,
    citation_accuracy: 0.5,
    traces_passed: 2,
    traces_total: 3,
    cost_usd: 0.02,
  },
  delta: { recall: -0.25, precision: 0, citation_accuracy: 0 },
  trend: OWNER.trend,
  recent_runs: [
    {
      id: "run1",
      case_id: "c1",
      case_name: "stripe-key",
      ran_at: "2026-10-10T12:00:00Z",
      actual_output: {},
      pass: true,
      recall: 1,
      precision: 1,
      citation_accuracy: 1,
      duration_ms: 100,
      cost_usd: 0.0012,
    },
    {
      id: "run2",
      case_id: "c2",
      case_name: "n-plus-one",
      ran_at: "2026-10-10T11:00:00Z",
      actual_output: {},
      pass: false,
      recall: null,
      precision: null,
      citation_accuracy: null,
      duration_ms: null,
      cost_usd: null,
    },
  ],
  alert: null,
  ...overrides,
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

/** The owner CARD root — the name renders in the header row (its own div);
    the picker's <option> shares the text, so pick the non-option and climb from
    the header to the card wrapper that also holds the summary + actions. */
function ownerCard(): HTMLElement {
  return screen
    .getAllByText("Security Reviewer")
    .find((el) => el.tagName !== "OPTION")!
    .closest("div")!.parentElement!;
}

beforeEach(() => {
  pushSpy.mockReset();
  ownersLoading = false;
  dashLoading = false;
  ownersData = [OWNER];
  dashData = DASH();
});

describe("EvalDashboardView — empty states", () => {
  it("no eval owners → the no-runs empty state and no picker/table", () => {
    ownersData = [];
    renderView();
    expect(screen.getByText(/No runs yet\. Create an eval case and run it\./)).toBeInTheDocument();
    expect(screen.queryByText("Security Reviewer")).not.toBeInTheDocument();
    expect(screen.queryByText("Recent runs")).not.toBeInTheDocument();
  });

  it("owners exist but no runs yet → the metric-trend and recent-runs sections go empty", () => {
    ownersData = [{ ...OWNER, latest: null, trend: [] }];
    dashData = DASH({ trend: [], recent_runs: [] });
    renderView();
    // Owner card still renders (cases exist, no sweep yet) with its own empty note.
    const card = ownerCard();
    expect(within(card).getByText(/No runs yet/)).toBeInTheDocument();
    // Both data sections collapse to the empty state — 3 copies total (card + 2).
    expect(screen.getAllByText(/No runs yet/).length).toBe(3);
  });
});

describe("EvalDashboardView — loaded dashboard", () => {
  it("renders owner cards, metric cards, and the recent-runs table with cost + pass badges", async () => {
    const user = userEvent.setup();
    renderView();

    // Owner card: name, cases/runs summary, latest metrics as text, actions.
    const card = ownerCard();
    expect(within(card).getByText("3 eval cases · gold set · 2 runs")).toBeInTheDocument();
    expect(within(card).getByText("Recall 75%")).toBeInTheDocument();
    expect(within(card).getByText("2/3")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Run eval (3)" }));
    expect(pushSpy).toHaveBeenCalledWith("/agents/ag1?tab=evals");

    // Metric cards carry the current values (text, not color).
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();

    // Recent runs: cost via formatCost (null → em-dash), pass/fail as words.
    // (Rows are run aggregates — the table shows metrics, not case names.)
    const row1 = screen.getByText("pass").closest("tr")!;
    expect(within(row1).getByText("$0.0012")).toBeInTheDocument();
    const row2 = screen.getByText("fail").closest("tr")!;
    // 3 null metrics + the unpriced cost — unknown, never $0.00.
    expect(within(row2).getAllByText("—").length).toBe(4);
  });

  it("the degradation banner maps the alert's raw metric names through i18n labels", () => {
    dashData = DASH({ alert: "recall,precision" });
    renderView();
    expect(
      screen.getByText("Degraded vs previous run: RECALL, PRECISION"),
    ).toBeInTheDocument();
  });
});
