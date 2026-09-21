/* Skill ConfigTab — the edit form (name / directive description / type /
   markdown body). Saving a CHANGED body creates a new immutable version
   server-side; the toast confirms the version the save produced. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, FormField, SelectInput, TextInput, Textarea } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useUpdateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { SKILL_TYPES } from "@/app/skills/_components/SkillsListView/constants";
import { s } from "../../styles";

export function ConfigTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const update = useUpdateSkill();
  const [name, setName] = React.useState(skill.name);
  const [description, setDescription] = React.useState(skill.description);
  const [type, setType] = React.useState<Skill["type"]>(skill.type);
  const [body, setBody] = React.useState(skill.body);

  const save = () =>
    update.mutate(
      { id: skill.id, patch: { name, description, type, body } },
      {
        onSuccess: (data) => toast.success(t("detail.config.savedToast", { version: data.version })),
      },
    );

  return (
    <div style={s.form}>
      <FormField label={t("create.fields.name")} required>
        <TextInput value={name} onChange={setName} />
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
      <FormField label={t("preview.bodyLabel")} hint={t("preview.bodyHint")} required>
        <Textarea value={body} onChange={setBody} rows={14} mono />
      </FormField>
      <div style={s.saveRow}>
        <Button
          kind="primary"
          icon="Check"
          onClick={save}
          disabled={update.isPending || !name.trim() || !body.trim()}
        >
          {t("preview.save")}
        </Button>
      </div>
    </div>
  );
}
