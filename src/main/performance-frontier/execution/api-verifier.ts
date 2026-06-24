/**
 * api-verifier.ts — Deterministic ground-truth verifier for the Performance
 * Frontier Progression suite.
 *
 * Materializes the agent's VFS snapshot into a temp dir, symlinks the host's
 * node_modules so the Express app can `require('express')` without a separate
 * install, boots the server on an ephemeral port, polls /health until it
 * responds, then runs a small deterministic battery of HTTP checks and kills
 * the server.
 *
 * IMPORTANT: This module NEVER throws. All error paths return booted:false with
 * an errorMessage so callers can surface the failure without try/catch.
 */

import { spawn } from 'child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import * as net from 'net';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

const OUTPUT_TRUNCATE_BYTES = 8 * 1024; // 8 KB
const POLL_INTERVAL_MS = 150;
const BOOT_TIMEOUT_MS = 8_000;
const OVERALL_TIMEOUT_MS = 15_000;

export interface ApiCheck {
  name: string;
  ok: boolean;
  status?: number;
  detail?: string;
}

export interface ApiVerificationResult {
  booted: boolean;
  checks: ApiCheck[];
  /** Truncated server stdout+stderr — boot errors show here. */
  output: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function truncate(text: string): string {
  const buf = Buffer.from(text, 'utf-8');
  if (buf.byteLength <= OUTPUT_TRUNCATE_BYTES) return text;
  return buf.slice(buf.byteLength - OUTPUT_TRUNCATE_BYTES).toString('utf-8');
}

/**
 * Bind a TCP server to port 0 so the OS assigns a free port, read it, then
 * close the server and return the port number. There is a tiny TOCTOU window
 * between close and the child binding, but it is acceptable for local testing.
 */
async function pickFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Could not get assigned port')));
        return;
      }
      const port = addr.port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    srv.on('error', reject);
  });
}

/**
 * Materialize a VFS snapshot (stripping the /workspace/ prefix) to a real
 * temp directory.  Returns the temp dir path.  The caller is responsible for
 * cleaning up via `rm(dir, { recursive: true, force: true })`.
 */
async function materializeSnapshot(
  vfsSnapshot: Record<string, string>,
  rootPrefix = '/workspace',
): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'heliox-api-'));
  const prefix = rootPrefix.endsWith('/') ? rootPrefix : `${rootPrefix}/`;

  for (const [vfsPath, content] of Object.entries(vfsSnapshot)) {
    if (!vfsPath.startsWith(prefix) && vfsPath !== rootPrefix) continue;

    const relative = vfsPath.startsWith(prefix) ? vfsPath.slice(prefix.length) : '';
    if (!relative) continue; // the directory root itself — skip

    const destPath = join(tempDir, relative);
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, content, 'utf-8');
  }

  return tempDir;
}

/**
 * Poll GET http://127.0.0.1:<port>/health every POLL_INTERVAL_MS ms until it
 * returns any HTTP response (we treat any response as "booted"), the child
 * process exits early (crash → fail fast), or the timeout elapses.
 *
 * Returns true when the server responds, false otherwise.
 */
async function pollUntilBooted(
  port: number,
  timeoutMs: number,
  child: ReturnType<typeof spawn>,
): Promise<boolean> {
  // Set up a promise that resolves when the child process exits.
  let childExited = false;
  const childExitPromise = new Promise<void>((resolve) => {
    child.once('close', () => {
      childExited = true;
      resolve();
    });
    child.once('error', () => {
      childExited = true;
      resolve();
    });
  });

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // If the child already exited, the server crashed — no point polling further.
    if (childExited) return false;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      // Any response (even 4xx) means the server is listening.
      void res.body?.cancel();
      return true;
    } catch {
      // Connection refused / network error — server not up yet.
    }

    // Wait before the next attempt, but yield immediately if the child exits.
    await Promise.race([
      new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS)),
      childExitPromise,
    ]);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Boot the Express app in the VFS snapshot and run a small deterministic
 * battery of HTTP checks.  Never throws.
 */
