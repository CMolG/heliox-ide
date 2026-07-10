import { describe, expect, it, vi } from 'vitest';
import { parseContextModeFlag, warnIfContextModeIsNoop } from './context-mode-flag';

describe('parseContextModeFlag', () => {
  it('returns undefined when the flag is absent (default: whatever the flow itself carries)', () => {
    expect(parseContextModeFlag(['node', 'cli.js', '--suite=team-work'])).toBeUndefined();
  });

  it('parses "blind"', () => {
    expect(parseContextModeFlag(['--context-mode=blind'])).toBe('blind');
  });

  it('parses "feedback"', () => {
    expect(parseContextModeFlag(['--context-mode=feedback'])).toBe('feedback');
  });

  // Edge: valores de flag inválidos — must fail loudly with a clear, actionable message.
  it('throws a clear error for an invalid value', () => {
    expect(() => parseContextModeFlag(['--context-mode=sandbox'])).toThrow(
      /Invalid --context-mode "sandbox"\. Expected one of: blind, feedback\./,
    );
  });

  // Edge: empty string after "=" is still an invalid value, not "absent".
  it('throws for an empty value rather than treating it as absent', () => {
    expect(() => parseContextModeFlag(['--context-mode='])).toThrow(/Invalid --context-mode ""/);
  });

  it('is case-sensitive (does not silently accept "Blind")', () => {
    expect(() => parseContextModeFlag(['--context-mode=Blind'])).toThrow(/Invalid --context-mode "Blind"/);
  });

  it('picks the flag out of a larger argv array regardless of position', () => {
    expect(parseContextModeFlag(['node', 'cli.js', '--seed=7', '--context-mode=feedback', '--suite=progression']))
      .toBe('feedback');
  });
});

describe('warnIfContextModeIsNoop', () => {
  it('warns when --context-mode is set for the flow-assembler suite (suite sin flow)', () => {
    const log = vi.fn();
    warnIfContextModeIsNoop('flow-assembler', 'feedback', log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('flow-assembler');
    expect(log.mock.calls[0][0]).toContain('--context-mode=feedback');
  });

  it('does not warn when contextMode is undefined (flag not passed)', () => {
    const log = vi.fn();
    warnIfContextModeIsNoop('flow-assembler', undefined, log);
    expect(log).not.toHaveBeenCalled();
  });

  it('does not warn when suite is undefined (CLI default resolves to architecture, which runs a flow)', () => {
    const log = vi.fn();
    warnIfContextModeIsNoop(undefined, 'feedback', log);
    expect(log).not.toHaveBeenCalled();
  });

  it.each(['architecture', 'analysis', 'design', 'business-knowledge', 'team-work', 'development', 'progression', 'from-scratch'] as const)(
    'does not warn for suite "%s" (it does execute an AgenticFlow)',
    (suite) => {
      const log = vi.fn();
      warnIfContextModeIsNoop(suite, 'blind', log);
      expect(log).not.toHaveBeenCalled();
    },
  );
});
