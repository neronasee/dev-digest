import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
// `box` lets individual tests swap the served trace (see the skills block tests).
const box = vi.hoisted(() => ({ current: undefined as RunTrace | undefined }));
vi.mock("@/lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: box.current, isLoading: false }),
}));

const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 2, grounding: "2/2 passed", grounding_kept: 2, grounding_total: 2, grounding_dropped: 0 },
  prompt_assembly: { system: "You are a reviewer.", skills: "### skill", memory: null, specs: null, user: "Review PR #482" },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

box.current = TRACE;
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("shows the COST stat between TOKENS and FINDINGS", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("$0.060")).toBeInTheDocument();
  });

  it("switches to the live log tab", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    await user.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

describe("RunTraceDrawer — skills block observability", () => {
  afterEach(() => {
    box.current = TRACE;
  });

  it("shows the per-block token count next to the skills block and the loaded skill names", async () => {
    const user = userEvent.setup();
    box.current = {
      ...TRACE,
      prompt_assembly: {
        ...TRACE.prompt_assembly,
        skills: "## branch-coverage\nEnumerate branches.",
        skills_tokens: 421,
        skills_loaded: ["branch-coverage", "corner-cases"],
      },
    };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Test Quality" prNumber={483} onClose={() => {}} />);
    // "Skills loaded" lives in the (open-by-default) Configuration section.
    expect(screen.getByText("Skills loaded")).toBeInTheDocument();
    expect(screen.getByText("branch-coverage")).toBeInTheDocument();
    expect(screen.getByText("corner-cases")).toBeInTheDocument();
    // The token count sits on the skills PromptBlock — expand Prompt assembly.
    await user.click(screen.getByText("Prompt assembly"));
    expect(screen.getByText("~421 tokens")).toBeInTheDocument();
  });

  it("renders no token count and 'none' for loaded skills when the trace has none", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.queryByText(/tokens/)).not.toBeInTheDocument();
    expect(screen.getByText("Skills loaded")).toBeInTheDocument();
  });
});

describe("RunTraceDrawer — grounding and optional telemetry", () => {
  afterEach(() => {
    box.current = TRACE;
  });

  it.each([
    [2, 2, "full"],
    [1, 2, "partial"],
    [0, 2, "zero"],
    [0, 0, "neutral"],
  ] as const)("colors grounding %i/%i as %s", (kept, total, state) => {
    box.current = {
      ...TRACE,
      stats: { ...TRACE.stats, grounding: `${kept}/${total} passed`, grounding_kept: kept, grounding_total: total, grounding_dropped: total - kept },
      memory_pulled: [],
      specs_read: [],
    };
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByTestId("grounding-badge")).toHaveAttribute("data-grounding-state", state);
    expect(screen.queryByText("Memory pulled")).not.toBeInTheDocument();
    expect(screen.queryByText("Specs read")).not.toBeInTheDocument();
  });
});
