/**
 * api-verifier.test.ts — End-to-end tests for the API ground-truth verifier.
 *
 * These tests actually boot real Express servers to prove that verifyApi:
 *   1. Boots and passes checks for a complete, well-formed app.
 *   2. Returns booted:false for a server that crashes on startup.
 *   3. Correctly reports avatar-endpoint-exists as false when the route is absent.
 *
 * All tests carry a generous timeout (30 s) because they spawn real processes.
 */

import { describe, expect, it } from 'vitest';
import { verifyApi } from './api-verifier';

// ---------------------------------------------------------------------------
// Minimal but complete Express app — all three checks should pass.
// ---------------------------------------------------------------------------

/** A working server.js that covers all three checks. */
const GOOD_SERVER_JS = `
'use strict';
const express = require('express');
const app = express();

app.use(express.json());

// Simple auth middleware: requires an 'x-auth' header.
function requireAuth(req, res, next) {
  if (!req.headers['x-auth']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Check 1: health returns 200.
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Check 2: avatar endpoint exists (protected, but route IS registered).
app.post('/users/:id/avatar', requireAuth, (req, res) => {
  res.json({ updated: true, id: req.params.id });
});

// Check 3: protected /users route — 401 without auth header.
app.get('/users', requireAuth, (_req, res) => res.json([]));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  process.stdout.write('Server listening on ' + PORT + '\\n');
});
`.trim();

// ---------------------------------------------------------------------------
// Broken server — syntax error causes it to crash immediately on boot.
// ---------------------------------------------------------------------------

const BROKEN_SERVER_JS = `
'use strict';
// Deliberate syntax error — this is not valid JS.
const foo = {{{;
`.trim();

// ---------------------------------------------------------------------------
// Server without the avatar route (regression scenario).
// ---------------------------------------------------------------------------

const NO_AVATAR_SERVER_JS = `
'use strict';
const express = require('express');
const app = express();

app.use(express.json());

function requireAuth(req, res, next) {
  if (!req.headers['x-auth']) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// NOTE: No avatar route — this simulates the Epoch 1 → Epoch 2 regression.

app.get('/users', requireAuth, (_req, res) => res.json([]));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  process.stdout.write('Server listening on ' + PORT + '\\n');
});
`.trim();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyApi (end-to-end)', () => {
  it(
    'good app: boots and all three checks pass',
    async () => {
      const snapshot: Record<string, string> = {
        '/workspace/src/server.js': GOOD_SERVER_JS,
      };

      const result = await verifyApi(snapshot);

      expect(
        result.booted,
        `expected booted:true — errorMessage: ${result.errorMessage ?? 'none'}, output: ${result.output}`,
      ).toBe(true);

      expect(result.errorMessage).toBeUndefined();

      const healthCheck = result.checks.find((c) => c.name === 'health');
      expect(healthCheck, 'health check must exist').toBeDefined();
      expect(healthCheck!.ok, `health check failed — detail: ${healthCheck?.detail}`).toBe(true);

      const avatarCheck = result.checks.find((c) => c.name === 'avatar-endpoint-exists');
      expect(avatarCheck, 'avatar-endpoint-exists check must exist').toBeDefined();
      expect(
        avatarCheck!.ok,
        `avatar check failed — detail: ${avatarCheck?.detail}`,
      ).toBe(true);

      const authCheck = result.checks.find((c) => c.name === 'auth-enforced');
      expect(authCheck, 'auth-enforced check must exist').toBeDefined();
      expect(
        authCheck!.ok,
        `auth-enforced check failed — detail: ${authCheck?.detail}`,
      ).toBe(true);
    },
    30_000,
  );

  it(
    'broken app: syntax error → booted:false with output/errorMessage populated',
    async () => {
      const snapshot: Record<string, string> = {
        '/workspace/src/server.js': BROKEN_SERVER_JS,
      };

      const result = await verifyApi(snapshot);

      expect(result.booted).toBe(false);
      // At least one of errorMessage or output must be non-empty (boot error evidence).
      const hasErrorEvidence =
        (result.errorMessage !== undefined && result.errorMessage.length > 0) ||
        result.output.length > 0;
      expect(
        hasErrorEvidence,
        `expected errorMessage or output to contain boot error — got errorMessage="${result.errorMessage}" output="${result.output}"`,
      ).toBe(true);
    },
    30_000,
  );

  it(
    'missing-avatar app: booted:true but avatar-endpoint-exists check is false (status 404)',
    async () => {
      const snapshot: Record<string, string> = {
        '/workspace/src/server.js': NO_AVATAR_SERVER_JS,
      };

      const result = await verifyApi(snapshot);

      expect(
        result.booted,
        `expected booted:true — errorMessage: ${result.errorMessage ?? 'none'}, output: ${result.output}`,
      ).toBe(true);

      const avatarCheck = result.checks.find((c) => c.name === 'avatar-endpoint-exists');
      expect(avatarCheck, 'avatar-endpoint-exists check must exist').toBeDefined();
      expect(
        avatarCheck!.ok,
        `expected avatar check to fail — detail: ${avatarCheck?.detail}`,
      ).toBe(false);
      expect(avatarCheck!.status, 'missing route must return 404').toBe(404);
    },
    30_000,
  );
});
