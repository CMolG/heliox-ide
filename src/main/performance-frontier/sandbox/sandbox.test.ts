import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPerformanceSandbox, exportSandboxArtifacts } from './sandbox';

let outputDir: string;

describe('performance frontier sandbox', () => {
  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'fluxor-pf-artifacts-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('stores files in an ephemeral VFS and exposes a JSON snapshot', async () => {
    const sandbox = createPerformanceSandbox({
      initialFiles: {
        'README.md': 'seeded',
      },
    });

    await sandbox.fileSystem.writeFile('/workspace/src/generated.ts', 'export const value = 42;', 'utf-8');
    await expect(sandbox.fileSystem.readFile('/workspace/README.md', 'utf-8'))
      .resolves
      .toBe('seeded');

    expect(sandbox.snapshot()).toMatchObject({
      '/workspace/README.md': 'seeded',
      '/workspace/src/generated.ts': 'export const value = 42;',
    });

    sandbox.destroy();
    expect(sandbox.snapshot()).toEqual({});
  });

  it('denies network calls by default', async () => {
    const sandbox = createPerformanceSandbox();

    await expect(sandbox.fetch('https://example.com/api')).rejects.toThrow('blocked by Performance Frontier sandbox');
  });

  it('serves explicitly mocked network responses', async () => {
    const sandbox = createPerformanceSandbox({
      networkMocks: [{
        origin: 'https://api.example.test',
        path: '/v1/metadata',
        method: 'GET',
        statusCode: 200,
        body: { ok: true },
      }],
    });

    const response = await sandbox.fetch('https://api.example.test/v1/metadata');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it('intercepts Fluxor ticket telemetry by default', async () => {
    const sandbox = createPerformanceSandbox();

    const response = await sandbox.fetch('https://api.javadaba.com/v1/fluxor/ticket', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        intent: 'Need Jira support.',
        missingCapabilities: ['Jira integration'],
      }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true, intercepted: true });
  });

  it('exports VFS snapshot files to a physical artifacts directory', async () => {
    const artifacts = await exportSandboxArtifacts({
      runId: 'pf-run-artifacts',
      outputDir,
      vfsSnapshot: {
        '/workspace/content.md': '# Copy',
        '/workspace/src/Landing.tsx': 'export function Landing() { return null; }',
      },
    });

    expect(artifacts.artifactsDir).toBe(join(outputDir, 'artifacts', 'pf-run-artifacts'));
    expect(artifacts.files.map((file) => file.vfsPath).sort()).toEqual([
      '/workspace/content.md',
      '/workspace/src/Landing.tsx',
    ]);
    await expect(readFile(join(artifacts.artifactsDir, 'src', 'Landing.tsx'), 'utf-8'))
      .resolves
      .toContain('Landing');
    expect(artifacts.files.find((file) => file.vfsPath.endsWith('Landing.tsx'))?.fileUrl)
      .toContain('file://');
  });
});
