/**
 * sandbox-runner.ts — Materialize a VFS snapshot to a real temp dir and execute
 * an arbitrary command against it.
 *
 * SECURITY NOTE: This module executes untrusted, LLM-generated code. Isolation
 * is limited to:
 *   1. A fresh `mkdtemp` directory that is always removed after the run.
 *   2. A configurable wall-clock timeout with SIGKILL enforcement.
 *
 * TODO: Add network-namespace isolation (e.g. unshare/firejail on Linux,
 * Sandbox profiles on macOS) so generated code cannot exfiltrate data or
 * phone home. The current implementation has NO network isolation.
 */

import { spawn } from 'child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const OUTPUT_CAP_BYTES = 64 * 1024; // 64 KB

export interface SandboxRunResult {
  exitCode: number | null; // null when killed (timeout)
  stdout: string;          // combined stdout+stderr, truncated to ~64KB
  timedOut: boolean;
  durationMs: number;
}

export interface SandboxRunOptions {
  vfsSnapshot: Record<string, string>; // VFS path -> content
  command: string;                     // e.g. 'node' or 'npx'
  args: string[];                      // e.g. ['-e', '...'] (NO shell string)
  timeoutMs?: number;                  // default 60_000
  /** VFS prefix to strip when materializing (default '/workspace'). */
  rootPrefix?: string;
  /** Relative subdir (within the materialized tree) to use as cwd. */
  cwd?: string;
  env?: Record<string, string>;
  /**
   * Optional hook invoked AFTER materialization and BEFORE spawning the
   * command. Receives the absolute path of the materialized temp directory.
   * Use it to install symlinks, generate lock files, etc.
   */
  prepare?: (materializedDir: string) => Promise<void>;
}

/**
 * Materialize the snapshot to a fresh temp dir, run the command with a timeout,
 * capture output, and ALWAYS clean up the temp dir.
 */
export async function runInSandbox(options: SandboxRunOptions): Promise<SandboxRunResult> {
  const {
    vfsSnapshot,
    command,
    args,
    timeoutMs = 60_000,
    rootPrefix = '/workspace',
    cwd: subdir,
    env: extraEnv,
    prepare,
  } = options;

  const tempDir = await mkdtemp(join(tmpdir(), 'heliox-sb-'));

  try {
    // --- Materialize snapshot ---
    const prefix = rootPrefix.endsWith('/') ? rootPrefix : `${rootPrefix}/`;

    for (const [vfsPath, content] of Object.entries(vfsSnapshot)) {
      // Ignore entries outside the declared prefix.
      if (!vfsPath.startsWith(prefix) && vfsPath !== rootPrefix) {
        continue;
      }

      const relative = vfsPath.startsWith(prefix)
        ? vfsPath.slice(prefix.length)
        : '';

      if (!relative) {
        // The prefix itself as a key — skip (it's the directory root, not a file).
        continue;
      }

      const destPath = join(tempDir, relative);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, content, 'utf-8');
    }

    // --- Optional prepare hook (e.g. install symlinks before spawn) ---
    if (prepare) {
      await prepare(tempDir);
    }

    // --- Resolve process cwd ---
    const processCwd = subdir ? join(tempDir, subdir) : tempDir;

    // --- Build environment ---
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...extraEnv,
    };

    // --- Spawn (no shell — never interpolate untrusted strings into a shell) ---
    const startMs = Date.now();

    const result = await new Promise<SandboxRunResult>((resolve) => {
      const child = spawn(command, args, {
        cwd: processCwd,
        env,
        shell: false,
      });

      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let timedOut = false;

      const onData = (chunk: Buffer): void => {
        totalBytes += chunk.byteLength;
        chunks.push(chunk);
      };

      child.stdout.on('data', onData);
      child.stderr.on('data', onData);

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);

        const durationMs = Date.now() - startMs;
        const combined = Buffer.concat(chunks);

        // Truncate: keep the tail (most recent output is more useful for debugging).
        let stdout: string;
        if (combined.byteLength > OUTPUT_CAP_BYTES) {
          stdout = combined.slice(combined.byteLength - OUTPUT_CAP_BYTES).toString('utf-8');
        } else {
          stdout = combined.toString('utf-8');
        }

        resolve({
          exitCode: timedOut ? null : code,
          stdout,
          timedOut,
          durationMs,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: null,
          stdout: err.message,
          timedOut: false,
          durationMs: Date.now() - startMs,
        });
      });
    });

    return result;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
