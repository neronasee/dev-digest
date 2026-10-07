/**
 * PrBriefCard — the PR Brief Overview surface, through the REAL hooks (fetch
 * stubbed per the house rule; the stub serves every URL the mounted tree
 * fetches): the none-state Generate card (AC-1), the pending/disabled +
 * announced in-flight state (AC-2), the populated card (summary, severity-
 * tagged risk rows, ordered focus rows — AC-3/a11y), risk expansion (AC-23),
 * missing-input labels (AC-4), both empty-list messages (AC-5), the focus-row
 * deep-link callback + "not in this PR's diff" hint (AC-6/AC-24), the stale
 * note + Refresh relabel (AC-8/AC-20), the failed-generation error + Retry
 * (AC-10), and the verdict banner ABOVE the summary (AC-22). The provider
 * passes ONLY the `brief` namespace by default so a missing key fails loudly
 * (AC-14); the AC-22 case adds `prReview` because VerdictBanner mounts it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBrief, PrBriefResponse, ReviewRecord } from "@devdigest/shared";
import briefMessages from "../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import { PrBriefCard } from "./PrBriefCard";

afterEach(cleanup);

const PR_ID = "pr-1";

const BRIEF: PrBrief = {
  summary: "Rate-limits the public API to stop credential-stuffing abuse.",
  risks: {
    risks: [
      {
        kind: "security",
        title: "Limiter keyed by IP only",
        explanation: "Behind the shared egress proxy every tenant shares one IP.",
        severity: "high",
        file_refs: ["src/pay.ts", "src/limiter.ts"],
      },
      {
        kind: "bug",
        title: "Off-by-one in the sliding window",
        explanation: "The window drops the newest entry instead of the oldest.",
        severity: "medium",
        file_refs: ["src/pay.ts"],
      },
    ],
  },
  review_focus: [
    { file: "src/pay.ts", line: 12, reason: "Entry point of the request path." },
    { file: "src/upstream.ts", line: 3, reason: "Blast-map caller of the changed symbol." },
  ],
  generation: {
    model: "openai/gpt-4.1",
    cost_usd: 0.012,
    prompt_tokens: 4200,
    completion_tokens: 350,
    generated_for_sha: "abc123",
    generated_at: "2026-10-01T10:00:00.000Z",
    missing_inputs: [],
    dropped_ungrounded: 1,
  },
};

function review(o: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "rev1",
    pr_id: PR_ID,
    agent_id: null,
    run_id: null,
    agent_name: "guardian",
    kind: "review",
    verdict: "request_changes",
    summary: "Solid hardening; one edge case.",
    score: 74,
    model: null,
    grounding: null,
    grounding_dropped: null,
    blockers: 1,
    created_at: "2026-10-02T10:00:00.000Z",
    findings: [
      { id: "f1" } as ReviewRecord["findings"][number],
      { id: "f2" } as ReviewRecord["findings"][number],
    ],
    ...o,
  };
}

const resp = (brief: PrBrief | null, stale = false): PrBriefResponse => ({
  pr_id: PR_ID,
  brief,
  current_head_sha: "def456",
  stale,
});

const res = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

/** A controllable POST outcome for the pending/error flows. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res2) => {
    resolve = res2;
  });
  return { promise, resolve };
}

type FetchPlan = {
  get?: PrBriefResponse;
  post?: () => Promise<Response>;
  onPost?: () => void;
};

function stubBriefFetch(plan: FetchPlan) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith(`/pulls/${PR_ID}/brief`) && method === "POST") {
      plan.onPost?.();
      return plan.post ? plan.post() : res(resp(BRIEF));
    }
    if (url.endsWith(`/pulls/${PR_ID}/brief`)) {
      return res(plan.get ?? resp(null));
    }
    throw new Error(`[test] unexpected fetch ${method} ${url}`);
  });
}

function renderCard(
  props: Partial<Parameters<typeof PrBriefCard>[0]> = {},
  messages: AbstractIntlMessages = { brief: briefMessages },
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={messages}>
        <PrBriefCard
          prId={PR_ID}
          prFilePaths={["src/pay.ts", "src/limiter.ts"]}
          latestReview={null}
          onFocusItem={() => {}}
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("PrBriefCard", () => {
  it("AC-1: none-state renders the Generate action and zero model-written content", async () => {
    vi.stubGlobal("fetch", stubBriefFetch({ get: resp(null) }));
    renderCard();

    expect(await screen.findByRole("button", { name: /generate brief/i })).toBeEnabled();
    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    // No model-written content sneaks into the none-state.
    expect(screen.queryByText(BRIEF.summary)).not.toBeInTheDocument();
    expect(screen.queryByText("Risk areas")).not.toBeInTheDocument();
    expect(screen.queryByText("Review focus")).not.toBeInTheDocument();
  });

  it("AC-2: pending disables the trigger and announces 'Generating…'; the response swaps the card in place", async () => {
    const gate = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      stubBriefFetch({ get: resp(null), post: () => gate.promise }),
    );
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: /generate brief/i }));

    // Visible in-flight state inside the polite live region + disabled trigger.
    expect(await screen.findByText("Generating…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate brief/i })).toBeDisabled();

    // onSuccess writes the POST response into the read cache — no refetch.
    gate.resolve(res(resp(BRIEF)));
    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
  });

  it("AC-3/a11y: populated card renders summary, severity-tagged risk rows with file refs, and ordered focus rows; AC-23: expansion reveals the explanation", async () => {
    vi.stubGlobal("fetch", stubBriefFetch({ get: resp(BRIEF) }));
    const user = userEvent.setup();
    renderCard();

    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();

    // Risk rows: severity is readable TEXT (never color alone) + the files it concerns.
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Limiter keyed by IP only")).toBeInTheDocument();
    expect(screen.getByText("src/pay.ts · src/limiter.ts")).toBeInTheDocument();

    // Explanation is hidden until the row expands (AC-23).
    expect(screen.queryByText(/Behind the shared egress proxy/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Limiter keyed by IP only/ }));
    expect(screen.getByText(/Behind the shared egress proxy/)).toBeInTheDocument();

    // Ordered focus rows: numbered `file:line` + reason, real buttons.
    const focusRow = screen.getByRole("button", { name: /src\/pay\.ts:12/ });
    expect(focusRow).toHaveTextContent("Entry point of the request path.");
    expect(screen.getByRole("button", { name: /src\/upstream\.ts:3/ })).toBeInTheDocument();

    // Footer: generated-at age + the generation model chip.
    expect(screen.getByText(/Generated .+ ago/)).toBeInTheDocument();
    expect(screen.getByText("openai/gpt-4.1")).toBeInTheDocument();
  });

  it("AC-4: one visible label per missing input kind", async () => {
    const brief: PrBrief = {
      ...BRIEF,
      generation: {
        ...BRIEF.generation,
        missing_inputs: ["intent", "blast"],
      },
    };
    vi.stubGlobal("fetch", stubBriefFetch({ get: resp(brief) }));
    renderCard();

    const note = await screen.findByText(/Generated without:/);
    expect(note).toHaveTextContent("intent");
    expect(note).toHaveTextContent("blast radius");
  });

  it("AC-5: empty risks and empty focus render their explicit empty messages", async () => {
    const brief: PrBrief = { ...BRIEF, risks: { risks: [] }, review_focus: [] };
    vi.stubGlobal("fetch", stubBriefFetch({ get: resp(brief) }));
    renderCard();

    expect(await screen.findByText("No notable risks flagged.")).toBeInTheDocument();
    expect(
      screen.getByText("No review-focus items — start with the Risk areas above."),
    ).toBeInTheDocument();
  });

  it("AC-6/AC-24: a focus-row click fires onFocusItem(file, line); non-diff files get the hint", async () => {
    vi.stubGlobal("fetch", stubBriefFetch({ get: resp(BRIEF) }));
    const onFocusItem = vi.fn();
    const user = userEvent.setup();
    renderCard({ onFocusItem });

    await user.click(await screen.findByRole("button", { name: /src\/pay\.ts:12/ }));
    expect(onFocusItem).toHaveBeenCalledWith("src/pay.ts", 12);

    // upstream.ts lives only in the blast map → exactly one hint, on that row.
    const hinted = screen.getByText("not in this PR's diff");
    expect(hinted.closest("button")).toHaveTextContent("src/upstream.ts:3");
    expect(
      within(screen.getByRole("button", { name: /src\/pay\.ts:12/ })).queryByText(
        "not in this PR's diff",
      ),
    ).not.toBeInTheDocument();
  });

  it("AC-8/AC-20: a stale brief shows the stale note and relabels the action to Refresh", async () => {
    vi.stubGlobal("fetch", stubBriefFetch({ get: resp(BRIEF, true) }));
    renderCard();

    expect(await screen.findByText(/generated for an earlier commit/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate brief/i })).not.toBeInTheDocument();
  });

  it("AC-10: a rejected POST surfaces the server error and Retry re-invokes the mutation", async () => {
    let postCalls = 0;
    vi.stubGlobal(
      "fetch",
      stubBriefFetch({
        get: resp(BRIEF), // a previously generated brief stays on screen
        post: () => {
          postCalls++;
          return Promise.resolve(
            res({ error: { code: "llm_failed", message: "Model unavailable" } }, 503),
          );
        },
      }),
    );
    const user = userEvent.setup();
    renderCard();

    // The cached brief is NOT destroyed by the failed refresh (AC-10).
    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /generate brief/i }));

    expect(await screen.findByText(/Model unavailable/)).toBeInTheDocument();
    expect(screen.getByText(BRIEF.summary)).toBeInTheDocument(); // still there

    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(postCalls).toBe(2));
  });

  it("AC-22: the verdict banner renders ABOVE the summary text; a null verdict renders none", async () => {
    vi.stubGlobal("fetch", stubBriefFetch({ get: resp(BRIEF) }));
    const messages = { brief: briefMessages, prReview: prReviewMessages };
    const { rerender } = renderCard({ latestReview: review() }, messages);

    const banner = await screen.findByText("Request changes");
    const summary = screen.getByText(BRIEF.summary);
    // DOM order: the banner precedes the summary.
    expect(
      banner.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Null verdict → no banner at all.
    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <NextIntlClientProvider locale="en" messages={messages}>
          <PrBriefCard
            prId={PR_ID}
            prFilePaths={["src/pay.ts"]}
            latestReview={review({ verdict: null })}
            onFocusItem={() => {}}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    expect(screen.queryByText("Request changes")).not.toBeInTheDocument();
  });
});
