import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalMcpClient, createLocalMcpToolSet } from './mcp-adapter';

let rootDir: string;

describe('local MCP adapter', () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'heliox-mcp-'));
    await writeFile(join(rootDir, 'README.md'), 'hello', 'utf-8');
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('lists and calls filesystem tools through an MCP-like client', async () => {
    const client = createLocalMcpClient({ rootDir });
    const tools = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'list_directory',
      'read_file',
      'write_file',
    ]);

    const result = await client.callTool('read_file', { path: 'README.md' });
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('hello'),
    });
  });

  it('blocks path traversal outside the configured root', async () => {
    const client = createLocalMcpClient({ rootDir });

    await expect(client.callTool('read_file', { path: '../secret.txt' }))
      .rejects
      .toThrow('outside the harness root');
  });

  it('maps MCP tools into executable AI SDK tools', async () => {
    const tools = createLocalMcpToolSet({ rootDir });
    const result = await tools.write_file.execute?.(
      { path: 'src/output.txt', content: 'created by tool' },
      { toolCallId: 'tool-1', messages: [] },
    );

    expect(result?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('bytesWritten'),
    });
    await expect(readFile(join(rootDir, 'src/output.txt'), 'utf-8'))
      .resolves
      .toBe('created by tool');
  });
});
