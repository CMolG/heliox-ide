/**
 * AiComposer.test.ts — Unit tests for the RISEN Mega-Prompt Engine
 *
 * Validates section ordering, backward-compatible bridge methods,
 * cognitive algorithm injection, and output contract formatting.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prompt dependencies before importing AiComposer
vi.mock('@/renderer/logic/ai/prompts/StupidityPrelude', () => ({
  getPrelude: (stupidity: boolean) => stupidity ? 'STUPIDITY_ON' : 'STANDARD',
  getPreludeVersion: () => '1.0.0',
}));

vi.mock('@/renderer/logic/ai/prompts/PromptVersionRegistry', () => ({
  promptRegistry: { registerSync: vi.fn() },
}));

vi.mock('@/renderer/logic/ai/memory/MemoryComposerPlugin', () => ({
  MemoryComposerPlugin: { compose: (p: unknown) => 'MEMORY_SECTION' },
}));

import { AiComposer } from '@/renderer/logic/ai/AiComposer';

describe('AiComposer (RISEN Engine)', () => {
  const SEP = '\n\n=========================================\n\n';

  // ── Basic compose ──────────────────────────────────────────────

  it('composes minimal prompt with prelude and mandate', () => {
    const result = new AiComposer('Do something').compose();
    expect(result).toContain('[PRELUDE]');
    expect(result).toContain('[2. THE MANDATE - MASTER OBJECTIVE]');
    expect(result).toContain('Do something');
  });

  it('uses heavy visual separator between sections', () => {
    const result = new AiComposer('task').compose();
    expect(result).toContain('=========================================');
  });

  // ── Section ordering ───────────────────────────────────────────

  it('places MASK before MANDATE and MANDATE before PRISON', () => {
    const result = new AiComposer('task')
      .withPersona('You are a genius')
      .withStrictConstraints(['No shortcuts'])
      .compose();

    const maskIdx = result.indexOf('[1. THE MASK');
    const mandateIdx = result.indexOf('[2. THE MANDATE');
    const prisonIdx = result.indexOf('[4. THE LOGICAL PRISON');

    expect(maskIdx).toBeGreaterThan(-1);
    expect(mandateIdx).toBeGreaterThan(maskIdx);
    expect(prisonIdx).toBeGreaterThan(mandateIdx);
  });

  // ── Persona (The Mask) ─────────────────────────────────────────

  it('includes persona profile in THE MASK section', () => {
    const result = new AiComposer('task')
      .withPersona('Senior Architect')
      .compose();
    expect(result).toContain('[1. THE MASK - PERSONA PROFILE]');
    expect(result).toContain('Senior Architect');
  });

  it('omits MASK when no persona is set', () => {
    const result = new AiComposer('task').compose();
    expect(result).not.toContain('[1. THE MASK');
  });

  // ── Backward-Compatible Bridge ─────────────────────────────────

  it('withRole() maps to persona profile (bridge)', () => {
    const result = new AiComposer('task')
      .withRole('You are a React expert')
      .compose();
    expect(result).toContain('[1. THE MASK - PERSONA PROFILE]');
    expect(result).toContain('You are a React expert');
  });

  it('withMods() maps to strict constraints (bridge)', () => {
    const result = new AiComposer('task')
      .withMods(['Focus on accessibility', 'Minimize size'])
      .compose();
    expect(result).toContain('[4. THE LOGICAL PRISON');
    expect(result).toContain('Focus on accessibility');
    expect(result).toContain('Minimize size');
  });

  // ── Cognitive Algorithm ────────────────────────────────────────

  it('includes cognitive steps section when steps are provided', () => {
    const result = new AiComposer('task')
      .withCognitiveSteps(['Analyze', 'Design', 'Implement'])
      .compose();
    expect(result).toContain('[3. THE COGNITIVE ALGORITHM');
    expect(result).toContain('1. Analyze');
    expect(result).toContain('2. Design');
    expect(result).toContain('3. Implement');
    expect(result).toContain('<step_by_step_reasoning>');
  });

  it('omits algorithm section when no steps', () => {
    const result = new AiComposer('task').compose();
    expect(result).not.toContain('[3. THE COGNITIVE ALGORITHM');
  });

  // ── Strict Constraints (The Logical Prison) ────────────────────

  it('aggregates constraints under ABSOLUTE RULES', () => {
    const result = new AiComposer('task')
      .withStrictConstraints(['No AWS', 'Under 500 words'])
      .compose();
    expect(result).toContain('[ABSOLUTE RULES]');
    expect(result).toContain('- No AWS');
    expect(result).toContain('- Under 500 words');
  });

  it('includes design system in prison section', () => {
    const result = new AiComposer('task')
      .withDesignSystem('Use Tailwind tokens')
      .compose();
    expect(result).toContain('[DESIGN SYSTEM]');
    expect(result).toContain('Use Tailwind tokens');
  });

  it('includes memory section', () => {
    const result = new AiComposer('task')
      .withMemory('Prefers functional components')
      .compose();
    expect(result).toContain('[LEARNED PREFERENCES (MEMORY)]');
    expect(result).toContain('Prefers functional components');
  });

  it('includes context digest', () => {
    const result = new AiComposer('task')
      .withContextDigest('Project uses React 19')
      .compose();
    expect(result).toContain('[PROJECT CONTEXT DIGEST]');
    expect(result).toContain('Project uses React 19');
  });

  // ── Output Contract ────────────────────────────────────────────

  it('includes output contract when withOutputSchema is called', () => {
    const result = new AiComposer('task')
      .withOutputSchema()
      .compose();
    expect(result).toContain('[5. THE OUTPUT CONTRACT - STRICT FORMAT]');
    expect(result).toContain('step_by_step_reasoning');
    expect(result).toContain('"filesChanged"');
  });

  it('omits output contract when not requested', () => {
    const result = new AiComposer('task').compose();
    expect(result).not.toContain('[5. THE OUTPUT CONTRACT');
  });

  // ── Feedback (Auto-correction) ─────────────────────────────────

  it('injects feedback alert in mandate section', () => {
    const result = new AiComposer('task')
      .withFeedback({
        snapshotDiff: {} as any,
        violations: [{
          metric: 'lcp' as any,
          before: 1200,
          after: 2500,
          deltaPct: 108,
          threshold: 10,
          likelyCause: 'Heavy render',
        }],
        instruction: 'Fix the regression',
        attemptNumber: 2,
      })
      .compose();
    expect(result).toContain('AUTO-CORRECTION ALERT (Attempt 2/3)');
    expect(result).toContain('lcp: 1200 -> 2500');
    expect(result).toContain('Heavy render');
    expect(result).toContain('Correction instruction: Fix the regression');
  });

  // ── Stupidity Mode ─────────────────────────────────────────────

  it('uses stupidity prelude by default', () => {
    const result = new AiComposer('task').compose();
    expect(result).toContain('STUPIDITY_ON');
  });

  it('uses standard prelude when stupidity mode off', () => {
    const result = new AiComposer('task')
      .withStupidityMode(false)
      .compose();
    expect(result).toContain('STANDARD');
    expect(result).not.toContain('STUPIDITY_ON');
  });

  // ── Directives ─────────────────────────────────────────────────

  it('includes attached directives in correct positions', () => {
    const result = new AiComposer('task')
      .withAttachedDirectives({
        system: 'sys directive',
        prefix: 'pre directive',
        suffix: 'suf directive',
      })
      .compose();
    expect(result).toContain('[ACTIVE DIRECTIVES · SYSTEM]');
    expect(result).toContain('sys directive');
    expect(result).toContain('[ACTIVE DIRECTIVES · PREFIX]');
    expect(result).toContain('pre directive');
    expect(result).toContain('[ACTIVE DIRECTIVES · SUFFIX]');
    expect(result).toContain('suf directive');
  });

  // ── Flows ──────────────────────────────────────────────────────

  it('includes flow baselines in narrowing section', () => {
    const result = new AiComposer('task')
      .withFlows([{
        id: 'f1', name: 'Homepage', baseUrl: 'http://localhost:3000',
        steps: [{ name: 'Load', action: 'navigate' as any, snapshot: { metrics: { lcp: 200, cls: 0.01, inp: 50 } } } as any],
      }])
      .compose();
    expect(result).toContain('[E2E FLOWS BASELINE]');
    expect(result).toContain('Homepage');
    expect(result).toContain('LCP=200ms');
  });

  // ── Fluent chaining ────────────────────────────────────────────

  it('supports full fluent chain', () => {
    const result = new AiComposer('Build a dashboard')
      .withStupidityMode(true)
      .withPersona('You are a senior engineer')
      .withCognitiveSteps(['Analyze', 'Build', 'Test'])
      .withStrictConstraints(['No external deps'])
      .withDesignSystem('Tailwind v4')
      .withContextDigest('React + Vite')
      .withMemory('Prefers hooks')
      .withOutputSchema()
      .compose();

    // Verify all sections present and ordered
    const sections = result.split(SEP);
    expect(sections.length).toBeGreaterThanOrEqual(5);
    expect(result).toContain('[PRELUDE]');
    expect(result).toContain('[1. THE MASK');
    expect(result).toContain('[2. THE MANDATE');
    expect(result).toContain('[3. THE COGNITIVE ALGORITHM');
    expect(result).toContain('[4. THE LOGICAL PRISON');
    expect(result).toContain('[5. THE OUTPUT CONTRACT');
  });
});
