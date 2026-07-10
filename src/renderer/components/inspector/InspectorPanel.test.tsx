/**
 * InspectorPanel.test.tsx — Component tests for the Figma-like right inspector
 *
 * Strategy:
 * - Mount <InspectorPanel /> against the REAL `desktop-store` (pure
 *   client-side state, no IPC) — reset via `useDesktopStore.setState(
 *   useDesktopStore.getInitialState(), true)`, the same pattern
 *   desktop-store.test.ts / StepInfoModal.test.tsx / NodeTree.flows.test.tsx
 *   use. Because InspectorPanel (and everything it renders — StepInspector,
 *   StepConfigCore) SUBSCRIBES to the store directly (unlike the old
 *   StepInfoModal, which received `stepData` as a static prop), store
 *   mutations here don't need a manual `rerender()` — the tree updates on
 *   its own, same as it does in the real app.
 * - `harness-store` IS mocked (hoisted spies for `runStep`/`runFromStep` +
 *   a `stepStatuses` fixture) since the real implementation dispatches
 *   through IPC/`window.fluxorAPI`, which isn't available here.
 * - `../desktop/StepInfoModal` is mocked SHALLOWLY (a stub exposing
 *   `stepId` and a serialized `connections` as data attributes) — its own
 *   internals (evidence content, focus trap, etc.) are covered by
 *   StepInfoModal.test.tsx; this file only needs to prove StepInspector's
 *   "Run evidence" button opens it with the right step (`connections` is
 *   surfaced too so the P10 drag-tick regression tests below can assert on
 *   it without duplicating StepRunEvidence's own rendering).
 *
 * Phase 8 provenance: the Instructions/Role/Mod/Execution-control/
 * Model-override scenarios below were TRANSPLANTED from StepInfoModal.test.tsx
 * (StepConfigCore itself is unchanged — only WHERE it's rendered moved, from
 * inside StepInfoModal to inside StepInspector here) — same testids, same
 * assertions, adapted to render `<InspectorPanel/>` with a step selected
 * instead of `<StepInfoModal stepId stepData .../>` directly.
 *
 * Scenarios covered:
 *   1. Selection routing: 0 selected (BoardInfo) / 1 step / 1 frame / 1 lone
 *      note / multi-select / a stale (deleted) selection id.
 *   2. BoardInfo: active board name + step/flow/note/edge counts.
 *   3. StepInspector: title edit (blur + Enter, blank-guard) and description
 *      edit commit via `updateStepData`.
 *   4. StepConfigCore transplants: Instructions, Role picker, Mod picker,
 *      mod domain hint, execution controls, model override.
 *   5. "Run evidence" opens the (mocked) StepInfoModal with this step's id.
 *   6. Multi-select "Delete all" removes every selected node.
 *   7. Collapse button flips `settings.showInspector` to false.
 */
import React, { Profiler } from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesktopStore } from '../../store/desktop-store';
import { useFluxorStore } from '../../store';
import { InspectorPanel } from './InspectorPanel';
import type { StepNodeData } from '@/types/desktop';
import type { MarketMod, MarketRole } from '@/types/market';
import type { AgenticExecutionStatus } from '@/types/harness';

// ── Mock harness-store (most execution detail is out of scope for this file —
// `compileCurrentCanvas`/`startExecution`/`executionStatus` are needed for
// FlowInspector's Run button and its `logic/flow-actions.ts` delegation) ────

const mockHarness = vi.hoisted(() => ({
  stepStatuses: {} as Record<string, string>,
  runStep: vi.fn(),
  runFromStep: vi.fn(),
  executionStatus: 'idle' as AgenticExecutionStatus,
  compileCurrentCanvas: vi.fn(),
  startExecution: vi.fn(),
}));

// Mocked as a callable selector PLUS a `getState()` static: FlowInspector's
// Export Flow/Export Markdown buttons delegate to `logic/flow-actions.ts`,
// which — being a plain async function rather than a hook — reads the store
// via `useHarnessStore.getState()`, the same way any zustand store exposes
// that method for use outside a component/hook.
vi.mock('../../store/harness-store', () => {
  const useHarnessStore = Object.assign(
    (selector: (s: typeof mockHarness) => unknown) => selector(mockHarness),
    { getState: () => mockHarness },
  );
  return { useHarnessStore };
});

// ── Mock StepInfoModal shallowly — its own internals are StepInfoModal.test.tsx's job ──
// `connections` is serialized onto a data attribute (rather than dropped) so
// the P10 render-isolation/liveness tests below can assert on it directly.

vi.mock('../desktop/StepInfoModal', () => ({
  StepInfoModal: (props: { stepId: string; connections: unknown }) => (
    <div
      data-testid="mock-step-info-modal"
      data-step-id={props.stepId}
      data-connections={JSON.stringify(props.connections)}
    />
  ),
}));

// ── Fixtures (mirrors StepInfoModal.test.tsx's — same shapes, same names) ───

