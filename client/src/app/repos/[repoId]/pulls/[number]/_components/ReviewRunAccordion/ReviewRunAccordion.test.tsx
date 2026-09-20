import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReviewRecord } from "@devdigest/shared";

vi.mock("@/lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../FindingsPanel", () => ({ FindingsPanel: () => <div>review findings</div> }));
vi.mock("../VerdictBanner", () => ({ VerdictBanner: () => <div>review verdict</div> }));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
const scrollIntoViewMock = vi.fn();

const REVIEW = {
  id: "review-1",
  run_id: "run-1",
  agent_name: "Security Reviewer",
  verdict: "comment",
  score: 88,
  summary: "Review summary",
  created_at: "2026-09-20T10:00:00.000Z",
  findings: [],
} as unknown as ReviewRecord;

describe("ReviewRunAccordion timeline navigation", () => {
  beforeEach(() => {
    scrollIntoViewMock.mockClear();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
    } else {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("does not target a legacy review that has no run ID", () => {
    render(
      <ReviewRunAccordion
        review={{ ...REVIEW, run_id: null }}
        prId="pr-1"
        targetRunId={null}
        targetRequest={0}
      />,
    );

    expect(screen.queryByText("review findings")).not.toBeInTheDocument();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it("reopens and scrolls the targeted run on every navigation request", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ReviewRunAccordion review={REVIEW} prId="pr-1" targetRunId={null} targetRequest={0} />,
    );

    expect(screen.queryByText("review findings")).not.toBeInTheDocument();

    rerender(
      <ReviewRunAccordion review={REVIEW} prId="pr-1" targetRunId="run-1" targetRequest={1} />,
    );
    expect(await screen.findByText("review findings")).toBeInTheDocument();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Security Reviewer/i }));
    expect(screen.queryByText("review findings")).not.toBeInTheDocument();

    rerender(
      <ReviewRunAccordion review={REVIEW} prId="pr-1" targetRunId="run-1" targetRequest={2} />,
    );
    expect(await screen.findByText("review findings")).toBeInTheDocument();
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(2);
  });
});
