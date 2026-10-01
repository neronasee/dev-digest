/* BlastGraph — the blast radius as a hand-rolled layered SVG (no chart lib):
   three columns of rounded-rect node pills — changed symbols | caller
   file:line | endpoint/cron chips — joined by cubic-bezier edges from the
   symbol (the index supplies group-level impact, not per-caller facts). The
   layout is fully deterministic (no measurement effects):
   pill widths are estimated from label length, rows march at a fixed pitch,
   and large maps are capped (top groups in server rank order, per-group
   caller/chip caps, row budget) with a "trimmed" note pointing back at the
   tree view. Ellipsized labels keep their full value in a native <title>. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { DownstreamImpact } from "@/lib/types";
import { s } from "./styles";

const GROUP_CAP = 8; // symbol groups kept (server rank order)
const ROW_BUDGET = 48; // drop trailing groups while > 3 groups exceed this
const CALLER_CAP = 6; // caller pills per group
const CHIP_CAP = 5; // endpoint/cron pills per group

const PITCH = 30; // vertical distance between row centers
const PILL_H = 22;
const PILL_RX = 11;
const GUTTER = 36; // gap between columns (also the bezier control offset room)
const X1 = 12; // symbol column left edge
const TOP = 14; // first row's top edge
const EDGE_BEND = 28; // horizontal control-point offset for the beziers

const MAX_W = { symbol: 190, caller: 300, chip: 250 } as const;
const CHAR_W = 6.6; // estimated advance width of an 11px mono/inter char
const PAD_X = 9; // pill inner horizontal padding

/** Estimated pill width for a label, capped at its column's max. */
function estW(text: string, max: number): number {
  return Math.min(max, text.length * CHAR_W + 2 * PAD_X);
}

/** Ellipsize a label so it fits its pill's capped width. */
function fit(text: string, max: number): string {
  const maxChars = Math.floor((max - 2 * PAD_X) / CHAR_W);
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1))}…`;
}

/** Fit a file path by dropping LEADING directories, never the filename: the
 *  basename (+ :line) is the part worth reading, a long repo prefix is not.
 *  Tail-fitting here is what made quick-blog pills read "…/blo…", "C…". */
function fitPath(text: string, max: number): string {
  const maxChars = Math.floor((max - 2 * PAD_X) / CHAR_W);
  if (text.length <= maxChars) return text;
  const segs = text.split("/");
  const file = segs.pop() ?? text;
  let out = file;
  for (let i = segs.length - 1; i >= 0; i--) {
    const body = out.startsWith("…/") ? out.slice(2) : out;
    const candidate = `…/${segs[i]}/${body}`;
    if (candidate.length > maxChars) break;
    out = candidate;
  }
  // Even the bare filename overflows → fall back to tail-fitting it.
  return out.length <= maxChars ? out : fit(file, max);
}

type ChipNode = { kind: "endpoint" | "cron"; label: string };
type GroupNode = { symbol: string; callers: DownstreamImpact["callers"]; chips: ChipNode[] };

/** Cubic bezier from (x1,y1) to (x2,y2) with horizontal-ish control points. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${x1} ${y1} C ${x1 + EDGE_BEND} ${y1}, ${x2 - EDGE_BEND} ${y2}, ${x2} ${y2}`;
}

