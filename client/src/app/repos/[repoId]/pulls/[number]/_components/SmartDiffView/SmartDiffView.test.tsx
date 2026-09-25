/**
 * Smart Diff P1 surface, through the REAL hooks (fetch stubbed per the house
 * rule): role groups with labels + counts, collapse defaults (docs +
 * boilerplate collapsed), the "N with findings" group counter, the file-card
 * dot, the inline FindingComment under the RIGHT line behind Show comments,
 * the Original order toggle, the no-review empty state, and the resilient
 * plain-DiffViewer fallback when the smart-diff endpoint fails.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrFile } from "@/lib/types";
import type { FindingRecord, SmartDiff } from "@/lib/types";
import type { ReviewRecord } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";
import { DiffTab } from "../DiffTab/DiffTab";

afterEach(cleanup);

const PR_ID = "pr-1";

/** RIGHT:2 = "added line" (the finding's cited line). */
const PATCH = "@@ -1,3 +1,4 @@\n context\n+added line\n tail";

const FILES: PrFile[] = [
  { path: "src/pay.ts", additions: 1, deletions: 0, patch: PATCH },
  { path: "src/pay.test.ts", additions: 2, deletions: 0, patch: PATCH },
  { path: "index.ts", additions: 1, deletions: 1, patch: PATCH },
  { path: "README.md", additions: 1, deletions: 0, patch: PATCH },
  { path: "pnpm-lock.yaml", additions: 30, deletions: 0, patch: PATCH },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    // finding_lines mirrors the two findings below: one anchored (line 2) and
    // one on a line the patch doesn't contain (99 → unanchored, dot only).
    { role: "core", files: [{ path: "src/pay.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [2, 99] }] },
    { role: "tests", files: [{ path: "src/pay.test.ts", pseudocode_summary: null, additions: 2, deletions: 0, finding_lines: [] }] },
    { role: "wiring", files: [{ path: "index.ts", pseudocode_summary: null, additions: 1, deletions: 1, finding_lines: [] }] },
    { role: "docs", files: [{ path: "README.md", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "boilerplate", files: [{ path: "pnpm-lock.yaml", pseudocode_summary: null, additions: 30, deletions: 0, finding_lines: [] }] },
  ],
  split_suggestion: { too_big: false, total_lines: 37, proposed_splits: [] },
};

function f(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "bug",
    title: "Off-by-one in the loop bound",
    file: "src/pay.ts",
    start_line: 2,
    end_line: 2,
    rationale: "The loop reads one element past the array.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(findings: FindingRecord[]): ReviewRecord {
  return {
    id: "rev1",
    pr_id: PR_ID,
    agent_id: null,
    run_id: null,
    agent_name: null,
    kind: "review",
    verdict: "request_changes",
    summary: null,
    score: 65,
    model: null,
    grounding: null,
    grounding_dropped: null,
    blockers: null,
    created_at: "2026-09-24T10:00:00.000Z",
    findings,
  };
}

const res = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

function stubFetch(opts: { reviews?: ReviewRecord[]; smartDiffStatus?: number } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/smart-diff")) {
      if (opts.smartDiffStatus && opts.smartDiffStatus !== 200) {
        return res({ error: { code: "x", message: "boom" } }, opts.smartDiffStatus);
      }
      return res(SMART_DIFF);
    }
    if (url.endsWith("/reviews")) {
      // TWO findings on ONE file: the group counter must stay at 1 file
      // (files-with-findings), not 2 (total findings). f2's line (99) isn't
      // in the patch → it lands in the unanchored footer, not on a line.
      const findings =
        opts.reviews ??
        [review([f({}), f({ id: "f2", title: "Unanchored drift", start_line: 99, end_line: 99 })])];
      return res(findings);
    }
    if (url.endsWith("/comments")) return res([]);
    if (url.endsWith("/runs/active")) return res([]);
    throw new Error(`[test] unexpected fetch ${url}`);
  });
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
        <DiffTab prId={PR_ID} filesCount={FILES.length} files={FILES} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("SmartDiffView (via DiffTab, real hooks)", () => {
  it("groups by role in order, collapses docs+boilerplate by default, counts files-with-findings, and marks the file with a dot", async () => {
    vi.stubGlobal("fetch", stubFetch());
    renderTab();

    // All five role headers, in response order.
    const roles = await screen.findAllByText(
      /^(Core|Tests|Wiring|Docs|Boilerplate)$/,
    );
    expect(roles.map((el) => el.textContent)).toEqual([
      "Core",
      "Tests",
      "Wiring",
      "Docs",
      "Boilerplate",
    ]);

    // Collapse defaults: core's file is visible; docs + boilerplate are not.
    expect(screen.getByText("src/pay.ts")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();

    // Counter badge: files WITH findings (1 file), even though that file
    // carries 2 findings — not the findings total.
    expect(screen.getByText("1 with findings")).toBeInTheDocument();

    // File-card dot on the file that carries findings (2 findings on pay.ts).
    expect(screen.getByTitle("2 finding-lines")).toBeInTheDocument();
  });

  it("expands a collapsed group on header click", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const user = userEvent.setup();
    renderTab();

    await screen.findByText("Boilerplate");
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
    await user.click(screen.getByText("Boilerplate"));
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  });

  it("renders the inline FindingComment under the RIGHT line behind Show comments, with the severity label on the line", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const user = userEvent.setup();
    renderTab();

    await screen.findByTitle("2 finding-lines");
    // Hidden by default (same gate as GitHub threads) — but the line is marked.
    expect(screen.queryByText("Off-by-one in the loop bound")).not.toBeInTheDocument();
    expect(screen.getByText("blocker")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /show comments/i }));
    const label = screen.getByText("blocker");
    const lineWrap = label.closest("div")!.parentElement!;
    expect(within(lineWrap).getByText("Off-by-one in the loop bound")).toBeInTheDocument();
    // The comment carries Accept/Reject actions.
    expect(within(lineWrap).getByRole("button", { name: /accept/i })).toBeInTheDocument();
    expect(within(lineWrap).getByRole("button", { name: /reject/i })).toBeInTheDocument();
    // f2 (line 99 isn't in the patch) lands in the unanchored footer instead
    // of vanishing — and only ONE line is severity-marked.
    expect(screen.getByText("Unanchored drift")).toBeInTheDocument();
    expect(screen.getByText(/on lines not in this patch/i)).toBeInTheDocument();
    expect(screen.getAllByText("blocker")).toHaveLength(1);
  });

  it("Original order toggle swaps to the plain viewer and back", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const user = userEvent.setup();
    renderTab();

    await screen.findByText("Boilerplate");
    await user.click(screen.getByRole("button", { name: /original order/i }));

    // Plain viewer: no group headers, GitHub (prop) order, collapsed groups gone.
    expect(screen.queryByText("Boilerplate")).not.toBeInTheDocument();
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
    expect(screen.getByText("README.md")).toBeInTheDocument();
    // Findings still pass through in original mode (the dot remains).
    expect(screen.getByTitle("2 finding-lines")).toBeInTheDocument();

    // …and back to role mode.
    await user.click(screen.getByRole("button", { name: /group by role/i }));
    expect(await screen.findByText("Boilerplate")).toBeInTheDocument();
    expect(screen.queryByText("pnpm-lock.yaml")).not.toBeInTheDocument();
  });

  it("no review yet: muted hint, no counter badge, no dot", async () => {
    vi.stubGlobal("fetch", stubFetch({ reviews: [] }));
    renderTab();

    expect(await screen.findByText("No review yet")).toBeInTheDocument();
    expect(screen.getByText("Run a review to see its findings inline in the diff.")).toBeInTheDocument();
    await screen.findByText("Core");
    expect(screen.queryByText(/with findings/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/finding-lines/)).not.toBeInTheDocument();
  });

  it("smart-diff failure falls back to the plain viewer (resilient)", async () => {
    vi.stubGlobal("fetch", stubFetch({ smartDiffStatus: 500 }));
    renderTab();

    expect(await screen.findByText("src/pay.ts")).toBeInTheDocument();
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
    expect(screen.queryByText("Boilerplate")).not.toBeInTheDocument();
  });
});
