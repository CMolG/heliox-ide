import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  ensureContextMap,
  upsertNode,
  upsertEdge,
  exportContextDigest,
  deleteNode,
} from '../store';
import { attachmentRegistry } from '../attachment-registry';
import { getAttachmentInjectionBlocks } from '../attachment-injector';

describe('context-map store', () => {
  let projectPath = '';

  beforeEach(async () => {
    projectPath = await mkdtemp(join(tmpdir(), 'heliox-cm-'));
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('creates context-map + auto gitignore default', async () => {
    const map = await ensureContextMap(projectPath);
    expect(map.version).toBe(1);
    const gitignore = await readFile(join(projectPath, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.heliox/');
  });

  it('supports node/edge CRUD and cascades edge delete when node removed', async () => {
    const n1 = await upsertNode(projectPath, { type: 'concept', label: 'Architecture', source: 'user' });
    const n2 = await upsertNode(projectPath, { type: 'goal', label: 'Ship MVP', source: 'user' });
    const edge = await upsertEdge(projectPath, { from: n1.id, to: n2.id, label: 'drives' });
    expect(edge.id).toBeTruthy();
    let map = await ensureContextMap(projectPath);
    expect(map.edges.length).toBe(1);
    await deleteNode(projectPath, n1.id);
    map = await ensureContextMap(projectPath);
    expect(map.nodes.some(n => n.id === n1.id)).toBe(false);
    expect(map.edges.length).toBe(0);
  });

  it('exports ranked context digest', async () => {
    const n1 = await upsertNode(projectPath, { type: 'constraint', label: 'No CSS framework', body: 'Never use CSS frameworks.', source: 'user', tags: ['frontend-engineer'] });
    const n2 = await upsertNode(projectPath, { type: 'goal', label: 'Q2 MVP', body: 'Ship remote control bridge MVP.', source: 'user' });
    await upsertEdge(projectPath, { from: n1.id, to: n2.id, label: 'supports' });

    const digest = await exportContextDigest(projectPath, { roleId: 'frontend-engineer', limit: 5 });
    expect(digest).toContain('[CONTEXT MAP DIGEST]');
    expect(digest).toContain('constraint: Never use CSS frameworks.');
  });

  it('builds active directives by mode with registry ordering', async () => {
    const attachable = await upsertNode(projectPath, {
      type: 'constraint',
      label: 'No emojis',
      body: 'Never use emojis.',
      source: 'user',
      injectMode: 'system',
      priority: 'critical',
      attachments: [],
    });
    await attachmentRegistry.attach(projectPath, attachable.id, 'session-1', 'user');
    await attachmentRegistry.refresh(projectPath);

    const blocks = getAttachmentInjectionBlocks('session-1');
    expect(blocks.system).toContain('[ACTIVE DIRECTIVES]');
    expect(blocks.system).toContain('[CRITICAL] Never use emojis.');
    expect(blocks.prefix).toBe('');
  });
});
