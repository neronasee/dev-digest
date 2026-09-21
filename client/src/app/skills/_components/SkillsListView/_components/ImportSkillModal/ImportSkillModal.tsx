/* ImportSkillModal — two-step import: (1) pick a .md/.markdown file or a .zip
   archive — only markdown entries are ever read; (2) preview the extracted
   skill core with editable metadata, save ONLY on the explicit import click.
   Imported skills land source='imported_file', enabled=false until vetted. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea, Markdown, Badge, Icon } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { extractFromZip, parseMarkdown, assertFileSize, type ParsedMarkdown } from "../../helpers";
import { SKILL_TYPES, MODAL_WIDTH } from "../../constants";
import { s } from "../../styles";

export function ImportSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const create = useCreateSkill();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [parsed, setParsed] = React.useState<ParsedMarkdown | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<Skill["type"]>("custom");

  const onFile = async (file: File) => {
    setError(null);
    try {
      if (/\.zip$/i.test(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const extracted = extractFromZip(bytes);
        applyExtracted(extracted);
      } else if (/\.(md|markdown)$/i.test(file.name)) {
        assertFileSize(file.size);
        const text = await file.text();
        applyExtracted(parseMarkdown(text));
      } else {
        setError(t("import.noMarkdown"));
      }
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith("import.") ? t(e.message) : t("drawer.importFailed"));
    }
  };

  const applyExtracted = (extracted: ParsedMarkdown) => {
    if (!extracted.name) setError(t("import.noMarkdown"));
    setParsed(extracted);
    setName(extracted.name ?? "");
    setDescription(extracted.description ?? "");
  };

  const submit = async () => {
    if (!parsed) return;
    const skill = await create.mutateAsync({
      name: name.trim(),
      description,
      type,
      body: parsed.body,
      source: "imported_file",
      enabled: false, // untrusted until vetted
    });
    toast.success(t("file.success", { name: skill.name }));
    onClose();
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("drawer.title")}
      subtitle={parsed ? t("import.previewTitle") : t("drawer.subtitle")}
      onClose={onClose}
      footer={
        parsed ? (
          <div style={s.footer}>
            <Button kind="ghost" icon="ArrowRight" onClick={() => setParsed(null)}>
              {t("import.back")}
            </Button>
            <Button
              kind="primary"
              icon="Upload"
              onClick={submit}
              disabled={create.isPending || !name.trim() || !parsed.body.trim()}
            >
              {create.isPending ? t("import.importing") : t("import.import")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {!parsed ? (
        <div style={s.pickZone}>
          <Icon.Upload size={22} style={{ color: "var(--text-muted)" }} />
          <div style={{ fontSize: 13.5, color: "var(--text-secondary)", maxWidth: 420 }}>
            {t("import.pickBody")}
          </div>
          <Button kind="secondary" icon="FileText" onClick={() => fileInput.current?.click()}>
            {t("import.pick")}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".md,.markdown,.zip"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
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
          <FormField label={t("file.bodyLabel")}>
            <div style={s.badgesRow}>
              <Badge color="var(--warn, #f59e0b)">{t("preview.untrustedBadge")}</Badge>
              <Badge mono>{t("preview.version", { version: 1 })}</Badge>
            </div>
          </FormField>
          <div style={s.notice}>{t("preview.untrustedNotice")}</div>
          <div style={{ padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-surface)" }}>
            <Markdown>{parsed.body}</Markdown>
          </div>
          {error && <span style={s.errorText}>{error}</span>}
        </div>
      )}
    </Modal>
  );
}
