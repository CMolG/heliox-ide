/**
 * `pf:compare` — Step P3. Pairs blind vs feedback ledger runs for one seed
 * and prints a markdown comparison table (stdout) plus writes it into
 * `docs/pf-context-mode-campaign.md`'s "## Resultados" section.
 *
 * Usage:
 *   npm run pf:compare -- --seed=7 [--suites=team-work,progression]
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import { loadDotEnv } from '../env';
import { parseCompareArgs } from './args';
import { buildComparison, parseLedger, renderComparisonMarkdown } from './comparator';
import { upsertResultsSection } from './report-doc';

const DOC_PATH = join(process.cwd(), 'docs', 'pf-context-mode-campaign.md');

async function readLedgerRaw(ledgerPath: string): Promise<string> {
  try {
    return await readFile(ledgerPath, 'utf-8');
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') return ''; // Edge: no ledger yet — treated as an empty one, not an error.
    throw error;
  }
}

async function main(): Promise<void> {
  await loadDotEnv();

  const { seed, suites } = parseCompareArgs(process.argv);
  const outputDir = join(process.cwd(), '.fluxor', 'performance-frontier');
  const ledgerPath = join(outputDir, 'pf-history.jsonl');

  const raw = await readLedgerRaw(ledgerPath);
  const records = raw.trim().length > 0 ? parseLedger(raw) : [];
  const result = buildComparison(records, { seed, suites });
  const markdown = renderComparisonMarkdown(result, { seed, suites });

  console.log(markdown);

  await upsertResultsSection(DOC_PATH, markdown);
  console.log(`\n[pf:compare] "Resultados" section written to ${DOC_PATH}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pf:compare] ${message}`);
  process.exitCode = 1;
});
