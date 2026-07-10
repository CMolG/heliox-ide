/**
 * fluxor-flow.test.ts — Tests for the canonical Fluxor portable flow format.
 *
 * Suite 1 – Round-trip: verify execution-relevant structure is preserved and
 *           lossy fields (role ids, mods, mentalContext.relationToStep) are
 *           acceptably flattened. Includes a regression case for an
 *           empty-string systemPrompt, which a prior truthiness-based import
 *           gate silently dropped instead of round-tripping exactly.
 * Suite 2 – Stable export order: two serialisations of the same flow produce
 *           identical JSON and a deterministic topological ordering.
 * Suite 3 – Cross-runtime conformance (TS half): load the shared golden fixture
 *           from sdk/conformance/conformance-chain.flow.json, reconstruct the
 *           flow, run it through executeAgenticFlow, and assert the execution
 *           order matches ['step-a','step-b','step-c','step-d'].
 * Suite 7 – Legacy compat: the format-tag shim added by the Heliox → Fluxor
 *           rebrand (Anexo A) — exportFlow always stamps the current format
 *           name; importFlow accepts a missing tag or the literal legacy
 *           "heliox-flow" value with a one-time deprecation warning, and
 *           never blocks reconstruction on either.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const warnSpy = vi.fn();

vi.mock('../logger', () => ({
  log: { warn: (...args: unknown[]) => warnSpy(...args) },
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgenticFlow } from '@/types/harness';
import { executeAgenticFlow } from '../harness-engine/executor';
import { resetWarnOnceForTests } from '../lib/warn-once';
import {
  exportFlow,
  FLUXOR_FLOW_FORMAT_NAME,
  FLUXOR_FLOW_FORMAT_VERSION,
  importFlow,
  type FluxorFlowExport,
} from './fluxor-flow';

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

/**
 * Same 3-step chain as makeTestFlow(), but `root`'s roles are replaced with a
 * single role whose systemPrompt is the empty string — regression coverage
 * for an import-side truthiness bug: `s.systemPrompt ? [...] : []` used to
 * drop the role entirely whenever systemPrompt was '', even though exportFlow
 * gates on `roles.length > 0` (not on the joined string's truthiness) and so
 * happily emits `systemPrompt: ''`. That mismatch broke the module's
 * documented "round-tripped EXACTLY" contract for this case.
 */
function makeEmptySystemPromptTestFlow(): AgenticFlow {
  const base = makeTestFlow();
  return {
    ...base,
    stepsRecord: {
      ...base.stepsRecord,
      root: {
        ...base.stepsRecord.root,
        roles: [{ id: 'role-empty', name: 'Empty', systemPrompt: '' }],
      },
    },
  };
}

