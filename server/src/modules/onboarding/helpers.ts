import type { OnboardingTour } from '@devdigest/shared';
import {
  MAX_GROUNDABLE_COMMANDS,
  MAX_SAMPLE_DIRS,
  MIN_FILES_PER_DIR,
  MAX_SCRIPTS_PER_DIR,
  PLUMBING_PATH_PATTERNS,
} from './constants.js';
import type { TourDraft } from './prompt.js';

/**
 * Pure helpers for the Onboarding Tour. Everything here is deterministic and
 * unit-tested: parsing the run artifacts the grounding gate checks commands
 * against, the gates themselves (invented paths, unverifiable commands,
 * unknown PR/file anchors), and the draft→document assembly. No IO, no
 * model, no DB.
 */

// ---- artifact parsing -----------------------------------------------------

/**
 * Script names from a package manifest. Never trusts `JSON.parse` output:
 * malformed JSON or a non-object `scripts` yields `[]`, never a throw and
 * never a fake script.
 */
export function parsePackageScripts(pkgJsonText: string): string[] {
  try {
    const parsed: unknown = JSON.parse(pkgJsonText);
    if (parsed === null || typeof parsed !== 'object') return [];
    const scripts = (parsed as { scripts?: unknown }).scripts;
    if (scripts === null || typeof scripts !== 'object' || Array.isArray(scripts)) return [];
    return Object.keys(scripts);
  } catch {
    return [];
  }
}

/**
 * Target names from a Makefile: lines that open a target RULE (`name:`).
 * Two shapes that look like one are excluded — dot-prefixed special targets
 * (`.PHONY`, `.DEFAULT_GOAL`, …) and assignments whose colon belongs to a
 * `:=` / `::=` / `:::=` operator (`NODE_ENV:=development`) — neither is a
 * runnable target, and offering `make .PHONY` would be a grounding-honesty
 * leak. Mid-name dots (`docker-compose.up:`) stay: those are real targets.
 */
export function parseMakeTargets(makefile: string): string[] {
  const out: string[] = [];
  for (const line of makefile.split('\n')) {
    const m = line.match(/^([A-Za-z0-9._-]+):(.*)$/);
    if (!m) continue;
    const name = m[1]!;
    const rest = m[2]!;
    if (name.startsWith('.')) continue;
    if (rest.replace(/^:+/, '').startsWith('=')) continue;
    out.push(name);
  }
  return out;
}

// ---- sample balancing & candidate curation ---------------------------------

/**
 * Per-component rank bias. The GLOBAL top-N of a multi-package repo is
 * client-crowded (observed live: server source files were not even citable),
 * so the service draws a large rank pool and rebalances it here:
 *
 *  - partition by TOP-LEVEL directory (first path segment; root files are
 *    their own `''` component), rank order preserved inside each;
 *  - keep at most `MAX_SAMPLE_DIRS` components, the most-present ones (ties
 *    broken by first appearance in the pool — deterministic);
 *  - each kept component gets `max(MIN_FILES_PER_DIR, ceil(total / dirs))`
 *    files;
 *  - leftover slots go to the largest component, filling in rank order.
 *
 * Output order is component-grouped (most present first), each group in rank
 * order — deterministic for a given pool, and ≈ `total` files overall.
 */
export function balanceSampleByDir(pool: readonly string[], total: number): string[] {
  const byDir = new Map<string, string[]>();
  const firstSeen = new Map<string, number>();
  pool.forEach((path, i) => {
    const slash = path.indexOf('/');
    const dir = slash === -1 ? '' : path.slice(0, slash);
    const list = byDir.get(dir);
    if (list) list.push(path);
    else {
      byDir.set(dir, [path]);
      firstSeen.set(dir, i);
    }
  });
  if (byDir.size === 0) return [];

  const dirs = [...byDir.entries()]
    .sort(
      (a, b) =>
        b[1].length - a[1].length || firstSeen.get(a[0])! - firstSeen.get(b[0])!,
    )
    .slice(0, MAX_SAMPLE_DIRS);

  const quota = Math.max(MIN_FILES_PER_DIR, Math.ceil(total / dirs.length));
  const taken: string[] = [];
  for (const [, files] of dirs) taken.push(...files.slice(0, quota));

  const leftover = total - taken.length;
  if (leftover > 0) {
    // The largest-presence component absorbs what the small ones could not.
    const [, files] = dirs[0]!;
    taken.push(...files.slice(quota, quota + leftover));
  }
  return taken;
}

