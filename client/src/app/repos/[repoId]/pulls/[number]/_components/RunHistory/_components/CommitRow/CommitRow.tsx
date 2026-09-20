/* CommitRow — one commit marker in the PR timeline. Commits are markers, not
   actions: dashed + transparent so they read as separators between the runs
   they sit chronologically between. */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { PrCommit } from "@devdigest/shared";
import { s } from "../../styles";

export function CommitRow({ commit }: { commit: PrCommit }) {
  const c = commit;
  return (
    <div style={s.commitRow}>
      <Icon.GitCommit size={15} style={s.commitIcon} />
      <span className="mono" style={s.commitSha}>
        {c.sha.slice(0, 7)}
      </span>
      <span style={s.commitMessage} title={c.message}>
        {c.message.split("\n")[0]}
      </span>
      <span style={s.commitMeta}>{c.author}</span>
      {c.committed_at && (
        <span style={s.commitMeta}>{new Date(c.committed_at).toLocaleTimeString()}</span>
      )}
    </div>
  );
}
