/**
 * BlastRadiusCard — L04's Overview block through the REAL hooks (fetch stubbed
 * per the house rule — BOTH endpoints the card owns must be served: /blast for
 * the map and /history for the folded-in prior-PRs section; a stub that throws
 * on /history fails every case once the section mounts). Covers: stat counts
 * with per-stat icons, endpoint/cron pills (split method, styles, +N more
 * expander), per-symbol caller links with ↳ connectors, collapse disclosure,
 * tree/graph toggle (pill rects, bezier edges, legend, caps + trimmed note),
 * the degraded badge + resync action, the no-head-sha plain-text fallback, the
 * honest empty states, and the prior-PR section (expand, links, empty, 0).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlastRadius, PrHistory } from "@/lib/types";
import { githubBlobUrl, githubPrUrl } from "@/lib/github-urls";
import messages from "../../../../../../../../messages/en/blast.json";
import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(cleanup);

/** Stat spans render "<svg/><b>2</b> symbols" — match on full textContent. */
const statText = (text: string) =>
  screen.getByText((_, el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim() === text);

const BLAST: BlastRadius = {
  changed_symbols: [
    { name: "refundPayment", file: "src/payments/refund.ts", kind: "function" },
    { name: "chargeCard", file: "src/payments/charge.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "chargeCard",
      callers: [
        { name: "checkout", file: "src/routes/checkout.ts", line: 88 },
        { name: "nightlyBilling", file: "src/jobs/billing.ts", line: 12 },
      ],
      endpoints_affected: ["POST /checkout"],
      crons_affected: ["cron: nightly-billing"],
    },
    {
      symbol: "refundPayment",
      callers: [{ name: "handleRefund", file: "src/routes/orders.ts", line: 42 }],
      endpoints_affected: [],
      crons_affected: [],
    },
  ],
  summary: "2 changed symbol(s), 3 downstream caller(s), 1 impacted endpoint(s), 1 impacted cron job(s)",
};

const HISTORY: PrHistory = {
  history: [
    {
      pr_number: 470,
      title: "Refund hardening",
      merged_at: "2026-08-05T00:00:00.000Z",
      author: "marisa.koch",
      files_overlap: ["src/payments/refund.ts"],
      notes: "shares 1 file(s) with this PR",
    },
  ],
};

const res = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

/** One stub for BOTH queries the card owns — /blast and /history. */
function stubBlastFetch(body: unknown, status = 200, history: unknown = HISTORY) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.endsWith("/pulls/pr-1/blast")) return res(body, status);
    if (url.endsWith("/pulls/pr-1/history")) return res(history);
    if (url.endsWith("/repos/repo-1/index-state")) {
      return res({ status: "partial", updatedAt: "2026-09-28T00:00:00Z", lastIndexedSha: "old" });
    }
    throw new Error(`[test] unexpected fetch ${url}`);
  });
}