/**
 * True when a repo-relative path is cross-cutting plumbing (see
 * `PLUMBING_PATH_PATTERNS`) — filtered out of the critical-path CANDIDATES
 * block only. Plumbing stays citable (the universe is built before this
 * filter applies); it is simply never suggested.
 */
export function isPlumbingPath(path: string): boolean {
  return PLUMBING_PATH_PATTERNS.some((re) => re.test(path));
}

// ---- grounding gates ------------------------------------------------------

/** Anything with a repo-relative `path` that must exist in the sample. */
export interface Pathed {
  path: string;
}

export interface GateResult<T> {
  kept: T[];
  dropped: number;
}

/**
 * Keep only entries whose `path` is EXACTLY a member of the universe — the
 * set of paths code actually fed to the model. Exact membership, no suffix
 * fuzz: the prompt renders the citable list verbatim, so a near-miss is a
 * hallucination, not a spelling difference.
 */
export function verifyPaths<T extends Pathed>(
  entries: readonly T[],
  universe: ReadonlySet<string>,
): GateResult<T> {
  const kept = entries.filter((e) => universe.has(e.path));
  return { kept, dropped: entries.length - kept.length };
}

/** Package managers whose `install` a manifest grounds. */
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

/** Run-step grounding facts for ONE directory: what the artifacts read from
 *  that directory actually offer. `dir` is `''` for the repository root and
 *  the directory path (e.g. `server`) for a nested package. */
export interface DirFacts {
  dir: string;
  /** Script names from this dir's package manifest ([] when none was read). */
  pkgScripts: readonly string[];
  /** Target names from this dir's Makefile ([] when none was read). */
  makeTargets: readonly string[];
  /** A compose file was read from this dir. */
  hasCompose: boolean;
  /** A package manifest was read from this dir. */
  hasManifest: boolean;
}

/**
 * What the run-step gate needs: per-directory facts. `dirs` must contain the
 * repository root (`dir: ''` — a command with no `cd` prefix validates
 * against it) plus one entry per probed directory whose package manifest was
 * discovered and read (the `cd <dir> && …` form validates against its own
 * entry). See `buildRunFacts`.
 */
export interface RunStepFacts {
  dirs: readonly DirFacts[];
}

/**
 * Fold the artifacts actually read into per-directory run facts: the root
 * entry (always present, flags false when the root tier found nothing) plus
 * one entry per probed directory that yielded a package manifest — only a
 * manifest dir is cd-anchorable, so a dir with just a compose file or
 * Makefile contributes nothing here (its files still feed the prompt).
 */
export function buildRunFacts(
  artifactTexts: ReadonlyMap<string, string>,
  probedDirs: readonly string[],
): RunStepFacts {
  const rootManifest = artifactTexts.get('package.json');
  const dirs: DirFacts[] = [
    {
      dir: '',
      pkgScripts: rootManifest !== undefined ? parsePackageScripts(rootManifest) : [],
      makeTargets:
        artifactTexts.has('Makefile') ? parseMakeTargets(artifactTexts.get('Makefile')!) : [],
      hasCompose:
        artifactTexts.has('docker-compose.yml') ||
        artifactTexts.has('docker-compose.override.yml'),
      hasManifest: rootManifest !== undefined,
    },
  ];
  for (const dir of probedDirs) {
    const manifest = artifactTexts.get(`${dir}/package.json`);
    if (manifest === undefined) continue;
    dirs.push({
      dir,
      pkgScripts: parsePackageScripts(manifest),
      makeTargets:
        artifactTexts.has(`${dir}/Makefile`)
          ? parseMakeTargets(artifactTexts.get(`${dir}/Makefile`)!)
          : [],
      hasCompose: artifactTexts.has(`${dir}/docker-compose.yml`),
      hasManifest: true,
    });
  }
  return { dirs };
}

