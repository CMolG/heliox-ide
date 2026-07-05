import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { loadDotEnv } from '../env';
import { runBench } from './bench-runner';
import type { PFSuite } from '../types';

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

function parseSuite(): PFSuite {
  const arg = process.argv.find((item) => item.startsWith('--suite='));
  if (!arg) throw new Error('--suite=<suite> is required.');
  const value = arg.slice('--suite='.length);
  if (SUITE_ALIASES[value]) return SUITE_ALIASES[value];
  if ((VALID_SUITES as string[]).includes(value)) return value as PFSuite;
  throw new Error(
    `Invalid PF suite "${value}". Expected one of: ${VALID_SUITES.join(', ')} (aliases: assembler→flow-assembler).`,
  );
}

function parseString(flag: string, fallback: string): string {
  const arg = process.argv.find((item) => item.startsWith(`--${flag}=`));
  if (!arg) return fallback;
  return arg.slice(`--${flag}=`.length);
}

function parseInt10(flag: string, fallback: number): number {
  const raw = parseString(flag, String(fallback));
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--${flag} must be a positive integer, got "${raw}".`);
  }
  return Math.floor(value);
}

function parseFlag(flag: string): boolean {
  return process.argv.includes(`--${flag}`);
}

function fmt1(n: number): string {
  return n.toFixed(1);
}

async function main(): Promise<void> {
  await loadDotEnv();

  const suite = parseSuite();
  const modelId = parseString('model', 'mimo/mimo-v2.5-pro');
  const repetitions = parseInt10('reps', 5);
  const baseSeed = parseInt10('seed', 1);
  const varySeeds = parseFlag('vary-seeds');

  console.log(`\n[pf:bench] Suite: ${suite}  Model: ${modelId}  Reps: ${repetitions}  Seed: ${baseSeed}${varySeeds ? '+i' : ''}\n`);

  const result = await runBench({ suite, modelId, repetitions, baseSeed, varySeeds });

  const { finalScore: fs } = result;
  const halfWidth = (fs.ci95.upper - fs.ci95.lower) / 2;

  console.log('─'.repeat(60));
  console.log(`Suite        : ${result.suite}`);
  console.log(`Model        : ${result.modelId}`);
  console.log(`Repetitions  : ${result.repetitions}`);
  console.log(`Seeds        : ${result.seeds.join(', ')}`);
  console.log('');
  console.log('── Score Distribution ──────────────────────────────────');
  console.log(`  Mean ± 95% CI : ${fmt1(fs.mean)} ± ${fmt1(halfWidth)} (95% CI [${fmt1(fs.ci95.lower)}, ${fmt1(fs.ci95.upper)}])`);
  console.log(`  Std Dev       : ${fmt1(fs.stdDev)}`);
  console.log(`  Std Error     : ${fmt1(fs.stdError)}`);
  console.log(`  Min / Median / Max : ${fmt1(fs.min)} / ${fmt1(fs.median)} / ${fmt1(fs.max)}`);
  console.log('');
  console.log('── Verdicts ────────────────────────────────────────────');
  for (const [verdict, count] of Object.entries(result.verdictCounts)) {
    console.log(`  ${verdict.padEnd(10)}: ${count}`);
  }
  console.log(`  Judge errors : ${result.judgeErrors}`);
  console.log('─'.repeat(60));
  console.log('');

  // Write full JSON result to .heliox/performance-frontier/bench-<suite>.json
  const outputDir = join(process.cwd(), '.heliox', 'performance-frontier');
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `bench-${suite}.json`);
  await writeFile(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`[pf:bench] Full result written to ${outputPath}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[pf:bench] ${message}`);
  process.exitCode = 1;
});
