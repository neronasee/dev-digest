import { z } from 'zod';

/**
 * Delivery-status webhooks from our transactional email provider.
 * The raw HTTP body reaches `handleWebhook` as `rawBody`.
 */

const statusWebhook = z
  .object({
    eventId: z.string().uuid(),
    provider: z.enum(['postmark', 'ses', 'resend']),
    recipient: z.string().email(),
    receivedAt: z.string().datetime().transform((iso) => new Date(iso)),
    bounceReason: z.string().min(1).optional(),
    retryAt: z.string().datetime().optional(),
    metadata: z.any(),
  })
  .passthrough();

export type StatusWebhook = z.infer<typeof statusWebhook>;

/**
 * Dedupe key computed from the raw provider body, before validation runs.
 * Called with the request body exactly as it arrived on the wire.
 */
export function dedupeKey(body: StatusWebhook): string {
  return `${body.eventId}:${body.receivedAt.getTime()}`;
}

export interface WebhookStore {
  append(row: Record<string, unknown>): Promise<void>;
}

export async function handleWebhook(
  rawBody: unknown,
  store: WebhookStore,
): Promise<{ status: number; body: unknown }> {
  let parsed: StatusWebhook;
  try {
    parsed = statusWebhook.parse(rawBody);
  } catch (err) {
    return { status: 500, body: { ok: false, detail: String(err) } };
  }

  await store.append({ dedupeKey: dedupeKey(rawBody as StatusWebhook), ...parsed });

  return { status: 202, body: { ok: true } };
}
