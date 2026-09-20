/**
 * Tiny helpers for the e2e runner. Assertions are intentionally minimal: most
 * of the "assert" work is done by agent-browser's own `wait --text` / `wait --url`
 * commands, which exit non-zero when the condition isn't met within the timeout.
 * These helpers only cover the extra substring checks and result bookkeeping.
 *
 * This file also owns the flow-spec contract: `FlowSchema` (below) validates
 * every `specs/*.flow.json` at load time in `run.ts`, so a typo'd key, command,
 * or placeholder fails fast as a named spec error instead of a confusing
 * mid-suite crash. The grammar mirrors e2e/README.md "How a flow works".
 */
import { z } from "zod";

/**
 * Commands a flow may issue — the deterministic-locator vocabulary from the
 * README (`open`, `wait`, `find`), plus `screenshot`/`close`, which `run.ts`
 * itself uses. Anything else (in particular the AI `chat` command) is a spec
 * bug: extend this list deliberately, never by accident.
 */
const KNOWN_COMMANDS = ["open", "wait", "find", "screenshot", "close"] as const;

/**
 * `wait` conditions that make it do something. README: `wait --text` /
 * `wait --url` "are" the assertions; `--load networkidle` waits for data to
 * settle. A condition-less `wait` asserts nothing — reject it.
 */
const WAIT_CONDITIONS = ["--load", "--url", "--text"] as const;

/** Locator kinds allowed after `find` (README: `find role|text|label`). */
const FIND_BY = ["role", "text", "label"] as const;

/** `{BASE}` is the only placeholder the runner substitutes — no other braces belong in a command. */
function strayBraceIssue(arg: string): string | null {
  const stripped = arg.replaceAll("{BASE}", "");
  if (!stripped.includes("{") && !stripped.includes("}")) return null;
  return `"${arg}" contains "{" / "}" outside a {BASE} placeholder — resolveArgs only substitutes {BASE}`;
}

/** agent-browser argv: at least one non-empty token, first token a known command. */
const CmdSchema = z
  .array(z.string().min(1))
  .min(1)
  .superRefine((cmd, ctx) => {
    cmd.forEach((arg, i) => {
      const issue = strayBraceIssue(arg);
      if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i], message: issue });
    });

    const name = cmd[0];
    if (name === undefined) return; // array .min(1) already reported it

    if (!(KNOWN_COMMANDS as readonly string[]).includes(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [0],
        message: `unknown command "${name}" — expected one of: ${KNOWN_COMMANDS.join(", ")}`,
      });
      return;
    }

    if (name === "open") {
      const target = cmd[1];
      if (target === undefined || !/^(?:\{BASE\}|https?:\/\/)/.test(target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [1],
          message: `open needs an absolute target ("{BASE}/…" or "http(s)://…"), got ${JSON.stringify(target ?? "(missing)")}`,
        });
      }
    }

    if (name === "wait" && !cmd.some((a) => (WAIT_CONDITIONS as readonly string[]).includes(a))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [0],
        message: `wait needs one of ${WAIT_CONDITIONS.join(" / ")} — otherwise it asserts nothing`,
      });
    }

    if (name === "find") {
      const by = cmd[1];
      if (by === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [1], message: "find needs a locator kind" });
      } else if (!(FIND_BY as readonly string[]).includes(by)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [1],
          message: `unknown locator kind "${by}" — expected one of: ${FIND_BY.join(", ")}`,
        });
      }
      if (cmd[2] === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [2], message: "find needs a selector value" });
      }
    }
  });

const StepSchema = z
  .object({
    /** agent-browser argv, e.g. ["wait", "--text", "#482"]. `{BASE}` is substituted. */
    cmd: CmdSchema,
    /** Human label for logs (defaults to the joined cmd). */
    label: z.string().min(1).optional(),
    /** Optional extra check on the command's stdout (beyond its exit code). */
    assert: z.object({ stdoutIncludes: z.string().min(1) }).strict().optional(),
  })
  .strict();

/** A whole `specs/*.flow.json` document, exactly as e2e/README.md documents it. */
export const FlowSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    steps: z.array(StepSchema).min(1),
  })
  .strict();

export type Step = z.infer<typeof StepSchema>;
export type Flow = z.infer<typeof FlowSchema>;

/** One-line rendering of a FlowSchema failure, e.g. `steps[2].cmd[0]: unknown command "wati"`. */
export function formatFlowError(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}

export interface StepResult {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface FlowResult {
  name: string;
  ok: boolean;
  steps: StepResult[];
}

/** Substitute `{BASE}` (and trim a trailing slash on BASE) in every arg. */
export function resolveArgs(cmd: string[], base: string): string[] {
  const b = base.replace(/\/+$/, "");
  return cmd.map((a) => a.replaceAll("{BASE}", b));
}

export function stdoutContains(stdout: string, needle: string): boolean {
  return stdout.includes(needle);
}

export function summarize(results: FlowResult[]): string {
  const lines: string[] = [];
  for (const f of results) {
    lines.push(`${f.ok ? "PASS" : "FAIL"}  ${f.name}`);
    for (const s of f.steps) {
      if (!s.ok) lines.push(`        ✗ ${s.label}${s.detail ? ` — ${s.detail}` : ""}`);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  lines.push("");
  lines.push(`${passed}/${results.length} flows passed`);
  return lines.join("\n");
}
