import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";

const { updateMutate, versions } = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  versions: { current: [] as SkillVersion[] },
}));

vi.mock("@/lib/hooks/skills", () => ({
  useSkillVersions: () => ({ data: versions.current, isLoading: false }),
  useUpdateSkill: () => ({ mutate: updateMutate, isPending: false }),
}));

import { VersioningTab } from "./VersioningTab";
import { lineDiff } from "../../helpers";

afterEach(cleanup);

const SKILL: Skill = {
  id: "sk1",
  name: "pr-rubric",
  description: "d",
  type: "rubric",
  source: "manual",
  body: "v2 line\nshared",
  enabled: true,
  version: 2,
  evidence_files: null,
};

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <VersioningTab skill={SKILL} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  updateMutate.mockReset();
  versions.current = [
    { skill_id: "sk1", version: 2, body: "v2 line\nshared", created_at: "2026-09-21T02:00:00.000Z" },
    { skill_id: "sk1", version: 1, body: "v1 line\nshared", created_at: "2026-09-21T01:00:00.000Z" },
  ];
});

describe("lineDiff", () => {
  it("emits removed/added/same rows in order", () => {
    expect(lineDiff("a\nb\nc", "a\nX\nc")).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "added", text: "X" },
      { type: "same", text: "c" },
    ]);
  });

  it("handles pure additions and removals", () => {
    expect(lineDiff("a", "a\nb")).toEqual([
      { type: "same", text: "a" },
      { type: "added", text: "b" },
    ]);
    expect(lineDiff("a\nb", "b")).toEqual([
      { type: "removed", text: "a" },
      { type: "same", text: "b" },
    ]);
  });
});

describe("VersioningTab", () => {
  it("lists versions newest-first and flags the current one", () => {
    renderTab();
    expect(screen.getByText("v2")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
    expect(screen.getByText("current")).toBeInTheDocument();
    // only the PREVIOUS version offers Diff/Restore
    expect(screen.getByRole("button", { name: /diff/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restore/i })).toBeInTheDocument();
  });

  it("Diff opens a modal with added/removed lines vs the current body", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByRole("button", { name: /diff/i }));
    expect(screen.getByText("Diff v1 → current")).toBeInTheDocument();
    expect(screen.getByText(/- v1 line/)).toBeInTheDocument();
    expect(screen.getByText(/\+ v2 line/)).toBeInTheDocument();
  });

  it("Restore confirms, then PUTs the old body as a new version", async () => {
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByRole("button", { name: /restore/i }));
    expect(screen.getByText("Restore v1?")).toBeInTheDocument();
    // The modal's confirm button — scoped, since the row button says Restore too.
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Restore$/ }));
    expect(updateMutate).toHaveBeenCalledWith(
      { id: "sk1", patch: { body: "v1 line\nshared" } },
      expect.anything(),
    );
  });
});
