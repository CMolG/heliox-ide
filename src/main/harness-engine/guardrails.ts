/**
 * guardrails.ts — Model-agnostic step "definition of done" enforcement.
 *
 * After a step runs, the executor verifies the step's StepContract against the
 * workspace. Failures produce concrete, deterministic corrective feedback that
 * is appended to the step prompt on the next attempt — so a weaker model
 * converges to a complete artifact instead of leaving stubs or no-ops. Every
 * check is a pure string/path assertion: the verdict is identical for any model.
 */
import type { StepContract } from '../../types/harness';
import { readBrandEnv } from '../lib/env-compat';

/** Default verify-and-retry attempts; override via FLUXOR_GUARDRAIL_MAX_ATTEMPTS. */
export const DEFAULT_GUARDRAIL_MAX_ATTEMPTS = (() => {
  const raw = Number(readBrandEnv('FLUXOR_GUARDRAIL_MAX_ATTEMPTS'));
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 3;
})();

/** Markers that mean "not actually implemented". */
const STUB_MARKER = /\b(?:TODO|FIXME|XXX|HACK)\b|placeholder|not[\s-]?implemented|coming soon|<your\b/i;

export interface GuardrailFinding {
  /** Stable id of the unmet requirement (for terse logging). */
  requirement: string;
  /** Human-actionable detail surfaced to the model on retry. */
  detail: string;
}

/** Minimal read surface we need to verify what a step produced. */
export interface ReadableWorkspace {
  readdir?: (path: string) => Promise<string[]>;
  readFile?: (path: string, encoding: 'utf-8') => Promise<string>;
  stat?: (path: string) => Promise<unknown>;
  /** Fast path provided by the PF sandbox VFS. */
  snapshot?: () => Record<string, string>;
}

/**
 * Snapshot the workspace as a path→content map. Prefers a VFS `snapshot()` (the
 * PF sandbox); otherwise walks `rootDir` with readdir/stat/readFile.
 */
export async function snapshotWorkspace(
  fileSystem: ReadableWorkspace | undefined,
  rootDir = '/workspace',
): Promise<Record<string, string>> {
  if (!fileSystem) return {};
  if (typeof fileSystem.snapshot === 'function') return fileSystem.snapshot();
  if (!fileSystem.readdir || !fileSystem.readFile) return {};

  const readdir = fileSystem.readdir.bind(fileSystem);
  const readFile = fileSystem.readFile.bind(fileSystem);
  const stat = fileSystem.stat?.bind(fileSystem);
  const out: Record<string, string> = {};

  const walk = async (dir: string): Promise<void> => {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = `${dir}/${name}`.replace(/\/{2,}/g, '/');
      let isDir = false;
      try {
        const info = (await stat?.(full)) as { isDirectory?: () => boolean } | undefined;
        isDir = typeof info?.isDirectory === 'function' ? info.isDirectory() : false;
      } catch {
        isDir = false;
      }
      if (isDir) {
        await walk(full);
      } else {
        try {
          out[full] = await readFile(full, 'utf-8');
        } catch {
          /* unreadable — skip */
        }
      }
    }
  };

  await walk(rootDir);
  return out;
}

function changedFiles(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys(after).filter((path) => after[path] !== before[path]);
}

/** Node built-in modules (importing these needs no package.json entry). */
const NODE_BUILTINS = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram',
  'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os',
  'path', 'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
  'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib',
]);

/** The external package name for an import specifier, or null if relative / @-aliased / a builtin. */
function externalPackageName(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/') || spec.startsWith('~')) return null;
  const bare = spec.startsWith('node:') ? spec.slice('node:'.length) : spec;
  const parts = bare.split('/');
  const pkg = bare.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (!pkg || NODE_BUILTINS.has(pkg)) return null;
  return pkg;
}

