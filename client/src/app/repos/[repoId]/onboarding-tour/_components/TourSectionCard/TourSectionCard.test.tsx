/**
 * TourSectionCard — one collapsible tour section, through the real component
 * (no data hooks, so no fetch to stub): copy places the exact command with an
 * announced confirmation (AC-14), the session-local done checkbox toggles both
 * ways (AC-15), Open anchors resolve to the cited file/PR at the repo's
 * hosting provider — the artifact itself, not the repo root, and plain text
 * when the repo is unresolved (AC-19), and an empty section renders its honest
 * empty-note (AC-8).
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingTour } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/onboarding.json";
import { TourSectionCard } from "./TourSectionCard";

afterEach(cleanup);

const TOUR: OnboardingTour = {
  architecture: { overview: "Three-layer API with cross-cutting middleware.", diagram: null },
  critical_paths: [{ path: "src/api/users.ts", description: "User route handlers." }],
  run_locally: [
    { title: "Install", description: "Install dependencies.", command: "npm install" },
    { title: "Start dependencies", description: "Postgres and Redis.", command: "docker compose up -d" },
  ],
  reading_path: [
    { path: "specs/api-layering.md", purpose: "The layering rules.", why: "Where new handlers go." },
  ],
  first_tasks: [
    {
      title: "Add pagination to the users list",
      description: "Small, well-scoped handler change.",
      artifact_kind: "pr",
      artifact_ref: "482",
    },
    {
      title: "Document the refund retry policy",
      description: "Docs-only change.",
      artifact_kind: "file",
      artifact_ref: "docs/refunds.md",
    },
  ],
  generation: { model: "seed", cost_usd: null, sampled_files: 12, sampled_artifacts: 4, dropped_ungrounded: 0 },
};

function renderCard(
  id: Parameters<typeof TourSectionCard>[0]["id"],
  tour: OnboardingTour = TOUR,
  repo?: { repoFullName?: string; branch?: string },
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <TourSectionCard
        id={id}
        tour={tour}
        repoFullName={repo?.repoFullName}
        branch={repo?.branch}
      />
    </NextIntlClientProvider>,
  );
}

const stubClipboard = (impl?: () => Promise<void>) => {
  const writeText = vi.fn(impl ?? (() => Promise.resolve()));
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
};

describe("TourSectionCard", () => {
  let user: ReturnType<typeof userEvent.setup>;
  beforeEach(() => {
    user = userEvent.setup();
  });

  it("copies the step's command verbatim and announces the confirmation (AC-14)", async () => {
    const writeText = stubClipboard();
    renderCard("run-locally");

    const copyButtons = screen.getAllByRole("button", { name: "Copy" });
    await user.click(copyButtons[0]!);

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("npm install");
    // The confirmation is announced (aria-live status) next to the step copied.
    expect(screen.getByText("Copied")).toBeInTheDocument();

    // Copying the second step places THAT command, not the first.
    await user.click(screen.getAllByRole("button", { name: "Copy" })[1]!);
    expect(writeText).toHaveBeenLastCalledWith("docker compose up -d");
  });

  it("marks a run step done for the session and unmarks it again (AC-15)", async () => {
    renderCard("run-locally");

    const stepDone = () => screen.getAllByRole("checkbox", { name: "Done" })[0]!;
    expect(stepDone()).not.toBeChecked();

    await user.click(stepDone());
    expect(stepDone()).toBeChecked();

    await user.click(stepDone());
    expect(stepDone()).not.toBeChecked();
  });

  it("opens the cited file at its blob URL — the file itself, not the repo root (AC-19)", () => {
    renderCard("critical-paths", TOUR, { repoFullName: "acme/payments-api", branch: "main" });

    expect(screen.getByRole("link", { name: "src/api/users.ts" })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts",
    );
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts",
    );
  });

  it("anchors first tasks to their artifact: the PR and the file respectively (AC-19)", () => {
    renderCard("first-tasks", TOUR, { repoFullName: "acme/payments-api", branch: "main" });

    const opens = screen.getAllByRole("link", { name: "Open" });
    expect(opens[0]).toHaveAttribute("href", "https://github.com/acme/payments-api/pull/482");
    expect(opens[1]).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/docs/refunds.md",
    );
  });

  it("renders paths as plain text when the repo is unresolved (AC-19)", () => {
    renderCard("critical-paths");

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("src/api/users.ts")).toBeInTheDocument();
  });

  it("renders the honest empty-note for a section with no grounded entries (AC-8)", () => {
    renderCard("run-locally", { ...TOUR, run_locally: [] });

    expect(screen.getByText("No recognizable run configuration was found in the clone.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Done" })).toBeNull();
  });

  it("exposes the collapse state and unmounts the body while collapsed (AC-13)", async () => {
    renderCard("critical-paths");

    expect(screen.getByRole("button", { name: "Collapse Critical paths" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Collapse Critical paths" }));

    expect(screen.queryByText("src/api/users.ts")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand Critical paths" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Expand Critical paths" }));
    expect(screen.getByText("src/api/users.ts")).toBeInTheDocument();
  });
});
