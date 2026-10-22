import type { Db } from './client.js';
import * as t from './schema.js';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Eval gold set for the seeded Security Reviewer (AC-34).
 *
 * (a) Decides the two PR-#482 seed findings — `accepted_at` on the Stripe-key
 *     finding, `dismissed_at` on the N+1 finding — via UPDATE … WHERE null so
 *     re-seeding never overwrites a decision (fires once).
 * (b) Inserts ≥8 eval cases owned by Security Reviewer, each a FULL unified
 *     diff (headers + hunks) from the patch constants below — standalone full
 *     diffs, NOT `pr_files` patches (PR #482's files stay patch-less; INSIGHT
 *     2026-09-21). Coverage: ≥1 `must_find` derived from the accepted finding
 *     (src/config.ts around line 12), ≥1 `must_not_flag` derived from the
 *     dismissed finding (src/api/users.ts 45–52), ≥1 clean zero-expectation
 *     case, remainder themed security cases. `input_meta` = { title, body }.
 *
 * Idempotent: select-by-(owner, name) before insert with stable case names
 * (duplicate names per owner are feature-forbidden, which protects the
 * select-then-insert).
 */

// ---- Patch constants (full unified diffs) ----------------------------------
// Hunk headers count their lines exactly (the grounding gate only accepts
// citations on new-side line numbers inside a hunk).

/** Case 1 — accepted finding: hardcoded Stripe secret key (src/config.ts ~12). */
const CONFIG_STRIPE_DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -1,8 +1,12 @@
 import { loadConfig } from './loader.js';

 export const config = loadConfig(process.env);

 export const featureFlags = {
   payments: true,
   refunds: false,
 };
+// Payment gateway credentials
+export const stripeSecretKey = 'sk_live_9f8e7d6c5b4a3210';
+export const stripePublicKey = 'pk_live_1a2b3c4d5e6f7890';
+export const stripeWebhookSecret = 'whsec_5f4e3d2c1b0a';`;

/** Case 2 — dismissed finding: N+1 in users list (src/api/users.ts 45–52). */
const USERS_LIST_DIFF = `diff --git a/src/api/users.ts b/src/api/users.ts
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -42,11 +42,13 @@
 export async function listUsers(req, reply) {
   const { page = 1, pageSize = 20 } = req.query;
   const users = await db.users.list({ page, pageSize });
-  return users.map((u) => ({ id: u.id, name: u.name }));
-}
-
-export async function getUser(req, reply) {
-  const user = await db.users.findById(req.params.id);
-  if (!user) return reply.status(404).send({ error: 'not_found' });
-  return { id: user.id, name: user.name };
-}
+  return users.map((u) => ({
+    id: u.id,
+    name: u.name,
+    emailPreview: maskEmail(u.email),
+  }));
+}
+
+export function maskEmail(email: string): string {
+  const [user, domain] = email.split('@');
+  return \`\${user[0]}***@\${domain}\`;
+}`;

/** Case 3 — clean: a pure formatting refactor with nothing to flag. */
const SLUGIFY_REFACTOR_DIFF = `diff --git a/src/utils/strings.ts b/src/utils/strings.ts
--- a/src/utils/strings.ts
+++ b/src/utils/strings.ts
@@ -1,5 +1,7 @@
 export function slugify(input: string): string {
-  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-');
+  return input
+    .toLowerCase()
+    .replace(/[^a-z0-9]+/g, '-');
 }

 export function truncate(input: string, max: number): string {`;

/** Case 4 — session token logged in plaintext (diagnostics left in). */
const SESSION_LOG_DIFF = `diff --git a/src/auth/session.ts b/src/auth/session.ts
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -10,5 +10,7 @@
 export function createSession(user: User): Session {
   const token = signJwt({ sub: user.id }, AUTH_TTL);
   const session: Session = { userId: user.id, token };
+  // Temporary diagnostics
+  console.log('issued session', { token, userId: user.id });
   return session;
 }`;

/** Case 5 — SQL built by string concatenation (injection). */
const SEARCH_CONCAT_DIFF = `diff --git a/src/api/search.ts b/src/api/search.ts
--- a/src/api/search.ts
+++ b/src/api/search.ts
@@ -1,6 +1,6 @@
 import { db } from '../db.js';

 export async function searchOrders(term: string) {
-  const rows = await db.query('SELECT * FROM orders WHERE email = $1', [term]);
+  const rows = await db.query("SELECT * FROM orders WHERE email = '" + term + "'");
   return rows;
 }`;

/** Case 6 — SSRF: webhook delivered to an unvalidated caller-supplied URL. */
const WEBHOOK_SSRF_DIFF = `diff --git a/src/integrations/webhook.ts b/src/integrations/webhook.ts
--- a/src/integrations/webhook.ts
+++ b/src/integrations/webhook.ts
@@ -3,5 +3,8 @@
 import axios from 'axios';

 export async function deliverWebhook(url: string, payload: unknown): Promise<void> {
+  const target = url || 'https://hooks.internal.example.com/collector';
+  const response = await axios.post(target, payload, { timeout: 5000 });
+  if (response.status >= 400) throw new Error('webhook delivery failed');
   await enqueueDelivery(url, payload);
 }`;

/** Case 7 — clean: a routine dependency bump. */
const DEPENDENCY_BUMP_DIFF = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -8,6 +8,6 @@
   "dependencies": {
     "fastify": "5.2.0",
-    "drizzle-orm": "0.38.4",
+    "drizzle-orm": "0.39.0",
     "postgres": "3.4.5"
   }
 }`;

/** Case 8 — MD5 password hashing (fast/unsalted-by-design hash). */
const PASSWORD_MD5_DIFF = `diff --git a/src/auth/passwords.ts b/src/auth/passwords.ts
--- a/src/auth/passwords.ts
+++ b/src/auth/passwords.ts
@@ -1,5 +1,6 @@
 import { createHash, randomBytes } from 'node:crypto';

 export function hashPassword(password: string): string {
-  return createHash('sha256').update(password).digest('hex');
+  const salt = randomBytes(16).toString('hex');
+  return createHash('md5').update(salt + password).digest('hex');
 }`;

/** Case 9 — debug endpoint exposing environment secrets, no auth gate. */
const DEBUG_ENDPOINT_DIFF = `diff --git a/src/api/admin.ts b/src/api/admin.ts
--- a/src/api/admin.ts
+++ b/src/api/admin.ts
@@ -1,5 +1,9 @@
 import { app } from '../app.js';