const ROLE_A = { name: 'frontend-engineer', icon: 'MdCode', iconLibrary: 'md', description: 'Builds UI', tags: ['frontend'], color: '#E87040' };
const ROLE_B = { name: 'backend-engineer', icon: 'MdStorage', iconLibrary: 'md', description: 'Builds APIs', tags: ['backend'], color: '#4285F4' };
const MOD_LINT = { name: 'strict-linting', icon: 'MdRule', iconLibrary: 'md', description: 'Fail fast on lint drift', tags: ['quality'] };
const MOD_DS_A = { name: 'design-system-a', icon: 'MdPalette', iconLibrary: 'md', description: 'Design system A', tags: ['design'], incompatibleWith: ['design-system-b'] };
const MOD_DS_B = { name: 'design-system-b', icon: 'MdPalette', iconLibrary: 'md', description: 'Design system B', tags: ['design'], incompatibleWith: ['design-system-a'] };

const ROLE_DEVOPS: MarketRole = { name: 'devops-engineer', icon: 'MdCloud', iconLibrary: 'md', description: 'Runs infra', tags: ['infra'], color: '#4285F4', domains: ['infra'] };
const MOD_DARK_MODE: MarketMod = { name: 'dark-mode', icon: 'MdPalette', iconLibrary: 'md', description: 'Dark theme tokens', tags: ['design'], domains: ['frontend'] };
const MOD_UNIVERSAL: MarketMod = { name: 'self-review', icon: 'MdFactCheck', iconLibrary: 'md', description: 'Review before done', tags: ['process'], domains: ['universal'] };

// ── Helpers ──────────────────────────────────────────────────────────────────

function seedStep(overrides?: Partial<{ prompt: string; description: string }>) {
  const stepId = useDesktopStore.getState().addStepNode({
    position: { x: 0, y: 0 },
    title: 'Test Step',
    description: overrides?.description,
    prompt: overrides?.prompt,
  });
  useDesktopStore.getState().setMarketInventory({
    flows: [],
    roles: [ROLE_A, ROLE_B],
    mods: [MOD_LINT, MOD_DS_A, MOD_DS_B],
  });
  return stepId;
}

function selectNode(id: string) {
  useDesktopStore.getState().setSelectedMentalNodeIds([id]);
}

/** Re-reads a step's `data` fresh from the store after a committed edit. */
function freshStepData(stepId: string): StepNodeData {
  return (useDesktopStore.getState().mentalNodes.find((n) => n.id === stepId) as { data: StepNodeData }).data;
}

/** Re-reads a frame's `data` fresh from the store after a committed edit. */
function freshFrameData(frameId: string) {
  return (useDesktopStore.getState().mentalNodes.find((n) => n.id === frameId) as { data: import('@/types/desktop').FrameNodeData }).data;
}

// ── window.fluxorAPI stub (FlowInspector's Export Flow/Export Markdown —
// real logic/flow-actions.ts, real IPC bridge shape) ────────────────────────

function stubFluxorAPI(overrides: {
  exportFlow?: (...args: unknown[]) => unknown;
  saveFile?: (...args: unknown[]) => unknown;
} = {}) {
  const exportFlow = vi.fn(overrides.exportFlow ?? (() => Promise.resolve({ success: true })));
  const saveFile = vi.fn(overrides.saveFile ?? (() => Promise.resolve(true)));
  Object.defineProperty(window, 'fluxorAPI', {
    value: { exportFlow, saveFile },
    writable: true,
    configurable: true,
  });
  return { exportFlow, saveFile };
}

