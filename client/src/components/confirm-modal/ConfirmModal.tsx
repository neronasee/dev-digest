/* ConfirmModal — shared confirmation dialog (confirm / cancel / X). Built on
   the vendored Modal; `danger` renders the confirm button in the danger kind.
   Used for destructive actions (skill/agent delete, version restore). */
"use client";

import React from "react";
import { Button, Modal } from "@devdigest/ui";
import { s } from "./styles";

export function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel,
  danger = true,
  pending = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      width={460}
      title={title}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button kind={danger ? "danger" : "primary"} icon="Trash" onClick={onConfirm} disabled={pending}>
            {pending ? "…" : confirmLabel}
          </Button>
        </div>
      }
    >
      {body && <div style={s.body}>{body}</div>}
    </Modal>
  );
}
