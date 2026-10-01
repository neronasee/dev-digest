/* get-findings — severity summary + top findings for a PR.
   GET /pulls/:id/reviews is PR-scoped and unbounded; everything (run_id /
   severity filters, severity-then-confidence ordering, the limit slice, the
   200-char rationale trim) happens client-side so results stay compact. */

import { z } from 'zod-v4';
import type { McpServer } from '@modelcontextprotocol/server';
import type { ApiClient } from '../api-client.js';
import type { ReviewRecord, Severity } from '@devdigest/shared';
import { resolvePullId, resolveRepoId } from '../resolve.js';
import { fail } from './fail.js';

const inputSchema = z.object({
  repo: z.string().min(1).describe('Repository full_name or bare name'),
  pr_number: z.number().int().positive().describe('PR number, e.g. 482'),
  run_id: z.string().optional().describe('Only findings from this run (from run-agent-on-pr output)'),
  severity: z
    .enum(['CRITICAL', 'WARNING', 'SUGGESTION'])
    .optional()
    .describe('Filter by severity: CRITICAL, WARNING, or SUGGESTION'),
  limit: z.number().int().min(1).max(50).default(10).describe('Max findings returned (default 10)'),
  verbose: z.boolean().default(false).describe('Full rationale/suggestion markdown instead of one-line'),
});

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

/** First line, hard-trimmed to 200 chars — never a newline. */
function oneLine(text: string): string {
  return (text.split('\n')[0] ?? '').slice(0, 200);
}

export interface FindingsSummaryOptions {
  severity?: Severity;
  limit: number;
  verbose: boolean;
}

/** Compact findings projection shared by get-findings and run-agent-on-pr:
 *  severity→confidence ordering, severity counts, the limit slice, and the
 *  200-char rationale trim (full text only when verbose). */
export function summarizeFindings(reviews: ReviewRecord[], opts: FindingsSummaryOptions) {
  const rows = reviews
    .flatMap((review) => review.findings.map((finding) => ({ review, finding })))
    .filter((row) => (opts.severity ? row.finding.severity === opts.severity : true))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.finding.severity] - SEVERITY_RANK[b.finding.severity] ||
        b.finding.confidence - a.finding.confidence,
    );

  const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const { finding } of rows) counts[finding.severity] += 1;

  const included = rows.slice(0, opts.limit);
  const findings = included.map(({ finding }) => ({
    title: finding.title,
    file: finding.file,
    line: finding.start_line,
    severity: finding.severity,
    category: finding.category,
    confidence: finding.confidence,
    rationale: opts.verbose ? finding.rationale : oneLine(finding.rationale),
    ...(opts.verbose ? { suggestion: finding.suggestion } : {}),
  }));

  const truncated =
    rows.length > included.length ||
    (!opts.verbose &&
      included.some(
        ({ finding }) => oneLine(finding.rationale) !== finding.rationale || finding.suggestion != null,
      ));

  return { summary: { total: rows.length, ...counts }, findings, truncated };
}


export function registerGetFindingsTool(server: McpServer, client: ApiClient): void {
  server.registerTool(
    'get-findings',
    {
      description:
        'Get review findings for a pull request: severity summary plus top findings; filter by run_id or severity.',
      annotations: { readOnlyHint: true },
      inputSchema,
    },
    async ({ repo, pr_number, run_id, severity, limit, verbose }) => {
      try {
        const repoId = await resolveRepoId(client, repo);
        const prId = await resolvePullId(client, repoId, pr_number);
        const allReviews = await client.listReviews(prId);
        const reviews = run_id ? allReviews.filter((r) => r.run_id === run_id) : allReviews;

        const { summary, findings, truncated } = summarizeFindings(reviews, { severity, limit, verbose });

        const structuredContent = {
          repo,
          pr_number,
          summary,
          reviews: reviews.map((r) => ({
            id: r.id,
            run_id: r.run_id,
            agent_name: r.agent_name,
            verdict: r.verdict,
            score: r.score,
            created_at: r.created_at,
          })),
          findings,
          truncated,
          hint: 'Increase limit or set verbose for full text; run_id narrows to one run.',
        };
        return {
          structuredContent,
          content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        };
      } catch (e) {
        return fail(e);
      }
    },
  );
}