export async function verifyApi(
  vfsSnapshot: Record<string, string>,
): Promise<ApiVerificationResult> {
  let tempDir: string | undefined;
  let child: ReturnType<typeof spawn> | undefined;

  // Hard overall timeout that wraps every async operation.
  let timedOut = false;
  const overallTimer = setTimeout(() => {
    timedOut = true;
    child?.kill('SIGKILL');
  }, OVERALL_TIMEOUT_MS);

  try {
    // 1. Materialize snapshot.
    tempDir = await materializeSnapshot(vfsSnapshot);

    // 2. Symlink the host's node_modules so `require('express')` resolves.
    await symlink(
      join(process.cwd(), 'node_modules'),
      join(tempDir, 'node_modules'),
      'dir',
    );

    // 3. Pick a free ephemeral port.
    const port = await pickFreePort();

    // 4. Spawn the server — no shell, never interpolate untrusted strings.
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    child = spawn(process.execPath, ['src/server.js'], {
      cwd: tempDir,
      env: { ...process.env as Record<string, string>, PORT: String(port) },
      shell: false,
    });

    const onData = (chunk: Buffer): void => {
      totalBytes += chunk.byteLength;
      // Cap captured output at 2× the truncation limit.
      if (totalBytes < OUTPUT_TRUNCATE_BYTES * 2) {
        chunks.push(chunk);
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    // 5. Poll until the server responds on /health or we time out.
    const booted = await pollUntilBooted(port, BOOT_TIMEOUT_MS, child);

    const capturedOutput = truncate(Buffer.concat(chunks).toString('utf-8'));

    if (!booted || timedOut) {
      return {
        booted: false,
        checks: [],
        output: capturedOutput,
        errorMessage: timedOut
          ? `Overall timeout (${OVERALL_TIMEOUT_MS} ms) exceeded before server booted`
          : `Server did not respond within ${BOOT_TIMEOUT_MS} ms`,
      };
    }

    // 6. Run deterministic checks.
    const base = `http://127.0.0.1:${port}`;
    const checks: ApiCheck[] = [];

    // Check 1 — /health returns 2xx.
    try {
      const res = await fetch(`${base}/health`);
      void res.body?.cancel();
      checks.push({
        name: 'health',
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        detail: res.status >= 200 && res.status < 300
          ? 'GET /health returned 2xx'
          : `GET /health returned ${res.status}`,
      });
    } catch (err: unknown) {
      checks.push({
        name: 'health',
        ok: false,
        detail: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Check 2 — avatar endpoint exists (POST /users/:id/avatar).
    // A 404 means the route was never created (regression). 401/400/200 all
    // mean the route EXISTS — the agent at minimum registered it.
    try {
      const res = await fetch(`${base}/users/u_demo/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: 'https://example.com/avatar.png' }),
      });
      void res.body?.cancel();
      const exists = res.status !== 404;
      checks.push({
        name: 'avatar-endpoint-exists',
        ok: exists,
        status: res.status,
        detail: exists
          ? `POST /users/:id/avatar returned ${res.status} (route exists)`
          : 'POST /users/:id/avatar returned 404 — route is missing (regression)',
      });
    } catch (err: unknown) {
      checks.push({
        name: 'avatar-endpoint-exists',
        ok: false,
        detail: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // Check 3 — auth is enforced on /users (GET without credentials → 401/403).
    // If it returns 200 with no credentials, auth is broken.
    try {
      const res = await fetch(`${base}/users`);
      void res.body?.cancel();
      const enforced = res.status === 401 || res.status === 403;
      checks.push({
        name: 'auth-enforced',
        ok: enforced,
        status: res.status,
        detail: enforced
          ? `GET /users (no auth) returned ${res.status} — auth is enforced`
          : `GET /users (no auth) returned ${res.status} — auth is NOT enforced (broken)`,
      });
    } catch (err: unknown) {
      checks.push({
        name: 'auth-enforced',
        ok: false,
        detail: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    return {
      booted: true,
      checks,
      output: capturedOutput,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      booted: false,
      checks: [],
      output: '',
      errorMessage: `verifyApi failed unexpectedly: ${msg}`,
    };
  } finally {
    clearTimeout(overallTimer);
    // Always kill the server process.
    try { child?.kill('SIGKILL'); } catch { /* ignore */ }
    // Always clean up the temp dir.
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
