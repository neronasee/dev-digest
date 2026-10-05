/**
 * FileCard with inline review findings (Smart Diff) — one flow, pure props
 * (fetch is never stubbed because nothing fetches): the header accent dot, the
 * severity bar label on the marked line, the FindingComment rendered under the
 * parsed line it anchors to (RIGHT:newNo), and a finding whose line is not in
 * the patch landing in the unanchored footer.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile } from "@/lib/types";
import prReview from "../../../../messages/en/prReview.json";
import shell from "../../../../messages/en/shell.json";
import { FileCard } from "./FileCard";

afterEach(cleanup);

/** Hunk starts at line 1: ctx=RIGHT:1, the added line is RIGHT:2. */
const FILE: PrFile = {
  path: "src/pay.ts",
  additions: 1,
  deletions: 0,
  patch: "@@ -1,3 +1,4 @@\n context\n+added line\n tail",
};

function f(o: Partial<FindingRecord>): FindingRecord {
  return {
    id: "f",
    severity: "CRITICAL",
    category: "bug",
    title: "t",
    file: "src/pay.ts",
    start_line: 1,
    end_line: 1,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "rev1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const ANCHORED = f({
  id: "f-anchored",
  severity: "CRITICAL",
  title: "Off-by-one in the loop bound",
  rationale: "The loop reads one element past the array.",
  start_line: 2,
  end_line: 2,
});
const UNANCHORED = f({
  id: "f-unanchored",
  severity: "WARNING",
  title: "Finding on a line not in this patch",
  start_line: 99,
  end_line: 99,
});

function renderCard(props: Partial<Parameters<typeof FileCard>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <FileCard
        file={FILE}
        findings={[ANCHORED, UNANCHORED]}
        commenting={{
          comments: [],
          canComment: false,
          showComments: true,
          posting: false,
          onSubmit: async () => {},
        }}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("FileCard — inline findings", () => {
  it("marks the anchored line, renders its FindingComment under it, dots the header, and routes the unanchored finding to the footer", () => {
    renderCard();

    // Header dot: 2 findings on this file → the dot carries their count.
    expect(screen.getByTitle("2 finding-lines")).toBeInTheDocument();

    // The marked line (RIGHT:2 = "added line") shows the top severity label.
    const label = screen.getByText("blocker");
    expect(label).toBeInTheDocument();

    // The anchored finding's comment renders under THAT line (same CodeLine
    // wrapper as the severity label), with its title + rationale.
    const lineWrap = label.closest("div")!.parentElement!;
    expect(within(lineWrap).getByText("Off-by-one in the loop bound")).toBeInTheDocument();
    expect(within(lineWrap).getByText(/reads one element past/)).toBeInTheDocument();

    // The line-99 finding cannot anchor anywhere → unanchored footer, not the line.
    const footer = screen.getByText("1 finding on lines not in this patch").closest("div")!;
    expect(within(footer).getByText("Finding on a line not in this patch")).toBeInTheDocument();
    expect(within(lineWrap).queryByText("Finding on a line not in this patch")).not.toBeInTheDocument();
  });

  it("hides inline comments and the footer behind showComments, but still marks the line (the bar/label mark the line)", () => {
    renderCard({ commenting: undefined });
    // No commenting API → no FindingComments anywhere…
    expect(screen.queryByText("Off-by-one in the loop bound")).not.toBeInTheDocument();
    // The ICU plural renders "1 finding on lines not in this patch" — match
    // the real copy, not the message-format source.
    expect(screen.queryByText(/on lines not in this patch/i)).not.toBeInTheDocument();
    // …but the severity label on the line remains.
    expect(screen.getByText("blocker")).toBeInTheDocument();
  });
});

describe("FileCard — brief deep-link focus", () => {
  /** 300 changed lines — far above AUTO_EXPAND_MAX_LINES (200). */
  const BIG: PrFile = { path: "src/big.ts", additions: 300, deletions: 4, patch: FILE.patch };

  it("focus forces open a file above AUTO_EXPAND_MAX_LINES; a focus for another path leaves it collapsed", () => {
    renderCard({ file: BIG, focus: { path: "src/big.ts", line: 2 } });
    expect(screen.getByText("added line")).toBeInTheDocument(); // body rendered

    cleanup();
    renderCard({ file: BIG, focus: { path: "src/other.ts", line: 2 } });
    expect(screen.queryByText("added line")).not.toBeInTheDocument();
  });

  it("scrolls the closest rendered line row into view (exact NEW-side line)", () => {
    const calls: Element[] = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      calls.push(this);
    };
    try {
      // RIGHT:2 = "added line" — the focus line exactly.
      renderCard({ focus: { path: "src/pay.ts", line: 2 } });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.textContent).toContain("added line");
    } finally {
      if (orig) Element.prototype.scrollIntoView = orig;
      else delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("an out-of-patch line lands on the nearest rendered row (the last NEW-side line)", () => {
    const calls: Element[] = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) {
      calls.push(this);
    };
    try {
      // Line 99 isn't in the patch — the closest at-or-before row is the last
      // rendered NEW-side line ("tail", RIGHT:3).
      renderCard({ focus: { path: "src/pay.ts", line: 99 } });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.textContent).toContain("tail");
    } finally {
      if (orig) Element.prototype.scrollIntoView = orig;
      else delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});