function renderCard(overrides: Partial<Parameters<typeof BlastRadiusCard>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
        <BlastRadiusCard
          prId="pr-1"
          repoId="repo-1"
          repoFullName="acme/payments-api"
          headSha="sha1"
          {...overrides}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

/** The blast graph svg — scope structural queries here (lucide icons carry
    their own <path>s elsewhere in the card). */
const graphSvg = () => document.querySelector('svg[aria-label="Blast radius graph"]')!;

describe("BlastRadiusCard", () => {
  it("(a) renders the title, four stat counts, caller link at the head blob, pills under its symbol, rank order", async () => {
    vi.stubGlobal("fetch", stubBlastFetch(BLAST));
    renderCard();

    expect(await screen.findByText("Blast radius")).toBeInTheDocument();
    // Await a data-only element: the title also renders in the loading state.
    await waitFor(() => expect(statText("2 symbols")).toBeInTheDocument());
    expect(statText("3 callers")).toBeInTheDocument();
    expect(statText("1 endpoints")).toBeInTheDocument();
    expect(statText("1 cron/jobs")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "src/routes/orders.ts:42" });
    expect(link).toHaveAttribute(
      "href",
      githubBlobUrl("acme/payments-api", "sha1", "src/routes/orders.ts", 42),
    );
    expect(link).toHaveAttribute("target", "_blank");

    // Endpoint pill (icon + bold method + path) under the chargeCard group only.
    const charge = screen.getByRole("button", { name: /chargeCard/ }).parentElement!;
    expect(
      within(charge).getByText((_, el) => el?.textContent === "POST /checkout"),
    ).toBeInTheDocument();
    expect(within(charge).getByText("cron: nightly-billing")).toBeInTheDocument();
    const refund = screen.getByRole("button", { name: /refundPayment/ }).parentElement!;
    expect(within(refund).queryByText("POST /checkout")).not.toBeInTheDocument();

    // Higher-rank symbol (chargeCard) renders first.
    const chargeBtn = screen.getByRole("button", { name: /chargeCard/ });
    const refundBtn = screen.getByRole("button", { name: /refundPayment/ });
    expect(chargeBtn.compareDocumentPosition(refundBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("(b) collapses a symbol on header click and restores it on re-expand", async () => {
    vi.stubGlobal("fetch", stubBlastFetch(BLAST));
    const user = userEvent.setup();
    renderCard();

    const header = await screen.findByRole("button", { name: /chargeCard/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "src/routes/checkout.ts:88" })).toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "src/routes/checkout.ts:88" })).not.toBeInTheDocument();

    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "src/routes/checkout.ts:88" })).toBeInTheDocument();
  });

  it("(c) toggles tree → graph → tree: svg[aria-label] appears, callers hide, then return", async () => {
    vi.stubGlobal("fetch", stubBlastFetch(BLAST));
    const user = userEvent.setup();
    renderCard();

    await screen.findByRole("button", { name: /chargeCard/ });
    await user.click(screen.getByRole("button", { name: "graph" }));

    const svg = document.querySelector('svg[aria-label="Blast radius graph"]');
    expect(svg).not.toBeNull();
    expect(screen.queryByRole("link", { name: "src/routes/orders.ts:42" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "tree" }));
    expect(document.querySelector('svg[aria-label="Blast radius graph"]')).toBeNull();
    expect(screen.getByRole("link", { name: "src/routes/orders.ts:42" })).toBeInTheDocument();
  });

  it("(d) no-callers fixture in graph view renders the graph empty state", async () => {
    const noCallers: BlastRadius = {
      changed_symbols: [{ name: "lonely", file: "src/lonely.ts", kind: "class" }],
      downstream: [{ symbol: "lonely", callers: [], endpoints_affected: [], crons_affected: [] }],
      summary: "1 changed symbol(s), 0 downstream caller(s), 0 impacted endpoint(s), 0 impacted cron job(s)",
    };
    vi.stubGlobal("fetch", stubBlastFetch(noCallers));
    const user = userEvent.setup();
    renderCard();

    await screen.findByText("1 changed symbol(s), no downstream callers found.");
    await user.click(screen.getByRole("button", { name: "graph" }));
    expect(await screen.findByText("No downstream callers to graph.")).toBeInTheDocument();
  });

  it("(e) degraded fixture shows the partial-index badge reason and the resync button", async () => {
    vi.stubGlobal(
      "fetch",
      stubBlastFetch({ ...BLAST, degraded: true, reason: "index_partial" }),
    );
    renderCard();

    expect(await screen.findByText("Partial index — Index is incomplete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resync index" })).toBeInTheDocument();
  });

  it("refreshes the blast map when background resync updates the index", async () => {
    let indexed = false;
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/pulls/pr-1/blast")) {
        return res(indexed ? BLAST : { ...BLAST, degraded: true, reason: "index_partial" });
      }
      if (url.endsWith("/pulls/pr-1/history")) return res(HISTORY);
      if (url.endsWith("/repos/repo-1/index-state")) {
        return res({
          status: indexed ? "full" : "partial",
          updatedAt: indexed ? "2026-09-28T00:01:00Z" : "2026-09-28T00:00:00Z",
          lastIndexedSha: indexed ? "new" : "old",
        });
      }
      if (url.endsWith("/repos/repo-1/resync") && init?.method === "POST") {
        setTimeout(() => { indexed = true; }, 50);
        return res({ status: "accepted" }, 202);
      }
      throw new Error(`[test] unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();
    renderCard();

    await screen.findByText("Partial index — Index is incomplete");
    await user.click(screen.getByRole("button", { name: "Resync index" }));
    await waitFor(() => expect(screen.queryByText("Partial index — Index is incomplete")).not.toBeInTheDocument(), { timeout: 3000 });
    expect(fetchStub.mock.calls.filter(([url]) => String(url).endsWith("/pulls/pr-1/blast"))).toHaveLength(2);
  });

  it("(f) headSha=null renders plain file:line text with no anchor", async () => {
    vi.stubGlobal("fetch", stubBlastFetch(BLAST));
    renderCard({ headSha: null });

    expect(await screen.findByText("src/routes/orders.ts:42")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("(g) zero-caller symbol shows its noCallers text; a fully empty map shows the block-level empty state", async () => {
    const mixed: BlastRadius = {
      changed_symbols: [
        { name: "chargeCard", file: "src/payments/charge.ts", kind: "function" },
        { name: "lonely", file: "src/lonely.ts", kind: "class" },
      ],
      downstream: [
        {
          symbol: "chargeCard",
          callers: [{ name: "checkout", file: "src/routes/checkout.ts", line: 88 }],
          endpoints_affected: [],
          crons_affected: [],
        },
        { symbol: "lonely", callers: [], endpoints_affected: [], crons_affected: [] },
      ],
      summary: "2 changed symbol(s), 1 downstream caller(s), 0 impacted endpoint(s), 0 impacted cron job(s)",
    };
    vi.stubGlobal("fetch", stubBlastFetch(mixed));
    renderCard();

    // Zero-caller symbol: no collapse control, honest noCallers text.
    const lonely = await screen.findByText("lonely");
    expect(screen.getAllByText("No downstream callers.")).toHaveLength(1);
    expect(lonely.closest("button")).toBeNull();

    cleanup();
    const empty: BlastRadius = {
      changed_symbols: [{ name: "lonely", file: "src/lonely.ts", kind: "class" }],
      downstream: [{ symbol: "lonely", callers: [], endpoints_affected: [], crons_affected: [] }],
      summary: "1 changed symbol(s), 0 downstream caller(s), 0 impacted endpoint(s), 0 impacted cron job(s)",
    };
    vi.stubGlobal("fetch", stubBlastFetch(empty));
    renderCard();
    expect(
      await screen.findByText("1 changed symbol(s), no downstream callers found."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No downstream callers.")).not.toBeInTheDocument();
  });

  it("(h) non-404 error renders the error text with the server message", async () => {
    vi.stubGlobal(
      "fetch",
      stubBlastFetch({ error: { code: "internal_error", message: "repo-intel exploded" } }, 500),
    );
    renderCard();

    expect(await screen.findByText(/Couldn't load the blast radius\. repo-intel exploded/)).toBeInTheDocument();
    // The card still carries its title; the map does not render.
    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /chargeCard/ })).not.toBeInTheDocument();
  });

  it("(i) stats and symbol headers carry icons; endpoint/cron pills are styled spans with icons and a bold method", async () => {
    vi.stubGlobal("fetch", stubBlastFetch(BLAST));
    renderCard();

    await waitFor(() => expect(statText("2 symbols")).toBeInTheDocument());
    // Per-stat leading icon inside each stat item.
    for (const text of ["2 symbols", "3 callers", "1 endpoints", "1 cron/jobs"]) {
      expect(statText(text).querySelector("svg")).not.toBeNull();
    }

    // <> accent icon on the symbol header button.
    const chargeBtn = screen.getByRole("button", { name: /chargeCard/ });
    expect(chargeBtn.querySelector("svg")).not.toBeNull();

    // Endpoint pill: span, globe icon, bold method, accent pill styling.
    const badge = screen.getByText((_, el) => el?.textContent === "POST /checkout");
    expect(badge.tagName).toBe("SPAN");
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.querySelector("b")?.textContent).toBe("POST");
    expect(badge.style.border).toBe("1px solid var(--accent)");
    expect(badge.style.background).toBe("var(--accent-bg)");
    expect(badge.style.borderRadius).toBe("999px");

    // Cron pill: span, clock icon, amber pill styling.
    const cron = screen.getByText("cron: nightly-billing");
    expect(cron.tagName).toBe("SPAN");
    expect(cron.querySelector("svg")).not.toBeNull();
    expect(cron.style.border).toBe("1px solid var(--warn)");
    expect(cron.style.background).toBe("var(--warn-bg)");

    // ↳ connector before each caller row.
    const callerRow = screen.getByRole("link", { name: "src/routes/checkout.ts:88" }).closest("li")!;
    expect(callerRow.querySelector("svg")).not.toBeNull();
  });

  it("(j) 7 endpoints render 5 pills + '+2 more', expanding shows all 7 + 'Show fewer', collapsing restores", async () => {
    const many: BlastRadius = {
      changed_symbols: [{ name: "chargeCard", file: "src/payments/charge.ts", kind: "function" }],
      downstream: [
        {
          symbol: "chargeCard",
          callers: [{ name: "checkout", file: "src/routes/checkout.ts", line: 88 }],
          endpoints_affected: ["GET /a", "POST /b", "PUT /c", "DELETE /d", "PATCH /e", "GET /f", "POST /g"],
          crons_affected: [],
        },
      ],
      summary: "1 changed symbol(s), 1 downstream caller(s), 7 impacted endpoint(s), 0 impacted cron job(s)",
    };
    vi.stubGlobal("fetch", stubBlastFetch(many));
    const user = userEvent.setup();
    renderCard();

    const badge = (text: string) =>
      screen.queryByText((_, el) => el?.textContent === text);

    await waitFor(() => expect(badge("GET /a")).toBeInTheDocument());
    expect(badge("PATCH /e")).toBeInTheDocument();
    expect(badge("GET /f")).not.toBeInTheDocument();
    expect(badge("POST /g")).not.toBeInTheDocument();

    const more = screen.getByRole("button", { name: "+2 more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(badge("GET /f")).toBeInTheDocument();
    expect(badge("POST /g")).toBeInTheDocument();
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Show fewer" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(badge("GET /f")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+2 more" })).toBeInTheDocument();
  });

  it("(hist-a) prior-PRs row is collapsed by default and expands to the GitHub-linked item with meta, chips, notes", async () => {
    vi.stubGlobal("fetch", stubBlastFetch(BLAST, 200, HISTORY));
    const user = userEvent.setup();
    renderCard();

    const row = await screen.findByRole("button", { name: /Prior PRs touching these files/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(within(row).getByText("1")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Refund hardening" })).not.toBeInTheDocument();

    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    const link = screen.getByRole("link", { name: "Refund hardening" });
    expect(link).toHaveAttribute("href", githubPrUrl("acme/payments-api", 470));
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("#470")).toBeInTheDocument();
    expect(screen.getByText("marisa.koch · merged 2026-08-05")).toBeInTheDocument();
    expect(screen.getByText("src/payments/refund.ts")).toBeInTheDocument();
    expect(screen.getByText("shares 1 file(s) with this PR")).toBeInTheDocument();
  });

  it("(hist-b) empty history renders a count badge of 0 and the honest empty message on expand", async () => {
    vi.stubGlobal("fetch", stubBlastFetch(BLAST, 200, { history: [] }));
    const user = userEvent.setup();
    renderCard();

    const row = await screen.findByRole("button", { name: /Prior PRs touching these files/ });
    expect(within(row).getByText("0")).toBeInTheDocument();

    await user.click(row);
    expect(await screen.findByText("No prior PRs touch these files.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Refund hardening" })).not.toBeInTheDocument();
  });

  it("(hist-c) repoFullName=null renders the item title as plain text, no anchor anywhere", async () => {
    vi.stubGlobal("fetch", stubBlastFetch(BLAST, 200, HISTORY));
    const user = userEvent.setup();
    renderCard({ repoFullName: null });

    const row = await screen.findByRole("button", { name: /Prior PRs touching these files/ });
    await user.click(row);

    expect(await screen.findByText("Refund hardening")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("(l) graph: pill rects = nodes, bezier paths = edges, bold-method tspan, legend, untrimmed <title>", async () => {
    const longFile = "src/routes/very/deeply/nested/checkout/handlers/area/checkout.ts";
    const graphable: BlastRadius = {
      changed_symbols: [{ name: "chargeCard", file: "src/payments/charge.ts", kind: "function" }],
      downstream: [
        {
          symbol: "chargeCard",
          callers: [
            { name: "checkout", file: longFile, line: 88 },
            { name: "nightlyBilling", file: "src/jobs/billing.ts", line: 12 },
          ],
          endpoints_affected: ["POST /checkout"],
          crons_affected: ["cron: nightly-billing"],
        },
      ],
      summary: "1 changed symbol(s), 2 downstream caller(s), 1 impacted endpoint(s), 1 impacted cron job(s)",
    };
    vi.stubGlobal("fetch", stubBlastFetch(graphable));
    const user = userEvent.setup();
    renderCard();

    await screen.findByRole("button", { name: /chargeCard/ });
    await user.click(screen.getByRole("button", { name: "graph" }));

    const svg = graphSvg();
    // 1 symbol + 2 callers + 2 chips (endpoint + cron) = 5 pill rects.
    expect(svg.querySelectorAll("rect")).toHaveLength(5);
    // 2 symbol→caller edges + 2 symbol→impact edges = 4 beziers.
    expect(svg.querySelectorAll("path")).toHaveLength(4);
    expect(svg.querySelectorAll("polygon, marker")).toHaveLength(0);
    // Endpoint chip text splits into a bold method tspan + path.
    expect(svg.querySelector("tspan")?.textContent).toBe("POST");
    // Ellipsized caller keeps its full label in a native tooltip.
    const titles = Array.from(svg.querySelectorAll("title")).map((e) => e.textContent);
    expect(titles).toContain(`${longFile}:88`);
    // Head-collapsed pill text: the basename (+ :line) survives, the long
    // leading directories collapse — never tail-truncated into "…/area/ch…".
    const callerLabel = Array.from(svg.querySelectorAll("text"))
      .map((e) => e.textContent)
      .find((txt) => txt?.endsWith("checkout.ts:88"));
    expect(callerLabel).toMatch(/^…\//);
    // Legend (HTML under the svg) lists all four node kinds when crons exist.
    expect(screen.getByText("Changed symbol")).toBeInTheDocument();
    expect(screen.getByText("Callers")).toBeInTheDocument();
    expect(screen.getByText("Endpoints")).toBeInTheDocument();
    expect(screen.getByText("Cron jobs")).toBeInTheDocument();
    // Nothing was capped — no trimmed note.
    expect(screen.queryByText(/switch to tree view for the full map/)).not.toBeInTheDocument();

    cleanup();
    // Cron legend entry is conditional: a cron-less map drops it.
    const noCrons: BlastRadius = {
      changed_symbols: [{ name: "chargeCard", file: "src/payments/charge.ts", kind: "function" }],
      downstream: [
        {
          symbol: "chargeCard",
          callers: [{ name: "checkout", file: "src/routes/checkout.ts", line: 88 }],
          endpoints_affected: [],
          crons_affected: [],
        },
      ],
      summary: "1 changed symbol(s), 1 downstream caller(s), 0 impacted endpoint(s), 0 impacted cron job(s)",
    };
    vi.stubGlobal("fetch", stubBlastFetch(noCrons));
    renderCard();
    await screen.findByRole("button", { name: /chargeCard/ });
    await user.click(screen.getByRole("button", { name: "graph" }));
    expect(graphSvg()).not.toBeNull();
    expect(screen.getByText("Changed symbol")).toBeInTheDocument();
    expect(screen.queryByText("Cron jobs")).not.toBeInTheDocument();
  });

  it("(m) 12-group map: graph caps to 8 symbol pills + trimmed note; tree still shows all 12", async () => {
    const twelve: BlastRadius = {
      changed_symbols: Array.from({ length: 12 }, (_, i) => ({
        name: `alpha${i}`,
        file: `src/a${i}.ts`,
        kind: "function",
      })),
      downstream: Array.from({ length: 12 }, (_, i) => ({
        symbol: `alpha${i}`,
        callers: [{ name: `caller${i}`, file: `src/c${i}.ts`, line: i + 1 }],
        endpoints_affected: [],
        crons_affected: [],
      })),
      summary: "12 changed symbol(s), 12 downstream caller(s), 0 impacted endpoint(s), 0 impacted cron job(s)",
    };
    vi.stubGlobal("fetch", stubBlastFetch(twelve));
    const user = userEvent.setup();
    renderCard();

    await waitFor(() => expect(statText("12 symbols")).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /alpha\d+ / })).toHaveLength(12);

    await user.click(screen.getByRole("button", { name: "graph" }));
    const svg = graphSvg();
    // 8 symbol pills survive the cap (plus their 8 caller pills = 16 rects).
    const symbolTitles = Array.from(svg.querySelectorAll("g > title")).map((e) => e.textContent ?? "");
    expect(symbolTitles.filter((t) => /^alpha\d+$/.test(t))).toHaveLength(8);
    expect(svg.querySelectorAll("rect")).toHaveLength(16);
    expect(screen.getByText(/switch to tree view for the full map/)).toBeInTheDocument();

    // The tree view is untouched by the graph caps.
    await user.click(screen.getByRole("button", { name: "tree" }));
    expect(screen.getAllByRole("button", { name: /alpha\d+ / })).toHaveLength(12);
  });
});
