import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

// Quality cases run with no tools (skillTask measures the SKILL.md content in isolation —
// see tasks.ts), so the module under review is inlined into the prompt, standing in for the
// file the skill would normally be pointed at. Every practice asserts a behavior the zod
// SKILL.md rules prescribe (parse-*, error-*, schema-*, object-*, type-* categories), and
// every grounding substring is byte-exact from that SKILL.md (grep-verified identifiers —
// the backend paraphrases prose but echoes identifiers).

const fx = fixtureReader(import.meta.url);

export const cases: SkillCase[] = [
  {
    name: "webhook module review flags throwing parse, raw error dump, z.any(), passthrough into the store, and the missing z.input type",
    kind: "quality",
    prompt: `Review this module before we open the PR. It turns delivery-status webhooks from our transactional email provider into stored rows: the raw HTTP body arrives in handleWebhook as rawBody, and providers also stick a couple of housekeeping keys in the body (things like ciRunId or xAccountTier) that mean nothing to us. Go through the file against our Zod practices and tell me everything that should change.

\`\`\`ts
${fx("webhook-handler.ts")}
\`\`\``,
    grounding: ["safeParse", "z.input", "z.unknown"],
    practices: [
      "flags the statusWebhook.parse(rawBody) call in the request path — user input must be validated with .safeParse() so the handler branches on the result object and answers an invalid body with a 4xx validation response instead of this thrown-path 500",
      "flags String(err) going back to the caller as the error detail — the failure body must be built from the structured issue data (result.error.issues / flatten()), never a raw dump of the caught error",
      "flags metadata: z.any() — the schema should use z.unknown() so the field is forced through narrowing instead of silently typing as any",
      "flags .passthrough() combined with spreading ...parsed into store.append — unknown keys the provider adds (the housekeeping keys) reach the stored row, so the object needs a deliberate unknown-key policy: .strict() to reject them or an explicit documented .strip()",
      "flags the missing pre-transform input type — receivedAt uses .transform() so the wire shape differs from the parsed shape, yet only the z.infer output type is exported and dedupeKey (which receives the raw body, hence the cast) is typed with it; the module must also derive the input type via z.input<typeof statusWebhook>, or parse before computing the key",
      "does not flag the ISO-string-to-Date transform on receivedAt itself as a problem — transforming at the schema is fine; the gap is only the missing input-side typing",
    ],
    threshold: 0.75,
    maxTurns: 4,
  },
  {
    name: "guidance for a readable validation path: parse at the boundary, per-field issue mapping, custom messages, all issues at once",
    kind: "quality",
    prompt:
      "QA keeps posting junk payloads at our webhook endpoint and getting back either a 500 or a wall of Zod internals nobody can read. I'm rewriting the validation path for that endpoint and want to do it properly this time. Where should validation happen, how do I turn failures into a response a human can act on per field, and how should the messages themselves be written? Walk me through the approach before I write any code.",
    grounding: ["safeParse", "issues"],
    practices: [
      "validates once at the system boundary — the handler parses the raw body with safeParse immediately on entry and passes the typed result.data downstream, instead of threading unknown data into business logic and validating later",
      "builds the failure response from the structured issue data — result.error.issues / flatten() (fieldErrors keyed per field) / format() — giving the client a per-field error map, and rules out a raw ZodError dump or substring-matching on error.message",
      "attaches custom messages where each validation is declared (e.g. .email('Please enter a valid email address') or .min(8, 'Password must be at least 8 characters')) so failures read as specific, actionable text rather than defaults like 'Expected string, received number'",
      "surfaces all validation issues in one response, not just the first failure, and locates nested or array errors via issue.path so the error map names the exact field (e.g. items.0.quantity)",
    ],
    threshold: 0.75,
    maxTurns: 4,
  },
  {
    name: "two payload variants keyed by a literal get a discriminated union, not an all-optional flat object",
    kind: "quality",
    prompt:
      "Our provider's webhook body comes in two variants, keyed by a `kind` field: `delivered` events carry an attempts count, `bounced` events carry a reason and a retryAt timestamp. My draft uses one flat z.object where every variant-specific field is optional so both shapes fit. Is that the right way to model this in Zod, or is there a better shape?",
    grounding: ["discriminated", "optional"],
    practices: [
      "prescribes a discriminated union over the shared `kind` literal (z.discriminatedUnion('kind', [...])) as the shape for the two variants",
      "does not recommend keeping the one-flat-object-with-optional-fields draft — says variant fields lose their guarantees (e.g. a `delivered` event parses without its attempts count) when every field is optional",
      "spells out the payoff of the discriminator: TypeScript narrows on `kind`, and/or Zod dispatches straight to the matching variant instead of trying each option in order — which neither the all-optional object nor a plain z.union provides",
    ],
    threshold: 0.7,
    maxTurns: 4,
  },
];
