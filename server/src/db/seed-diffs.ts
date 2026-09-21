/**
 * Patch bodies for the experiment PRs (Skills Lab control experiments).
 *
 * `pr_files.patch` stores ONLY the hunk portion of a unified diff (`@@ ... @@`
 * plus +/-/context lines) — `diffFromPrFiles` re-adds the `diff --git` /
 * `---` / `+++` headers around it. Hunk headers must count their lines
 * correctly: the reviewer's grounding gate only accepts finding citations on
 * new-side line numbers inside a hunk.
 */

/**
 * Experiment (a) — PR #483. New `refundPayment` with four branches, plus a test
 * file that covers ONLY the happy path. Without the test-quality skills bound,
 * the reviewer is expected to pass this; with them, it flags the uncovered
 * `insufficient_balance` branch, the missing zero/invalid-amount corner cases,
 * and the over-mocked `db` boundary.
 */
export const REFUND_SOURCE_PATCH = `@@ -0,0 +1,25 @@
+import { db } from '../db.js';
+
+export interface RefundResult {
+  ok: boolean;
+  reason?: 'user_not_found' | 'insufficient_balance';
+}
+
+export async function refundPayment(userId: string, amount: number): Promise<RefundResult> {
+  if (amount <= 0) {
+    throw new Error('Refund amount must be positive');
+  }
+
+  const user = await db.users.findById(userId);
+  if (!user) {
+    return { ok: false, reason: 'user_not_found' };
+  }
+
+  if (amount > user.balance) {
+    return { ok: false, reason: 'insufficient_balance' };
+  }
+
+  await db.refunds.insert({ userId, amount });
+  await db.users.updateBalance(userId, { decrement: amount });
+  return { ok: true };
+}`;

export const REFUND_TEST_PATCH = `@@ -0,0 +1,14 @@
+import { describe, it, expect, vi } from 'vitest';
+import { db } from '../db.js';
+import { refundPayment } from './refund.js';
+
+describe('refundPayment', () => {
+  it('refunds a payment', async () => {
+    vi.spyOn(db.users, 'findById').mockResolvedValue({ id: 'u1', balance: 100 });
+    vi.spyOn(db.refunds, 'insert').mockResolvedValue(undefined);
+
+    const result = await refundPayment('u1', 50);
+
+    expect(result).toEqual({ ok: true });
+  });
+});`;

/**
 * Experiment (b) — PR #484. Public route contract change: query param
 * `include_profile` → `expand`, default page size 20 → 50, response field
 * `name` → `full_name`. Without the API-contract skills bound, the reviewer is
 * expected to pass this; with them, it flags the breaking renames and the
 * missing deprecation window.
 */
export const ROUTE_SIGNATURE_PATCH = `@@ -12,18 +12,17 @@
 export async function listUsers(req, reply) {
   // GET /users — paginated user list
-  const { page = 1, pageSize = 20, include_profile } = req.query;
+  const { page = 1, pageSize = 50, expand } = req.query;
   const users = await db.users.list({ page, pageSize });

-  return users.map((u) => ({
+  return users.map((u) => ({
     id: u.id,
-    name: u.name,
-    ...(include_profile ? { profile: u.profile } : {}),
+    full_name: u.name,
+    ...(expand ? { profile: u.profile } : {}),
   }));
 }

 export async function getUser(req, reply) {
   const user = await db.users.findById(req.params.id);
   if (!user) return reply.status(404).send({ error: 'not_found' });
-  return { id: user.id, name: user.name };
+  return { id: user.id, full_name: user.name };
 }`;
