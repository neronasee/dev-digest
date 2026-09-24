/* CreateSkillModal — "create skill" modal: name / description (the skill's
   interface, phrased as a directive) / type / markdown body. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Modal, FormField, TextInput, SelectInput, Textarea } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useCreateSkill } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { SKILL_TYPES, MODAL_WIDTH } from "../../constants";
import { s } from "../../styles";

export function CreateSkillModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations("skills");
  const toast = useToast();
  const create = useCreateSkill();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [type, setType] = React.useState<Skill["type"]>("rubric");
  const [body, setBody] = React.useState("");

  const submit = async () => {
    const skill = await create.mutateAsync({ name: name.trim(), description, type, body });
    toast.success(t("create.success", { name: skill.name }));
    onClose();
  };

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("create.title")}
      subtitle={t("create.subtitle")}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {t("create.cancel")}
          </Button>
          <Button
            kind="primary"
            icon="Plus"
            onClick={submit}
            disabled={create.isPending || !name.trim() || !body.trim()}
          >
            {create.isPending ? t("create.creating") : t("create.create")}
          </Button>
        </div>
      }
    >
      <div style={s.formBody}>
        <FormField label={t("create.fields.name")} required>
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
        <FormField label={t("create.fields.body")} required>
          <Textarea value={body} onChange={setBody} rows={10} mono placeholder={t("file.bodyPlaceholder")} />
        </FormField>
      </div>
    </Modal>
  );
}
