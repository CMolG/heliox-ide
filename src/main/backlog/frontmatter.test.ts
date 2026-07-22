// src/main/backlog/frontmatter.test.ts
import { describe, expect, it } from 'vitest';
import { parseBacklogCard, serializeBacklogCard } from './frontmatter';

describe('legacy status/runState mapping (F0 spec §2.1)', () => {
  const cases: Array<[string, string, string]> = [
    ['pending', 'todo', 'idle'],
    ['in_progress', 'doing', 'running'],
    ['completed', 'review', 'completed'],
    ['failed', 'refine', 'failed'],
  ];
  for (const [legacy, status, runState] of cases) {
    it(`maps legacy status "${legacy}"`, async () => {
      const content = `---\ntask_id: T1\nstatus: ${legacy}\n---\n# Title\n\nBody text.`;
      const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
      expect(card?.status).toBe(status);
      expect(card?.runState).toBe(runState);
    });
  }

  it('unrecognized/absent status falls back like v1 (pending/todo/idle)', async () => {
    const content = `---\ntask_id: T1\n---\n# Title\n\nBody.`;
    const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
    expect(card?.status).toBe('todo');
    expect(card?.runState).toBe('idle');
  });

  it('a genuine v2 status/runState pair round-trips untouched', async () => {
    const content = `---\ntask_id: T1\nstatus: doing\nrunState: running\n---\n# Title\n\nBody.`;
    const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
    expect(card?.status).toBe('doing');
    expect(card?.runState).toBe('running');
  });
});

describe('legacy priority mapping (F0 spec §2.2)', () => {
  const cases: Array<[string, string]> = [
    ['critical', 'superHigh'], ['high', 'high'], ['medium', 'medium'], ['low', 'low'],
  ];
  for (const [legacy, v2] of cases) {
    it(`maps legacy priority "${legacy}"`, async () => {
      const content = `---\ntask_id: T1\npriority: ${legacy}\n---\n# Title\n\nBody.`;
      const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
      expect(card?.priority).toBe(v2);
    });
  }
  it('unrecognized/absent priority falls back to medium', async () => {
    const content = `---\ntask_id: T1\n---\n# Title\n\nBody.`;
    const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
    expect(card?.priority).toBe('medium');
  });
  it('a new v2-only priority (superLow) round-trips', async () => {
    const content = `---\ntask_id: T1\npriority: superLow\n---\n# Title\n\nBody.`;
    const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
    expect(card?.priority).toBe('superLow');
  });
});

describe('body section parsing (F0 spec §1.2)', () => {
  it('a legacy body with no sections is 100% description', async () => {
    const content = `---\ntask_id: T1\n---\n# Title\n\nAll of this is description.\nSecond line.`;
    const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
    expect(card?.description).toBe('All of this is description.\nSecond line.');
    expect(card?.comments).toEqual([]);
    expect(card?.attachments).toEqual([]);
  });

  it('parses ## Attachments and ## Comments sections, case-insensitive, any order', async () => {
    const content = [
      '---', 'task_id: T1', '---',
      '# Title', '',
      'Description text.', '',
      '## comments',
      '- **SecOps** (2026-06-15T09:00:00.000Z): Please use the recommended library.',
      '',
      '## Attachments',
      '- docs/security_audit.pdf',
      '- docs/plan.pdf — Migration plan',
    ].join('\n');
    const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
    expect(card?.description).toBe('Description text.');
    expect(card?.comments).toEqual([
      { author: 'SecOps', date: '2026-06-15T09:00:00.000Z', text: 'Please use the recommended library.' },
    ]);
    expect(card?.attachments.map(a => ({ path: a.path, name: a.name }))).toEqual([
      { path: 'docs/security_audit.pdf', name: 'security_audit.pdf' },
      { path: 'docs/plan.pdf', name: 'Migration plan' },
    ]);
  });

  it('comment text tolerates a colon inside it', async () => {
    const content = [
      '---', 'task_id: T1', '---', '# Title', '', 'Desc.', '',
      '## Comments',
      '- **Ana** (2026-07-01T00:00:00.000Z): Note: check the migration first.',
    ].join('\n');
    const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
    expect(card?.comments[0].text).toBe('Note: check the migration first.');
  });
});

