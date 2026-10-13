/* EvalCaseModal — create/edit an eval case, shared by the PR-detail "Turn into
   eval case" one-click (finding-prefilled) and the AgentEditor Evals tab
   (blank / existing). NOTHING persists before Save: "Run case" executes the
   current form as a draft-run (persists nothing server-side); the FIRST run in
   a modal session is gated by a cost confirmation (once per session — later
   runs go straight through). Expected-output JSON must parse + match the
   shared EvalExpectedOutput schema before Save unlocks (AC-7). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, Markdown, Modal, SelectInput, Tabs, Textarea, TextInput } from "@devdigest/ui";
import type { EvalCase, EvalRun, FindingRecord, PrFile } from "@devdigest/shared";
import { useAgents } from "@/lib/hooks/agents";
import { useCreateEvalCase, useEvalDraftRun, useUpdateEvalCase } from "@/lib/hooks/evals";
import { formatCost } from "@/lib/cost";
import { ConfirmModal } from "@/components/confirm-modal";
import { BLANK_EXPECTED_JSON, MODAL_WIDTH, TAB_DIFF, TAB_PR_META } from "./constants";
import {
  actualOfRun,
  capViolations,
  parseExpectedJson,
  prefillFromFinding,
  runPassed,
  toPercent,
  toWriteBody,
} from "./helpers";
import { s } from "./styles";

interface FormState {
  name: string;
  diff: string;
  title: string;
  body: string;
  expectedJson: string;
}

/** Edit → from the stored case; one-click → from the finding; blank → skeleton. */
function initialForm(props: {
  existing?: EvalCase | null;
  finding?: FindingRecord | null;
  files?: PrFile[];
  prMeta?: { title: string | null; body: string | null } | null;
}): FormState {
  if (props.existing) {
    const meta = (props.existing.input_meta ?? null) as
      | { title?: unknown; body?: unknown }
      | null;
    return {
      name: props.existing.name,
      diff: props.existing.input_diff ?? "",
      title: typeof meta?.title === "string" ? meta.title : "",
      body: typeof meta?.body === "string" ? meta.body : "",
      expectedJson: JSON.stringify(props.existing.expected_output ?? {}, null, 2),
    };
  }
  if (props.finding) {
    const p = prefillFromFinding(
      props.finding,
      props.files ?? [],
      props.prMeta ?? { title: null, body: null },
    );
    return {
      name: p.name,
      diff: p.diff,
      title: p.title,
      body: p.body,
      expectedJson: JSON.stringify(p.expected, null, 2),
    };
  }
  return { name: "", diff: "", title: "", body: "", expectedJson: BLANK_EXPECTED_JSON };
}

