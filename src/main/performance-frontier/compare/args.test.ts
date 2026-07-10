import { describe, expect, it } from 'vitest';
import { parseCompareArgs } from './args';

describe('parseCompareArgs', () => {
  // Edge: valores de flag inválidos — missing required --seed.
  it('throws when --seed is missing', () => {
    expect(() => parseCompareArgs(['node', 'cli.js'])).toThrow(/--seed=<n> is required/);
  });

  it('throws when --seed is non-numeric', () => {
    expect(() => parseCompareArgs(['--seed=abc'])).toThrow(/--seed must be a finite number, got "abc"/);
  });

  it('parses a valid --seed with no --suites', () => {
    expect(parseCompareArgs(['--seed=7'])).toEqual({ seed: 7 });
  });

  it('accepts a negative or zero seed as a valid finite number', () => {
    expect(parseCompareArgs(['--seed=0'])).toEqual({ seed: 0 });
    expect(parseCompareArgs(['--seed=-3'])).toEqual({ seed: -3 });
  });

  it('parses a single --suites value', () => {
    expect(parseCompareArgs(['--seed=7', '--suites=team-work'])).toEqual({ seed: 7, suites: ['team-work'] });
  });

  it('parses a comma-separated --suites list, trimming whitespace', () => {
    expect(parseCompareArgs(['--seed=7', '--suites=team-work, progression'])).toEqual({
      seed: 7,
      suites: ['team-work', 'progression'],
    });
  });

  it('resolves suite aliases the same way pf:run/pf:bench do', () => {
    expect(parseCompareArgs(['--seed=1', '--suites=assembler,business'])).toEqual({
      seed: 1,
      suites: ['flow-assembler', 'business-knowledge'],
    });
  });

  // Edge: valores de flag inválidos — unknown suite name.
  it('throws a clear error for an unknown suite name', () => {
    expect(() => parseCompareArgs(['--seed=1', '--suites=not-a-real-suite'])).toThrow(
      /Invalid PF suite "not-a-real-suite" in --suites/,
    );
  });

  it('throws for an empty --suites value rather than silently comparing nothing', () => {
    expect(() => parseCompareArgs(['--seed=1', '--suites='])).toThrow(/--suites was provided but empty/);
  });

  it('throws for a --suites value that is only commas/whitespace', () => {
    expect(() => parseCompareArgs(['--seed=1', '--suites= , ,'])).toThrow(/--suites was provided but empty/);
  });
});
