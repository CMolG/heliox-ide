import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { upsertResultsSection } from './report-doc';

let dir: string;
let docPath: string;

describe('upsertResultsSection', () => {
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fluxor-pf-compare-doc-'));
    docPath = join(dir, 'pf-context-mode-campaign.md');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the file with just the section when it does not exist yet', async () => {
    await upsertResultsSection(docPath, '| a | b |\n|---|---|\n| 1 | 2 |');
    const content = await readFile(docPath, 'utf-8');
    expect(content).toContain('## Resultados');
    expect(content).toContain('| a | b |');
  });

  it('appends the section at the end when the doc exists but has no "## Resultados" heading, preserving everything', async () => {
    const original = [
      '# Campaña PF: Context Modes',
      '',
      '## Suites elegidas',
      '',
      '- team-work',
      '- progression',
      '',
      '## Checklist de ejecución',
      '',
      '- [ ] run blind',
      '- [ ] run feedback',
    ].join('\n');
    await writeFile(docPath, original, 'utf-8');

    await upsertResultsSection(docPath, '| suite | score |\n|---|---|\n| team-work | 90 |');
    const content = await readFile(docPath, 'utf-8');

    expect(content).toContain('# Campaña PF: Context Modes');
    expect(content).toContain('## Suites elegidas');
    expect(content).toContain('- team-work');
    expect(content).toContain('## Checklist de ejecución');
    expect(content).toContain('- [ ] run blind');
    expect(content).toContain('## Resultados');
    expect(content).toContain('| team-work | 90 |');
    // The new section comes after the pre-existing content.
    expect(content.indexOf('## Checklist')).toBeLessThan(content.indexOf('## Resultados'));
  });

  it('replaces an existing "## Resultados" section in the middle of the doc, preserving sections before AND after', async () => {
    const original = [
      '# Campaña PF',
      '',
      '## Checklist de ejecución',
      '',
      '- [ ] step one',
      '',
      '## Resultados',
      '',
      '_(placeholder until the campaign runs)_',
      '',
      '## Notas',
      '',
      'Algo que no debe borrarse.',
    ].join('\n');
    await writeFile(docPath, original, 'utf-8');

    await upsertResultsSection(docPath, '| suite | score |\n|---|---|\n| progression | 88 |');
    const content = await readFile(docPath, 'utf-8');

    expect(content).toContain('## Checklist de ejecución');
    expect(content).toContain('- [ ] step one');
    expect(content).toContain('## Notas');
    expect(content).toContain('Algo que no debe borrarse.');
    expect(content).not.toContain('placeholder until the campaign runs');
    expect(content).toContain('| progression | 88 |');

    // Order preserved: Checklist, then Resultados, then Notas.
    expect(content.indexOf('## Checklist')).toBeLessThan(content.indexOf('## Resultados'));
    expect(content.indexOf('## Resultados')).toBeLessThan(content.indexOf('## Notas'));
  });

  it('replaces a "## Resultados" section that is the LAST section in the doc', async () => {
    const original = [
      '# Campaña PF',
      '',
      '## Checklist de ejecución',
      '',
      '- [ ] step one',
      '',
      '## Resultados',
      '',
      '_(placeholder)_',
    ].join('\n');
    await writeFile(docPath, original, 'utf-8');

    await upsertResultsSection(docPath, '| suite | score |\n|---|---|\n| team-work | 95 |');
    const content = await readFile(docPath, 'utf-8');

    expect(content).toContain('## Checklist de ejecución');
    expect(content).toContain('- [ ] step one');
    expect(content).not.toContain('_(placeholder)_');
    expect(content).toContain('| team-work | 95 |');
  });

  it('is idempotent: running it twice with the same table converges to stable content (no duplication)', async () => {
    const original = '# Campaña PF\n\n## Checklist\n\n- [ ] a\n';
    await writeFile(docPath, original, 'utf-8');

    const table = '| suite | score |\n|---|---|\n| team-work | 90 |';
    await upsertResultsSection(docPath, table);
    const afterFirst = await readFile(docPath, 'utf-8');
    await upsertResultsSection(docPath, table);
    const afterSecond = await readFile(docPath, 'utf-8');

    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond.match(/## Resultados/g)).toHaveLength(1);
  });

  it('refreshes the section content when re-run with a different table (not just idempotent on identical input)', async () => {
    await writeFile(docPath, '# Campaña PF\n\n## Checklist\n\n- [ ] a\n', 'utf-8');

    await upsertResultsSection(docPath, '| suite | score |\n|---|---|\n| team-work | 80 |');
    await upsertResultsSection(docPath, '| suite | score |\n|---|---|\n| team-work | 95 |');
    const content = await readFile(docPath, 'utf-8');

    expect(content).not.toContain('| team-work | 80 |');
    expect(content).toContain('| team-work | 95 |');
    expect(content.match(/## Resultados/g)).toHaveLength(1);
  });
});
