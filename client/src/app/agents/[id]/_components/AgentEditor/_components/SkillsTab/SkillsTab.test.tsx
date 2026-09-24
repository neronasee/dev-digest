import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { SkillSummary } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../../../../messages/en/skills.json";

const { setMutate } = vi.hoisted(() => ({ setMutate: vi.fn() }));
const { agentSkills } = vi.hoisted(() => ({
  agentSkills: { current: [] as { agent_id: string; skill_id: string; order: number }[] },
}));

vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: SKILLS, isLoading: false }),
  useAgentSkills: () => ({ data: agentSkills.current, isLoading: false }),
  useSetAgentSkills: () => ({ mutate: setMutate, isPending: false }),
}));

import { SkillsTab } from "./SkillsTab";

afterEach(cleanup);

const SKILLS: SkillSummary[] = [
  {
    id: "s1",
    name: "branch-coverage",
    description: "Enumerate branches.",
    type: "rubric",
    source: "manual",
    body: "# b",
    enabled: true,
    version: 1,
    agent_count: 1,
  },
  {
    id: "s2",
    name: "corner-cases",
    description: "Boundary inputs.",
    type: "rubric",
    source: "manual",
    body: "# c",
    enabled: true,
    version: 2,
    agent_count: 1,
  },
  {
    id: "s3",
    name: "flake-watch",
    description: "Flake vectors.",
    type: "convention",
    source: "imported_file",
    body: "# f",
    enabled: true,
    version: 1,
    agent_count: 0,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, skills: skillsMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function boundLinks() {
  return agentSkills.current.map((l) => l.skill_id).map((skill_id, order) => ({ agent_id: "ag1", skill_id, order }));
}

beforeEach(() => {
  setMutate.mockReset();
  agentSkills.current = [
    { agent_id: "ag1", skill_id: "s2", order: 0 },
    { agent_id: "ag1", skill_id: "s1", order: 1 },
  ];
});

describe("AgentEditor SkillsTab", () => {
  it("renders ALL skills — bound rows first in link order with numbers, then unbound", () => {
    renderWithIntl(<SkillsTab agentId="ag1" />);
    // bound: s2 (#1), s1 (#2); unbound: s3 ("flake-watch") sorts last by name
    const rows = screen.getAllByText(/branch-coverage|corner-cases|flake-watch/);
    expect(rows.map((r) => r.textContent)).toEqual(["corner-cases", "branch-coverage", "flake-watch"]);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    // "2 of 3 enabled" badge (linked vs total)
    expect(screen.getByText("2 of 3 enabled")).toBeInTheDocument();
    expect(screen.getByText("Order matters — earlier skills appear earlier in the assembled prompt. Toggle to attach.")).toBeInTheDocument();
  });

  it("marks only bound rows draggable", () => {
    renderWithIntl(<SkillsTab agentId="ag1" />);
    const cornerCases = screen.getByText("corner-cases").closest("div")!;
    const flake = screen.getByText("flake-watch").closest("div")!;
    expect(cornerCases.getAttribute("draggable")).toBe("true");
    expect(flake.getAttribute("draggable")).toBeNull();
  });

  it("toggling an unbound skill ON posts the full ordered id list (appended last)", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SkillsTab agentId="ag1" />);
    const flakeRow = screen.getByText("flake-watch").closest("div")!;
    await user.click(flakeRow.querySelector('button[role="switch"]')!);
    expect(setMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["s2", "s1", "s3"] });
  });

  it("toggling a bound skill OFF posts the remaining ordered list", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SkillsTab agentId="ag1" />);
    const row = screen.getByText("corner-cases").closest("div")!;
    await user.click(row.querySelector('button[role="switch"]')!);
    expect(setMutate).toHaveBeenCalledWith({ agentId: "ag1", skillIds: ["s1"] });
  });

  it("search filters rows by name", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SkillsTab agentId="ag1" />);
    await user.type(screen.getByPlaceholderText("Filter skills…"), "flake");
    expect(screen.getByText("flake-watch")).toBeInTheDocument();
    expect(screen.queryByText("branch-coverage")).not.toBeInTheDocument();
    expect(screen.queryByText("corner-cases")).not.toBeInTheDocument();
  });

  it("boundLinks helper sanity (test fixture uses replace-set semantics)", () => {
    expect(boundLinks()).toHaveLength(2);
  });
});