beforeEach(() => {
  useDesktopStore.setState(useDesktopStore.getInitialState(), true);
  useFluxorStore.setState(useFluxorStore.getInitialState(), true);
  mockHarness.stepStatuses = {};
  mockHarness.runStep.mockClear();
  mockHarness.runFromStep.mockClear();
  mockHarness.executionStatus = 'idle';
  mockHarness.compileCurrentCanvas.mockReset();
  mockHarness.startExecution.mockReset();
  delete (window as { fluxorAPI?: unknown }).fluxorAPI;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Selection routing ─────────────────────────────────────────────────────

describe('InspectorPanel — selection routing', () => {
  it('shows BoardInfo when nothing is selected', () => {
    render(<InspectorPanel />);
    expect(screen.getByTestId('inspector-board-info')).toBeInTheDocument();
  });

  it('shows StepInspector (with StepConfigCore embedded) when exactly one Step node is selected', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);

    expect(screen.getByTestId('inspector-step')).toBeInTheDocument();
    expect(screen.getByTestId('step-info-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('inspector-board-info')).not.toBeInTheDocument();
  });

  it('shows FlowInspector when exactly one Frame node is selected', () => {
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: ['a', 'b'],
    });
    selectNode(frameId);
    render(<InspectorPanel />);

    expect(screen.getByTestId('inspector-frame')).toBeInTheDocument();
    // Title is now a committable input (Phase 11), not static text.
    expect(screen.getByTestId('inspector-frame-title')).toHaveValue('My Flow');
    // 'a'/'b' are declared childIds that don't resolve to real nodes here —
    // the stat card still counts them (raw childIds.length), independent of
    // the resolved child list below it (see FlowInspector's child-list tests).
    expect(screen.getByTestId('inspector-frame-step-count')).toHaveTextContent('2');
  });

  it('shows a graceful NoteInspector fallback for a lone plain mental-card selection', () => {
    const noteId = useDesktopStore.getState().addMentalNode({
      position: { x: 0, y: 0 }, width: 160, height: 80, text: 'A sticky note', color: '#EDE9FE', shape: 'square',
    });
    selectNode(noteId);
    render(<InspectorPanel />);

    expect(screen.getByTestId('inspector-note')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-note-text')).toHaveTextContent('A sticky note');
  });

  it('shows MultiSelectInspector when multiple nodes are selected', () => {
    const stepA = seedStep();
    const stepB = useDesktopStore.getState().addStepNode({ position: { x: 10, y: 10 }, title: 'Step B' });
    useDesktopStore.getState().setSelectedMentalNodeIds([stepA, stepB]);
    render(<InspectorPanel />);

    expect(screen.getByTestId('inspector-multi')).toBeInTheDocument();
    expect(screen.getByTestId('inspector-multi-count')).toHaveTextContent('2 selected');
  });

  it('falls back to BoardInfo when the selected id no longer resolves to a node (stale selection)', () => {
    selectNode('node-that-was-deleted-elsewhere');
    render(<InspectorPanel />);
    expect(screen.getByTestId('inspector-board-info')).toBeInTheDocument();
  });
});

// ── BoardInfo ─────────────────────────────────────────────────────────────

describe('InspectorPanel — BoardInfo', () => {
  it('shows the active board name and step/flow/note/edge counts', () => {
    useDesktopStore.getState().renameBoard(useDesktopStore.getState().activeBoardId, 'My Board');
    const stepId = seedStep();
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'Flow 1', childIds: [],
    });
    useDesktopStore.getState().addMentalNode({
      position: { x: 0, y: 0 }, width: 100, height: 50, text: 'note', color: '#EDE9FE', shape: 'square',
    });
    useDesktopStore.getState().addMentalEdge(stepId, frameId);

    render(<InspectorPanel />);

    expect(screen.getByTestId('inspector-board-name')).toHaveTextContent('My Board');
    expect(screen.getByTestId('inspector-stat-steps')).toHaveTextContent('1');
    expect(screen.getByTestId('inspector-stat-flows')).toHaveTextContent('1');
    expect(screen.getByTestId('inspector-stat-notes')).toHaveTextContent('1');
    expect(screen.getByTestId('inspector-stat-edges')).toHaveTextContent('1');
  });

  it('falls back to a default name if somehow no board resolves', () => {
    useDesktopStore.setState({ boards: [], activeBoardId: 'missing' });
    render(<InspectorPanel />);
    expect(screen.getByTestId('inspector-board-name')).toHaveTextContent('Board');
  });
});

// ── StepInspector: title / description ───────────────────────────────────

describe('InspectorPanel — StepInspector title/description', () => {
  it('commits a title edit via updateStepData on blur', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);

    const titleInput = screen.getByTestId('inspector-step-title');
    fireEvent.change(titleInput, { target: { value: 'Renamed Step' } });
    fireEvent.blur(titleInput);

    expect(freshStepData(stepId).title).toBe('Renamed Step');
  });

  it('commits a title edit on Enter too', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);

    const titleInput = screen.getByTestId('inspector-step-title') as HTMLInputElement;
    titleInput.focus();
    fireEvent.change(titleInput, { target: { value: 'Renamed via Enter' } });
    fireEvent.keyDown(titleInput, { key: 'Enter' });

    expect(freshStepData(stepId).title).toBe('Renamed via Enter');
  });

  it('ignores a blank title — reverts the field instead of committing empty', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);

    const titleInput = screen.getByTestId('inspector-step-title');
    fireEvent.change(titleInput, { target: { value: '   ' } });
    fireEvent.blur(titleInput);

    expect(freshStepData(stepId).title).toBe('Test Step');
    expect(titleInput).toHaveValue('Test Step');
  });

  it('commits a description edit via updateStepData on blur', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);

    const descInput = screen.getByTestId('inspector-step-description');
    fireEvent.change(descInput, { target: { value: 'A new description' } });
    fireEvent.blur(descInput);

    expect(freshStepData(stepId).description).toBe('A new description');
  });
});

// ── StepConfigCore transplants (Instructions) ────────────────────────────

describe('InspectorPanel — StepConfigCore (instructions)', () => {
  it('seeds the textarea from description when prompt is unset', () => {
    const stepId = seedStep({ description: 'Legacy description text' });
    selectNode(stepId);
    render(<InspectorPanel />);
    expect(screen.getByTestId('step-info-prompt')).toHaveValue('Legacy description text');
  });

  it('persists edits into the store via updateStepData', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.change(screen.getByTestId('step-info-prompt'), {
      target: { value: 'Summarize the README in three bullets.' },
    });

    expect(freshStepData(stepId).prompt).toBe('Summarize the README in three bullets.');
  });
});

