import { describe, expect, it } from 'vitest';
import { verifyStepContract, snapshotWorkspace, buildCorrectivePrompt, mergeStepContracts, literalizePathPattern } from './guardrails';
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

  it('never descends into node_modules or .git when walking a real tree', async () => {
    const dirs: Record<string, string[]> = {
      '/w': ['node_modules', '.git', 'src', 'a.txt'],
      '/w/src': ['b.txt'],
      '/w/node_modules': ['pkg'],
      '/w/node_modules/pkg': ['huge.js'],
      '/w/.git': ['HEAD'],
    };
    const files: Record<string, string> = {
      '/w/a.txt': 'a',
      '/w/src/b.txt': 'b',
      '/w/node_modules/pkg/huge.js': 'never-read',
      '/w/.git/HEAD': 'never-read',
    };
    const fs = {
      readdir: async (d: string) => {
        if (!(d in dirs)) throw new Error('ENOENT');
        return dirs[d];
      },
      readFile: async (f: string) => {
        if (!(f in files)) throw new Error('ENOENT');
        return files[f];
      },
      stat: async (p: string) => ({ isDirectory: () => p in dirs }),
    };
    await expect(snapshotWorkspace(fs, '/w')).resolves.toEqual({
      '/w/a.txt': 'a',
      '/w/src/b.txt': 'b',
    });
  });
});