describe('new v2 scalar/array fields + defaults (F0 spec §2.3)', () => {
  it('defaults epic/tags/estimate/assignees/related on a legacy card', async () => {
    const content = `---\ntask_id: T1\n---\n# Title\n\nDesc.`;
    const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
    expect(card?.epic).toBeUndefined();
    expect(card?.tags).toEqual([]);
    expect(card?.estimate).toBe(0);
    expect(card?.assignees).toEqual([]);
    expect(card?.related).toEqual([]);
  });

  it('reads real v2 arrays (tags/assignees/related) as YAML block lists', async () => {
    const content = [
      '---', 'task_id: T1', 'epic: Security', 'tags:', '  - Backend', '  - Auth',
      'assignees:', '  - Ana Dev', 'related:', '  - TASK-101', 'estimate: 16', '---',
      '# Title', '', 'Desc.',
    ].join('\n');
    const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
    expect(card?.epic).toBe('Security');
    expect(card?.tags).toEqual(['Backend', 'Auth']);
    expect(card?.assignees).toEqual(['Ana Dev']);
    expect(card?.related).toEqual(['TASK-101']);
    expect(card?.estimate).toBe(16);
  });

  it('createdAt defaults to file mtime when absent, updatedAt defaults to createdAt', async () => {
    // parseBacklogCard falls back to fs.stat(filePath) — use a real temp file for this one.
    const os = await import('os');
    const fs = await import('fs/promises');
    const path = await import('path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backlog-test-'));
    const file = path.join(dir, 't1.md');
    await fs.writeFile(file, `---\ntask_id: T1\n---\n# Title\n\nDesc.`, 'utf-8');
    const content = await fs.readFile(file, 'utf-8');
    const card = await parseBacklogCard(file, content, { projectRoot: dir });
    expect(card?.createdAt).toBeTruthy();
    expect(card?.updatedAt).toBe(card?.createdAt);
  });
});

describe('serializeBacklogCard (F0 spec §1.5/§2.4)', () => {
  it('emits v2 scalars always, omits empty optional arrays/epic', async () => {
    const card = await parseBacklogCard('/proj/.backlog/t1.md', `---\ntask_id: T1\nstatus: doing\n---\n# Title\n\nDesc.`, { projectRoot: '/proj' });
    const out = serializeBacklogCard(card!, '# Title\n\nDesc.');
    expect(out).toContain('task_id: T1');
    expect(out).toContain('status: doing');
    expect(out).toContain('runState: idle');
    expect(out).toContain('estimate: 0');
    expect(out).not.toMatch(/^epic:/m);
    expect(out).not.toMatch(/^tags:/m);
    expect(out).not.toMatch(/^assignees:/m);
    expect(out).not.toMatch(/^related:/m);
  });

  it('preserves the body verbatim (title + description + sections)', async () => {
    const body = '# Title\n\nDesc.\n\n## Comments\n- **A** (2026-01-01T00:00:00.000Z): hi';
    const card = await parseBacklogCard('/proj/.backlog/t1.md', `---\ntask_id: T1\n---\n${body}`, { projectRoot: '/proj' });
    const out = serializeBacklogCard(card!, body);
    expect(out.endsWith(body)).toBe(true);
  });

  it('emits tags/assignees/related as YAML block lists when present', async () => {
    const content = `---\ntask_id: T1\ntags:\n  - Backend\n---\n# Title\n\nDesc.`;
    const card = await parseBacklogCard('/proj/.backlog/t1.md', content, { projectRoot: '/proj' });
    const out = serializeBacklogCard(card!, '# Title\n\nDesc.');
    expect(out).toMatch(/tags:\n\s*-\s*Backend/);
  });
});
