import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

it('reads repository files but rejects traversal and symlinks outside the clone', async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), 'devdigest-git-read-'));
  const cloneDir = join(temporaryRoot, 'clones');
  const repoDir = join(cloneDir, 'acme', 'repo');
  await mkdir(join(repoDir, 'docs'), { recursive: true });
  await writeFile(join(repoDir, 'docs', 'plan.md'), '# Safe plan');
  await writeFile(join(temporaryRoot, 'secret.md'), '# Outside the repository');
  await symlink(join(temporaryRoot, 'secret.md'), join(repoDir, 'docs', 'linked.md'));

  const git = new SimpleGitClient(cloneDir);
  const repo = { owner: 'acme', name: 'repo' };
  expect(await git.readFile(repo, 'docs/plan.md')).toBe('# Safe plan');
  await expect(git.readFile(repo, '../../../secret.md')).rejects.toThrow('escapes the repository clone');
  await expect(git.readFile(repo, 'docs/linked.md')).rejects.toThrow('escapes the repository clone');
});