describe('mergeStepContracts — merging runtime mod contract fragments with a step contract', () => {
  it('returns undefined when base is undefined and there are no fragments', () => {
    expect(mergeStepContracts(undefined, [])).toBeUndefined();
  });

  it('returns undefined when base is undefined and every fragment is empty', () => {
    expect(mergeStepContracts(undefined, [{}, { requiredArtifacts: [] }, { forbiddenArtifacts: [] }])).toBeUndefined();
  });

  it('returns the fragment content unmodified when base is undefined and one fragment is meaningful', () => {
    expect(mergeStepContracts(undefined, [{ mustWriteFiles: true }])).toEqual({ mustWriteFiles: true });
  });

  it('ORs boolean requirements across base and fragments', () => {
    const merged = mergeStepContracts(
      { mustWriteFiles: false },
      [{ forbidStubMarkers: true }, { requireDeclaredDependencies: true }, {}],
    );
    expect(merged?.mustWriteFiles).toBeFalsy();
    expect(merged?.forbidStubMarkers).toBe(true);
    expect(merged?.requireDeclaredDependencies).toBe(true);
  });

  it('is true if ANY single contributor requires it, even when most say false/absent', () => {
    const merged = mergeStepContracts({}, [{}, { mustWriteFiles: false }, { mustWriteFiles: true }]);
    expect(merged?.mustWriteFiles).toBe(true);
  });

  it('concatenates array requirements with base entries first', () => {
    const baseArtifact = { description: 'base artifact', pathPattern: 'a\\.ts$' };
    const fragmentArtifact = { description: 'fragment artifact', pathPattern: 'b\\.ts$' };
    const merged = mergeStepContracts(
      { requiredArtifacts: [baseArtifact] },
      [{ requiredArtifacts: [fragmentArtifact] }, {}],
    );
    expect(merged?.requiredArtifacts).toEqual([baseArtifact, fragmentArtifact]);
  });

  it('concatenates forbiddenArtifacts across every fragment, base first', () => {
    const baseForbidden = { description: 'base forbidden', pathPattern: 'src/legacy/' };
    const fragForbidden = { description: 'fragment forbidden', pathPattern: 'src/locales/' };
    const merged = mergeStepContracts(
      { forbiddenArtifacts: [baseForbidden] },
      [{ forbiddenArtifacts: [fragForbidden] }],
    );
    expect(merged?.forbiddenArtifacts).toEqual([baseForbidden, fragForbidden]);
  });

  it('takes the maximum of the defined maxAttempts values', () => {
    expect(mergeStepContracts({ maxAttempts: 2 }, [{ maxAttempts: 5 }, { maxAttempts: 3 }])?.maxAttempts).toBe(5);
  });

  it('leaves maxAttempts undefined when none of the contributors define it', () => {
    expect(mergeStepContracts({ mustWriteFiles: true }, [{ forbidStubMarkers: true }])?.maxAttempts).toBeUndefined();
  });

  it('handles an empty fragments array against a defined base by returning the base content', () => {
    expect(mergeStepContracts({ mustWriteFiles: true, maxAttempts: 4 }, [])).toEqual({
      mustWriteFiles: true,
      maxAttempts: 4,
    });
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

  it('escalates to a blunter, more directive block that still surfaces a literal path', () => {
    const prompt = buildCorrectivePrompt(
      [{
        requirement: 'artifact-missing:review',
        detail: 'Missing required artifact (review). Create a file whose path matches /REVIEW\\.md$/. Create the file `REVIEW.md`.',
      }],
      { escalate: true },
    );
    expect(prompt).toContain('ESCALATION');
    expect(prompt).toContain('REVIEW.md');
  });
});

describe('literalizePathPattern', () => {
  it('reduces a simple extension-alternation pattern to its first alternative', () => {
    expect(literalizePathPattern('src/App\\.(tsx|jsx)$')).toBe('src/App.tsx');
  });

  it('reduces a nested-directory extension alternation', () => {
    expect(literalizePathPattern('src/components/ui/button\\.(tsx|ts)$')).toBe('src/components/ui/button.tsx');
  });

  it('returns an already-literal path unescaped', () => {
    expect(literalizePathPattern('REVIEW\\.md$')).toBe('REVIEW.md');
  });

  it('returns null when top-level alternation / wildcards survive the reduction', () => {
    expect(literalizePathPattern('\\.test\\.(ts|tsx)$|__tests__/.*\\.(ts|tsx)$')).toBeNull();
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

describe('localeCoverage', () => {
  it('flags a catalog missing a key used via t() elsewhere in the workspace', () => {
    const contract: StepContract = {
      localeCoverage: [{ description: 'en source catalog', catalogPathPattern: 'src/i18n/en\\.ts$' }],
    };
    const after = {
      '/workspace/src/pages/Landing.tsx': "t('landing.hero.title'); t('landing.cta.download');",
      '/workspace/src/i18n/en.ts': "export const en = { 'landing.hero.title': 'Build agents visually' };",
    };
    const findings = verifyStepContract(contract, {}, after);
    const finding = findings.find((f) => f.requirement.startsWith('locale-coverage:'));
    expect(finding).toBeDefined();
    expect(finding?.detail).toContain('landing.cta.download');
  });

  it('produces no finding when the catalog covers every key used via t()', () => {
    const contract: StepContract = {
      localeCoverage: [{ description: 'en source catalog', catalogPathPattern: 'src/i18n/en\\.ts$' }],
    };
    const after = {
      '/workspace/src/pages/Landing.tsx': "t('landing.hero.title');",
      '/workspace/src/i18n/en.ts': "export const en = { 'landing.hero.title': 'Build agents visually' };",
    };
    expect(verifyStepContract(contract, {}, after)).toHaveLength(0);
  });

  it('flags an es value identical to the en source as untranslated when requireTranslated is set', () => {
    const contract: StepContract = {
      localeCoverage: [{
        description: 'es catalog',
        catalogPathPattern: 'src/i18n/es\\.ts$',
        sourcePathPattern: 'src/i18n/en\\.ts$',
        requireTranslated: true,
      }],
    };
    const after = {
      '/workspace/src/i18n/en.ts': "export const en = { 'auth.login.cta': 'Log in' };",
      '/workspace/src/i18n/es.ts': "export const es = { 'auth.login.cta': 'Log in' };",
    };
    const findings = verifyStepContract(contract, {}, after);
    const finding = findings.find((f) => f.requirement.startsWith('locale-untranslated:'));
    expect(finding).toBeDefined();
    expect(finding?.detail).toContain('auth.login.cta');
  });

  it('mergeStepContracts concatenates localeCoverage from a base contract and a mod fragment', () => {
    const baseReq = { description: 'en source catalog', catalogPathPattern: 'src/i18n/en\\.ts$' };
    const fragReq = {
      description: 'es catalog',
      catalogPathPattern: 'src/i18n/es\\.ts$',
      sourcePathPattern: 'src/i18n/en\\.ts$',
      requireTranslated: true,
    };
    const merged = mergeStepContracts({ localeCoverage: [baseReq] }, [{ localeCoverage: [fragReq] }]);
    expect(merged?.localeCoverage).toEqual([baseReq, fragReq]);
  });
});
