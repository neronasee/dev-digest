import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within, cleanup, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { EvalRun, FindingRecord, PrFile } from "@devdigest/shared";
import messages from "../../../messages/en/eval.json";

const { createMutate, updateMutate, draftMutate } = vi.hoisted(() => ({
  createMutate: vi.fn(),
  updateMutate: vi.fn(),
  draftMutate: vi.fn(),
}));

// Mock the data hooks — the modal renders without a network or query client,
// and tests drive mutations by invoking the mutate fns / their onSuccess.
vi.mock("@/lib/hooks/evals", () => ({
  useEvalDraftRun: () => ({ mutate: draftMutate, isPending: false, error: null }),
  useCreateEvalCase: () => ({ mutate: createMutate, isPending: false, error: null }),
  useUpdateEvalCase: () => ({ mutate: updateMutate, isPending: false, error: null }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: "ag1", name: "Security Reviewer" }] }),
}));

import { EvalCaseModal } from "./EvalCaseModal";

afterEach(cleanup);

const FILES: PrFile[] = [
  {
    path: "src/config.ts",
    additions: 1,
    deletions: 0,
    patch: "@@ -8,6 +8,7 @@ import Stripe\n const existing = 1;\n+const stripeKey = 'sk_live_x';\n const next = 2;",
  },
];

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 9,
  end_line: 9,
  rationale: "A live key is committed.",
  suggestion: null,
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: "2026-10-10T00:00:00Z",
  dismissed_at: null,
};

const RUN: EvalRun = {
  recall: 1,
  precision: 1,
  citation_accuracy: 1,
  traces_passed: 1,
  traces_total: 1,
  duration_ms: 2400,
  cost_usd: 0.0012,
  per_trace: [
    {
      name: "case",
      pass: true,
      expected: {},
      actual: { findings: [], pre_grounding_count: 1, error: null },
    },
  ],
};

function renderModal(props: Partial<Parameters<typeof EvalCaseModal>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalCaseModal agentId="ag1" finding={FINDING} files={FILES} prMeta={{ title: "Add Stripe", body: "Wire payments." }} {...props} onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("EvalCaseModal — one-click prefill (AC-2/AC-3/AC-6)", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    draftMutate.mockReset();
  });

  it("renders prefilled from the finding and persists nothing before Save", async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.getByDisplayValue("Hardcoded Stripe secret key")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/diff --git a\/src\/config\.ts/)).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
    expect(draftMutate).not.toHaveBeenCalled();

    // PR meta lives on its own tab.
    await user.click(screen.getByRole("button", { name: "PR meta" }));
    expect(screen.getByDisplayValue("Add Stripe")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Wire payments.")).toBeInTheDocument();
  });

  it("Save posts the create mutation with the sliced diff + must_find expectation", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        <EvalCaseModal agentId="ag1" finding={FINDING} files={FILES} prMeta={{ title: "Add Stripe", body: "Wire payments." }} onClose={onClose} />
      </NextIntlClientProvider>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(createMutate).toHaveBeenCalledTimes(1);
    const [body] = createMutate.mock.calls[0]!;
    expect(body).toMatchObject({
      name: "Hardcoded Stripe secret key",
      input_meta: { title: "Add Stripe", body: "Wire payments." },
      expected_output: {
        must_find: [{ file: "src/config.ts", start_line: 9, end_line: 9 }],
      },
    });
    expect((body as { input_diff: string }).input_diff).toContain("+const stripeKey = 'sk_live_x';");
  });
});

describe("EvalCaseModal — invalid expected-output JSON gates Save (AC-7)", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    draftMutate.mockReset();
  });

  it("shows the invalid-JSON indicator and disables Save; valid JSON re-enables it", async () => {
    const user = userEvent.setup();
    renderModal();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    expect(screen.getByText("valid JSON")).toBeInTheDocument();

    const jsonArea = screen.getByDisplayValue(/must_find/);
    // Editing JSON is a paste-like wholesale replace — userEvent's key parser
    // treats braces as special-key descriptors, so set values directly.
    fireEvent.change(jsonArea, { target: { value: "{oops" } });
    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(createMutate).not.toHaveBeenCalled();

    fireEvent.change(jsonArea, { target: { value: '{"must_find": []}' } });
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

describe("EvalCaseModal — first Run is cost-warned, once per session (AC-4)", () => {
  beforeEach(() => {
    createMutate.mockReset();
    updateMutate.mockReset();
    draftMutate.mockReset();
  });

  it("warns before the first run; cancel executes nothing; confirm runs; repeats run directly", async () => {
    const user = userEvent.setup();
    renderModal();

    // First activation → the cost confirmation, nothing executed yet.
    await user.click(screen.getByRole("button", { name: "Run case" }));
    expect(screen.getByText(/real LLM call/)).toBeInTheDocument();
    expect(draftMutate).not.toHaveBeenCalled();

    // Cancel → nothing executes, nothing persists. (Two dialogs are open —
    // scope the confirm's Cancel to the inner one.)
    const confirmDialog = screen.getAllByRole("dialog")[1]!;
    await user.click(within(confirmDialog).getByRole("button", { name: "Cancel" }));
    expect(draftMutate).not.toHaveBeenCalled();

    // Second activation warns again (the first was cancelled, not accepted).
    await user.click(screen.getAllByRole("button", { name: "Run case" })[0]!);
    expect(screen.getByText(/real LLM call/)).toBeInTheDocument();

    // Confirm → the draft-run executes with the current form values. (The
    // confirm dialog renders BEFORE the outer footer in document order, so
    // resolve its buttons through the dialog, not by index.)
    const runConfirm = screen.getAllByRole("dialog")[1]!;
    await user.click(within(runConfirm).getByRole("button", { name: "Run case" }));
    expect(draftMutate).toHaveBeenCalledTimes(1);
    const [body, opts] = draftMutate.mock.calls[0]!;
    expect(body).toMatchObject({ name: "Hardcoded Stripe secret key" });

    // The result renders from the mutation's onSuccess (metrics + pass badge).
    await act(async () => {
      (opts as { onSuccess: (d: { result: EvalRun }) => void }).onSuccess({ result: RUN });
    });
    expect(screen.getByText("Last run passed")).toBeInTheDocument();
    expect(screen.getByText(/recall 100%/)).toBeInTheDocument();

    // A repeat run goes straight through — no second warning.
    await user.click(screen.getAllByRole("button", { name: "Run case" })[0]!);
    expect(screen.queryByText(/real LLM call/)).not.toBeInTheDocument();
    expect(draftMutate).toHaveBeenCalledTimes(2);
  });
});