/** External packages imported across the workspace but absent from package.json. */
function undeclaredDependencies(after: Record<string, string>): string[] {
  const pkgPath = Object.keys(after).find((path) => /(^|\/)package\.json$/.test(path));
  if (!pkgPath) return [];
  let declared: Set<string>;
  try {
    const pkg = JSON.parse(after[pkgPath]) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    declared = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]);
  } catch {
    return [];
  }
  const importRe = /(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  const imported = new Set<string>();
  for (const [path, content] of Object.entries(after)) {
    if (!/\.(ts|tsx|js|jsx|mts|cts)$/.test(path) || /(^|\/)node_modules\//.test(path)) continue;
    for (const match of content.matchAll(importRe)) {
      const pkg = externalPackageName(match[1] ?? match[2] ?? match[3] ?? '');
      if (pkg) imported.add(pkg);
    }
  }
  return [...imported].filter((pkg) => !declared.has(pkg)).sort();
}

/** Pure, deterministic contract check — identical verdict for any model. */
export function verifyStepContract(
  contract: StepContract,
  before: Record<string, string>,
  after: Record<string, string>,
): GuardrailFinding[] {
  const findings: GuardrailFinding[] = [];
  const written = changedFiles(before, after);

  if (contract.mustWriteFiles && written.length === 0) {
    findings.push({
      requirement: 'must-write-files',
      detail: 'This step produced no new or modified files. Use write_file to create the expected artifacts now.',
    });
  }

  if (contract.forbidStubMarkers) {
    const stubbed = written.filter((path) => STUB_MARKER.test(after[path]));
    if (stubbed.length > 0) {
      findings.push({
        requirement: 'no-stub-markers',
        detail: `These files you wrote still contain TODO/FIXME/placeholder stubs — implement them fully and remove every marker: ${stubbed.join(', ')}.`,
      });
    }
  }

  for (const req of contract.requiredArtifacts ?? []) {
    // Case-insensitive so a model naming `landing.tsx` still satisfies a
    // `Landing\.tsx$` requirement — the gate checks intent, not casing.
    const pathRe = new RegExp(req.pathPattern, 'i');
    const matches = Object.keys(after).filter((path) => pathRe.test(path));

    if (matches.length === 0) {
      findings.push({
        requirement: `artifact-missing:${req.description}`,
        detail: `Missing required artifact (${req.description}). Create a file whose path matches /${req.pathPattern}/.`,
      });
      continue;
    }

    for (const signature of req.mustContain ?? []) {
      const sigRe = new RegExp(signature, 'i');
      if (!matches.some((path) => sigRe.test(after[path]))) {
        findings.push({
          requirement: `artifact-content:${req.description}`,
          detail: `The artifact (${req.description}) exists but is missing required content matching /${signature}/. Add it.`,
        });
      }
    }

    if (req.minBytes !== undefined) {
      const bigEnough = matches.some((path) => Buffer.byteLength(after[path], 'utf-8') >= req.minBytes!);
      if (!bigEnough) {
        findings.push({
          requirement: `artifact-size:${req.description}`,
          detail: `The artifact (${req.description}) is empty or too small. Produce real content (at least ${req.minBytes} bytes).`,
        });
      }
    }
  }

  for (const forbidden of contract.forbiddenArtifacts ?? []) {
    const pathRe = new RegExp(forbidden.pathPattern, 'i');
    const created = written.filter((path) => pathRe.test(path));
    if (created.length > 0) {
      findings.push({
        requirement: `forbidden-artifact:${forbidden.description}`,
        detail: `Do not create a parallel ${forbidden.description}: ${created.join(', ')}. The canonical file already exists — put your content there and leave these alone.`,
      });
    }
  }

  if (contract.requireDeclaredDependencies) {
    const missing = undeclaredDependencies(after);
    if (missing.length > 0) {
      findings.push({
        requirement: 'undeclared-dependencies',
        detail: `These packages are imported but missing from package.json — add them to "dependencies" so the project installs and builds: ${missing.join(', ')}.`,
      });
    }
  }

  return findings;
}

/** True when a contract fragment declares nothing that would ever produce a finding. */
function isEmptyContract(contract: StepContract): boolean {
  return (
    !contract.mustWriteFiles
    && !contract.forbidStubMarkers
    && !contract.requireDeclaredDependencies
    && (contract.requiredArtifacts ?? []).length === 0
    && (contract.forbiddenArtifacts ?? []).length === 0
    && contract.maxAttempts === undefined
  );
}

/**
 * Merge a step's own `StepContract` with runtime-declared fragments
 * contributed by its attached mods (`MarketModRuntime.contract`, aggregated by
 * `collectModRuntime` in executor.ts) into a single effective contract.
 *
 *   - Booleans (`mustWriteFiles`, `forbidStubMarkers`, `requireDeclaredDependencies`)
 *     OR across base + fragments — any one requiring it makes the merged
 *     contract require it.
 *   - Arrays (`requiredArtifacts`, `forbiddenArtifacts`) concatenate, base
 *     first, so the step's own corrective feedback still surfaces first.
 *   - `maxAttempts` takes the largest of the defined values (never let one
 *     mod's smaller budget starve another mod's requirement); `undefined`
 *     when none of them define it.
 *
 * Returns `undefined` when there is truly nothing to enforce (`base` is
 * `undefined` and every fragment is empty) so the executor's existing
 * `Boolean(contract)` gate keeps behaving exactly as it did for steps with no
 * contract at all.
 */
export function mergeStepContracts(
  base: StepContract | undefined,
  fragments: StepContract[],
): StepContract | undefined {
  if (base === undefined && fragments.every(isEmptyContract)) {
    return undefined;
  }

  const all = base ? [base, ...fragments] : fragments;

  const mustWriteFiles = all.some((c) => Boolean(c.mustWriteFiles));
  const forbidStubMarkers = all.some((c) => Boolean(c.forbidStubMarkers));
  const requireDeclaredDependencies = all.some((c) => Boolean(c.requireDeclaredDependencies));
  const requiredArtifacts = all.flatMap((c) => c.requiredArtifacts ?? []);
  const forbiddenArtifacts = all.flatMap((c) => c.forbiddenArtifacts ?? []);
  const declaredMaxAttempts = all
    .map((c) => c.maxAttempts)
    .filter((value): value is number => typeof value === 'number');
  const maxAttempts = declaredMaxAttempts.length > 0 ? Math.max(...declaredMaxAttempts) : undefined;

  return {
    ...(mustWriteFiles ? { mustWriteFiles } : {}),
    ...(forbidStubMarkers ? { forbidStubMarkers } : {}),
    ...(requireDeclaredDependencies ? { requireDeclaredDependencies } : {}),
    ...(requiredArtifacts.length > 0 ? { requiredArtifacts } : {}),
    ...(forbiddenArtifacts.length > 0 ? { forbiddenArtifacts } : {}),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
  };
}

/** Build the corrective feedback appended to the step prompt on the next attempt. */
export function buildCorrectivePrompt(findings: GuardrailFinding[]): string {
  return [
    '',
    '── GUARDRAIL FAILURE (automated, deterministic check) ──',
    "Your previous attempt did NOT satisfy this step's completion contract. Fix EXACTLY the following, then write the COMPLETE files (no TODO/placeholder stubs may remain):",
    ...findings.map((finding, index) => `${index + 1}. ${finding.detail}`),
    'If you previously explored (listed directories / re-read files) WITHOUT writing: STOP exploring now.',
    'Call write_file for each artifact above immediately — that is the ONLY action that completes this step.',
    'Content you put in your reply text does NOT count and is discarded. Produce the files; do not explain.',
  ].join('\n');
}
