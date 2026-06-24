import { loadDotEnv } from './env';
import { runPerformanceFrontier } from './runner';
import type { PFSuite } from './types';

function parseSeed(): number | undefined {
  const arg = process.argv.find((item) => item.startsWith('--seed='));
  if (!arg) return undefined;
  const value = Number(arg.slice('--seed='.length));
  return Number.isFinite(value) ? value : undefined;
}

const VALID_SUITES: PFSuite[] = [
  'architecture',
  'analysis',
  'design',
  'business',
  'team-work',
  'flow-assembler',
  'development',
  'business-knowledge',
  'progression',
];

const SUITE_ALIASES: Record<string, PFSuite> = {
  assembler: 'flow-assembler',
  business: 'business-knowledge',
};

function parseSuite(): PFSuite | undefined {
  const arg = process.argv.find((item) => item.startsWith('--suite='));
  if (!arg) return undefined;
  const value = arg.slice('--suite='.length);
  if (SUITE_ALIASES[value]) return SUITE_ALIASES[value];
  if ((VALID_SUITES as string[]).includes(value)) return value as PFSuite;
  throw new Error(
    `Invalid PF suite "${value}". Expected one of: ${VALID_SUITES.join(', ')} (aliases: assembler→flow-assembler).`,
  );
}

async function main(): Promise<void> {
  await loadDotEnv();
  const result = await runPerformanceFrontier({
    seed: parseSeed(),
    suite: parseSuite(),
  });

  console.log(JSON.stringify({
    runId: result.runId,
    finalScore: result.finalScore,
    verdict: result.verdict,
    reportPath: result.reportPath,
    ledgerPath: result.ledgerPath,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Performance Frontier] ${message}`);
  process.exitCode = 1;
});
