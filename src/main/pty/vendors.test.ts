/**
 * vendors.test.ts — Unit tests for the agent vendor registry
 *
 * What is pinned here:
 *   1. argv per vendor — including the one that must NOT carry the prompt.
 *   2. `FLUXOR_AGENT_BIN_<ID>` overriding the binary (the e2e seam).
 *   3. `detectVendors` answering, never throwing, with a mocked `which`.
 *
 * Mocking strategy: `execFile` is injected, so no process is ever spawned and
 * the module stays free of the native `node-pty` binding.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_VENDORS,
  AGENT_VENDOR_IDS,
  detectVendors,
  resolveVendorBin,
  resolveVendorExtraArgs,
  vendorBinEnvVar,
  vendorExtraArgsEnvVar,
  whichBin,
  type ExecFileFn,
} from './vendors';

/** A `which` that succeeds for the listed binaries and fails for anything else. */
function fakeWhich(installed: Record<string, string>): ExecFileFn {
  return vi.fn(async (_file: string, args: string[]) => {
    const bin = args[0];
    if (bin in installed) return { stdout: `${installed[bin]}\n`, stderr: '' };
    throw new Error(`${bin} not found`);
  });
}

describe('AGENT_VENDORS — argv', () => {
  it('passes the prompt as a trailing positional for claude and codex', () => {
    expect(AGENT_VENDORS.claude.buildArgs({ prompt: 'do the thing' })).toEqual(['do the thing']);
    expect(AGENT_VENDORS.codex.buildArgs({ prompt: 'do the thing' })).toEqual(['do the thing']);
  });

  it('keeps extra args before the positional prompt', () => {
    expect(AGENT_VENDORS.claude.buildArgs({ prompt: 'p', extraArgs: ['--verbose'] }))
      .toEqual(['--verbose', 'p']);
  });

  it('omits the prompt entirely when there is none', () => {
    expect(AGENT_VENDORS.claude.buildArgs({})).toEqual([]);
    expect(AGENT_VENDORS.codex.buildArgs({ extraArgs: ['-x'] })).toEqual(['-x']);
  });

  it('NEVER puts the prompt in opencode argv — its positional is a directory', () => {
    // Regression guard with teeth: `opencode <prompt>` would silently change
    // the working directory instead of asking anything.
    expect(AGENT_VENDORS.opencode.promptDelivery).toBe('type');
    expect(AGENT_VENDORS.opencode.buildArgs({ prompt: 'do the thing' })).toEqual([]);
  });

  it('passes gemini its prompt with -i', () => {
    expect(AGENT_VENDORS.gemini.buildArgs({ prompt: 'p' })).toEqual(['-i', 'p']);
  });

  it('declares every id exactly once, keyed by its own id', () => {
    expect(AGENT_VENDOR_IDS).toEqual(['claude', 'codex', 'opencode', 'gemini']);
    for (const id of AGENT_VENDOR_IDS) expect(AGENT_VENDORS[id].id).toBe(id);
  });
});

describe('resolveVendorBin', () => {
  it('uses the vendor default when nothing overrides it', () => {
    expect(resolveVendorBin(AGENT_VENDORS.claude, {})).toBe('claude');
  });

  it('honours FLUXOR_AGENT_BIN_<ID>, upper-cased', () => {
    expect(vendorBinEnvVar('claude')).toBe('FLUXOR_AGENT_BIN_CLAUDE');
    expect(resolveVendorBin(AGENT_VENDORS.claude, { FLUXOR_AGENT_BIN_CLAUDE: '/tmp/fake-agent.sh' }))
      .toBe('/tmp/fake-agent.sh');
  });

  it('ignores a blank override rather than trying to spawn an empty string', () => {
    expect(resolveVendorBin(AGENT_VENDORS.codex, { FLUXOR_AGENT_BIN_CODEX: '   ' })).toBe('codex');
  });

  it('scopes the override to its own vendor', () => {
    const env = { FLUXOR_AGENT_BIN_CLAUDE: '/tmp/fake' };
    expect(resolveVendorBin(AGENT_VENDORS.codex, env)).toBe('codex');
  });
});

