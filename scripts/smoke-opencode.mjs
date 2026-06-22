// scripts/smoke-opencode.mjs — Smoke test that mirrors what OpenCodeAdapter spawns.
// Usage: node scripts/smoke-opencode.mjs [provider/model]
//
// The script does NOT import the TS adapter (no tsx in deps); instead it spawns
// the exact CLI shape the adapter uses and validates that the expected JSON
// events flow through. Match this against the cases in src/ai-adapter/adapters/opencode.ts.
import { spawn } from 'node:child_process';

const model = process.argv[2] ?? 'xiaomi-token-plan-ams/mimo-v2-pro';
const prompt = 'One line: which model are you?';

const args = [
  'run', prompt,
  '--format', 'json',
  '--dangerously-skip-permissions',
  '--model', model,
];

const proc = spawn('opencode', args, { stdio: ['ignore', 'pipe', 'pipe'] });

const eventCounts = {};
const messages = [];
let sessionId = null;
let buf = '';

proc.stdout.on('data', chunk => {
  buf += chunk.toString();
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      eventCounts[ev.type] = (eventCounts[ev.type] ?? 0) + 1;
      if (ev.sessionID) sessionId = ev.sessionID;
      if (ev.type === 'text') messages.push(ev.part?.text ?? '');
    } catch {
      console.error('[non-json]', line.slice(0, 200));
    }
  }
});

proc.stderr.on('data', chunk => process.stderr.write(chunk));

proc.on('close', code => {
  console.log(JSON.stringify({ exitCode: code, model, sessionId, eventCounts, messages }, null, 2));
});
