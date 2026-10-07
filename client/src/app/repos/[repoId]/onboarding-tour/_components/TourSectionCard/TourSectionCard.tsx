/* TourSectionCard — one collapsible tour section. The same card shell renders
   all five section kinds (AC-13 collapse; honest empty-note when a section has
   no grounded entries — AC-8):

   - architecture: prose through the Markdown primitive (rendered as data,
     AC-21) + the persisted diagram source through MermaidDiagram (invalid
     source renders nothing, prose always stands — AC-20/21);
   - critical paths / reading path: path rows with an external Open anchor at
     the repo's hosting provider — plain text when the repo is unresolved
     (AC-19);
   - run locally: command blocks with Copy (verbatim clipboard + announced
     confirmation — AC-14) and a session-local done checkbox (AC-15; never
     persisted);
   - first tasks: Open anchors resolving to the referenced PR or file (AC-19).

   Commands are display/copy text only — nothing here is ever executed. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Icon, Markdown } from "@devdigest/ui";
import type {
  OnboardingTour,
  TourArchitecture,
  TourCriticalPath,
  TourFirstTask,
  TourReadingEntry,
  TourRunStep,
} from "@devdigest/shared";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { SECTION_TITLE_KEYS, type SectionId } from "../../constants";
import { githubFileUrl, githubPrUrl } from "../../helpers";
import { s } from "../../styles";

export function TourSectionCard({
  id,
  tour,
  repoFullName,
  branch,
}: {
  id: SectionId;
  tour: OnboardingTour;
  /** Unresolved repo (no active repo yet) → paths render as plain text. */
  repoFullName?: string;
  branch?: string;
}) {
  const t = useTranslations("onboarding");
  const [open, setOpen] = React.useState(true);
  const title = t(SECTION_TITLE_KEYS[id]);
  const bodyId = `tour-section-${id}`;

  return (
    <section id={id} aria-labelledby={`${bodyId}-title`} style={s.card}>
      <div style={s.cardHeader}>
        <h2 id={`${bodyId}-title`} style={s.cardTitle}>
          {title}
        </h2>
        <button
          type="button"
          style={s.collapseBtn}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={t(open ? "actions.collapseSection" : "actions.expandSection", {
            section: title,
          })}
          onClick={() => setOpen((v) => !v)}
        >
          <Icon.ChevronDown
            size={15}
            style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform .12s" }}
          />
        </button>
      </div>
      {/* Collapsed = body unmounted (AC-13); the section root keeps its anchor. */}
      {open && (
        <div id={bodyId} style={s.cardBody}>
          {id === "architecture" && <ArchitectureBody section={tour.architecture} />}
          {id === "critical-paths" && (
            <PathListBody
              entries={tour.critical_paths}
              emptyKey="sections.critical-paths.empty"
              repoFullName={repoFullName}
              branch={branch}
            />
          )}
          {id === "run-locally" && <RunLocallyBody steps={tour.run_locally} />}
          {id === "reading-path" && (
            <PathListBody
              entries={tour.reading_path}
              emptyKey="sections.reading-path.empty"
              repoFullName={repoFullName}
              branch={branch}
            />
          )}
          {id === "first-tasks" && (
            <FirstTasksBody
              tasks={tour.first_tasks}
              repoFullName={repoFullName}
              branch={branch}
            />
          )}
        </div>
      )}
    </section>
  );
}

/** Section 1 — prose (always present) + optional mermaid diagram source. */
function ArchitectureBody({ section }: { section: TourArchitecture }) {
  return (
    <div>
      <Markdown>{section.overview}</Markdown>
      {section.diagram != null && (
        <div style={s.diagram}>
          <MermaidDiagram chart={section.diagram} />
        </div>
      )}
    </div>
  );
}

/** A repo-relative path with its role text and an external Open anchor. */
function PathRow({
  index,
  path,
  children,
  href,
}: {
  index: number;
  path: string;
  children?: React.ReactNode;
  href: string | null;
}) {
  const t = useTranslations("onboarding");
  return (
    <div style={s.row}>
      <span style={s.rowIndex} className="tnum">
        {index}
      </span>
      <div style={s.rowMain}>
        {href ? (
          <a style={s.rowPath} className="mono" href={href} target="_blank" rel="noreferrer">
            {path}
          </a>
        ) : (
          <span style={s.rowPathPlain} className="mono">
            {path}
          </span>
        )}
        {children}
      </div>
      {href && (
        <a style={s.openLink} href={href} target="_blank" rel="noreferrer">
          <Icon.ExternalLink size={11} />
          {t("actions.open")}
        </a>
      )}
    </div>
  );
}