describe('resolveVendorExtraArgs', () => {
  it('is empty when nothing is set', () => {
    expect(resolveVendorExtraArgs('claude', {})).toEqual([]);
  });

  it('names its variable per vendor, upper-cased', () => {
    expect(vendorExtraArgsEnvVar('claude')).toBe('FLUXOR_AGENT_EXTRA_ARGS_CLAUDE');
    expect(vendorExtraArgsEnvVar('opencode')).toBe('FLUXOR_AGENT_EXTRA_ARGS_OPENCODE');
  });

  it('splits on whitespace, collapsing runs and trimming the ends', () => {
    expect(resolveVendorExtraArgs('claude', {
      FLUXOR_AGENT_EXTRA_ARGS_CLAUDE: '  --permission-mode   bypassPermissions --model haiku ',
    })).toEqual(['--permission-mode', 'bypassPermissions', '--model', 'haiku']);
  });

  it('treats a blank value as unset rather than as one empty argument', () => {
    expect(resolveVendorExtraArgs('codex', { FLUXOR_AGENT_EXTRA_ARGS_CODEX: '   ' })).toEqual([]);
  });

  it('scopes to its own vendor', () => {
    const env = { FLUXOR_AGENT_EXTRA_ARGS_CLAUDE: '--model haiku' };
    expect(resolveVendorExtraArgs('codex', env)).toEqual([]);
  });

  it('does NOT honour quotes — the documented limit of the seam', () => {
    // Pinned rather than fixed: implementing quoting here would be a second,
    // subtly different shell parser in front of a spawn that never uses a
    // shell. An argument with a space belongs in the vendor registry.
    expect(resolveVendorExtraArgs('claude', {
      FLUXOR_AGENT_EXTRA_ARGS_CLAUDE: '--append-system-prompt "be brief"',
    })).toEqual(['--append-system-prompt', '"be', 'brief"']);
  });

  it('lands before the positional prompt when the registry builds argv', () => {
    const extra = resolveVendorExtraArgs('claude', { FLUXOR_AGENT_EXTRA_ARGS_CLAUDE: '--model haiku' });
    expect(AGENT_VENDORS.claude.buildArgs({ prompt: 'p', extraArgs: [...extra, '--session-id', 'u'] }))
      .toEqual(['--model', 'haiku', '--session-id', 'u', 'p']);
  });
});

describe('whichBin', () => {
  it('returns the resolved absolute path', async () => {
    await expect(whichBin('claude', fakeWhich({ claude: '/usr/local/bin/claude' })))
      .resolves.toBe('/usr/local/bin/claude');
  });

  it('returns null instead of throwing when the binary is absent', async () => {
    await expect(whichBin('gemini', fakeWhich({}))).resolves.toBeNull();
  });

  it('returns null on an empty answer', async () => {
    const empty: ExecFileFn = async () => ({ stdout: '\n', stderr: '' });
    await expect(whichBin('claude', empty)).resolves.toBeNull();
  });
});

describe('detectVendors', () => {
  it('reports availability per vendor and never rejects', async () => {
    const found = await detectVendors(
      fakeWhich({ claude: '/usr/local/bin/claude', codex: '/opt/codex' }),
      {},
    );
    expect(found).toEqual([
      { id: 'claude', label: 'Claude Code', available: true, path: '/usr/local/bin/claude' },
      { id: 'codex', label: 'Codex', available: true, path: '/opt/codex' },
      { id: 'opencode', label: 'OpenCode', available: false },
      { id: 'gemini', label: 'Gemini CLI', available: false },
    ]);
  });

  it('probes the OVERRIDDEN binary, not the vendor default', async () => {
    const which = fakeWhich({ '/tmp/fake-agent.sh': '/tmp/fake-agent.sh' });
    const found = await detectVendors(which, { FLUXOR_AGENT_BIN_CLAUDE: '/tmp/fake-agent.sh' });
    expect(found.find((v) => v.id === 'claude')).toEqual({
      id: 'claude', label: 'Claude Code', available: true, path: '/tmp/fake-agent.sh',
    });
    expect(which).toHaveBeenCalledWith('which', ['/tmp/fake-agent.sh']);
  });

  it('answers "not installed" rather than propagating the probe failure', async () => {
    const exploding: ExecFileFn = async () => { throw new Error('boom'); };
    const found = await detectVendors(exploding, {});
    expect(found.every((v) => v.available === false)).toBe(true);
  });
});