// ── StepConfigCore transplants (roles) ───────────────────────────────────

describe('InspectorPanel — StepConfigCore (role management)', () => {
  it('attaches a role via the picker and lists it with a remove button', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.change(screen.getByTestId('step-info-role-select'), { target: { value: ROLE_A.name } });
    fireEvent.click(screen.getByTestId('step-info-role-attach'));

    expect(freshStepData(stepId).roles.map((r) => r.name)).toEqual([ROLE_A.name]);
    expect(screen.getByTestId(`step-info-role-remove-${ROLE_A.name}`)).toBeInTheDocument();
  });

  it('honors one-role-per-step: attaching a second role replaces the first', () => {
    const stepId = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_A);
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.change(screen.getByTestId('step-info-role-select'), { target: { value: ROLE_B.name } });
    fireEvent.click(screen.getByTestId('step-info-role-attach'));

    expect(freshStepData(stepId).roles.map((r) => r.name)).toEqual([ROLE_B.name]);
    expect(screen.queryByTestId(`step-info-role-remove-${ROLE_A.name}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`step-info-role-remove-${ROLE_B.name}`)).toBeInTheDocument();
  });

  it('removes a role via its remove button', () => {
    const stepId = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_A);
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.click(screen.getByTestId(`step-info-role-remove-${ROLE_A.name}`));

    expect(freshStepData(stepId).roles).toEqual([]);
    expect(screen.getByText('No role assigned yet.')).toBeInTheDocument();
  });
});

// ── StepConfigCore transplants (mods) ─────────────────────────────────────

describe('InspectorPanel — StepConfigCore (mod management)', () => {
  it('attaches a mod via the picker and lists it with a remove button', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_LINT.name } });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    expect(freshStepData(stepId).mods.map((m) => m.name)).toEqual([MOD_LINT.name]);
    expect(screen.getByTestId(`step-info-mod-remove-${MOD_LINT.name}`)).toBeInTheDocument();
  });

  it('pre-filters an incompatible mod out of the picker options', () => {
    const stepId = seedStep();
    useDesktopStore.getState().addModToStep(stepId, MOD_DS_A);
    selectNode(stepId);
    render(<InspectorPanel />);

    const options = Array.from(screen.getByTestId('step-info-mod-select').querySelectorAll('option')).map((o) => o.textContent);
    expect(options).not.toContain('Design System B');
    expect(options).toContain('Strict Linting');
  });

  it('removes a mod via its remove button', () => {
    const stepId = seedStep();
    useDesktopStore.getState().addModToStep(stepId, MOD_LINT);
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.click(screen.getByTestId(`step-info-mod-remove-${MOD_LINT.name}`));

    expect(freshStepData(stepId).mods).toEqual([]);
    expect(screen.getByText('No mods assigned yet.')).toBeInTheDocument();
  });

  it('surfaces a rejection message when the store declines the add (e.g. a concurrent external attach)', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_LINT.name } });
    act(() => {
      useDesktopStore.getState().addModToStep(stepId, MOD_LINT);
    });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    expect(screen.getByText(/"Strict Linting" was rejected/i)).toBeInTheDocument();
  });
});

// ── StepConfigCore transplants (mod domain hint — non-blocking) ──────────

describe('InspectorPanel — StepConfigCore (mod domain hint)', () => {
  it('attaches the mod AND shows a muted, non-blocking hint when its domains are disjoint from the attached role\'s', () => {
    const stepId = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_DEVOPS);
    useDesktopStore.getState().setMarketInventory({ flows: [], roles: [ROLE_DEVOPS], mods: [MOD_DARK_MODE] });
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_DARK_MODE.name } });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    expect(freshStepData(stepId).mods.map((m) => m.name)).toEqual([MOD_DARK_MODE.name]);
    const hint = screen.getByTestId('step-info-mod-domain-hint');
    expect(hint).toHaveAttribute('role', 'status');
    expect(hint).toHaveTextContent('"dark-mode" targets frontend; the attached role "devops-engineer" covers infra. Attached anyway — it may be irrelevant here.');
  });

  it('shows no hint when the step has no role attached', () => {
    const stepId = seedStep();
    useDesktopStore.getState().setMarketInventory({ flows: [], roles: [], mods: [MOD_DARK_MODE] });
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_DARK_MODE.name } });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    expect(freshStepData(stepId).mods.map((m) => m.name)).toEqual([MOD_DARK_MODE.name]);
    expect(screen.queryByTestId('step-info-mod-domain-hint')).not.toBeInTheDocument();
  });

  it('shows no hint when the mod is universal (role-agnostic)', () => {
    const stepId = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_DEVOPS);
    useDesktopStore.getState().setMarketInventory({ flows: [], roles: [ROLE_DEVOPS], mods: [MOD_UNIVERSAL] });
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_UNIVERSAL.name } });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    expect(freshStepData(stepId).mods.map((m) => m.name)).toEqual([MOD_UNIVERSAL.name]);
    expect(screen.queryByTestId('step-info-mod-domain-hint')).not.toBeInTheDocument();
  });

  it('shows the hard-rejection error instead of the domain hint when the store declines the add', () => {
    const stepId = seedStep();
    useDesktopStore.getState().addRoleToStep(stepId, ROLE_DEVOPS);
    useDesktopStore.getState().setMarketInventory({ flows: [], roles: [ROLE_DEVOPS], mods: [MOD_DARK_MODE] });
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.change(screen.getByTestId('step-info-mod-select'), { target: { value: MOD_DARK_MODE.name } });
    act(() => {
      useDesktopStore.getState().addModToStep(stepId, MOD_DARK_MODE);
    });
    fireEvent.click(screen.getByTestId('step-info-mod-attach'));

    expect(screen.getByText(/"Dark Mode" was rejected/i)).toBeInTheDocument();
    expect(screen.queryByTestId('step-info-mod-domain-hint')).not.toBeInTheDocument();
  });
});

// ── StepConfigCore transplants (execution controls) ──────────────────────

describe('InspectorPanel — StepConfigCore (execution controls)', () => {
  it('Run this step calls harness-store runStep with the step id', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);
    fireEvent.click(screen.getByTestId('step-info-run'));
    expect(mockHarness.runStep).toHaveBeenCalledWith(stepId);
  });

  it('Run from here calls harness-store runFromStep with the step id', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);
    fireEvent.click(screen.getByTestId('step-info-run-from'));
    expect(mockHarness.runFromStep).toHaveBeenCalledWith(stepId);
  });

  it('disables both run buttons while the step is running', () => {
    const stepId = seedStep();
    selectNode(stepId);
    mockHarness.stepStatuses = { [stepId]: 'running' };
    render(<InspectorPanel />);
    expect(screen.getByTestId('step-info-run')).toBeDisabled();
    expect(screen.getByTestId('step-info-run-from')).toBeDisabled();
  });
});

// ── StepConfigCore transplants (model override) ──────────────────────────

describe('InspectorPanel — StepConfigCore (model override)', () => {
  it('renders empty by default (no override set on this step)', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);
    expect(screen.getByTestId('step-info-model-override')).toHaveValue('');
  });

  it('seeds the input from an existing data.model', () => {
    const stepId = seedStep();
    useDesktopStore.getState().updateStepData(stepId, { model: 'anthropic/claude-opus-4.6' });
    selectNode(stepId);
    render(<InspectorPanel />);
    expect(screen.getByTestId('step-info-model-override')).toHaveValue('anthropic/claude-opus-4.6');
  });

  it('persists edits into the store via updateStepData on change', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.change(screen.getByTestId('step-info-model-override'), {
      target: { value: 'openrouter/qwen-3-max' },
    });

    expect(freshStepData(stepId).model).toBe('openrouter/qwen-3-max');
  });

  it('trims whitespace and clears an existing override back to undefined on blur', () => {
    const stepId = seedStep();
    useDesktopStore.getState().updateStepData(stepId, { model: 'anthropic/claude-opus-4.6' });
    selectNode(stepId);
    render(<InspectorPanel />);

    fireEvent.blur(screen.getByTestId('step-info-model-override'), { target: { value: '   ' } });

    expect(freshStepData(stepId).model).toBeUndefined();
  });
});

// ── "Run evidence" opens the (mocked) StepInfoModal ──────────────────────

describe('InspectorPanel — Run evidence', () => {
  it('opens StepInfoModal (evidence-only) with this step\'s id when clicked', () => {
    const stepId = seedStep();
    selectNode(stepId);
    render(<InspectorPanel />);

    expect(screen.queryByTestId('mock-step-info-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('inspector-run-evidence-btn'));

    expect(screen.getByTestId('mock-step-info-modal')).toHaveAttribute('data-step-id', stepId);
  });
});

// ── Multi-select "Delete all" ────────────────────────────────────────────

describe('InspectorPanel — multi-select delete-all', () => {
  it('removes every selected node from the store', () => {
    const stepA = seedStep();
    const stepB = useDesktopStore.getState().addStepNode({ position: { x: 10, y: 10 }, title: 'Step B' });
    useDesktopStore.getState().setSelectedMentalNodeIds([stepA, stepB]);
    render(<InspectorPanel />);

    fireEvent.click(screen.getByTestId('inspector-delete-all-btn'));

    const remainingIds = useDesktopStore.getState().mentalNodes.map((n) => n.id);
    expect(remainingIds).not.toContain(stepA);
    expect(remainingIds).not.toContain(stepB);
  });
});

// ── FlowInspector: title/description/tags/author/version (Phase 11) ────────

describe('InspectorPanel — FlowInspector fields', () => {
  it('renders current title/description/tags/author/version values', () => {
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', description: 'A test flow', childIds: [],
    });
    useDesktopStore.getState().updateFrameData(frameId, { tags: ['alpha', 'beta'], author: 'Ada', version: '1.0.0' });
    selectNode(frameId);
    render(<InspectorPanel />);

    expect(screen.getByTestId('inspector-frame-title')).toHaveValue('My Flow');
    expect(screen.getByTestId('inspector-frame-description')).toHaveValue('A test flow');
    expect(screen.getByTestId('inspector-frame-tags')).toHaveValue('alpha, beta');
    expect(screen.getByTestId('inspector-frame-author')).toHaveValue('Ada');
    expect(screen.getByTestId('inspector-frame-version')).toHaveValue('1.0.0');
  });

  it('commits a title edit via updateFrameData on blur', () => {
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: [],
    });
    selectNode(frameId);
    render(<InspectorPanel />);

    const titleInput = screen.getByTestId('inspector-frame-title');
    fireEvent.change(titleInput, { target: { value: 'Renamed Flow' } });
    fireEvent.blur(titleInput);

    expect(freshFrameData(frameId).title).toBe('Renamed Flow');
  });

  it('commits a title edit on Enter too', () => {
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: [],
    });
    selectNode(frameId);
    render(<InspectorPanel />);

    const titleInput = screen.getByTestId('inspector-frame-title') as HTMLInputElement;
    titleInput.focus();
    fireEvent.change(titleInput, { target: { value: 'Renamed via Enter' } });
    fireEvent.keyDown(titleInput, { key: 'Enter' });

    expect(freshFrameData(frameId).title).toBe('Renamed via Enter');
  });

  it('ignores a blank title — reverts the field instead of committing empty', () => {
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: [],
    });
    selectNode(frameId);
    render(<InspectorPanel />);

    const titleInput = screen.getByTestId('inspector-frame-title');
    fireEvent.change(titleInput, { target: { value: '   ' } });
    fireEvent.blur(titleInput);

    expect(freshFrameData(frameId).title).toBe('My Flow');
    expect(titleInput).toHaveValue('My Flow');
  });

  it('commits a description edit via updateFrameData on blur', () => {
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: [],
    });
    selectNode(frameId);
    render(<InspectorPanel />);

    const descInput = screen.getByTestId('inspector-frame-description');
    fireEvent.change(descInput, { target: { value: 'A new description' } });
    fireEvent.blur(descInput);

    expect(freshFrameData(frameId).description).toBe('A new description');
  });

  it('commits tags via updateFrameData on blur, trimming and dropping empty entries', () => {
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: [],
    });
    selectNode(frameId);
    render(<InspectorPanel />);

    const tagsInput = screen.getByTestId('inspector-frame-tags');
    fireEvent.change(tagsInput, { target: { value: 'alpha,  beta ,,gamma' } });
    fireEvent.blur(tagsInput);

    expect(freshFrameData(frameId).tags).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('commits author and version edits via updateFrameData on blur', () => {
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: [],
    });
    selectNode(frameId);
    render(<InspectorPanel />);

    fireEvent.change(screen.getByTestId('inspector-frame-author'), { target: { value: 'Ada Lovelace' } });
    fireEvent.blur(screen.getByTestId('inspector-frame-author'));
    fireEvent.change(screen.getByTestId('inspector-frame-version'), { target: { value: '3.1.4' } });
    fireEvent.blur(screen.getByTestId('inspector-frame-version'));

    expect(freshFrameData(frameId).author).toBe('Ada Lovelace');
    expect(freshFrameData(frameId).version).toBe('3.1.4');
  });

  it('Escape reverts the title draft to the last-committed value', () => {
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: [],
    });
    selectNode(frameId);
    render(<InspectorPanel />);

    const titleInput = screen.getByTestId('inspector-frame-title');
    fireEvent.change(titleInput, { target: { value: 'Half-typed edit' } });
    fireEvent.keyDown(titleInput, { key: 'Escape' });

    expect(titleInput).toHaveValue('My Flow');
  });
});

// ── FlowInspector: step count + child list (Phase 11) ───────────────────────

describe('InspectorPanel — FlowInspector child list', () => {
  it('lists resolved child steps and clicking one moves the canvas selection to it', () => {
    const stepId = useDesktopStore.getState().addStepNode({ position: { x: 0, y: 0 }, title: 'Child Step' });
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: [stepId],
    });
    selectNode(frameId);
    render(<InspectorPanel />);

    const childRow = screen.getByTestId(`inspector-frame-child-${stepId}`);
    expect(childRow).toHaveTextContent('Child Step');

    fireEvent.click(childRow);

    expect(useDesktopStore.getState().selectedMentalNodeIds).toEqual([stepId]);
  });

  it('does not render a row for a declared childId that has no resolving Step node', () => {
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: ['ghost-step'],
    });
    selectNode(frameId);
    render(<InspectorPanel />);

    expect(screen.queryByTestId('inspector-frame-child-ghost-step')).not.toBeInTheDocument();
    expect(screen.getByText('No steps resolved on the canvas yet.')).toBeInTheDocument();
  });
});

// ── FlowInspector: Run / Export Flow / Export Markdown (Phase 11) ──────────

describe('InspectorPanel — FlowInspector actions', () => {
  function seedFlowSelection() {
    const stepId = useDesktopStore.getState().addStepNode({ position: { x: 0, y: 0 }, title: 'Step A' });
    const frameId = useDesktopStore.getState().addFrameNode({
      position: { x: 0, y: 0 }, width: 300, height: 200, title: 'My Flow', childIds: [stepId],
    });
    selectNode(frameId);
    return { frameId, stepId };
  }

  it('Run compiles the canvas and starts execution when compilation succeeds', () => {
    mockHarness.compileCurrentCanvas.mockReturnValue({ id: 'flow-1', name: 'My Flow', rootStepId: 'root', stepsRecord: {} });
    seedFlowSelection();
    render(<InspectorPanel />);

    fireEvent.click(screen.getByTestId('inspector-frame-run'));

    expect(mockHarness.compileCurrentCanvas).toHaveBeenCalledTimes(1);
    expect(mockHarness.startExecution).toHaveBeenCalledTimes(1);
  });

  it('Run does not start execution when compileCurrentCanvas returns null', () => {
    mockHarness.compileCurrentCanvas.mockReturnValue(null);
    seedFlowSelection();
    render(<InspectorPanel />);

    fireEvent.click(screen.getByTestId('inspector-frame-run'));

    expect(mockHarness.compileCurrentCanvas).toHaveBeenCalledTimes(1);
    expect(mockHarness.startExecution).not.toHaveBeenCalled();
  });

  it('Run is disabled while the flow is executing', () => {
    mockHarness.executionStatus = 'running';
    seedFlowSelection();
    render(<InspectorPanel />);

    expect(screen.getByTestId('inspector-frame-run')).toBeDisabled();
  });

  it('Export Flow compiles the canvas and calls window.fluxorAPI.exportFlow with the compiled flow', async () => {
    const compiledFlow = { id: 'flow-1', name: 'My Flow', rootStepId: 'root', stepsRecord: {} };
    mockHarness.compileCurrentCanvas.mockReturnValue(compiledFlow);
    const api = stubFluxorAPI({ exportFlow: () => Promise.resolve({ success: true, path: '/tmp/flow-1.flow.json' }) });
    seedFlowSelection();
    render(<InspectorPanel />);

    fireEvent.click(screen.getByTestId('inspector-frame-export'));

    expect(mockHarness.compileCurrentCanvas).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.exportFlow).toHaveBeenCalledWith(compiledFlow));
  });

  it('Export Markdown compiles the canvas and calls window.fluxorAPI.saveFile with a .md default name', async () => {
    const compiledFlow = { id: 'flow-42', name: 'My Flow', rootStepId: 'root', stepsRecord: {} };
    mockHarness.compileCurrentCanvas.mockReturnValue(compiledFlow);
    const api = stubFluxorAPI();
    seedFlowSelection();
    render(<InspectorPanel />);

    fireEvent.click(screen.getByTestId('inspector-frame-export-md'));

    expect(mockHarness.compileCurrentCanvas).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.saveFile).toHaveBeenCalledWith('flow-42.md', expect.any(String)));
  });

  it('Export Markdown shows an error toast and never calls saveFile when the canvas fails to compile', async () => {
    mockHarness.compileCurrentCanvas.mockReturnValue(null);
    const api = stubFluxorAPI();
    seedFlowSelection();
    render(<InspectorPanel />);

    fireEvent.click(screen.getByTestId('inspector-frame-export-md'));

    await waitFor(() => {
      expect(useFluxorStore.getState().toasts.some((t) => t.type === 'error')).toBe(true);
    });
    expect(api.saveFile).not.toHaveBeenCalled();
  });
});

// ── Render isolation regression (drag-tick perf) ─────────────────────────
// Guards the fix to InspectorPanel's `resolvedNodes`/`boardCounts`/
// `stepStatus` selectors: repositioning a node (e.g. `MentalGraphCanvas`
// dragging it — see `updateMentalNode` in desktop-store.ts, which rebuilds
// the `mentalNodes` array via `.map()` on every drag frame) must not
// reconcile this always-mounted column when nothing it displays actually
// changed. "Nothing changed" has no DOM signal to assert against, so this
// probes actual React commits via `<Profiler>` instead.
//
// Deliberately exercised with NOTHING selected (the BoardInfo body, which is
// mounted by default — exactly the "mounted by default" phrasing from the
// original bug report) rather than with a Step selected: at the time this
// probe was written, StepInspector (a sibling file, out of this fix's scope)
// subscribed to raw `mentalNodes`/`mentalEdges` for its own
// `computeStepConnections` call, so it re-rendered on ANY node patch
// independent of InspectorPanel's fix — mounting it here would have falsely
// failed this probe on an unrelated, pre-existing subscription.
//
// That StepInspector-side leak (P10) is now fixed too (see StepInspector.tsx's
// Subscriptions A/B) — the "StepInspector render isolation" describe below
// covers it with a step actually selected.

describe('InspectorPanel — render isolation (drag-tick perf regression)', () => {
  it('does not re-render when a node is repositioned and the change is irrelevant to what is displayed', () => {
    const stepId = seedStep();

    let renderCount = 0;
    render(
      <Profiler id="inspector-probe" onRender={() => { renderCount += 1; }}>
        <InspectorPanel />
      </Profiler>,
    );
    const afterMount = renderCount;

    // A position patch never changes stepCount/flowCount/noteCount/edgeCount
    // (BoardInfo's only inputs) nor the (empty) selection — a true no-op for
    // InspectorPanel, and the exact shape of a canvas drag tick.
    act(() => {
      useDesktopStore.getState().updateMentalNode(stepId, { position: { x: 999, y: 999 } });
    });

    expect(renderCount).toBe(afterMount);
  });

  it('sanity check: DOES re-render when a change relevant to BoardInfo occurs (proves the probe is live)', () => {
    seedStep();

    let renderCount = 0;
    render(
      <Profiler id="inspector-probe" onRender={() => { renderCount += 1; }}>
        <InspectorPanel />
      </Profiler>,
    );
    const afterMount = renderCount;

    act(() => {
      useDesktopStore.getState().addStepNode({ position: { x: 10, y: 10 }, title: 'Another Step' });
    });

    expect(renderCount).toBeGreaterThan(afterMount);
  });
});

// ── StepInspector render isolation (P10 — drag-tick perf regression) ────
// Covers the gap the probe above deliberately left open: WITH a step
// selected, StepInspector used to subscribe to the RAW `mentalNodes`/
// `mentalEdges` arrays for its own `computeStepConnections` call.
// `updateMentalNode` rebuilds the `mentalNodes` array (via `.map()`) on
// every drag frame — untouched nodes keep their old object reference, but
// the ARRAY itself is always a new reference — so that raw subscription
// changed on every tick regardless of which node moved, re-rendering
// StepInspector (and therefore this always-mounted Inspector column) on
// ANY node drag whenever a step was selected. Fixed with two narrow
// subscriptions (this step's own edges; only the connected-step titles
// `connections` can actually surface) — see StepInspector.tsx.
// Same Profiler-commit-counting technique as the describe above.

describe('InspectorPanel — StepInspector render isolation (drag-tick perf regression)', () => {
  it('does not re-render when an unselected, unconnected node is repositioned while a step is selected', () => {
    const stepId = seedStep();
    const otherStepId = useDesktopStore.getState().addStepNode({
      position: { x: 50, y: 50 }, title: 'Unrelated Step',
    });
    selectNode(stepId);

    let renderCount = 0;
    render(
      <Profiler id="inspector-probe" onRender={() => { renderCount += 1; }}>
        <InspectorPanel />
      </Profiler>,
    );
    const afterMount = renderCount;

    // The exact shape of a canvas drag tick on some OTHER, unconnected node:
    // irrelevant to StepInspector's edges subscription (no edge touches
    // `stepId`) and its titles subscription (no connected title changed).
    act(() => {
      useDesktopStore.getState().updateMentalNode(otherStepId, { position: { x: 999, y: 999 } });
    });

    expect(renderCount).toBe(afterMount);
  });

  it('sanity check: DOES commit and shows the new title when a CONNECTED step is renamed (proves the probe is live)', () => {
    const stepId = seedStep();
    const connectedId = useDesktopStore.getState().addStepNode({
      position: { x: 50, y: 50 }, title: 'Loop Source',
    });
    // A loop edge FROM connectedId TO stepId makes `stepId` the loop's
    // TARGET — `connections.loopIn.fromTitle` resolves to `connectedId`'s
    // title, exactly what this rename changes (the only two fields in
    // `connections` that are ever resolved through a node title at all —
    // see StepInspector.tsx's Subscription B).
    useDesktopStore.getState().addMentalEdge(connectedId, stepId, 'loop', undefined, undefined, 5);
    selectNode(stepId);

    let renderCount = 0;
    render(
      <Profiler id="inspector-probe" onRender={() => { renderCount += 1; }}>
        <InspectorPanel />
      </Profiler>,
    );
    fireEvent.click(screen.getByTestId('inspector-run-evidence-btn'));
    const afterOpen = renderCount;

    act(() => {
      useDesktopStore.getState().updateStepData(connectedId, { title: 'Renamed Loop Source' });
    });

    expect(renderCount).toBeGreaterThan(afterOpen);
    const connections = JSON.parse(
      screen.getByTestId('mock-step-info-modal').getAttribute('data-connections') ?? '{}',
    );
    expect(connections.loopIn.fromTitle).toBe('Renamed Loop Source');
  });
});

// ── Collapse ──────────────────────────────────────────────────────────────

describe('InspectorPanel — collapse', () => {
  it('sets settings.showInspector to false when the collapse button is clicked', () => {
    render(<InspectorPanel />);
    fireEvent.click(screen.getByTestId('inspector-collapse-btn'));
    expect(useDesktopStore.getState().settings.showInspector).toBe(false);
  });
});
