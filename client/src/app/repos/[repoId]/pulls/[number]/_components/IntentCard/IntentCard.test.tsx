/**
 * IntentCard — the Intent Layer's Overview surface, through the REAL hooks
 * (fetch stubbed per the house rule): the 200 fixture renders goal/scope/
 * confidence/provenance/category, a 404 renders the run-a-review empty state,
 * and the feedback control fires PUT /pulls/:id/intent/feedback and refetches.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntentDetail } from "@/lib/types";
import messages from "../../../../../../../../messages/en/prReview.json";
import { IntentCard } from "./IntentCard";

afterEach(cleanup);

const DETAIL: PrIntentDetail = {
  reasoning: "Body and issue state the hardening goal.",
  intent: "Rate-limit the public API endpoints.",
  category: "feature",
  breaking_change: false,
  in_scope: ["public endpoints", "limiter middleware"],
  out_of_scope: ["admin routes"],
  confidence: 0.86,
  evidence_used: ["title", "description", "linked_issue", "diff"],
  pr_id: "pr-1",
  inferred: false,
  sources: [
    { source: "title" },
    { source: "description" },
    { source: "linked_issue", detail: "#471" },
  ],
  model: "deepseek/deepseek-v4-flash",
  cost_usd: 0.0007,
  derived_at: "2026-09-24T10:00:00.000Z",
  feedback: null,
  feedback_note: null,
};

const res = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

function stubIntentFetch(opts: { status?: number } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/intent/feedback") && method === "PUT") {
      return res({ ...DETAIL, feedback: "incorrect", feedback_note: undefined });
    }
    if (url.endsWith("/intent")) {
      if (opts.status && opts.status !== 200) {
        return res({ error: { code: "not_found", message: "Intent not found" } }, opts.status);
      }
      return res(DETAIL);
    }
    throw new Error(`[test] unexpected fetch ${method} ${url}`);
  });
}

function renderCard(prId: string | null = "pr-1") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <IntentCard prId={prId} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("IntentCard", () => {
  it("renders the goal quote, both scope columns, confidence word, provenance and the category chip (200)", async () => {
    vi.stubGlobal("fetch", stubIntentFetch());
    renderCard();

    expect(await screen.findByText("“Rate-limit the public API endpoints.”")).toBeInTheDocument();
    expect(screen.getByText("In scope")).toBeInTheDocument();
    expect(screen.getByText("public endpoints")).toBeInTheDocument();
    expect(screen.getByText("limiter middleware")).toBeInTheDocument();
    expect(screen.getByText("Out of scope")).toBeInTheDocument();
    expect(screen.getByText("admin routes")).toBeInTheDocument();
    expect(screen.getByText("High confidence")).toBeInTheDocument();
    // Raw % lives ONLY in the tooltip.
    expect(screen.getByTitle("86%")).toBeInTheDocument();
    expect(screen.queryByText("86%")).not.toBeInTheDocument();
    expect(
      screen.getByText(/title, description, issue #471 · deepseek\/deepseek-v4-flash · 2026-09-24/),
    ).toBeInTheDocument();
    expect(screen.getByText("feature")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /re-derive/i })).toBeInTheDocument();
  });

  it("renders the run-a-review empty state on 404 (absent intent is not an error)", async () => {
    vi.stubGlobal("fetch", stubIntentFetch({ status: 404 }));
    renderCard();

    expect(await screen.findByText("No intent yet")).toBeInTheDocument();
    expect(screen.getByText("Run a review to derive intent")).toBeInTheDocument();
    expect(screen.queryByText("In scope")).not.toBeInTheDocument();
  });

  it("fires PUT /pulls/:id/intent/feedback with the verdict and refetches the intent", async () => {
    const fetchMock = stubIntentFetch();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderCard();

    await screen.findByText("“Rate-limit the public API endpoints.”");
    const getsBefore = fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/intent") && (i?.method ?? "GET") === "GET").length;
    expect(getsBefore).toBe(1);

    await user.click(screen.getByRole("button", { name: /incorrect/i }));

    const put = fetchMock.mock.calls.find(
      ([u, i]) => String(u).endsWith("/intent/feedback") && i?.method === "PUT",
    );
    expect(put).toBeDefined();
    expect(String(put![0])).toContain("/pulls/pr-1/intent/feedback");
    expect(JSON.parse(String(put![1]?.body))).toEqual({ verdict: "incorrect" });
    // onSuccess invalidates ["intent", prId] → the card refetches (2nd GET).
    await waitFor(() => {
      const gets = fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/intent") && (i?.method ?? "GET") === "GET").length;
      expect(gets).toBe(2);
    });
  });
});