export function BlastGraph({ downstream }: { downstream: DownstreamImpact[] }) {
  const t = useTranslations("blast");

  if (downstream.every((g) => g.callers.length === 0)) {
    return <div style={{ color: "var(--text-muted)", fontSize: 13.5, padding: "10px 0" }}>{t("graph.empty")}</div>;
  }

  // Caps: top groups in server rank order, then per-group caller/chip caps,
  // then a row budget that drops trailing groups (never below 3 groups).
  const callable = downstream.filter((g) => g.callers.length > 0);
  const toNode = (g: DownstreamImpact): GroupNode => ({
    symbol: g.symbol,
    callers: g.callers.slice(0, CALLER_CAP),
    chips: [
      ...g.endpoints_affected.map((e) => ({ kind: "endpoint" as const, label: e })),
      ...g.crons_affected.map((c) => ({ kind: "cron" as const, label: c })),
    ].slice(0, CHIP_CAP),
  });
  let groups = callable.slice(0, GROUP_CAP).map(toNode);
  const rows = (gs: GroupNode[]) => gs.reduce((n, g) => n + Math.max(g.callers.length, g.chips.length, 1), 0);
  while (groups.length > 3 && rows(groups) > ROW_BUDGET) groups = groups.slice(0, -1);
  const trimmed =
    callable.length > groups.length ||
    groups.some(
      (g, i) =>
        g.callers.length === CALLER_CAP && callable[i]!.callers.length > CALLER_CAP,
    ) ||
    groups.some((g, i) => {
      const full =
        callable[i]!.endpoints_affected.length + callable[i]!.crons_affected.length;
      return g.chips.length === CHIP_CAP && full > CHIP_CAP;
    });

  // Per-group label/width pairs; column offsets derive from the capped data.
  const symText = groups.map((g) => fit(g.symbol, MAX_W.symbol));
  const symW = symText.map((txt) => estW(txt, MAX_W.symbol));
  const callerText = groups.map((g) =>
    g.callers.map((c) => fitPath(`${c.file}:${c.line}`, MAX_W.caller)),
  );
  const callerW = callerText.map((col) => col.map((txt) => estW(txt, MAX_W.caller)));
  const chipText = groups.map((g) => g.chips.map((c) => fit(c.label, MAX_W.chip)));
  const chipW = chipText.map((col) => col.map((txt) => estW(txt, MAX_W.chip)));

  const maxSymW = symW.reduce((m, w) => Math.max(m, w), 0);
  const maxCallerW = callerW.flat().reduce((m, w) => Math.max(m, w), 0);
  const maxChipW = chipW.flat().reduce((m, w) => Math.max(m, w), 0);
  const X2 = X1 + maxSymW + GUTTER;
  const X3 = X2 + maxCallerW + GUTTER;
  const WIDTH = X3 + maxChipW + X1;

  // Row assignment: each group owns max(callers, chips, 1) consecutive rows;
  // the symbol pill centers on its span, callers and chips stack from its top.
  const startRow: number[] = [];
  const groupRows: number[] = [];
  let row = 0;
  for (const g of groups) {
    startRow.push(row);
    const r = Math.max(g.callers.length, g.chips.length, 1);
    groupRows.push(r);
    row += r;
  }
  const totalRows = row;
  const cy = (r: number) => TOP + r * PITCH + PILL_H / 2;
  const HEIGHT = TOP + (totalRows - 1) * PITCH + PILL_H + TOP;
  const hasCrons = groups.some((g) => g.chips.some((c) => c.kind === "cron"));

  /** Symbol pill center: vertically centered on its caller/chip row span. */
  const cySym = (i: number) => {
    const first = startRow[i]!;
    const last = startRow[i]! + groupRows[i]! - 1;
    return (cy(first) + cy(last)) / 2;
  };

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={t("graph.ariaLabel")}
        style={{ display: "block", maxWidth: WIDTH }}
      >
        {groups.map((g, i) =>
          g.callers.map((_, j) => (
            <path
              key={`sc-${i}-${j}`}
              d={edgePath(X1 + symW[i]!, cySym(i), X2, cy(startRow[i]! + j))}
              stroke="var(--border-strong)"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
        {groups.map((g, i) =>
          g.chips.map((_chip, k) => (
            <path
              key={`sc-impact-${i}-${k}`}
              d={edgePath(X1 + symW[i]!, cySym(i), X3, cy(startRow[i]! + k))}
              stroke="var(--border-strong)"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          )),
        )}
        {groups.map((g, i) => (
          <g key={`s-${g.symbol}-${i}`}>
            <title>{g.symbol}</title>
            <rect
              x={X1}
              y={cySym(i) - PILL_H / 2}
              width={symW[i]!}
              height={PILL_H}
              rx={PILL_RX}
              fill="var(--bg-surface)"
              stroke="var(--accent)"
            />
            <text
              x={X1 + symW[i]! / 2}
              y={cySym(i)}
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--text-primary)"
              fontSize={11.5}
              fontWeight={700}
            >
              {symText[i]}
            </text>
          </g>
        ))}
        {groups.map((g, i) =>
          g.callers.map((c, j) => (
            <g key={`c-${i}-${j}-${c.file}:${c.line}`}>
              <title>{`${c.file}:${c.line}`}</title>
              <rect
                x={X2}
                y={cy(startRow[i]! + j) - PILL_H / 2}
                width={callerW[i]![j]!}
                height={PILL_H}
                rx={PILL_RX}
                fill="var(--bg-surface)"
                stroke="var(--border-strong)"
              />
              <text
                x={X2 + callerW[i]![j]! / 2}
                y={cy(startRow[i]! + j)}
                textAnchor="middle"
                dominantBaseline="central"
                fill="var(--text-secondary)"
                fontSize={11}
                fontFamily="var(--font-mono, monospace)"
              >
                {callerText[i]![j]!}
              </text>
            </g>
          )),
        )}
        {groups.map((g, i) =>
          g.chips.map((chip, k) => {
            const isCron = chip.kind === "cron";
            const space = chip.label.indexOf(" ");
            const method = isCron || space === -1 ? "" : chip.label.slice(0, space);
            const rest = isCron || space === -1 ? chip.label : chip.label.slice(space + 1);
            return (
              <g key={`ch-${i}-${k}`}>
                <title>{chip.label}</title>
                <rect
                  x={X3}
                  y={cy(startRow[i]! + k) - PILL_H / 2}
                  width={chipW[i]![k]!}
                  height={PILL_H}
                  rx={PILL_RX}
                  fill="var(--bg-surface)"
                  stroke={isCron ? "var(--warn)" : "var(--accent)"}
                />
                <text
                  x={X3 + chipW[i]![k]! / 2}
                  y={cy(startRow[i]! + k)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={isCron ? "var(--text-secondary)" : "var(--accent-text)"}
                  fontSize={11}
                  fontFamily="var(--font-mono, monospace)"
                >
                  {method ? (
                    <>
                      <tspan fontWeight={700}>{method}</tspan> {rest}
                    </>
                  ) : (
                    rest
                  )}
                </text>
              </g>
            );
          }),
        )}
      </svg>

      <div style={s.graphLegend}>
        <span style={s.legendItem}>
          <span style={{ ...s.legendSwatch, border: "1px solid var(--accent)" }} />
          {t("graph.legend.symbol")}
        </span>
        <span style={s.legendItem}>
          <span style={s.legendSwatch} />
          {t("graph.legend.callers")}
        </span>
        <span style={s.legendItem}>
          <span
            style={{ ...s.legendSwatch, border: "1px solid var(--accent)", background: "var(--accent-bg)" }}
          />
          {t("graph.legend.endpoints")}
        </span>
        {hasCrons && (
          <span style={s.legendItem}>
            <span
              style={{ ...s.legendSwatch, border: "1px solid var(--warn)", background: "var(--warn-bg)" }}
            />
            {t("graph.legend.crons")}
          </span>
        )}
      </div>
      {trimmed && <div style={s.graphTrimmed}>{t("graph.trimmed")}</div>}
    </div>
  );
}
