/* ImportFromUrlModal — two-step URL import: (1) fetch a markdown skill
   server-side (POST /skills/import-url — a dangerous scan verdict is a 422
   and the body never reaches the client); (2) preview the scan verdict +
   editable metadata, save ONLY on the explicit import click through the
   regular create mutation. Imported skills land source='imported_url',
   enabled=false until vetted. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea, Markdown, Badge } from "@devdigest/ui";
import type { Skill, SkillUrlImportPreview } from "@devdigest/shared";
import { useCreateSkill, useImportSkillFromUrl } from "@/lib/hooks/skills";
import { ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { parseMarkdown } from "../../helpers";
import { SKILL_TYPES, MODAL_WIDTH } from "../../constants";
import { s } from "../../styles";

export function ImportFromUrlModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const create = useCreateSkill();
  const importUrl = useImportSkillFromUrl();
  const [url, setUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<SkillUrlImportPreview | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<Skill["type"]>("custom");

  const fetchPreview = async () => {
    setError(null);
    try {
      const p = await importUrl.mutateAsync({ url: url.trim() });
      setPreview(p);
      // Same metadata derivation as the file import: front matter if present,
      // first `# ` heading as the name fallback.
      const parsed = parseMarkdown(p.body);
      setName(parsed.name ?? "");
      setDescription(parsed.description ?? "");
    } catch (e) {
      // Dangerous verdict → the server rejected the fetch outright (422) and
      // the body never reached us; surface its reason verbatim.
      if (e instanceof ApiError && e.status === 422 && e.code === "skill_threat_detected") {
        setError(`${t("url.error.blocked")} ${e.message}`);
      } else {
        setError(t("url.error.fetch"));
      }
    }
  };

  const submit = async () => {
    if (!preview) return;
    const skill = await create.mutateAsync({
      name: name.trim(),
      description,
      type,
      body: preview.body,
      source: "imported_url",
      enabled: false, // untrusted until vetted
    });
    toast.success(t("url.success", { name: skill.name }));
    onClose();
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("page.menu.fromUrl")}
      subtitle={preview ? t("import.previewTitle") : t("url.hint")}
      onClose={onClose}
      footer={
        preview ? (
          <div style={s.footer}>
            <Button kind="ghost" icon="ArrowRight" onClick={() => setPreview(null)}>
              {t("import.back")}
            </Button>
            <Button
              kind="primary"
              icon="Globe"
              onClick={submit}
              disabled={create.isPending || !name.trim() || !preview.body.trim()}
            >
              {create.isPending ? t("file.importing") : t("url.import")}
            </Button>
          </div>
        ) : (
          <div style={s.footer}>
            <Button kind="ghost" onClick={onClose}>
              {t("create.cancel")}
            </Button>
            <Button
              kind="primary"
              icon="Globe"
              onClick={fetchPreview}
              disabled={importUrl.isPending || !url.trim()}
            >
              {importUrl.isPending ? t("url.fetching") : t("url.fetch")}
            </Button>
          </div>
        )
      }
    >
      {!preview ? (
        <div style={s.formBody}>
          <FormField label={t("url.label")} hint={t("url.hint")}>
            <TextInput value={url} onChange={setUrl} placeholder={t("url.placeholder")} />
          </FormField>
          {error && <span style={s.errorText}>{error}</span>}
        </div>
      ) : (
        <div style={s.formBody}>
          <FormField label={t("file.nameLabel")} required hint={t("file.nameHint")}>
            <TextInput value={name} onChange={setName} placeholder={t("file.namePlaceholder")} />
          </FormField>
          <FormField label={t("create.fields.description")} hint={t("form.descriptionHint")}>
            <Textarea value={description} onChange={setDescription} rows={2} />
          </FormField>
          <FormField label={t("create.fields.type")}>
            <SelectInput
              value={type}
              onChange={(v) => setType(v as Skill["type"])}
              options={SKILL_TYPES.map((tp) => ({ value: tp, label: t(`listItem.type.${tp}`) }))}
            />
          </FormField>
          {/* Server-computed two-level scan verdict, shown verbatim; a
              suspicious verdict warns but does not block — the server already
              allowed the preview through. */}
          <div style={s.notice}>
            <div style={{ fontWeight: 600 }}>
              {t("url.scan.title")}: {t(`url.scan.${preview.scan.verdict}`)}
            </div>
            <div>
              {preview.scan.reason}
              {preview.scan.llm == null ? ` ${t("url.scan.regexOnly")}` : ""}
            </div>
          </div>
          <FormField label={t("file.bodyLabel")}>
            <div style={s.badgesRow}>
              <Badge color="var(--warn, #f59e0b)">{t("preview.untrustedBadge")}</Badge>
              <Badge mono>{t("preview.version", { version: 1 })}</Badge>
            </div>
          </FormField>
          <div style={s.notice}>{t("preview.untrustedNotice")}</div>
          <div style={{ padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-surface)" }}>
            <Markdown>{preview.body}</Markdown>
          </div>
          {error && <span style={s.errorText}>{error}</span>}
        </div>
      )}
    </Modal>
  );
}
