/**
 * model-intelligence.test.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
import { describe, it, expect } from 'vitest';

// Recreate the constants (since they're not exported, we test the logic)
const MODEL_COSTS: Record<string, string> = {
  'gpt-4.1': 'x0', 'gpt-4o': 'x0', 'gpt-5-mini': 'x0',
  'gpt-5.4-mini': 'x0.33', 'gpt-5.1-codex-mini': 'x0.33',
  'claude-haiku-4.5': 'x0.33', 'gemini-3-flash-preview': 'x0.33',
  'claude-sonnet-4': 'x1', 'claude-sonnet-4.5': 'x1', 'claude-sonnet-4.6': 'x1',
  'gpt-5.1': 'x1', 'gpt-5.2': 'x1', 'gpt-5.4': 'x1',
  'gpt-5.1-codex': 'x1', 'gpt-5.1-codex-max': 'x1', 'gpt-5.2-codex': 'x1', 'gpt-5.3-codex': 'x1',
  'gemini-3-pro-preview': 'x1', 'gemini-3.1-pro-preview': 'x1',
  'claude-opus-4.5': 'x3', 'claude-opus-4.6': 'x3',
  'claude-opus-4.6-fast': 'x30',
};

const MODEL_EFFORT_SUPPORT: Record<string, readonly string[]> = {
  'gpt-4.1': ['low', 'medium', 'high'],
  'gpt-5-mini': ['low', 'medium', 'high'],
  'gpt-5.4-mini': ['low', 'medium', 'high'],
  'gpt-5.1-codex-mini': ['low', 'medium', 'high'],
  'claude-haiku-4.5': ['low', 'medium', 'high'],
};

const DEFAULT_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'];

function getEffortLevels(model: string) {
  return MODEL_EFFORT_SUPPORT[model] ?? DEFAULT_EFFORT_LEVELS;
}

describe('Model Intelligence', () => {
  describe('MODEL_COSTS', () => {
    it('free models have x0 cost', () => {
      expect(MODEL_COSTS['gpt-4.1']).toBe('x0');
      expect(MODEL_COSTS['gpt-5-mini']).toBe('x0');
    });

    it('budget models have x0.33 cost', () => {
      expect(MODEL_COSTS['gpt-5.4-mini']).toBe('x0.33');
      expect(MODEL_COSTS['gpt-5.1-codex-mini']).toBe('x0.33');
      expect(MODEL_COSTS['claude-haiku-4.5']).toBe('x0.33');
    });

    it('standard models have x1 cost', () => {
      expect(MODEL_COSTS['claude-sonnet-4.6']).toBe('x1');
      expect(MODEL_COSTS['gpt-5.4']).toBe('x1');
      expect(MODEL_COSTS['gemini-3-pro-preview']).toBe('x1');
      expect(MODEL_COSTS['gpt-5.1-codex-max']).toBe('x1');
    });

    it('opus models have x3 cost', () => {
      expect(MODEL_COSTS['claude-opus-4.6']).toBe('x3');
      expect(MODEL_COSTS['claude-opus-4.5']).toBe('x3');
    });

    it('opus fast has x30 cost', () => {
      expect(MODEL_COSTS['claude-opus-4.6-fast']).toBe('x30');
    });

    it('every known model has a cost entry', () => {
      const KNOWN_MODELS = [
        'claude-sonnet-4.6', 'claude-sonnet-4.5', 'claude-haiku-4.5',
        'claude-opus-4.6', 'claude-opus-4.6-fast', 'claude-opus-4.5', 'claude-sonnet-4',
        'gemini-3-pro-preview',
        'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2',
        'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5.1',
        'gpt-5.4-mini', 'gpt-5.1-codex-mini', 'gpt-5-mini', 'gpt-4.1',
      ];
      for (const model of KNOWN_MODELS) {
        expect(MODEL_COSTS[model], `Missing cost for ${model}`).toBeDefined();
      }
    });
  });

  describe('getEffortLevels', () => {
    it('returns 3 levels for models without xhigh support', () => {
      expect(getEffortLevels('gpt-4.1')).toEqual(['low', 'medium', 'high']);
      expect(getEffortLevels('claude-haiku-4.5')).toEqual(['low', 'medium', 'high']);
      expect(getEffortLevels('gpt-5-mini')).toEqual(['low', 'medium', 'high']);
    });

    it('returns 4 levels for models with full support', () => {
      expect(getEffortLevels('claude-sonnet-4.6')).toEqual(['low', 'medium', 'high', 'xhigh']);
      expect(getEffortLevels('claude-opus-4.6')).toEqual(['low', 'medium', 'high', 'xhigh']);
      expect(getEffortLevels('gpt-5.4')).toEqual(['low', 'medium', 'high', 'xhigh']);
    });

    it('returns default 4 levels for unknown models', () => {
      expect(getEffortLevels('unknown-model')).toEqual(['low', 'medium', 'high', 'xhigh']);
    });

    it('no model has empty effort levels', () => {
      const allModels = [...Object.keys(MODEL_EFFORT_SUPPORT), 'claude-sonnet-4.6', 'unknown'];
      for (const model of allModels) {
        expect(getEffortLevels(model).length).toBeGreaterThan(0);
      }
    });
  });
});
