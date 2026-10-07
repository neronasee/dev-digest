import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverDocuments, readDocument } from './reader.js';
import { DEFAULT_CONTEXT_ROOTS } from './constants.js';

/**
 * Hermetic reader tests over a tmp-dir clone fixture — real fs, no DB, no
 * Docker. Pins the discovery rules (root matching, .md-only, symlink/binary
 * skips, deterministic order) and the realpath confinement of readDocument
 * (the security-relevant part: forged `..`/absolute/symlink paths must refuse).
 */

const ROOTS = [...DEFAULT_CONTEXT_ROOTS];

let cloneDir: string;

async function write(rel: string, content: string): Promise<void> {
  const full = join(cloneDir, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(full, content);
}

beforeAll(async () => {
  cloneDir = await mkdtemp(join(tmpdir(), 'devdigest-ctx-'));
  await mkdir(join(cloneDir, 'specs'), { recursive: true });
  await mkdir(join(cloneDir, 'docs'), { recursive: true });
  await mkdir(join(cloneDir, 'insights'), { recursive: true });
  await mkdir(join(cloneDir, 'src', 'lib'), { recursive: true });
  await mkdir(join(cloneDir, 'node_modules', 'pkg'), { recursive: true });

  await write('specs/api-layering.md', 'module `api/` must not import `db/` directly');
  await write('specs/nested/postmortems.md', 'nested doc under specs');
  await write('docs/architecture.md', '# Architecture\n\nLayered.');
  await write('insights/2026-learnings.md', 'x'.repeat(40));
  await write('src/lib/docs/readme.md', 'md under a docs segment deep in src');
  await write('src/lib/util.ts', 'export const x = 1;');
  await write('README.md', 'top-level readme is under no root');
  await write('node_modules/pkg/THIRD.md', 'vendored markdown is not ours');
  // Binary: valid .md path whose bytes are not text.
  await writeFile(join(cloneDir, 'specs', 'binary.md'), Buffer.from([0x23, 0x00, 0x42]));
  // Symlinked document pointing at a real file inside the clone.
  await symlink(join('..', 'docs', 'architecture.md'), join(cloneDir, 'specs', 'linked.md'));
});

afterAll(async () => {
  await rm(cloneDir, { recursive: true, force: true });
});

describe('discoverDocuments', () => {
  it('finds .md files under any configured root segment with exact path/root/size/estimate', async () => {
    const { documents } = await discoverDocuments(cloneDir, ROOTS);
    const byPath = new Map(documents.map((d) => [d.path, d]));

    const api = byPath.get('specs/api-layering.md');
    expect(api).toBeDefined();
    expect(api!.root).toBe('specs');
    expect(api!.sizeBytes).toBe('module `api/` must not import `db/` directly'.length);
    expect(api!.tokens).toBe(Math.ceil('module `api/` must not import `db/` directly'.length / 4));

    expect(byPath.get('docs/architecture.md')!.root).toBe('docs');
    expect(byPath.get('insights/2026-learnings.md')!.root).toBe('insights');
    // A root segment anywhere in the path counts ("under any roots segment").
    expect(byPath.get('src/lib/docs/readme.md')!.root).toBe('docs');
    expect(byPath.get('specs/nested/postmortems.md')!.root).toBe('specs');
  });

  it('ignores non-markdown files, rootless markdown, and excluded dirs', async () => {
    const { documents } = await discoverDocuments(cloneDir, ROOTS);
    const paths = documents.map((d) => d.path);
    expect(paths).not.toContain('src/lib/util.ts');
    expect(paths).not.toContain('README.md');
    expect(paths).not.toContain('node_modules/pkg/THIRD.md');
  });

  it('skips symlinks and binary candidates (recorded in skipped, never documents)', async () => {
    const { documents, skipped } = await discoverDocuments(cloneDir, ROOTS);
    const paths = documents.map((d) => d.path);
    expect(paths).not.toContain('specs/linked.md'); // symlink — never followed
    expect(paths).not.toContain('specs/binary.md'); // NUL bytes — not text
    expect(skipped).toContain('specs/linked.md');
    expect(skipped).toContain('specs/binary.md');
  });

  it('returns documents in deterministic path order', async () => {
    const { documents } = await discoverDocuments(cloneDir, ROOTS);
    const paths = documents.map((d) => d.path);
    expect(paths).toEqual([...paths].sort());
  });

  it('honors a custom roots list (settings-driven scan)', async () => {
    const { documents } = await discoverDocuments(cloneDir, ['docs']);
    expect(documents.map((d) => d.path)).toEqual([
      'docs/architecture.md',
      'src/lib/docs/readme.md',
    ]);
  });

  it('returns empty results (no throw) for a missing clone', async () => {
    const result = await discoverDocuments(join(cloneDir, 'does-not-exist'), ROOTS);
    expect(result.documents).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

describe('readDocument', () => {
  it('reads a real document inside the clone', async () => {
    const content = await readDocument(cloneDir, 'specs/api-layering.md');
    expect(content).toBe('module `api/` must not import `db/` directly');
  });

  it('refuses `..` traversal escaping the clone', async () => {
    expect(await readDocument(cloneDir, '../../etc/passwd')).toBeUndefined();
  });

  it('refuses absolute paths', async () => {
    expect(await readDocument(cloneDir, '/etc/passwd')).toBeUndefined();
  });

  it('refuses a symlink inside the clone pointing outside it', async () => {
    // secrets.md -> /etc/passwd
    await symlink('/etc/passwd', join(cloneDir, 'specs', 'escape.md'));
    try {
      expect(await readDocument(cloneDir, 'specs/escape.md')).toBeUndefined();
    } finally {
      await rm(join(cloneDir, 'specs', 'escape.md'), { force: true });
    }
  });

  it('yields undefined for a missing file (never throws)', async () => {
    expect(await readDocument(cloneDir, 'specs/nope.md')).toBeUndefined();
  });

  it('yields undefined when the clone root itself is missing', async () => {
    expect(await readDocument(join(cloneDir, 'does-not-exist'), 'specs/a.md')).toBeUndefined();
  });
});

describe('readDocument unreadable file', () => {
  it('yields undefined for a permission-denied file (when not root)', async () => {
    const rel = 'specs/locked.md';
    await write(rel, 'secret');
    const full = join(cloneDir, rel);
    await chmod(full, 0o000);
    try {
      // chmod is ineffective for root — the confinement contract still holds,
      // only the specific errno differs; assert for the normal (non-root) case.
      if (process.getuid?.() !== 0) {
        expect(await readDocument(cloneDir, rel)).toBeUndefined();
      } else {
        expect(typeof (await readDocument(cloneDir, rel))).toBe('string');
      }
    } finally {
      await chmod(full, 0o644);
      await rm(full, { force: true });
    }
  });
});
