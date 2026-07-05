import { describe, expect, it } from 'vitest';
import { calculateExecutionCost, isFreeModel } from './cost-calculator';

describe('isFreeModel', () => {
  it('treats "0"/"0" pricing as free', () => {
    expect(isFreeModel({ prompt: '0', completion: '0' })).toBe(true);
  });

  it('treats any paid rate as not free', () => {
    expect(isFreeModel({ prompt: '0.0000005', completion: '0' })).toBe(false);
    expect(isFreeModel({ prompt: '0', completion: '0.0000015' })).toBe(false);
  });

  it('treats missing pricing as free', () => {
    expect(isFreeModel(undefined)).toBe(true);
  });
});

describe('calculateExecutionCost', () => {
  it('returns 0.0 for free models regardless of token usage', () => {
    const cost = calculateExecutionCost(
      { promptTokens: 5000, completionTokens: 5000 },
      { prompt: '0', completion: '0' },
    );
    expect(cost.executionCostUsd).toBe(0);
    expect(cost.promptCostUsd).toBe(0);
    expect(cost.completionCostUsd).toBe(0);
  });

  it('computes exact per-token cost for paid models', () => {
    const cost = calculateExecutionCost(
      { promptTokens: 1000, completionTokens: 500 },
      { prompt: '0.0000005', completion: '0.0000015' },
    );
    expect(cost.promptCostUsd).toBeCloseTo(0.0005, 12);
    expect(cost.completionCostUsd).toBeCloseTo(0.00075, 12);
    expect(cost.executionCostUsd).toBeCloseTo(0.00125, 12);
  });

  it('accepts numeric pricing rates', () => {
    const cost = calculateExecutionCost(
      { promptTokens: 100, completionTokens: 100 },
      { prompt: 0.00001, completion: 0.00002 },
    );
    expect(cost.executionCostUsd).toBeCloseTo(0.003, 12);
  });

  it('guards against malformed pricing and negative tokens', () => {
    const cost = calculateExecutionCost(
      { promptTokens: -50, completionTokens: 100 },
      { prompt: 'not-a-number', completion: '0.0000010' },
    );
    expect(cost.promptCostUsd).toBe(0);
    expect(cost.completionCostUsd).toBeCloseTo(0.0001, 12);
    expect(cost.executionCostUsd).toBeCloseTo(0.0001, 12);
  });
});
