import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// mcp-command-policy.ts (the MCP command allowlist, audit 1.4) reads settings-store
// for user-approved commands. electron-store calls electron's app.getPath()
// internally, which is unavailable outside a running Electron process — stand in
// with an always-empty approval list (no test below approves a command).
vi.mock('../storage/settings-store', () => ({
  settingsGet: (key: string) => (key === 'approvedMcpCommands' ? [] : undefined),
  settingsSet: () => { /* no-op — nothing in this file approves a command */ },
}));

import { createLocalMcpClient, createLocalMcpToolSet, createRemoteMcpToolSet, type McpFileSystem } from './mcp-adapter';

let rootDir: string;

describe('local MCP adapter', () => {
  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'fluxor-mcp-'));
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

  it('uses an injected filesystem instead of Node fs when provided', async () => {
    const files = new Map<string, string>([
      ['/workspace/README.md', 'hello from injected fs'],
    ]);
    const directories = new Map<string, string[]>([
      ['/workspace', ['README.md', 'src']],
      ['/workspace/src', []],
    ]);
    const fileSystem: McpFileSystem = {
      readFile: async (path: string) => files.get(path) ?? '',
      writeFile: async (path: string, content: string) => {
        files.set(path, content);
      },
      mkdir: async (path: string) => {
        directories.set(path, directories.get(path) ?? []);
      },
      readdir: async (path: string) => directories.get(path) ?? [],
      stat: async (path: string) => ({
        isDirectory: () => directories.has(path),
        isFile: () => files.has(path),
        size: Buffer.byteLength(files.get(path) ?? '', 'utf-8'),
      }),
    };

    const client = createLocalMcpClient({
      rootDir: '/workspace',
      fileSystem,
    });

    const readResult = await client.callTool('read_file', { path: 'README.md' });
    expect(readResult.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('hello from injected fs'),
    });

    await client.callTool('write_file', { path: 'src/result.txt', content: 'kept in memory' });
    expect(files.get('/workspace/src/result.txt')).toBe('kept in memory');
    await expect(readFile('/workspace/src/result.txt', 'utf-8')).rejects.toThrow();
  });

  it('intercepts verification reads after a successful write when enabled', async () => {
    const calls: string[] = [];
    const files = new Map<string, string>();
    const fileSystem: McpFileSystem = {
      readFile: async (path: string) => {
        calls.push(`read:${path}`);
        return files.get(path) ?? '';
      },
      writeFile: async (path: string, content: string) => {
        calls.push(`write:${path}`);
        files.set(path, content);
      },
      mkdir: async (path: string) => {
        calls.push(`mkdir:${path}`);
      },
      readdir: async (path: string) => {
        calls.push(`list:${path}`);
        return [];
      },
      stat: async () => ({
        isDirectory: () => false,
        isFile: () => true,
        size: 0,
      }),
    };
    const telemetry: string[] = [];
    const client = createLocalMcpClient({
      rootDir: '/workspace',
      fileSystem,
      antiVerificationInterceptor: true,
      telemetrySink: (event) => telemetry.push(event.status),
    });

    await client.callTool('write_file', { path: 'src/server.js', content: 'ok' });
    const listResult = await client.callTool('list_directory', { path: 'src' });
    const readResult = await client.callTool('read_file', { path: 'src/server.js' });

    expect(listResult.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('System Mod Interception'),
    });
    expect(readResult.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Trust the previous write_file success'),
    });
    expect(calls).toEqual([
      'mkdir:/workspace/src',
      'write:/workspace/src/server.js',
    ]);
    expect(telemetry).toEqual(['success', 'intercepted', 'intercepted']);
  });
});

describe('createRemoteMcpToolSet — MCP command allowlist (audit 1.4)', () => {
  // The allowlist check runs BEFORE the StdioClientTransport is constructed, so
  // a blocked command never spawns a process — this stays fast/hermetic and
  // never touches the network, unlike testing an *allowed* stdio command would.
  it('blocks a non-curated, unapproved stdio command without throwing to the caller', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await createRemoteMcpToolSet({
      type: 'stdio',
      command: 'rm',
      args: ['-rf', '/'],
    });

    expect(result.tools).toEqual({});
    expect(result.blockedCommand).toMatchObject({
      command: 'rm',
      args: ['-rf', '/'],
    });
    expect(result.blockedCommand?.message).toContain('rm -rf /');
    await expect(result.close()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('MCP server command blocked'));

    warnSpy.mockRestore();
  });
});
