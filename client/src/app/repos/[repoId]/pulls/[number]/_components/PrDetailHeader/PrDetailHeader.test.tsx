import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PrDetail } from "@devdigest/shared";

vi.mock("../RunReviewDropdown", () => ({ RunReviewDropdown: () => <div>run control</div> }));

import { PrDetailHeader } from "./PrDetailHeader";

afterEach(cleanup);

const pr = {
  id: "pr-1",
  number: 42,
  title: "Truthful run count",
  author: "dev",
  branch: "feature",
  base: "main",
  status: "open",
  additions: 1,
  deletions: 0,
  files_count: 1,
} as PrDetail;

describe("PrDetailHeader", () => {
  it("shows the historical agent-run count supplied by the run API", () => {
    render(
      <PrDetailHeader
        pr={pr}
        prId="pr-1"
        tab="findings"
        runsCount={5}
        onSetTab={() => {}}
        onRunStart={() => {}}
        onRunsStarted={() => {}}
      />,
    );
    expect(screen.getByText("Agent runs")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });
});
