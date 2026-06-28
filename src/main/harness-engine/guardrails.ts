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

/** Default verify-and-retry attempts; override via HELIOX_GUARDRAIL_MAX_ATTEMPTS. */
export const DEFAULT_GUARDRAIL_MAX_ATTEMPTS = (() => {
  const raw = Number(process.env.HELIOX_GUARDRAIL_MAX_ATTEMPTS);
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

  return findings;
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
