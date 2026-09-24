import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { SkillUrlImportPreview } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { ToastProvider } from "@/lib/toast";
import { ApiError } from "@/lib/api";

const { createMutateAsync, importUrlMutateAsync, onClose } = vi.hoisted(() => ({
  createMutateAsync: vi.fn(),
  importUrlMutateAsync: vi.fn(),
  onClose: vi.fn(),
}));

vi.mock("@/lib/hooks/skills", () => ({
  useCreateSkill: () => ({ mutateAsync: createMutateAsync, isPending: false }),
  useImportSkillFromUrl: () => ({ mutateAsync: importUrlMutateAsync, isPending: false }),
}));

import { ImportFromUrlModal } from "./ImportFromUrlModal";

afterEach(cleanup);

// Front matter + heading body — parseMarkdown derives name/description from
// the `name:`/`description:` lines; the RAW body (front matter included) is
// what must be sent to POST /skills on import.
const BODY =
  "name: security-rubric\ndescription: Flags unsafe changes.\n\n# Security rubric\n\nFlag risky patterns.";

function previewWith(scan: SkillUrlImportPreview["scan"]): SkillUrlImportPreview {
  return { body: BODY, scan };
}

const SAFE: SkillUrlImportPreview = previewWith({
  verdict: "safe",
  regex: { level: "safe", hits: [] },
  llm: { level: "safe", reason: "Ordinary markdown rubric." },
  reason: "Ordinary markdown rubric.",
});

const SUSPICIOUS: SkillUrlImportPreview = previewWith({
  verdict: "suspicious",
  regex: { level: "suspicious", hits: [{ pattern: "role-override", weight: 2 }] },
  llm: { level: "suspicious", reason: "Role-override phrase present." },
  reason: "Role-override phrase present.",
});

const REGEX_ONLY: SkillUrlImportPreview = previewWith({
  verdict: "safe",
  regex: { level: "safe", hits: [] },
  llm: null, // LLM scan degraded — regex-only verdict
  reason: "No regex hits.",
});

function renderModal() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ToastProvider>
        <ImportFromUrlModal onClose={onClose} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

/** Drive step 1 → step 2 with a resolving preview; returns the user session. */
async function openStep2(preview: SkillUrlImportPreview) {
  const user = userEvent.setup();
  renderModal();
  importUrlMutateAsync.mockResolvedValue(preview);
  await user.type(
    screen.getByPlaceholderText("https://example.com/skills/security.md"),
    "https://example.com/sk.md",
  );
  await user.click(screen.getByRole("button", { name: "Fetch" }));
  await screen.findByDisplayValue("security-rubric"); // step 2 landed
  return user;
}

beforeEach(() => {
  createMutateAsync.mockReset();
  importUrlMutateAsync.mockReset();
  onClose.mockReset();
});

describe("ImportFromUrlModal", () => {
  it("step 1 renders the URL field; Fetch posts the trimmed URL", async () => {
    const user = userEvent.setup();
    renderModal();
    importUrlMutateAsync.mockResolvedValue(SAFE);
    expect(screen.getByText("Skill URL")).toBeInTheDocument();
    expect(screen.queryByText("Skill name")).not.toBeInTheDocument();
    await user.type(
      screen.getByPlaceholderText("https://example.com/skills/security.md"),
      "  https://example.com/sk.md  ",
    );
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(importUrlMutateAsync).toHaveBeenCalledWith({ url: "https://example.com/sk.md" });
  });

  it("a safe preview opens step 2 with parsed metadata, the scan banner and the rendered body", async () => {
    await openStep2(SAFE);
    expect(screen.getByDisplayValue("security-rubric")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Flags unsafe changes.")).toBeInTheDocument();
    expect(screen.getByText("Security scan: Safe — no injection patterns detected")).toBeInTheDocument();
    expect(screen.getByText("Ordinary markdown rubric.")).toBeInTheDocument();
    expect(screen.getByText("untrusted source")).toBeInTheDocument();
    expect(screen.getByText("Security rubric")).toBeInTheDocument(); // rendered markdown heading
  });

  it("a suspicious preview warns in the banner but keeps Import enabled", async () => {
    await openStep2(SUSPICIOUS);
    expect(
      screen.getByText("Security scan: Suspicious — review before importing"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import from URL" })).toBeEnabled();
  });

  it("a dangerous verdict (422 skill_threat_detected) shows the blocked message and never renders step 2", async () => {
    const user = userEvent.setup();
    renderModal();
    importUrlMutateAsync.mockRejectedValue(
      new ApiError("Injected override phrase", 422, "skill_threat_detected"),
    );
    await user.type(
      screen.getByPlaceholderText("https://example.com/skills/security.md"),
      "https://example.com/sk.md",
    );
    await user.click(screen.getByRole("button", { name: "Fetch" }));
    expect(
      await screen.findByText("Import blocked by the security scan: Injected override phrase"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Skill name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import from URL" })).not.toBeInTheDocument();
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it("Import creates the skill with the RAW body, source imported_url, disabled; toasts and closes", async () => {
    const user = await openStep2(SAFE);
    createMutateAsync.mockResolvedValue({ name: "security-rubric" });
    await user.click(screen.getByRole("button", { name: "Import from URL" }));
    expect(createMutateAsync).toHaveBeenCalledWith({
      name: "security-rubric",
      description: "Flags unsafe changes.",
      type: "custom",
      body: BODY,
      source: "imported_url",
      enabled: false,
    });
    expect(
      await screen.findByText('Imported "security-rubric". Disabled until you vet + enable it.'),
    ).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it("a degraded scan (llm null) appends the regex-only note to the banner", async () => {
    await openStep2(REGEX_ONLY);
    expect(
      screen.getByText("No regex hits. AI scanner unavailable — regex-only scan"),
    ).toBeInTheDocument();
  });
});
