// scripts/smoke-mental-injection.mjs — End-to-end smoke for the mental → chat pipeline.
//
// Simulates what AgenticChatApp.handleSend builds at send time:
//   1) takes a hard-coded mental subgraph (3 nodes, 2 edges)
//   2) serializes via the triples format
//   3) prepends it to a user message
//   4) spawns `opencode run` against MiMo V2 Pro
//   5) verifies the model's reply cites the injected concepts
//
// Pure node + child_process; no tsx/vitest deps. Mirrors the prompt shape
// produced by mentalSubgraphToDigest() — keep in sync if format changes.

import { spawn } from 'node:child_process';

const NODES = [
  { id: 'auth',    text: 'Auth flow' },
  { id: 'cookie',  text: 'Session cookie' },
  { id: 'refresh', text: 'JWT refresh' },
];

const EDGES = [
  { from: 'auth',   to: 'cookie',  kind: 'link' },
  { from: 'cookie', to: 'refresh', kind: 'ramification' },
];

function quote(s) {
  return `"${s.trim().replace(/\s+/g, ' ').replace(/"/g, '\\"')}"`;
}

function digest() {
  const byId = new Map(NODES.map(n => [n.id, n]));
  const lines = ['[MENTAL MAP]'];
  for (const e of EDGES) {
    lines.push(`${quote(byId.get(e.from).text)} --${e.kind}--> ${quote(byId.get(e.to).text)}`);
  }
  return lines.join('\n');
}

const userMessage = [
  digest(),
  '',
  'Given the mental map above, explain in ONE short sentence how all three concepts relate.',
  'Cite each concept name in your sentence.',
].join('\n');

const model = process.argv[2] ?? 'xiaomi-token-plan-ams/mimo-v2-pro';

const proc = spawn('opencode', [
  'run', userMessage,
  '--format', 'json',
  '--dangerously-skip-permissions',
  '--model', model,
], { stdio: ['ignore', 'pipe', 'pipe'] });

let buf = '';
const texts = [];
const eventCounts = {};

proc.stdout.on('data', chunk => {
  buf += chunk.toString();
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line);
      eventCounts[ev.type] = (eventCounts[ev.type] ?? 0) + 1;
      if (ev.type === 'text') texts.push(ev.part?.text ?? '');
    } catch { /* non-json */ }
  }
});

proc.stderr.on('data', chunk => process.stderr.write(chunk));

proc.on('close', code => {
  const reply = texts.join('').trim();
  const cites = ['Auth flow', 'Session cookie', 'JWT refresh'].filter(c => reply.toLowerCase().includes(c.toLowerCase()));
  const result = {
    exitCode: code,
    model,
    eventCounts,
    reply,
    conceptsCited: cites,
    conceptsCitedCount: cites.length,
    pass: code === 0 && cites.length === 3,
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
});
