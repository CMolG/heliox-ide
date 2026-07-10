/**
 * mcp-command-policy.ts — Stdio MCP command allowlist + consent (audit 1.4)
 *
 * Closes the RCE surface in mcp-adapter.ts: a stdio MCP server config is just a
 * `command` + `args` pair spawned as a child process (createRemoteMcpToolSet).
 * Without a check, a malicious market/flow item declaring a `tool_provider` mod
 * could spawn arbitrary binaries. This module is the policy the spawn boundary
 * consults before it is allowed to construct a StdioClientTransport.
 *
 * A stdio command may spawn only if:
 *   (a) it matches a curated `mcp-directory` entry (same command, and its args
 *       are a prefix of the curated entry's args — extra trailing args, like a
 *       custom target directory, are tolerated; anything inside the curated
 *       prefix window must match exactly), OR
 *   (b) the exact command+args was previously approved by the user and
 *       persisted via settings-store (`approvedMcpCommands`), OR
 *   (c) FLUXOR_MCP_ALLOW_ALL=1 is set (legacy compat: HELIOX_MCP_ALLOW_ALL,
 *       deprecated) — an escape hatch for local dev/tests only; every use is
 *       logged loudly.
 *
 * Enforcement lives in the main process (mcp-adapter.ts), so it cannot be
 * bypassed from the renderer — the renderer only ever reaches this through the
 * mcp:* IPC channels registered below.
 */
import { ipcMain } from 'electron';
import { getMcpDirectory } from '../market/mcp-directory';
import { settingsGet, settingsSet } from '../storage/settings-store';
import { readBrandEnv } from '../lib/env-compat';

// ---------------------------------------------------------------------------
// Typed rejection error
// ---------------------------------------------------------------------------

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ').trim();
}

/**
 * Thrown by `assertMcpCommandAllowed` when a stdio command is neither curated
 * nor approved. Carries the exact command + args so callers (and, ultimately,
 * the step status log the user sees) can show actionable approval instructions
 * instead of a generic connection failure.
 */
export class MCPCommandBlockedError extends Error {
  readonly command: string;
  readonly args: string[];

  constructor(command: string, args: string[]) {
    super(
      `MCP server command blocked: "${formatCommand(command, args)}" is not in the curated MCP ` +
      'directory and has not been approved. Approve it via the mcp:approveCommand IPC channel ' +
      '(Settings > MCP Servers), or set FLUXOR_MCP_ALLOW_ALL=1 for local dev/testing only.',
    );
    this.name = 'MCPCommandBlockedError';
    this.command = command;
    this.args = args;
  }
}

// ---------------------------------------------------------------------------
// Matching rules
// ---------------------------------------------------------------------------

function argsPrefixMatches(candidateArgs: string[], curatedArgs: string[]): boolean {
  if (candidateArgs.length < curatedArgs.length) return false;
  return curatedArgs.every((arg, i) => candidateArgs[i] === arg);
}

function argsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** True when `command`+`args` matches a curated stdio entry (conservative prefix match). */
export function matchesCuratedDirectory(command: string, args: string[]): boolean {
  return getMcpDirectory().some((entry) => (
    entry.install.type === 'stdio'
    && entry.install.command === command
    && argsPrefixMatches(args, entry.install.args ?? [])
  ));
}

function isAllowAllEscapeHatchEnabled(): boolean {
  return readBrandEnv('FLUXOR_MCP_ALLOW_ALL') === '1';
}

// ---------------------------------------------------------------------------
// User-approved commands (persisted via settings-store)
// ---------------------------------------------------------------------------

export interface ApprovedMcpCommand {
  command: string;
  args: string[];
  approvedAt: string;
}

export function listApprovedMcpCommands(): ApprovedMcpCommand[] {
  return settingsGet('approvedMcpCommands');
}

/** True when `command`+`args` was previously approved (exact match, order-sensitive). */
export function isMcpCommandApproved(command: string, args: string[]): boolean {
  return listApprovedMcpCommands().some((entry) => (
    entry.command === command && argsEqual(entry.args, args)
  ));
}

/** Approve a command+args pair. Idempotent — re-approving refreshes `approvedAt`. */
export function approveMcpCommand(command: string, args: string[] = []): ApprovedMcpCommand[] {
  const rest = listApprovedMcpCommands().filter((entry) => (
    !(entry.command === command && argsEqual(entry.args, args))
  ));
  const next = [...rest, { command, args, approvedAt: new Date().toISOString() }];
  settingsSet('approvedMcpCommands', next);
  return next;
}

/** Revoke a previously approved command+args pair. No-op if it was never approved. */
export function revokeMcpCommand(command: string, args: string[] = []): ApprovedMcpCommand[] {
  const next = listApprovedMcpCommands().filter((entry) => (
    !(entry.command === command && argsEqual(entry.args, args))
  ));
  settingsSet('approvedMcpCommands', next);
  return next;
}

// ---------------------------------------------------------------------------
// The spawn-boundary guard
// ---------------------------------------------------------------------------

/**
 * Throws `MCPCommandBlockedError` unless `command`+`args` is curated, approved,
 * or the env escape hatch is set. Call this immediately before constructing a
 * StdioClientTransport — never after.
 */
export function assertMcpCommandAllowed(command: string, args: string[] = []): void {
  if (isAllowAllEscapeHatchEnabled()) {
    console.warn(
      `[mcp-command-policy] FLUXOR_MCP_ALLOW_ALL=1 — bypassing the MCP command allowlist for ` +
      `"${formatCommand(command, args)}". This escape hatch is for local dev/tests only and must ` +
      'never be set in a distributed build.',
    );
    return;
  }

  if (matchesCuratedDirectory(command, args)) return;
  if (isMcpCommandApproved(command, args)) return;

  throw new MCPCommandBlockedError(command, args);
}

// ---------------------------------------------------------------------------
// IPC — renderer surface (main process only; settings persist via electron-store)
// ---------------------------------------------------------------------------

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let ipcRegistered = false;

/** Register mcp:listApprovedCommands / mcp:approveCommand / mcp:revokeCommand (idempotent). */
export function registerMcpCommandPolicyIpcHandlers(): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('mcp:listApprovedCommands', () => {
    try {
      return { success: true, data: listApprovedMcpCommands() };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('mcp:approveCommand', (_event, command: string, args: string[] = []) => {
    if (typeof command !== 'string' || command.trim().length === 0) {
      return { success: false, error: 'command must be a non-empty string.' };
    }
    try {
      return { success: true, data: approveMcpCommand(command, Array.isArray(args) ? args : []) };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('mcp:revokeCommand', (_event, command: string, args: string[] = []) => {
    if (typeof command !== 'string' || command.trim().length === 0) {
      return { success: false, error: 'command must be a non-empty string.' };
    }
    try {
      return { success: true, data: revokeMcpCommand(command, Array.isArray(args) ? args : []) };
    } catch (err) {
      return { success: false, error: errMsg(err) };
    }
  });
}