/**
 * Keep only run steps whose command is runnable verbatim from the artifacts
 * we fed the model. A command passes iff:
 *   - it is a SINGLE command — no shell metacharacter (`&` (subsumes `&&`),
 *     `|` (subsumes `||`), `;`, backtick, `$(`, `>`, `<`, newline): the
 *     head-token rules below verify ONE invocation, so a chained, backgrounded
 *     or substituted tail would ship unverified into copy-paste text;
 *   - OR it is exactly the one multi-token form `cd <dir> && <single
 *     command>` — `cd` at position 0, exactly one `&&`, `<dir>` EXACTLY a
 *     directory whose package manifest is in the sample (discovered dirs are
 *     relative and `..`-free by construction, so membership is the gate),
 *     and the remainder a metachar-free single command validated against
 *     THAT dir's facts;
 *   - `<pm> install` (npm/pnpm/yarn/bun) and a package manifest was read (in
 *     the command's directory);
 *   - `<pm> run <script>` or the `<pm> <script>` shorthand, script in that
 *     dir's manifest scripts;
 *   - `make <target>` with the target in that dir's Makefile;
 *   - `docker compose up …` / `docker-compose up …` and that dir has compose;
 *   - anything else is dropped — the tour never shows a command we cannot
 *     trace back to the repo's own artifacts.
 */
export function verifyRunSteps<T extends { command: string }>(
  steps: readonly T[],
  facts: RunStepFacts,
): GateResult<T> {
  const kept = steps.filter((s) => runStepGrounded(s.command, facts));
  return { kept, dropped: steps.length - kept.length };
}

/**
 * Shell metacharacters that turn one command into several, or into a
 * substitution/redirect — single characters suffice: `&` subsumes `&&`,
 * `|` subsumes `||`. A run-step command must be a single verbatim
 * invocation of the repo's own artifact, so any of these rejects it before
 * the head-token rules run — they verify one command, never a tail they
 * cannot see. (The ONE sanctioned `cd <dir> && …` form is parsed before
 * this check is applied to its remainder.)
 */
const SHELL_METACHARS = ['&', ';', '|', '`', '$(', '>', '<', '\n'] as const;

function hasShellMetachar(command: string): boolean {
  return SHELL_METACHARS.some((m) => command.includes(m));
}

/** The separator of the one sanctioned multi-token form. */
const CD_SEP = ' && ';

function runStepGrounded(command: string, facts: RunStepFacts): boolean {
  if (hasShellMetachar(command)) {
    // `cd <dir> && <single command>`: cd at position 0, one `&&`, nothing
    // after the command. Anything else containing a metacharacter is out.
    if (!command.startsWith('cd ')) return false;
    const idx = command.indexOf(CD_SEP);
    if (idx === -1) return false;
    const dir = command.slice('cd '.length, idx);
    // `cd  && …` (double space) leaves dir empty/blank — it must NOT fall
    // through to the root DirFacts entry (dir: '') and pass as root-grounded.
    if (dir.trim() === '') return false;
    const rest = command.slice(idx + CD_SEP.length);
    if (hasShellMetachar(rest)) return false; // covers a second chain link
    const dirFacts = facts.dirs.find((d) => d.dir === dir);
    return dirFacts !== undefined && singleCommandGrounded(rest, dirFacts);
  }
  const root = facts.dirs.find((d) => d.dir === '');
  return root !== undefined && singleCommandGrounded(command, root);
}

/** A metachar-free single command against one directory's facts: the
 *  head-token provenance rules (pm install / pm run|shorthand script /
 *  make target / compose up). */