beforeEach(() => {
  warnSpy.mockClear();
  resetWarnOnceForTests();
});

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

  it('exports systemPrompt as an empty string when the single role has an empty systemPrompt', () => {
    const exported = exportFlow(makeEmptySystemPromptTestFlow());
    const rootExported = exported.steps.find((s) => s.id === 'root')!;
    expect(rootExported.systemPrompt).toBe('');
  });

  it('reconstructs exactly one role with systemPrompt \'\' on import instead of dropping it as falsy', () => {
    const restored = importFlow(exportFlow(makeEmptySystemPromptTestFlow()));
    const rootRestored = restored.stepsRecord['root']!;
    expect(rootRestored.roles).toHaveLength(1);
    expect(rootRestored.roles[0].id).toBe('exported-role');
    expect(rootRestored.roles[0].systemPrompt).toBe('');
  });

  it('round-trips export→import→export with a stable result when systemPrompt is empty', () => {
    const exportedOnce = exportFlow(makeEmptySystemPromptTestFlow());
    const reimported = importFlow(exportedOnce);
    const exportedTwice = exportFlow(reimported);
    expect(exportedTwice).toEqual(exportedOnce);
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

  it('sets version to FLUXOR_FLOW_FORMAT_VERSION', () => {
    const exported = exportFlow(makeTestFlow());
    expect(exported.version).toBe(FLUXOR_FLOW_FORMAT_VERSION);
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
    const exported: FluxorFlowExport = JSON.parse(raw);

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

// ---------------------------------------------------------------------------
// Suite 4 – loops + contract + model round-trip (Phase 4a)
// ---------------------------------------------------------------------------

/**
 * Same 3-step chain as makeTestFlow(), plus a bounded loop (leaf → middle)
 * and a completion contract + model override on the middle step — covers the
 * three fields fluxor-flow.ts added in Phase 4a (contract, model, loops).
 */
function makeLoopTestFlow(): AgenticFlow {
  const base = makeTestFlow();
  return {
    ...base,
    stepsRecord: {
      ...base.stepsRecord,
      middle: {
        ...base.stepsRecord.middle,
        contract: { mustWriteFiles: true, maxAttempts: 2 },
        model: 'openai/gpt-4o-mini',
      },
    },
    loops: [{ id: 'loop-1', sourceStepId: 'leaf', targetStepId: 'middle', maxIterations: 4 }],
  };
}

describe('loops + contract + model round-trip (Phase 4a)', () => {
  it('exports step.contract and step.model verbatim', () => {
    const exported = exportFlow(makeLoopTestFlow());
    const middleExported = exported.steps.find((s) => s.id === 'middle')!;
    expect(middleExported.contract).toEqual({ mustWriteFiles: true, maxAttempts: 2 });
    expect(middleExported.model).toBe('openai/gpt-4o-mini');
  });

  it('omits contract/model keys for steps that do not declare them', () => {
    const exported = exportFlow(makeLoopTestFlow());
    const rootExported = exported.steps.find((s) => s.id === 'root')!;
    expect(rootExported.contract).toBeUndefined();
    expect(rootExported.model).toBeUndefined();
  });

  it('restores contract and model onto the reconstructed AgenticStep', () => {
    const restored = importFlow(exportFlow(makeLoopTestFlow()));
    const middleRestored = restored.stepsRecord['middle']!;
    expect(middleRestored.contract).toEqual({ mustWriteFiles: true, maxAttempts: 2 });
    expect(middleRestored.model).toBe('openai/gpt-4o-mini');
  });

  it('exports flow.loops, omitted when the flow declares no loops', () => {
    const withoutLoops = exportFlow(makeTestFlow());
    expect(withoutLoops.loops).toBeUndefined();

    const withLoops = exportFlow(makeLoopTestFlow());
    expect(withLoops.loops).toEqual([
      { id: 'loop-1', sourceStepId: 'leaf', targetStepId: 'middle', maxIterations: 4 },
    ]);
  });

  it('clamps loops[].maxIterations into [1, LOOP_MAX_ITERATIONS_CAP] (1..50) at export time', () => {
    const flow = makeLoopTestFlow();
    flow.loops = [
      { id: 'loop-too-high', sourceStepId: 'leaf', targetStepId: 'middle', maxIterations: 999 },
      { id: 'loop-too-low', sourceStepId: 'leaf', targetStepId: 'middle', maxIterations: 0 },
    ];
    const exported = exportFlow(flow);
    expect(exported.loops).toEqual([
      { id: 'loop-too-high', sourceStepId: 'leaf', targetStepId: 'middle', maxIterations: 50 },
      { id: 'loop-too-low', sourceStepId: 'leaf', targetStepId: 'middle', maxIterations: 1 },
    ]);
  });

  it('restores flow.loops verbatim on import', () => {
    const restored = importFlow(exportFlow(makeLoopTestFlow()));
    expect(restored.loops).toEqual([
      { id: 'loop-1', sourceStepId: 'leaf', targetStepId: 'middle', maxIterations: 4 },
    ]);
  });

  it('round-trips a flow with loops + step contract/model through export→import→export with a stable result', () => {
    const exportedOnce = exportFlow(makeLoopTestFlow());
    const reimported = importFlow(exportedOnce);
    const exportedTwice = exportFlow(reimported);
    expect(exportedTwice).toEqual(exportedOnce);
  });

  it('keeps version at FLUXOR_FLOW_FORMAT_VERSION ("1") for flows carrying contract/model/loops', () => {
    const exported = exportFlow(makeLoopTestFlow());
    expect(exported.version).toBe(FLUXOR_FLOW_FORMAT_VERSION);
    expect(exported.version).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Suite 5 – Cross-runtime conformance (TS half): contract/model fixture
// ---------------------------------------------------------------------------

describe('cross-runtime conformance — contract/model round-trip fixture', () => {
  it('importFlow(conformance-contract.flow.json) → exportFlow deep-equals golden-contract-roundtrip.json', () => {
    const fixturePath = join(process.cwd(), 'sdk', 'conformance', 'conformance-contract.flow.json');
    const goldenPath = join(process.cwd(), 'sdk', 'conformance', 'golden-contract-roundtrip.json');

    const exportedFixture: FluxorFlowExport = JSON.parse(readFileSync(fixturePath, 'utf-8'));
    const goldenRoundtrip: FluxorFlowExport = JSON.parse(readFileSync(goldenPath, 'utf-8'));

    const roundtripped = exportFlow(importFlow(exportedFixture));

    // The checked-in golden fixture predates the `format` tag (Heliox → Fluxor
    // rebrand, Anexo A) and lives under sdk/conformance/ (a different agent's
    // territory), so it isn't necessarily updated in lockstep with this file.
    // Every OTHER field must still match byte-for-byte.
    expect(roundtripped).toEqual({ ...goldenRoundtrip, format: FLUXOR_FLOW_FORMAT_NAME });
  });
});

// ---------------------------------------------------------------------------
// Suite 6 – human-facing metadata round-trip (Phase 5)
// ---------------------------------------------------------------------------

/**
 * Same 3-step chain as makeTestFlow(), plus flow-level description/tags/
 * author/version and a per-step description on `root` and `leaf` (but not
 * `middle`) — covers the two purely human-facing, execution-inert fields
 * Phase 5 added: AgenticStep.description and AgenticFlow.description/tags/
 * author/version.
 */
function makeMetaTestFlow(): AgenticFlow {
  const base = makeTestFlow();
  return {
    ...base,
    description: 'A flow that demonstrates metadata round-tripping.',
    tags: ['demo', 'onboarding'],
    author: 'Ada Lovelace',
    version: '2.1.0',
    stepsRecord: {
      ...base.stepsRecord,
      root: { ...base.stepsRecord.root, description: 'Kicks off the chain.' },
      leaf: { ...base.stepsRecord.leaf, description: 'Wraps up the chain.' },
    },
  };
}

describe('human-facing metadata round-trip (Phase 5)', () => {
  it('exports per-step description and flow meta, leaving steps without a description untouched', () => {
    const exported = exportFlow(makeMetaTestFlow());

    const rootExported = exported.steps.find((s) => s.id === 'root')!;
    const middleExported = exported.steps.find((s) => s.id === 'middle')!;
    const leafExported = exported.steps.find((s) => s.id === 'leaf')!;

    expect(rootExported.description).toBe('Kicks off the chain.');
    expect(leafExported.description).toBe('Wraps up the chain.');
    expect(middleExported.description).toBeUndefined();
    expect('description' in middleExported).toBe(false);

    expect(exported.meta).toEqual({
      description: 'A flow that demonstrates metadata round-tripping.',
      tags: ['demo', 'onboarding'],
      author: 'Ada Lovelace',
      version: '2.1.0',
    });
  });

  it('restores per-step description and flow meta fields on import', () => {
    const restored = importFlow(exportFlow(makeMetaTestFlow()));

    expect(restored.stepsRecord['root']?.description).toBe('Kicks off the chain.');
    expect(restored.stepsRecord['leaf']?.description).toBe('Wraps up the chain.');
    expect(restored.stepsRecord['middle']?.description).toBeUndefined();

    expect(restored.description).toBe('A flow that demonstrates metadata round-tripping.');
    expect(restored.tags).toEqual(['demo', 'onboarding']);
    expect(restored.author).toBe('Ada Lovelace');
    expect(restored.version).toBe('2.1.0');
  });

  it('round-trips a flow with full metadata through export→import→export with a stable result', () => {
    const exportedOnce = exportFlow(makeMetaTestFlow());
    const reimported = importFlow(exportedOnce);
    const exportedTwice = exportFlow(reimported);
    expect(exportedTwice).toEqual(exportedOnce);
  });

  it('omits the meta key and every step description key entirely when no metadata is set', () => {
    const exported = exportFlow(makeTestFlow());

    expect('meta' in exported).toBe(false);
    for (const step of exported.steps) {
      expect('description' in step).toBe(false);
    }

    // Guard against a stray `description: undefined` / `meta: undefined` key
    // surviving JSON serialization — the whole point of the conditional-spread
    // approach is that pre-Phase-5 exports stay byte-identical.
    const json = JSON.stringify(exported);
    expect(json).not.toContain('"meta"');
    expect(json).not.toContain('"description"');
  });

  it('keeps version at FLUXOR_FLOW_FORMAT_VERSION ("1") for flows carrying metadata', () => {
    const exported = exportFlow(makeMetaTestFlow());
    expect(exported.version).toBe(FLUXOR_FLOW_FORMAT_VERSION);
    expect(exported.version).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Suite 7 – Legacy compat: format-tag shim (Heliox → Fluxor rebrand, Anexo A)
// ---------------------------------------------------------------------------

describe('legacy format tag compat', () => {
  it('exportFlow always stamps the current format name', () => {
    const exported = exportFlow(makeTestFlow());
    expect(exported.format).toBe('fluxor-flow');
    expect(exported.format).toBe(FLUXOR_FLOW_FORMAT_NAME);
  });

  it('imports a legacy fixture with no format field at all, without throwing', () => {
    const legacyFixture = exportFlow(makeTestFlow()) as Partial<FluxorFlowExport>;
    delete legacyFixture.format;

    expect(() => importFlow(legacyFixture as FluxorFlowExport)).not.toThrow();
    const restored = importFlow(legacyFixture as FluxorFlowExport);
    expect(restored.id).toBe('test-flow');
  });

  it('warns once when importing a fixture with no format field', () => {
    const legacyFixture = exportFlow(makeTestFlow()) as Partial<FluxorFlowExport>;
    delete legacyFixture.format;

    importFlow(legacyFixture as FluxorFlowExport);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('heliox-flow');
  });

  it('imports a fixture with the explicit legacy "heliox-flow" format tag, with a warning', () => {
    const legacyFixture = { ...exportFlow(makeTestFlow()), format: 'heliox-flow' };

    const restored = importFlow(legacyFixture);

    expect(restored.id).toBe('test-flow');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('heliox-flow');
  });

  it('does not warn when importing a current "fluxor-flow" export', () => {
    const current = exportFlow(makeTestFlow());
    importFlow(current);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns only once across repeated imports of the same legacy value', () => {
    const legacyFixture = { ...exportFlow(makeTestFlow()), format: 'heliox-flow' };
    importFlow(legacyFixture);
    importFlow(legacyFixture);
    importFlow(legacyFixture);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Suite 8 — contextMode round-trip (Rosetta, spec:
// docs/superpowers/specs/2026-07-10-rosetta-context-manifest.md)
// ---------------------------------------------------------------------------

describe('contextMode export/import round-trip', () => {
  it('omits the contextMode key entirely when the flow has no contextMode (blind default) — byte-identical to a pre-feedback export', () => {
    const exported = exportFlow(makeTestFlow());
    expect('contextMode' in exported).toBe(false);
    expect(JSON.stringify(exported)).not.toContain('"contextMode"');
  });

  it('omits the contextMode key when the flow explicitly declares "blind"', () => {
    const flow = { ...makeTestFlow(), contextMode: 'blind' as const };
    const exported = exportFlow(flow);
    expect('contextMode' in exported).toBe(false);
    expect(JSON.stringify(exported)).not.toContain('"contextMode"');
  });

  it('includes contextMode: "feedback" when the flow declares it', () => {
    const flow = { ...makeTestFlow(), contextMode: 'feedback' as const };
    const exported = exportFlow(flow);
    expect(exported.contextMode).toBe('feedback');
  });

  it('restores contextMode: "feedback" on import', () => {
    const flow = { ...makeTestFlow(), contextMode: 'feedback' as const };
    const restored = importFlow(exportFlow(flow));
    expect(restored.contextMode).toBe('feedback');
  });

  it('leaves contextMode undefined on import when the export carries none (never defaults it to the literal "blind")', () => {
    const restored = importFlow(exportFlow(makeTestFlow()));
    expect(restored.contextMode).toBeUndefined();
    expect('contextMode' in restored).toBe(false);
  });

  it('round-trips a feedback-mode flow through export→import→export with a stable result', () => {
    const flow = { ...makeTestFlow(), contextMode: 'feedback' as const };
    const exportedOnce = exportFlow(flow);
    const reimported = importFlow(exportedOnce);
    const exportedTwice = exportFlow(reimported);
    expect(exportedTwice).toEqual(exportedOnce);
  });

  it('does not perturb any other field on the export when contextMode is present', () => {
    const blindExported = exportFlow(makeTestFlow());
    const feedbackFlow = { ...makeTestFlow(), contextMode: 'feedback' as const };
    const feedbackExported = exportFlow(feedbackFlow);
    const { contextMode: _omit, ...feedbackWithoutContextMode } = feedbackExported;
    expect(feedbackWithoutContextMode).toEqual(blindExported);
  });
});
