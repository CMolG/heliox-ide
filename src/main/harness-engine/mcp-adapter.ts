/**
 * mcp-adapter.ts — Local MCP-compatible filesystem tools
 *
 * The harness exposes a small, root-scoped filesystem surface to LLMs. Tool
 * definitions are shaped like MCP tools and mapped into Vercel AI SDK tools.
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'path';
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { CallToolResult, Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';

const DEFAULT_MAX_READ_BYTES = 1024 * 1024;

const pathSchema = z.string().min(1).describe('Path relative to the harness project root.');
const optionalPathSchema = z.string().optional().describe('Directory path relative to the harness project root.');

const listDirectorySchema = z.object({
  path: optionalPathSchema,
});

const readFileSchema = z.object({
  path: pathSchema,
  maxBytes: z.number().int().positive().max(DEFAULT_MAX_READ_BYTES).optional(),
});

const writeFileSchema = z.object({
  path: pathSchema,
  content: z.string(),
});

type LocalToolName = 'list_directory' | 'read_file' | 'write_file';

interface LocalMcpToolDefinition {
  mcpTool: McpTool;
  parameters: z.ZodTypeAny;
  call: (args: unknown) => Promise<unknown>;
}

export interface LocalMcpClient {
  rootDir: string;
  listTools: () => Promise<McpTool[]>;
  callTool: (name: string, args: unknown) => Promise<CallToolResult>;
}

export interface LocalMcpOptions {
  rootDir?: string;
}

function textResult(value: unknown): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
    }],
  };
}

function toolResultToText(output: CallToolResult): string {
  return output.content.map((part: CallToolResult['content'][number]) => (
    'text' in part ? part.text : JSON.stringify(part)
  )).join('\n');
}

function resolveWithinRoot(rootDir: string, inputPath = '.'): string {
  const root = resolve(rootDir);
  const target = resolve(root, inputPath);
  const relativeTarget = relative(root, target);

  if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
    throw new Error(`Path "${inputPath}" is outside the harness root.`);
  }

  return target;
}

function relativeToRoot(rootDir: string, targetPath: string): string {
  return relative(resolve(rootDir), targetPath) || '.';
}

function createToolDefinitions(rootDir: string): Record<LocalToolName, LocalMcpToolDefinition> {
  return {
    list_directory: {
      mcpTool: {
        name: 'list_directory',
        title: 'List directory',
        description: 'List files and directories under the harness project root.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative directory path. Defaults to project root.' },
          },
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      parameters: listDirectorySchema,
      call: async (args) => {
        const parsed = listDirectorySchema.parse(args);
        const dirPath = resolveWithinRoot(rootDir, parsed.path ?? '.');
        const entries = await readdir(dirPath);
        const results = await Promise.all(entries.map(async (name) => {
          const entryPath = resolveWithinRoot(rootDir, relativeToRoot(rootDir, resolve(dirPath, name)));
          const entryStat = await stat(entryPath);
          return {
            name,
            path: relativeToRoot(rootDir, entryPath),
            isDirectory: entryStat.isDirectory(),
            size: entryStat.isFile() ? entryStat.size : undefined,
          };
        }));
        return { path: relativeToRoot(rootDir, dirPath), entries: results };
      },
    },
    read_file: {
      mcpTool: {
        name: 'read_file',
        title: 'Read file',
        description: 'Read a UTF-8 text file under the harness project root.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path.' },
            maxBytes: { type: 'number', description: 'Maximum bytes to read.' },
          },
          required: ['path'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      parameters: readFileSchema,
      call: async (args) => {
        const parsed = readFileSchema.parse(args);
        const filePath = resolveWithinRoot(rootDir, parsed.path);
        const content = await readFile(filePath, 'utf-8');
        const maxBytes = parsed.maxBytes ?? DEFAULT_MAX_READ_BYTES;
        const sliced = content.slice(0, maxBytes);
        return {
          path: relativeToRoot(rootDir, filePath),
          content: sliced,
          truncated: content.length > sliced.length,
        };
      },
    },
    write_file: {
      mcpTool: {
        name: 'write_file',
        title: 'Write file',
        description: 'Write a UTF-8 text file under the harness project root.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative file path.' },
            content: { type: 'string', description: 'Complete UTF-8 file contents.' },
          },
          required: ['path', 'content'],
        },
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
      parameters: writeFileSchema,
      call: async (args) => {
        const parsed = writeFileSchema.parse(args);
        const filePath = resolveWithinRoot(rootDir, parsed.path);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, parsed.content, 'utf-8');
        return {
          path: relativeToRoot(rootDir, filePath),
          bytesWritten: Buffer.byteLength(parsed.content, 'utf-8'),
        };
      },
    },
  };
}

export function createLocalMcpClient(options: LocalMcpOptions = {}): LocalMcpClient {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const definitions = createToolDefinitions(rootDir);

  return {
    rootDir,
    listTools: async () => Object.values(definitions).map((definition) => definition.mcpTool),
    callTool: async (name, args) => {
      const definition = definitions[name as LocalToolName];
      if (!definition) throw new Error(`Unknown MCP tool "${name}".`);
      return textResult(await definition.call(args));
    },
  };
}

export function createLocalMcpToolSet(options: LocalMcpOptions = {}): ToolSet {
  const client = createLocalMcpClient(options);
  const definitions = createToolDefinitions(client.rootDir);

  return Object.fromEntries(
    Object.values(definitions).map((definition) => [
      definition.mcpTool.name,
      tool({
        description: definition.mcpTool.description,
        inputSchema: definition.parameters,
        execute: (args) => client.callTool(definition.mcpTool.name, args),
        toModelOutput: ({ output }) => ({
          type: 'text',
          value: toolResultToText(output),
        }),
      }),
    ]),
  );
}