export function EvalCaseModal({
  agentId: defaultAgentId,
  existing = null,
  finding = null,
  files = [],
  prMeta = null,
  onClose,
}: {
  /** Preselected owning agent (the finding's review agent / the editor agent). */
  agentId: string | null;
  /** Edit mode: the case to update (Save ⇒ PUT). */
  existing?: EvalCase | null;
  /** One-click prefill source (Save ⇒ POST). */
  finding?: FindingRecord | null;
  /** PR files — the diff-prefill source for the one-click flow. */
  files?: PrFile[];
  prMeta?: { title: string | null; body: string | null } | null;
  onClose: () => void;
}) {
  const t = useTranslations("eval");

  const [agentId, setAgentId] = React.useState(defaultAgentId ?? "");
  const [form, setForm] = React.useState<FormState>(() =>
    initialForm({ existing, finding, files, prMeta }),
  );
  const [tab, setTab] = React.useState<string>(TAB_DIFF);
  const [result, setResult] = React.useState<EvalRun | null>(null);
  const [confirmCost, setConfirmCost] = React.useState(false);
  // Cost warning fires on the FIRST Run activation of this modal session only.
  const costWarned = React.useRef(false);

  const { data: agents } = useAgents();
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const parsedExpected = parseExpectedJson(form.expectedJson);
  const violations = capViolations(form);
  const agentOptions = [
    ...(agentId === "" ? [{ value: "", label: "—" }] : []),
    ...(agents ?? []).map((a) => ({ value: a.id, label: a.name })),
  ];

  const draft = useEvalDraftRun(agentId || null);
  const create = useCreateEvalCase(agentId || null);
  const update = useUpdateEvalCase(agentId || null);
  const saving = create.isPending || update.isPending;
  const saveError = create.error ?? update.error;
  const saveDisabled =
    saving || !agentId || !form.name.trim() || !parsedExpected || violations.length > 0;

  const doRun = () => {
    if (!agentId || !parsedExpected) return;
    draft.mutate(toWriteBody({ ...form, expected: parsedExpected }), {
      onSuccess: (d) => setResult(d.result),
    });
  };

  const onRunClick = () => {
    // First activation of the session → confirm the real LLM cost; cancelling
    // the confirm executes nothing (and the next click asks again).
    if (costWarned.current) doRun();
    else setConfirmCost(true);
  };

  const save = () => {
    if (!agentId || !parsedExpected) return;
    const body = toWriteBody({ ...form, expected: parsedExpected, notes: existing?.notes ?? null });
    const done = { onSuccess: () => onClose() };
    if (existing) update.mutate({ caseId: existing.id, body }, done);
    else create.mutate(body, done);
  };

  const actual = actualOfRun(result);
  const passed = runPassed(result);

  return (
    <Modal
      width={MODAL_WIDTH}
      title={existing ? t("caseEditor.caseTitle", { name: existing.name }) : t("caseEditor.newCase")}
      onClose={onClose}
      footer={
        <>
          {saveError && <span style={s.footerError}>{saveError.message}</span>}
          <Button kind="ghost" onClick={onClose}>
            {t("caseEditor.cancel")}
          </Button>
          <Button
            kind="secondary"
            icon="Play"
            disabled={!agentId || !parsedExpected || draft.isPending}
            onClick={onRunClick}
          >
            {draft.isPending ? t("caseEditor.running") : t("caseEditor.runCase")}
          </Button>
          <Button kind="primary" disabled={saveDisabled} onClick={save}>
            {saving ? t("caseEditor.saving") : t("caseEditor.save")}
          </Button>
        </>
      }
    >
      <div style={s.body}>
        <FormField label={t("caseEditor.agentLabel")} required>
          {existing ? (
            <span>{agentOptions.find((option) => option.value === agentId)?.label ?? agentId}</span>
          ) : (
            <SelectInput value={agentId} onChange={setAgentId} options={agentOptions} mono={false} />
          )}
        </FormField>

        <FormField label={t("caseEditor.nameLabel")} required>
          <TextInput
            value={form.name}
            onChange={(name) => set({ name })}
            placeholder={t("caseEditor.namePlaceholder")}
            mono
          />
        </FormField>

        <Tabs
          tabs={[
            { key: TAB_DIFF, label: t("caseEditor.tabs.diff") },
            { key: TAB_PR_META, label: t("caseEditor.tabs.prMeta") },
          ]}
          value={tab}
          onChange={setTab}
          pad="0"
        />

        <div style={s.tabBody}>
          {tab === TAB_DIFF ? (
            <FormField label={t("caseEditor.inputLabel")} required>
              <Textarea
                value={form.diff}
                onChange={(diff) => set({ diff })}
                placeholder={t("caseEditor.diffPlaceholder")}
                rows={12}
                mono
              />
            </FormField>
          ) : (
            <>
              <FormField label={t("caseEditor.titleLabel")}>
                <TextInput
                  value={form.title}
                  onChange={(title) => set({ title })}
                  placeholder={t("caseEditor.titlePlaceholder")}
                />
              </FormField>
              <FormField label={t("caseEditor.bodyLabel")}>
                <Textarea value={form.body} onChange={(body) => set({ body })} rows={6} />
              </FormField>
            </>
          )}
        </div>

        <FormField
          label={t("caseEditor.expectedOutput")}
          required
          right={
            <span style={s.jsonBadge(!!parsedExpected)}>
              {parsedExpected ? t("caseEditor.validJson") : t("caseEditor.invalidJson")}
            </span>
          }
        >
          <Textarea
            value={form.expectedJson}
            onChange={(expectedJson) => set({ expectedJson })}
            rows={10}
            mono
          />
        </FormField>
        {violations.length > 0 && (
          <div role="note" style={s.capError}>
            {t("caseEditor.tooLarge")}
          </div>
        )}

        {result && (
          <div style={s.resultBlock}>
            <div style={s.resultMetaRow}>
              <span style={passed ? s.passBadge : s.failBadge}>
                {passed ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
              </span>
              <span style={s.resultSummary}>
                {t("caseEditor.resultSummary", {
                  recall: toPercent(result.recall),
                  precision: toPercent(result.precision),
                  citation: toPercent(result.citation_accuracy),
                  duration: Math.round(result.duration_ms / 1000),
                })}
              </span>
              <span style={s.cost}>{formatCost(result.cost_usd)}</span>
            </div>
            {actual.error && (
              <div role="alert" style={s.runError}>
                {actual.error}
              </div>
            )}
            {actual.findings.length > 0 && (
              <div style={s.findingsList}>
                {actual.findings.map((f) => (
                  <div key={f.id} style={s.findingRow}>
                    <Markdown>{`**${f.severity}** · ${f.file}:${f.start_line} — ${f.title}`}</Markdown>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {draft.error && (
          <div role="alert" style={s.runError}>
            {draft.error.message}
          </div>
        )}
      </div>

      {confirmCost && (
        <ConfirmModal
          title={t("caseEditor.runCase")}
          body={t("caseEditor.costWarning")}
          confirmLabel={t("caseEditor.runCase")}
          cancelLabel={t("caseEditor.cancel")}
          danger={false}
          onConfirm={() => {
            setConfirmCost(false);
            costWarned.current = true;
            doRun();
          }}
          onClose={() => setConfirmCost(false)}
        />
      )}
    </Modal>
  );
}
