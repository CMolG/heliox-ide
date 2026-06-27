/**
 * heliox-flow.test.ts — Tests for the canonical Heliox portable flow format.
 *
 * Suite 1 – Round-trip: verify execution-relevant structure is preserved and
 *           lossy fields (role ids, mods, mentalContext.relationToStep) are
 *           acceptably flattened.
 * Suite 2 – Stable export order: two serialisations of the same flow produce
 *           identical JSON and a deterministic topological ordering.
 * Suite 3 – Cross-runtime conformance (TS half): load the shared golden fixture
 *           from sdk/conformance/conformance-chain.flow.json, reconstruct the
 *           flow, run it through executeAgenticFlow, and assert the execution
 *           order matches ['step-a','step-b','step-c','step-d'].
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import type { AgenticFlow } from '@/types/harness';
import { executeAgenticFlow } from '../harness-engine/executor';
import {
  exportFlow,
  HELIOX_FLOW_FORMAT_VERSION,
  importFlow,
  type HelioxFlowExport,
} from './heliox-flow';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a 3-step diamond-free DAG: root → middle → leaf */
function makeTestFlow(): AgenticFlow {
  return {
    id: 'test-flow',
    name: 'Test Flow',
    rootStepId: 'root',
    stepsRecord: {
      root: {
        id: 'root',
        type: 'llm_call',
        prompt: 'Root prompt',
        tools: [
          { id: 'tool-search', name: 'search' },
          { id: 'tool-calc', name: 'calculator' },
        ],
        prevStepIds: [],
        nextStepIds: ['middle'],
        mods: [{ id: 'mod-1', name: 'Sanitiser', type: 'pre_process' }],
        roles: [
          { id: 'role-planner', name: 'Planner', systemPrompt: 'You are a planner.' },
          { id: 'role-critic', name: 'Critic', systemPrompt: 'You are a critic.' },
        ],
        mentalContext: [
          { id: 'ctx-background', text: 'Domain background info.', relationToStep: 'incoming' },
          { id: 'ctx-goal', text: 'Overall goal text.', relationToStep: 'outgoing' },
        ],
      },
      middle: {
        id: 'middle',
        type: 'tool_call',
        prompt: 'Middle prompt',
        tools: [],
        prevStepIds: ['root'],
        nextStepIds: ['leaf'],
        mods: [],
        roles: [],
        mentalContext: [],
      },
      leaf: {
        id: 'leaf',
        type: 'llm_call',
        prompt: 'Leaf prompt',
        tools: [{ id: 'tool-writer', name: 'writer' }],
        prevStepIds: ['middle'],
        nextStepIds: [],
        mods: [],
        roles: [],
        mentalContext: [],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Suite 1 – Round-trip fidelity
// ---------------------------------------------------------------------------

describe('exportFlow / importFlow round-trip', () => {
  it('preserves step ids', () => {
    const original = makeTestFlow();
    const restored = importFlow(exportFlow(original));
    expect(Object.keys(restored.stepsRecord).sort()).toEqual(
      Object.keys(original.stepsRecord).sort(),
    );
  });

  it('preserves flow id, name, and rootStepId', () => {
    const original = makeTestFlow();
    const restored = importFlow(exportFlow(original));
    expect(restored.id).toBe(original.id);
    expect(restored.name).toBe(original.name);
    expect(restored.rootStepId).toBe(original.rootStepId);
  });

  it('preserves prompts for every step', () => {
    const original = makeTestFlow();
    const restored = importFlow(exportFlow(original));
    for (const step of Object.values(original.stepsRecord)) {
      expect(restored.stepsRecord[step.id]?.prompt).toBe(step.prompt);
    }
  });

  it('preserves prevStepIds (dependsOn) for every step', () => {
    const original = makeTestFlow();
    const restored = importFlow(exportFlow(original));
    for (const step of Object.values(original.stepsRecord)) {
      expect(restored.stepsRecord[step.id]?.prevStepIds).toEqual(step.prevStepIds);
    }
  });

  it('derives nextStepIds correctly from dependsOn', () => {
    const original = makeTestFlow();
    const restored = importFlow(exportFlow(original));
    expect(restored.stepsRecord['root']?.nextStepIds).toEqual(['middle']);
    expect(restored.stepsRecord['middle']?.nextStepIds).toEqual(['leaf']);
    expect(restored.stepsRecord['leaf']?.nextStepIds).toEqual([]);
  });

  it('flattens multiple roles into a single joined systemPrompt', () => {
    const original = makeTestFlow();
    const exported = exportFlow(original);
    const rootExported = exported.steps.find((s) => s.id === 'root')!;
    expect(rootExported.systemPrompt).toBe('You are a planner.\n\nYou are a critic.');
  });

  it('restores systemPrompt as a single sentinel role', () => {
    const original = makeTestFlow();
    const restored = importFlow(exportFlow(original));
    const rootRestored = restored.stepsRecord['root']!;
    expect(rootRestored.roles).toHaveLength(1);
    expect(rootRestored.roles[0].id).toBe('exported-role');
    expect(rootRestored.roles[0].name).toBe('ExportedRole');
    expect(rootRestored.roles[0].systemPrompt).toBe('You are a planner.\n\nYou are a critic.');
  });

  it('preserves tool names for every step', () => {
    const original = makeTestFlow();
    const restored = importFlow(exportFlow(original));
    const rootTools = restored.stepsRecord['root']!.tools.map((t) => t.name);
    expect(rootTools).toEqual(['search', 'calculator']);
    const leafTools = restored.stepsRecord['leaf']!.tools.map((t) => t.name);
    expect(leafTools).toEqual(['writer']);
  });

  it('flattens mentalContext into a context map and restores it', () => {
    const original = makeTestFlow();
    const exported = exportFlow(original);
    const rootExported = exported.steps.find((s) => s.id === 'root')!;
    expect(rootExported.context).toEqual({
      'ctx-background': 'Domain background info.',
      'ctx-goal': 'Overall goal text.',
    });

    const restored = importFlow(exported);
    const rootRestored = restored.stepsRecord['root']!;
    expect(rootRestored.mentalContext).toHaveLength(2);
    expect(rootRestored.mentalContext.find((c) => c.id === 'ctx-background')?.text).toBe(
      'Domain background info.',
    );
    // relationToStep is intentionally restored as 'incoming' (lossy field)
    expect(rootRestored.mentalContext.every((c) => c.relationToStep === 'incoming')).toBe(true);
  });

  it('drops mods (intentionally lossy)', () => {
    const original = makeTestFlow();
    const restored = importFlow(exportFlow(original));
    for (const step of Object.values(restored.stepsRecord)) {
      expect(step.mods).toEqual([]);
    }
  });

  it('omits systemPrompt when a step has no roles', () => {
    const original = makeTestFlow();
    const exported = exportFlow(original);
    const middleExported = exported.steps.find((s) => s.id === 'middle')!;
    expect(middleExported.systemPrompt).toBeUndefined();
  });

  it('omits context when a step has no mentalContext', () => {
    const original = makeTestFlow();
    const exported = exportFlow(original);
    const middleExported = exported.steps.find((s) => s.id === 'middle')!;
    expect(middleExported.context).toBeUndefined();
  });

  it('sets version to HELIOX_FLOW_FORMAT_VERSION', () => {
    const exported = exportFlow(makeTestFlow());
    expect(exported.version).toBe(HELIOX_FLOW_FORMAT_VERSION);
    expect(exported.version).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Suite 2 – Stable export order (deterministic topological sort)
// ---------------------------------------------------------------------------

describe('stable export order', () => {
  it('emits root before middle before leaf for a linear chain', () => {
    const exported = exportFlow(makeTestFlow());
    const ids = exported.steps.map((s) => s.id);
    expect(ids.indexOf('root')).toBeLessThan(ids.indexOf('middle'));
    expect(ids.indexOf('middle')).toBeLessThan(ids.indexOf('leaf'));
  });

  it('produces identical JSON on two consecutive calls', () => {
    const flow = makeTestFlow();
    const json1 = JSON.stringify(exportFlow(flow));
    const json2 = JSON.stringify(exportFlow(flow));
    expect(json1).toBe(json2);
  });

  it('breaks ties by id ascending when multiple roots exist', () => {
    // Flow with two independent roots: 'alpha' and 'beta', no edges between them.
    const twoRootFlow: AgenticFlow = {
      id: 'two-roots',
      name: 'Two Roots',
      rootStepId: 'alpha',
      stepsRecord: {
        beta: {
          id: 'beta',
          type: 'llm_call',
          prompt: 'Beta',
          tools: [],
          prevStepIds: [],
          nextStepIds: [],
          mods: [],
          roles: [],
          mentalContext: [],
        },
        alpha: {
          id: 'alpha',
          type: 'llm_call',
          prompt: 'Alpha',
          tools: [],
          prevStepIds: [],
          nextStepIds: [],
          mods: [],
          roles: [],
          mentalContext: [],
        },
      },
    };

    const exported = exportFlow(twoRootFlow);
    expect(exported.steps[0].id).toBe('alpha');
    expect(exported.steps[1].id).toBe('beta');
  });
});

// ---------------------------------------------------------------------------
// Suite 3 – Cross-runtime conformance (TS half)
// ---------------------------------------------------------------------------

describe('cross-runtime conformance — golden DAG order', () => {
  it('executes conformance-chain in step-a → step-b → step-c → step-d → step-e order', async () => {
    // Load the shared fixture (also consumed by the Java test suite).
    const fixturePath = join(process.cwd(), 'sdk', 'conformance', 'conformance-chain.flow.json');
    const raw = readFileSync(fixturePath, 'utf-8');
    const exported: HelioxFlowExport = JSON.parse(raw);

    const flow = importFlow(exported);
    const order: string[] = [];

    await executeAgenticFlow(flow, {
      runStep: async ({ step }) => {
        order.push(step.id);
        return { text: '', usage: null, toolCalls: [], toolResults: [] };
      },
    });

    expect(order).toEqual(['step-a', 'step-b', 'step-c', 'step-d', 'step-e']);
  });
});