/** Sections 2 and 4 — ordered path lists ({ path, text } entries). */
function PathListBody({
  entries,
  emptyKey,
  repoFullName,
  branch,
}: {
  entries: Array<TourCriticalPath | TourReadingEntry>;
  emptyKey: string;
  repoFullName?: string;
  branch?: string;
}) {
  const t = useTranslations("onboarding");
  if (entries.length === 0) {
    return <p style={s.emptyNote}>{t(emptyKey)}</p>;
  }
  return (
    <div style={s.rowList}>
      {entries.map((entry, i) => (
        <PathRow
          key={entry.path}
          index={i + 1}
          path={entry.path}
          href={githubFileUrl(repoFullName, branch, entry.path)}
        >
          {"description" in entry ? (
            <p style={s.rowText}>{entry.description}</p>
          ) : (
            <>
              <p style={s.rowText}>{entry.purpose}</p>
              <p style={s.rowText}>{entry.why}</p>
            </>
          )}
        </PathRow>
      ))}
    </div>
  );
}

/** Section 3 — ordered setup steps with copyable commands + session-local done. */
function RunLocallyBody({ steps }: { steps: TourRunStep[] }) {
  const t = useTranslations("onboarding");
  const [done, setDone] = React.useState<Set<number>>(() => new Set());
  const [copyState, setCopyState] = React.useState<number | "failed" | null>(null);

  if (steps.length === 0) {
    return <p style={s.emptyNote}>{t("sections.run-locally.empty")}</p>;
  }

  const copy = async (index: number, command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState(index);
    } catch {
      setCopyState("failed");
    }
  };

  const toggleDone = (index: number, on: boolean) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (on) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  return (
    <div style={s.rowList}>
      {steps.map((step, i) => (
        <div key={`${step.title}-${i}`} style={s.stepRow}>
          <div style={s.stepMain}>
            <div style={s.stepTitleRow}>
              <span style={s.rowIndex} className="tnum">
                {i + 1}
              </span>
              <span style={s.stepTitle}>{step.title}</span>
            </div>
            <p style={s.stepDesc}>{step.description}</p>
            <div style={s.commandRow}>
              <pre className="mono" style={s.command}>
                {step.command}
              </pre>
              <Button kind="ghost" size="sm" icon="Copy" onClick={() => copy(i, step.command)}>
                {t("actions.copy")}
              </Button>
              <span role="status" aria-live="polite" style={s.copyStatus}>
                {copyState === i ? t("actions.copied") : copyState === "failed" ? t("actions.copyFailed") : ""}
              </span>
            </div>
          </div>
          <div style={done.has(i) ? { ...s.stepDone, ...s.stepDoneChecked } : s.stepDone}>
            <Checkbox
              checked={done.has(i)}
              onChange={(on) => toggleDone(i, on)}
              label={t("actions.done")}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Section 5 — starter tasks anchored to a real PR or file (AC-19). */
function FirstTasksBody({
  tasks,
  repoFullName,
  branch,
}: {
  tasks: TourFirstTask[];
  repoFullName?: string;
  branch?: string;
}) {
  const t = useTranslations("onboarding");
  if (tasks.length === 0) {
    return <p style={s.emptyNote}>{t("sections.first-tasks.empty")}</p>;
  }
  return (
    <div style={s.rowList}>
      {tasks.map((task, i) => {
        const href =
          task.artifact_kind === "pr"
            ? githubPrUrl(repoFullName, task.artifact_ref)
            : githubFileUrl(repoFullName, branch, task.artifact_ref);
        return (
          <div key={`${task.title}-${i}`} style={s.row}>
            <span style={s.rowIndex} className="tnum">
              {i + 1}
            </span>
            <div style={s.rowMain}>
              <div style={s.stepTitleRow}>
                {task.artifact_kind === "pr" && (
                  <span style={s.prRef} className="mono">
                    #{task.artifact_ref}
                  </span>
                )}
                <span style={s.stepTitle}>{task.title}</span>
              </div>
              <p style={s.rowText}>{task.description}</p>
            </div>
            {href ? (
              <a style={s.openLink} href={href} target="_blank" rel="noreferrer">
                <Icon.ExternalLink size={11} />
                {t("actions.open")}
              </a>
            ) : (
              task.artifact_kind === "file" && (
                <span style={s.rowPathPlain} className="mono">
                  {task.artifact_ref}
                </span>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
