/**
 * dependency-cruiser gate for the onion-architecture skill.
 *
 * A "test runner for your import graph": each rule below declares a forbidden
 * from → to edge pattern. Regexes are RE2 — no look-ahead; use `pathNot` for
 * exclusions and `$1` to back-reference the capture group from `from.path`
 * inside `to.path`.
 *
 * Ratchet: `error` rules are blocking (already clean); `warn` rules are a
 * tracked burn-down baseline — shrink them, then promote to `error`. Full
 * rationale and the exception ledger live in
 * `.claude/skills/onion-architecture/enforcement.md`.
 *
 * CommonJS on purpose: server/package.json has "type": "module", so a plain
 * `.js` config would parse as ESM and fail.
 */
module.exports = {
  forbidden: [
    // Most cycles flow through the DI composition root (container ↔ service),
    // plus one genuine agents/helpers ↔ agents/repository cycle. Warn-level
    // until the container-cycle policy is decided; fix the agents cycle first.
    {
      name: 'no-circular',
      comment: 'circular dependency — prefer acyclic imports; container cycles need a policy',
      severity: 'warn',
      from: {},
      to: { circular: true },
    },

    // reviewer-core is the domain core: pure pipeline functions whose only
    // contact with the outside world is the injected LLMProvider. No HTTP,
    // no DB, no SDKs, no filesystem, no child processes.
    //
    // Pattern note: dependency-cruiser renders resolved npm deps as
    // `…/node_modules/<pkg>/…` (hence the `node_modules/<pkg>/` forms) and
    // node builtins WITHOUT the `node:` prefix (hence `(node:)?fs(/|$)`).
    //
    {
      name: 'core-is-pure',
      comment: 'reviewer-core must stay pure — no I/O beyond the injected LLMProvider',
      severity: 'error',
      from: { path: 'reviewer-core/src' },
      to: {
        path: [
          'node_modules/fastify/',
          'drizzle-orm',
          'node_modules/postgres/',
          'node_modules/@octokit/',
          'node_modules/octokit/',
          'simple-git',
          '@ast-grep/napi',
          '/src/adapters/',
          '/src/db/',
          '^(node:)?fs(/|$)',
          '^(node:)?(child_process|net|http|os|process)(/|$)',
        ],
      },
    },

    // Only these two ledgered files may use `openai`. Keeping this exception
    // in its own edge rule means they remain subject to every other purity ban.
    {
      name: 'core-openai-egress-only',
      comment: 'only the designated reviewer-core egress files may import openai',
      severity: 'error',
      from: {
        path: 'reviewer-core/src',
        pathNot: ['reviewer-core/src/llm/openrouter\\.ts$', 'reviewer-core/src/llm/structured\\.ts$'],
      },
      to: { path: '^openai(/|$)|node_modules/openai/' },
    },

    // Services orchestrate through container ports (container.github(),
    // container.llm(id), …), never by importing adapter SDK wrappers.
    // Exception: repo-intel/service.ts — the indexer subsystem legitimately
    // uses the codeindex/astgrep adapters behind the container.repoIntel facade.
    {
      name: 'services-depend-on-ports',
      comment: 'services reach adapters via the container, not direct imports',
      severity: 'error',
      from: {
        path: 'src/modules/[^/]+/(service|run-executor)[^/]*\\.ts$',
        pathNot: 'src/modules/repo-intel/',
      },
      to: { path: 'src/adapters/' },
    },

    // Routes are the transport layer: parse, call the service, map the reply.
    // They never touch adapters or the DB directly.
    {
      name: 'routes-are-thin',
      comment: 'routes call services only — no adapters, no db',
      severity: 'error',
      from: { path: 'src/modules/[^/]+/routes\\.ts$' },
      to: { path: 'src/adapters/' },
    },

    // Drizzle queries belong in repository files (repository.ts / *.repo.ts).
    // Warn burn-down: the fat-route modules and a few helpers still query
    // db/schema directly — see enforcement.md for the list.
    {
      name: 'db-confined-to-repositories',
      comment: 'SQL lives in repositories — moves of db/schema imports out of routes/helpers shrink this',
      severity: 'warn',
      from: {
        path: 'src/modules/',
        pathNot: 'src/modules/[^/]+/repository',
      },
      to: { path: ['src/db/schema', '^drizzle-orm'] },
    },

    // Cross-feature access goes through the composition root
    // (container.agentsRepo / container.reviewRepo / container.repoIntel) or
    // modules/_shared — never a direct ../<other-module>/ import. $1
    // back-references the from-module so same-module imports are allowed.
    {
      name: 'no-cross-module-internals',
      comment: 'cross-module imports go via the container or _shared — hoist the shared piece',
      severity: 'warn',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        pathNot: ['^src/modules/$1/', '^src/modules/_shared/'],
      },
    },

    // Infrastructure must not depend on features. Exception: astgrep shares
    // SUPPORTED_EXT with repo-intel/constants — move the constant to
    // platform/ or _shared and delete the pathNot.
    {
      name: 'adapters-dont-know-modules',
      comment: 'adapters implement ports — they must not know feature modules',
      severity: 'error',
      from: { path: '^src/adapters/' },
      to: {
        path: '^src/modules/',
        pathNot: '^src/modules/repo-intel/constants',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['/dist/', '\\.test\\.ts$', '\\.it\\.test\\.ts$'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
