/**
 * development-verifier.ts — Deterministic ground-truth verifier for the
 * Performance Frontier Development suite.
 *
 * Materializes the agent's VFS snapshot into a temp dir, symlinks the host's
 * node_modules so vitest resolves without a separate install, then runs
 * `vitest run --reporter=json` and parses the structured output to produce a
 * machine-readable TestVerificationResult.
 *
 * IMPORTANT: This module NEVER throws. All error paths return ran:false with an
 * errorMessage so callers can surface the failure without try/catch.
 */

import { symlink } from 'fs/promises';
import { join } from 'path';
import { runInSandbox } from './sandbox-runner';

const OUTPUT_TRUNCATE_BYTES = 8 * 1024; // 8 KB

export interface TestVerificationResult {
  /** Did the test runner actually execute the suite? */
  ran: boolean;
  passed: number;
  failed: number;
  total: number;
  /** Truncated runner output (for the report/debugging). */
  output: string;
  errorMessage?: string;
}

/**
 * Parse the vitest JSON report from (potentially noisy) stdout.
 *
 * Strategy: find the first `{` that precedes `"numTotalTests"` and walk
 * forward tracking brace depth to extract the enclosing object.
 */
function parseVitestJson(raw: string): {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
} | null {
  const marker = '"numTotalTests"';
  const markerIdx = raw.indexOf(marker);
  if (markerIdx === -1) return null;

  // Walk backward from the marker to find the opening `{`.
  let start = -1;
  for (let i = markerIdx; i >= 0; i -= 1) {
    if (raw[i] === '{') {
      start = i;
      break;
    }
  }
  if (start === -1) return null;

  // Walk forward tracking brace depth to find the matching `}`.
  let depth = 0;
  let end = -1;
  for (let i = start; i < raw.length; i += 1) {
    if (raw[i] === '{') depth += 1;
    else if (raw[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const total = parsed['numTotalTests'];
    const passed = parsed['numPassedTests'];
    const failed = parsed['numFailedTests'];
    if (
      typeof total === 'number' &&
      typeof passed === 'number' &&
      typeof failed === 'number'
    ) {
      return { numTotalTests: total, numPassedTests: passed, numFailedTests: failed };
    }
    return null;
  } catch {
    return null;
  }
}

function truncate(text: string): string {
  const buf = Buffer.from(text, 'utf-8');
  if (buf.byteLength <= OUTPUT_TRUNCATE_BYTES) return text;
  return buf.slice(buf.byteLength - OUTPUT_TRUNCATE_BYTES).toString('utf-8');
}

/**
 * Run the vitest suite inside the provided VFS snapshot and return a
 * deterministic, machine-readable result.
 *
 * The snapshot MUST include:
 *   /workspace/calculator.test.ts  — the test file
 *   /workspace/calculator.ts       — the agent's implementation
 */
export async function verifyDevelopment(
  vfsSnapshot: Record<string, string>,
): Promise<TestVerificationResult> {
  // The vitest CLI entry point (confirmed by node_modules/vitest/package.json bin field).
  const vitestMjs = join('node_modules', 'vitest', 'vitest.mjs');

  let sandboxResult: Awaited<ReturnType<typeof runInSandbox>>;

  try {
    sandboxResult = await runInSandbox({
      vfsSnapshot,
      prepare: async (dir: string) => {
        // Symlink the host's node_modules so vitest + its deps resolve without
        // a separate `npm install`. The temp dir is isolated from the repo's
        // vitest.config.ts because cwd will be the temp dir, not the repo root.
        await symlink(
          join(process.cwd(), 'node_modules'),
          join(dir, 'node_modules'),
          'dir',
        );
      },
      command: process.execPath,
      args: [vitestMjs, 'run', 'calculator.test.ts', '--reporter=json', '--no-color'],
      timeoutMs: 90_000,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ran: false,
      passed: 0,
      failed: 0,
      total: 0,
      output: '',
      errorMessage: `runInSandbox threw unexpectedly: ${msg}`,
    };
  }

  const output = truncate(sandboxResult.stdout);

  if (sandboxResult.timedOut) {
    return {
      ran: false,
      passed: 0,
      failed: 0,
      total: 0,
      output,
      errorMessage: 'Test runner timed out after 90 s',
    };
  }

  const parsed = parseVitestJson(sandboxResult.stdout);

  if (!parsed) {
    return {
      ran: false,
      passed: 0,
      failed: 0,
      total: 0,
      output,
      errorMessage:
        'Could not parse vitest JSON report from output ' +
        `(exit code ${sandboxResult.exitCode ?? 'null'})`,
    };
  }

  return {
    ran: true,
    passed: parsed.numPassedTests,
    failed: parsed.numFailedTests,
    total: parsed.numTotalTests,
    output,
  };
}
