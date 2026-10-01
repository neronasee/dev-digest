/* ImpactBadgeList — the endpoint/cron pills under a symbol group. The pills are
   <span>s, NOT Chips: Chip renders a <button>, and these badges live one
   disclosure layer inside a group whose header is itself a <button> — nested
   buttons are invalid HTML. Endpoint pills preview the first few entries and
   expand via a real toggle button; crons always render in full. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon } from "@devdigest/ui";
import { s } from "./styles";

/** Endpoint pills shown before the "+N more" expander kicks in. */
const ENDPOINT_PREVIEW = 5;

/** "GET /users" → globe icon + bold method + path (split on the first space). */
function EndpointBadge({ endpoint }: { endpoint: string }) {
  const space = endpoint.indexOf(" ");
  const method = space === -1 ? endpoint : endpoint.slice(0, space);
  const path = space === -1 ? "" : endpoint.slice(space + 1);
  return (
    <span style={s.endpointBadge}>
      <Icon.Globe size={12} aria-hidden />
      <b style={s.endpointMethod}>{method}</b> {path}
    </span>
  );
}

/** Amber cron/job pill — clock icon, full schedule text. */
function CronBadge({ cron }: { cron: string }) {
  return (
    <span style={s.cronBadge}>
      <Icon.Clock size={12} aria-hidden />
      {cron}
    </span>
  );
}

export function ImpactBadgeList({
  endpoints,
  crons,
}: {
  endpoints: string[];
  crons: string[];
}) {
  const t = useTranslations("blast");
  const [expanded, setExpanded] = React.useState(false);

  if (endpoints.length === 0 && crons.length === 0) return null;

  const hidden = endpoints.length - ENDPOINT_PREVIEW;
  const shown = expanded ? endpoints : endpoints.slice(0, ENDPOINT_PREVIEW);

  return (
    <div style={s.chipRow}>
      {shown.map((e) => (
        <EndpointBadge key={`e:${e}`} endpoint={e} />
      ))}
      {crons.map((c) => (
        <CronBadge key={`c:${c}`} cron={c} />
      ))}
      {hidden > 0 && (
        <button style={s.badgeMore} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("impact.fewer") : t("impact.more", { count: hidden })}
        </button>
      )}
    </div>
  );
}
