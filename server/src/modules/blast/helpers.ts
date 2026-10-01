import { z } from 'zod';
import { BlastRadius, PrHistory } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';

/**
 * blast — pure mapping helpers (application layer). No HTTP and no raw SQL
 * live here: the flat repo-intel `BlastResult` is regrouped into the shared
 * `BlastRadius` contract shape, and the pulls repository's overlap rows into
 * `PrHistory`. Types are derived from the container's facade
 * (`Container['repoIntel']` — the reviews/run-executor pattern), so this module
 * never imports repo-intel internals.
 */

type RepoIntel = Container['repoIntel'];
export type BlastResult = Awaited<ReturnType<RepoIntel['getBlastRadius']>>;
type IndexState = Awaited<ReturnType<RepoIntel['getIndexState']>>;

export type BlastRadiusDto = z.infer<typeof BlastRadius>;
export type PrHistoryDto = z.infer<typeof PrHistory>;
export type OverlappingPrRow = Awaited<
  ReturnType<Container['pullsRepo']['findOverlappingPrs']>
>[number];

/** Pino-style request logger surface (fastify's `req.log` satisfies this). */
export interface Logger {
  info(o: object, m?: string): void;
  warn(o: object, m?: string): void;
  error(o: object, m?: string): void;
  debug(o: object, m?: string): void;
}

/**
 * Map the facade's flat blast result + one index-state read into the grouped
 * `BlastRadius` contract:
 *  - callers are grouped by `viaSymbol` (one `DownstreamImpact` per CHANGED
 *    symbol, zero-caller symbols included with `callers: []`);
 *  - a defensive self-caller filter drops rows whose file declares the symbol
 *    they reach (the ripgrep facade path already skips same-file refs; the
 *    persistent SQL path does not — filter here so both are safe) and rows
 *    whose `viaSymbol` matches no changed symbol;
 *  - endpoints/crons per symbol = ordered-dedup union of the facts of that
 *    symbol's caller files (`[]` when `factsByFile` is absent — degraded);
 *  - `downstream` is ordered by the group's max caller rank desc (stable sort
 *    keeps changed-symbol order on ties);
 *  - `degraded` combines the result's own flag with index partial-ness (the
 *    persistent facade path reports `degraded: false` even for a partial
 *    index — one `getIndexState` read derives it here).
 */
export function toBlastRadius(result: BlastResult, state: IndexState): BlastRadiusDto {
  // symbol name → declaring changed files
  const declFiles = new Map<string, Set<string>>();
  for (const sym of result.changedSymbols) {
    let files = declFiles.get(sym.name);
    if (!files) {
      files = new Set<string>();
      declFiles.set(sym.name, files);
    }
    files.add(sym.file);
  }

  // Defensive self-caller filter (D5) + unknown-viaSymbol drop.
  const survivors = result.callers.filter((row) => {
    const decls = declFiles.get(row.viaSymbol);
    return decls !== undefined && !decls.has(row.file);
  });

  // Group survivors by viaSymbol, facade order preserved inside a group.
  const bySymbol = new Map<string, BlastResult['callers']>();
  for (const row of survivors) {
    const group = bySymbol.get(row.viaSymbol);
    if (group) group.push(row);
    else bySymbol.set(row.viaSymbol, [row]);
  }

  // One DownstreamImpact per changed symbol (zero-caller symbols included).
  // The contract keys impact by bare symbol NAME, so two changed files
  // declaring the same name collapse into ONE group (D11) — otherwise both
  // entries would duplicate the same caller list and the summary's flat
  // caller count would diverge from the per-group sum the UI stats show.
  const seenNames = new Set<string>();
  const groups = result.changedSymbols.flatMap((sym) => {
    if (seenNames.has(sym.name)) return [];
    seenNames.add(sym.name);
    const group = bySymbol.get(sym.name) ?? [];
    const endpoints: string[] = [];
    const crons: string[] = [];
    for (const row of group) {
      const facts = result.factsByFile?.[row.file];
      if (!facts) continue;
      for (const e of facts.endpoints) if (!endpoints.includes(e)) endpoints.push(e);
      for (const c of facts.crons) if (!crons.includes(c)) crons.push(c);
    }
    const maxRank = group.reduce((max, row) => Math.max(max, row.rank), -1);
    return {
      symbol: sym.name,
      callers: group.map((row) => ({ name: row.symbol, file: row.file, line: row.line })),
      endpoints_affected: endpoints,
      crons_affected: crons,
      maxRank,
    };
  });
  // Rank sort (P3): highest max-rank caller group first; stable sort keeps
  // changed-symbol order on ties.
  groups.sort((a, b) => b.maxRank - a.maxRank);

  const endpointsAll = new Set<string>();
  const cronsAll = new Set<string>();
  for (const g of groups) {
    for (const e of g.endpoints_affected) endpointsAll.add(e);
    for (const c of g.crons_affected) cronsAll.add(c);
  }
  const summary =
    `${result.changedSymbols.length} changed symbol(s), ` +
    `${survivors.length} downstream caller(s), ` +
    `${endpointsAll.size} impacted endpoint(s), ` +
    `${cronsAll.size} impacted cron job(s)`;

  const downstream = groups.map(({ maxRank: _maxRank, ...impact }) => impact);
  const changed_symbols = result.changedSymbols.map((s) => ({
    name: s.name,
    file: s.file,
    kind: s.kind,
  }));

  const degraded = result.degraded === true || state.status !== 'full';
  if (degraded) {
    const reason = result.reason
      ?? (state.status === 'partial'
        ? 'index_partial'
        : (state.degradedReason ?? (state.status === 'failed' ? 'index_failed' : 'no_data')));
    return { changed_symbols, downstream, summary, degraded: true, reason };
  }
  return { changed_symbols, downstream, summary };
}

/** Cap on prior-PR groups served by `toPrHistory` (query-side bound is 200 rows). */
const MAX_HISTORY_PRS = 5;

/**
 * Map the pulls repository's flat overlap rows into the `PrHistory` contract:
 * one item per PR (rows arrive `number desc`, insertion order preserved),
 * `files_overlap` = ordered dedup of sharedPath ∩ currentPaths, and
 * `merged_at` from `updated_at ?? opened_at ?? epoch` — `pull_requests` has no
 * `merged_at` column (documented spec decision D9).
 */
export function toPrHistory(rows: OverlappingPrRow[], currentPaths: string[]): PrHistoryDto {
  const current = new Set(currentPaths);
  const byId = new Map<string, OverlappingPrRow[]>();
  for (const row of rows) {
    const group = byId.get(row.id);
    if (group) group.push(row);
    else byId.set(row.id, [row]);
  }
  const history = [...byId.values()].slice(0, MAX_HISTORY_PRS).map((group) => {
    const pr = group[0]!;
    const overlap: string[] = [];
    for (const row of group) {
      if (current.has(row.sharedPath) && !overlap.includes(row.sharedPath)) {
        overlap.push(row.sharedPath);
      }
    }
    return {
      pr_number: pr.number,
      title: pr.title,
      merged_at: (pr.updatedAt ?? pr.openedAt ?? new Date(0)).toISOString(),
      author: pr.author,
      files_overlap: overlap,
      notes: `shares ${overlap.length} file(s) with this PR`,
    };
  });
  return { history };
}
