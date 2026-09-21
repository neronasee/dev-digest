/* Skill VersioningTab — the immutable version history (newest first). Each
   previous version offers Diff (line diff vs the CURRENT body, in a modal) and
   Restore (confirm → PUT the old body → a NEW version is appended). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Modal, Skeleton } from "@devdigest/ui";
import type { Skill, SkillVersion } from "@devdigest/shared";
import { useSkillVersions, useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { ConfirmModal } from "@/components/confirm-modal";
import { lineDiff } from "../../helpers";
import { s } from "../../styles";

export function VersioningTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const { data: versions, isLoading } = useSkillVersions(skill.id);
  const [diffing, setDiffing] = React.useState<SkillVersion | null>(null);
  const [restoring, setRestoring] = React.useState<SkillVersion | null>(null);

  if (isLoading) return <Skeleton height={160} />;

  return (
    <div style={{ maxWidth: 760 }}>
      {(versions ?? []).map((v) => {
        const current = v.version === skill.version;
        return (
          <div key={v.version} style={{ ...s.versionRow, ...(current ? s.versionRowCurrent : {}) }}>
            <span className="mono" style={s.versionNum}>
              {t("preview.version", { version: v.version })}
            </span>
            {current && <Badge color="var(--ok)">{t("detail.versioning.current")}</Badge>}
            <span style={s.versionDate}>{new Date(v.created_at).toLocaleString()}</span>
            {!current && (
              <span style={s.rowButtons}>
                <Button kind="secondary" size="sm" icon="GitBranch" onClick={() => setDiffing(v)}>
                  {t("detail.versioning.diff")}
                </Button>
                <Button kind="secondary" size="sm" icon="RefreshCw" onClick={() => setRestoring(v)}>
                  {t("detail.versioning.restore")}
                </Button>
              </span>
            )}
          </div>
        );
      })}

      {diffing && (
        <Modal
          width={860}
          title={t("detail.versioning.diffTitle", { version: diffing.version })}
          onClose={() => setDiffing(null)}
          footer={
            <Button kind="ghost" onClick={() => setDiffing(null)}>
              {t("create.cancel")}
            </Button>
          }
        >
          <pre className="mono" style={s.diffPre}>
            {lineDiff(diffing.body, skill.body).map((row, i) => (
              <span
                key={i}
                style={row.type === "added" ? s.diffAdded : row.type === "removed" ? s.diffRemoved : s.diffSame}
              >
                {row.type === "added" ? "+ " : row.type === "removed" ? "- " : "  "}
                {row.text}
                {"\n"}
              </span>
            ))}
          </pre>
        </Modal>
      )}

      {restoring && (
        <ConfirmModal
          title={t("detail.versioning.restoreConfirmTitle", { version: restoring.version })}
          body={t("detail.versioning.restoreConfirmBody")}
          confirmLabel={t("detail.versioning.restore")}
          cancelLabel={t("create.cancel")}
          danger={false}
          pending={update.isPending}
          onConfirm={() =>
            update.mutate(
              { id: skill.id, patch: { body: restoring.body } },
              {
                onSuccess: (data) => {
                  toast.success(t("detail.versioning.restoredToast", { version: data.version }));
                  setRestoring(null);
                },
              },
            )
          }
          onClose={() => setRestoring(null)}
        />
      )}
    </div>
  );
}