function singleCommandGrounded(command: string, facts: DirFacts): boolean {
  const scripts = new Set(facts.pkgScripts);
  const targets = new Set(facts.makeTargets);
  const parts = command.trim().split(/\s+/);
  const [head, second, third] = parts;
  if (!head) return false;

  if (PACKAGE_MANAGERS.has(head)) {
    if (second === 'install') return facts.hasManifest;
    if (second === 'run') return third !== undefined && scripts.has(third);
    return second !== undefined && scripts.has(second);
  }
  if (head === 'make') {
    return second !== undefined && targets.has(second);
  }
  if (head === 'docker') {
    return second === 'compose' && third === 'up' && facts.hasCompose;
  }
  if (head === 'docker-compose') {
    return second === 'up' && facts.hasCompose;
  }
  return false;
}

/**
 * The exact command vocabulary the run-step gate accepts, derived from the
 * SAME facts the gate checks — prompt and gate in lockstep by construction:
 * what the model is handed as RUN COMMANDS is precisely what
 * `verifyRunSteps` keeps against those facts. Root entries first, then each
 * discovered dir's cd-prefixed entries; deterministic in facts order
 * (manifest key order, Makefile order). Capped: total commands and
 * `npm run <script>` entries per directory (a big manifest would otherwise
 * flood the list before compose/install get a slot).
 */
export function enumerateGroundableCommands(
  facts: RunStepFacts,
  cap: number = MAX_GROUNDABLE_COMMANDS,
): string[] {
  const out: string[] = [];
  const push = (command: string) => {
    if (out.length < cap) out.push(command);
  };
  for (const d of facts.dirs) {
    const prefix = d.dir === '' ? '' : `cd ${d.dir} && `;
    if (d.hasManifest) push(`${prefix}npm install`);
    for (const script of d.pkgScripts.slice(0, MAX_SCRIPTS_PER_DIR)) {
      push(`${prefix}npm run ${script}`);
    }
    for (const target of d.makeTargets) push(`${prefix}make ${target}`);
    if (d.hasCompose) push(`${prefix}docker compose up -d`);
  }
  return out;
}

/**
 * Keep only first tasks whose artifact really exists: a `pr` task must cite a
 * PR number from the open-PR list we fed the model; a `file` task must cite a
 * path from the universe. Both sets are strings so one gate serves both kinds.
 */
export function verifyFirstTasks<T extends { artifact_kind: string; artifact_ref: string }>(
  tasks: readonly T[],
  prNumbers: ReadonlySet<string>,
  universe: ReadonlySet<string>,
): GateResult<T> {
  const kept = tasks.filter((t) =>
    t.artifact_kind === 'pr' ? prNumbers.has(t.artifact_ref) : universe.has(t.artifact_ref),
  );
  return { kept, dropped: tasks.length - kept.length };
}

// ---- document assembly ----------------------------------------------------

/** Run provenance attached in code — never a model self-report. */
export type TourGeneration = OnboardingTour['generation'];

/**
 * Models sometimes wrap the mermaid source in a markdown code fence
 * (```mermaid … ```); mermaid cannot parse the fence, so an otherwise-good
 * diagram would silently degrade to the prose fallback client-side. Strip
 * ONE enclosing fence and nothing else — inner content is untouched.
 */
export function normalizeDiagramSource(diagram: string): string {
  const trimmed = diagram.trim();
  const fenced = /^```[a-zA-Z]*[ \t]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  const inner = fenced?.[1];
  return inner === undefined ? trimmed : inner.trim();
}

/**
 * Attach the generation block to a grounded draft. Order-preserving: the
 * five sections pass through untouched (already filtered by the gates) and
 * `generation` is appended, matching the contract's field order. The one
 * normalization: the architecture diagram loses an enclosing code fence.
 */
export function toTourDocument(draft: TourDraft, generation: TourGeneration): OnboardingTour {
  return {
    architecture: {
      overview: draft.architecture.overview,
      diagram:
        draft.architecture.diagram === null
          ? null
          : normalizeDiagramSource(draft.architecture.diagram),
    },
    critical_paths: draft.critical_paths,
    run_locally: draft.run_locally,
    reading_path: draft.reading_path,
    first_tasks: draft.first_tasks,
    generation,
  };
}
