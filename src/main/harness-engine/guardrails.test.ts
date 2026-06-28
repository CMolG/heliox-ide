import { describe, expect, it } from 'vitest';
import { verifyStepContract, snapshotWorkspace, buildCorrectivePrompt } from './guardrails';
import type { StepContract } from '../../types/harness';

describe('verifyStepContract — model-agnostic definition of done', () => {
  it('flags must-write-files when the step changed nothing', () => {
    const fs = { '/workspace/a.ts': 'x' };
    const findings = verifyStepContract({ mustWriteFiles: true }, fs, fs);
    expect(findings.map((f) => f.requirement)).toContain('must-write-files');
  });

  it('passes must-write-files when a file was added', () => {
    const findings = verifyStepContract({ mustWriteFiles: true }, {}, { '/workspace/a.ts': 'x' });
    expect(findings).toHaveLength(0);
  });

  it('flags stub markers ONLY in files the step actually wrote', () => {
    const before = { '/workspace/old.ts': '// TODO pre-existing scaffold stub' };
    const after = {
      '/workspace/old.ts': '// TODO pre-existing scaffold stub',
      '/workspace/new.tsx': 'export const x = 1; // TODO finish me',
    };
    const findings = verifyStepContract({ forbidStubMarkers: true }, before, after);
    expect(findings).toHaveLength(1);
    expect(findings[0].requirement).toBe('no-stub-markers');
    expect(findings[0].detail).toContain('new.tsx');
    expect(findings[0].detail).not.toContain('old.ts');
  });

  it('flags a missing required artifact', () => {
    const contract: StepContract = { requiredArtifacts: [{ description: 'review', pathPattern: 'REVIEW\\.md$' }] };
    const findings = verifyStepContract(contract, {}, { '/workspace/src/x.ts': 'y' });
    expect(findings[0].requirement).toContain('artifact-missing');
  });

  it('flags a required artifact that exists but lacks required content', () => {
    const contract: StepContract = {
      requiredArtifacts: [{ description: 'landing seo', pathPattern: 'Landing\\.tsx$', mustContain: ['application/ld\\+json'] }],
    };
    const findings = verifyStepContract(contract, {}, { '/workspace/src/Landing.tsx': '<title>x</title>' });
    expect(findings[0].requirement).toContain('artifact-content');
  });

  it('passes when the artifact exists with the required content', () => {
    const contract: StepContract = {
      requiredArtifacts: [{ description: 'landing seo', pathPattern: 'Landing\\.tsx$', mustContain: ['application/ld\\+json'] }],
    };
    const after = { '/workspace/src/Landing.tsx': 'const ld = `<script type="application/ld+json">{}</script>`;' };
    expect(verifyStepContract(contract, {}, after)).toHaveLength(0);
  });

  it('flags an artifact below minBytes and passes when large enough', () => {
    const contract: StepContract = { requiredArtifacts: [{ description: 'review', pathPattern: 'REVIEW\\.md$', minBytes: 20 }] };
    expect(verifyStepContract(contract, {}, { '/workspace/REVIEW.md': 'tiny' })[0].requirement).toContain('artifact-size');
    expect(verifyStepContract(contract, {}, { '/workspace/REVIEW.md': 'a sufficiently long review body here' })).toHaveLength(0);
  });

  it('matches artifact paths case-insensitively (tolerates model naming variance)', () => {
    const contract: StepContract = {
      requiredArtifacts: [{ description: 'landing', pathPattern: 'Landing\\.tsx$', mustContain: ['hero'] }],
    };
    // The model wrote lowercase `landing.tsx` with `Hero` — must still satisfy.
    expect(verifyStepContract(contract, {}, { '/workspace/src/pages/landing.tsx': 'const Hero = () => null;' })).toHaveLength(0);
  });

  it('flags a forbidden artifact this step created (parallel system)', () => {
    const contract: StepContract = { forbiddenArtifacts: [{ description: 'parallel i18n', pathPattern: 'src/locales/' }] };
    const findings = verifyStepContract(contract, {}, { '/workspace/src/locales/en.json': '{}' });
    expect(findings[0].requirement).toContain('forbidden-artifact');
  });

  it('does not flag a forbidden path the step did not touch', () => {
    const fs = { '/workspace/src/locales/en.json': '{}' };
    const contract: StepContract = { forbiddenArtifacts: [{ description: 'parallel i18n', pathPattern: 'src/locales/' }] };
    expect(verifyStepContract(contract, fs, fs)).toHaveLength(0);
  });
});

describe('snapshotWorkspace', () => {
  it('uses the VFS snapshot() fast path when available', async () => {
    const snap = { '/workspace/a.ts': 'x' };
    await expect(snapshotWorkspace({ snapshot: () => snap })).resolves.toEqual(snap);
  });

  it('returns empty for an absent file system', async () => {
    await expect(snapshotWorkspace(undefined)).resolves.toEqual({});
  });
});

describe('buildCorrectivePrompt', () => {
  it('surfaces every finding as actionable feedback for the next attempt', () => {
    const prompt = buildCorrectivePrompt([
      { requirement: 'artifact-content:json-ld', detail: 'Add Schema.org JSON-LD to Landing.' },
    ]);
    expect(prompt).toContain('GUARDRAIL FAILURE');
    expect(prompt).toContain('Add Schema.org JSON-LD to Landing.');
  });
});

describe('verifyStepContract — dependency coherence', () => {
  const pkg = (deps: string[]) => JSON.stringify({ dependencies: Object.fromEntries(deps.map((d) => [d, '1.0.0'])) });

  it('flags a package imported but not declared in package.json', () => {
    const after = {
      '/workspace/package.json': pkg(['react']),
      '/workspace/src/Form.tsx': "import { useForm } from 'react-hook-form';\nimport React from 'react';",
    };
    const findings = verifyStepContract({ requireDeclaredDependencies: true }, {}, after);
    expect(findings).toHaveLength(1);
    expect(findings[0].requirement).toBe('undeclared-dependencies');
    expect(findings[0].detail).toContain('react-hook-form');
  });

  it('ignores relative imports, the @/ alias and node builtins', () => {
    const after = {
      '/workspace/package.json': pkg(['react']),
      '/workspace/src/x.ts': "import a from './a';\nimport b from '@/lib/b';\nimport { readFile } from 'node:fs';\nimport React from 'react';",
    };
    expect(verifyStepContract({ requireDeclaredDependencies: true }, {}, after)).toHaveLength(0);
  });

  it('normalizes scoped and subpath specifiers', () => {
    const after = {
      '/workspace/package.json': pkg(['@hookform/resolvers', 'react-dom']),
      '/workspace/src/x.tsx': "import { zodResolver } from '@hookform/resolvers/zod';\nimport { createRoot } from 'react-dom/client';",
    };
    expect(verifyStepContract({ requireDeclaredDependencies: true }, {}, after)).toHaveLength(0);
  });
});