+app.get('/debug/env', async () => {
+  return { nodeEnv: process.env.NODE_ENV, dbUrl: process.env.DATABASE_URL };
+});
+
 export function registerAdminRoutes() {
   app.get('/admin/stats', async () => stats());
 }`;

interface GoldCase {
  name: string;
  title: string;
  body: string;
  diff: string;
  expectedOutput: Record<string, unknown>;
  notes?: string;
}

/**
 * The gold set. Expectation line ranges are the NEW-side line numbers of the
 * diffs above (grounding only accepts citations inside hunk ranges).
 */
export const EVAL_GOLD_CASES: GoldCase[] = [
  {
    name: 'hardcoded-stripe-key',
    title: 'Add payment gateway credentials to config',
    body: 'Wires the payment gateway by adding its credentials next to the other config flags.',
    diff: CONFIG_STRIPE_DIFF,
    expectedOutput: {
      must_find: [
        {
          file: 'src/config.ts',
          start_line: 10,
          end_line: 12,
          severity: 'CRITICAL',
          category: 'security',
          title: 'Hardcoded Stripe secret key in commit',
        },
      ],
    },
    notes: 'Gold case derived from the ACCEPTED PR #482 finding (src/config.ts:12).',
  },
  {
    name: 'users-list-n1-untouched',
    title: 'Add email preview to the users list response',
    body: 'Extends the user list payload with a masked email preview.',
    diff: USERS_LIST_DIFF,
    expectedOutput: {
      must_not_flag: [
        {
          file: 'src/api/users.ts',
          start_line: 45,
          end_line: 52,
          severity: 'WARNING',
          category: 'perf',
          title: 'N+1 query in user list endpoint',
        },
      ],
    },
    notes:
      'Gold case derived from the DISMISSED PR #482 finding (src/api/users.ts 45–52): the agent must NOT re-flag the dismissed pattern.',
  },
  {
    name: 'slugify-refactor-clean',
    title: 'Reformat slugify for readability',
    body: 'Pure formatting refactor of the slugify helper — no behavior change.',
    diff: SLUGIFY_REFACTOR_DIFF,
    expectedOutput: {},
    notes: 'Clean case: zero expectations — passes only with zero findings.',
  },
  {
    name: 'session-token-logged',
    title: 'Add session issuance diagnostics',
    body: 'Logs freshly issued sessions while debugging auth.',
    diff: SESSION_LOG_DIFF,
    expectedOutput: {
      must_find: [{ file: 'src/auth/session.ts', start_line: 13, end_line: 14, category: 'security' }],
    },
  },
  {
    name: 'sql-concat-injection',
    title: 'Simplify order search query',
    body: 'Builds the order-search query inline.',
    diff: SEARCH_CONCAT_DIFF,
    expectedOutput: {
      must_find: [{ file: 'src/api/search.ts', start_line: 4, end_line: 4, category: 'security' }],
    },
  },
  {
    name: 'webhook-ssrf-unvalidated-url',
    title: 'Deliver webhooks synchronously',
    body: 'Posts webhook payloads directly instead of enqueueing them.',
    diff: WEBHOOK_SSRF_DIFF,
    expectedOutput: {
      must_find: [{ file: 'src/integrations/webhook.ts', start_line: 6, end_line: 7, category: 'security' }],
    },
  },
  {
    name: 'dependency-bump-clean',
    title: 'Bump drizzle-orm to 0.39.0',
    body: 'Routine dependency bump.',
    diff: DEPENDENCY_BUMP_DIFF,
    expectedOutput: {},
    notes: 'Clean case: zero expectations.',
  },
  {
    name: 'md5-password-hash',
    title: 'Salt password hashes',
    body: 'Adds a per-user salt to password hashing.',
    diff: PASSWORD_MD5_DIFF,
    expectedOutput: {
      must_find: [{ file: 'src/auth/passwords.ts', start_line: 4, end_line: 5, category: 'security' }],
    },
  },
  {
    name: 'debug-env-endpoint-exposed',
    title: 'Add debug environment endpoint',
    body: 'Exposes runtime environment info for local diagnostics.',
    diff: DEBUG_ENDPOINT_DIFF,
    expectedOutput: {
      must_find: [{ file: 'src/api/admin.ts', start_line: 3, end_line: 5, category: 'security' }],
    },
  },
];

/**
 * Seed the eval gold set (idempotent). No-ops cleanly when the Security
 * Reviewer agent is absent from the workspace.
 */
export async function seedEvalGoldSet(db: Db, workspaceId: string, prId: string): Promise<void> {
  // Only the original seeded review may supply these gold decisions. A later
  // review can report the same file, line, and title in this or another workspace.
  const [seedReview] = await db
    .select({ id: t.reviews.id })
    .from(t.reviews)
    .where(and(
      eq(t.reviews.workspaceId, workspaceId),
      eq(t.reviews.prId, prId),
      eq(t.reviews.model, 'seed'),
      eq(t.reviews.kind, 'review'),
    ));
  if (seedReview) {
    await db
      .update(t.findings)
      .set({ acceptedAt: new Date() })
      .where(
        and(
          eq(t.findings.reviewId, seedReview.id),
          eq(t.findings.file, 'src/config.ts'),
          eq(t.findings.startLine, 12),
          eq(t.findings.title, 'Hardcoded Stripe secret key in commit'),
          isNull(t.findings.acceptedAt),
          isNull(t.findings.dismissedAt),
        ),
      );
    await db
      .update(t.findings)
      .set({ dismissedAt: new Date() })
      .where(
        and(
          eq(t.findings.reviewId, seedReview.id),
          eq(t.findings.file, 'src/api/users.ts'),
          eq(t.findings.startLine, 45),
          eq(t.findings.title, 'N+1 query in user list endpoint'),
          isNull(t.findings.dismissedAt),
          isNull(t.findings.acceptedAt),
        ),
      );
  }

  // (b) The gold set — owned by Security Reviewer.
  const [securityAgent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
  if (!securityAgent) return;

  for (const gold of EVAL_GOLD_CASES) {
    const [existing] = await db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, securityAgent.id),
          eq(t.evalCases.name, gold.name),
        ),
      );
    if (existing) continue;
    await db.insert(t.evalCases).values({
      workspaceId,
      ownerKind: 'agent',
      ownerId: securityAgent.id,
      name: gold.name,
      inputDiff: gold.diff,
      inputMeta: { title: gold.title, body: gold.body },
      expectedOutput: gold.expectedOutput,
      notes: gold.notes ?? null,
    });
  }
}
