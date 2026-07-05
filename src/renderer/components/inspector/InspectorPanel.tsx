/**
 * InspectorPanel.tsx — Figma-like right-side inspector bound to canvas selection
 *
 * Responsibility:
 * - Renders the third (rightmost) column of the IDE shell: a collapsible
 *   panel whose content routes off `selectedMentalNodeIds` (desktop-store).
 *   This is now the PRIMARY step-config surface — StepInfoModal is reached
 *   from here (via StepInspector's "Run evidence" button) and is itself
 *   trimmed to read-only execution evidence.
 * - Owns the header (label + collapse button) and the 0/1/many-selection
 *   routing. The 0/note/multi-select bodies are small enough to live here
 *   directly (BoardInfo/NoteInspector/MultiSelectInspector); the Step and
 *   Frame cases are each their own file (`StepInspector.tsx`,
 *   `FlowInspector.tsx`) since they own local edit state (and, for Step,
 *   embed `StepConfigCore`/`StepInfoModal`).
 *
 * Boundaries:
 * - Owns: selection→body routing, the collapse action, and the read-only
 *   Board/Note/multi-select summaries below.
 * - Does NOT own: step edit state (StepInspector.tsx), flow edit state
 *   (FlowInspector.tsx), the canvas selection itself (xyflow/MentalGraphCanvas
 *   drives `setSelectedMentalNodeIds`), or board CRUD (desktop-store's
 *   `createBoard`/`switchBoard`/etc. — this only reads `boards`/`activeBoardId`
 *   to display the active board's name).
 *
 * Performance:
 * - This panel is mounted for the lifetime of the IDE shell (only its
 *   contents change), and the canvas fires a store `set()` on every pan/
 *   zoom/drag tick. Every selector below is written to resolve to either a
 *   primitive or a `useShallow`-compared small object/array, so this column
 *   only re-renders when something it actually displays changes — see the
 *   inline comments on `resolvedNodes`/`boardCounts`/`stepStatus` below for
 *   the specifics (esp. how `updateMentalNode`'s per-node reference
 *   stability during drags makes this possible).
 */
import React, { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { LucideIcon } from '@/renderer/components/desktop/LucideIcon';
import { StepInspector } from './StepInspector';
import { FlowInspector } from './FlowInspector';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import { useHarnessStore } from '@/renderer/store/harness-store';
import type { CanvasGraphNode, FrameGraphNode, MentalGraphNode, StepGraphNode } from '@/types/desktop';

function isStepNode(node: CanvasGraphNode): node is StepGraphNode {
  return node.type === 'step';
}

function isFrameNode(node: CanvasGraphNode): node is FrameGraphNode {
  return node.type === 'frame';
}

// ─── 0 selected — active board summary ─────────────────────────────

function BoardInfo({
  boardName,
  stepCount,
  flowCount,
  noteCount,
  edgeCount,
}: {
  boardName: string;
  stepCount: number;
  flowCount: number;
  noteCount: number;
  edgeCount: number;
}) {
  return (
    <div data-testid="inspector-board-info">
      <h3 className="step-config-section-label">Board</h3>
      <p className="step-config-title" data-testid="inspector-board-name">{boardName}</p>
      <div className="step-config-connections" style={{ marginTop: 10 }}>
        <div className="step-config-connection-card">
          <div className="step-config-connection-label">Steps</div>
          <div className="step-config-connection-value" data-testid="inspector-stat-steps">{stepCount}</div>
        </div>
        <div className="step-config-connection-card">
          <div className="step-config-connection-label">Flows</div>
          <div className="step-config-connection-value" data-testid="inspector-stat-flows">{flowCount}</div>
        </div>
        <div className="step-config-connection-card">
          <div className="step-config-connection-label">Notes</div>
          <div className="step-config-connection-value" data-testid="inspector-stat-notes">{noteCount}</div>
        </div>
        <div className="step-config-connection-card">
          <div className="step-config-connection-label">Edges</div>
          <div className="step-config-connection-value" data-testid="inspector-stat-edges">{edgeCount}</div>
        </div>
      </div>
      <p className="step-config-hint" style={{ marginTop: 12 }}>
        Select a step, flow, or note on the canvas to inspect it here.
      </p>
    </div>
  );
}

// ─── 1 plain mental ("note") card selected ─────────────────────────
// Not explicitly designed yet (Phase 8 only specs Step/Frame/multi/empty) —
// this graceful fallback keeps a lone note selection from rendering a blank
// panel rather than leaving the user without feedback.

function NoteInspector({ node }: { node: MentalGraphNode }) {
  return (
    <div data-testid="inspector-note">
      <h3 className="step-config-section-label">Note</h3>
      <p className="step-config-title" data-testid="inspector-note-text">{node.text || 'Untitled note'}</p>
      <p className="step-config-hint" style={{ marginTop: 12 }}>Note tools land in a future phase.</p>
    </div>
  );
}

// ─── Multi-select ───────────────────────────────────────────────────

function MultiSelectInspector({ count, onDeleteAll }: { count: number; onDeleteAll: () => void }) {
  return (
    <div data-testid="inspector-multi">
      <h3 className="step-config-section-label">Selection</h3>
      <p className="step-config-title" data-testid="inspector-multi-count">{count} selected</p>
      <button
        type="button"
        className="inspector-delete-all-btn"
        data-testid="inspector-delete-all-btn"
        onClick={onDeleteAll}
      >
        <LucideIcon name="Trash2" size={13} />
        Delete all
      </button>
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────

export function InspectorPanel() {
  // Resolve selected ids → live node OBJECTS in one shallow-compared
  // selector, instead of subscribing to the raw `selectedMentalNodeIds`/
  // `mentalNodes` array references separately and re-deriving this on every
  // render (the previous approach):
  // - Stale-id fallback: mapping ids → nodes (rather than branching on
  //   `selectedMentalNodeIds.length` directly) means a stale id left over
  //   from a deletion elsewhere gracefully falls back toward "0 resolved"
  //   instead of rendering a routing case for a node that no longer exists.
  // - Drag perf: `updateMentalNode` rebuilds the `mentalNodes` ARRAY via
  //   `.map()` on every drag frame, but every node the patch doesn't touch
  //   keeps its OLD object reference (non-matching entries pass through as
  //   `n` untouched — see `updateMentalNode` in desktop-store.ts). Because
  //   we resolve down to node OBJECTS here (not the raw array), `useShallow`
  //   sees identical references for anything outside `selectedMentalNodeIds`
  //   and bails out — so dragging an unselected node no longer reconciles
  //   this always-mounted column on every frame. It only re-renders when the
  //   selection itself changes or a SELECTED node's object actually changes.
  const resolvedNodes = useDesktopStore(
    useShallow((s) =>
      s.selectedMentalNodeIds
        .map((id) => s.mentalNodes.find((n) => n.id === id))
        .filter((n): n is CanvasGraphNode => n !== undefined),
    ),
  );

  // Primitive (string) selector — Object.is equality is enough, so this
  // re-renders only when the active board's *name* actually changes, not on
  // every unrelated store tick (pan/zoom/drag).
  const boardName = useDesktopStore((s) => s.boards.find((b) => b.id === s.activeBoardId)?.name ?? 'Board');

  // BoardInfo's four stats, computed with plain counters instead of three
  // separate `.filter()` array allocations, and shallow-compared as a group.
  // This still RECOMPUTES on every mentalNodes/mentalEdges change (that part
  // is unavoidable — we need fresh counts to know whether they moved), but
  // the component only RE-RENDERS when one of the four numbers actually
  // differs from last time.
  const boardCounts = useDesktopStore(
    useShallow((s) => {
      let stepCount = 0;
      let flowCount = 0;
      let noteCount = 0;
      for (const node of s.mentalNodes) {
        if (node.type === 'step') stepCount++;
        else if (node.type === 'frame') flowCount++;
        else if (node.type === 'mental') noteCount++;
      }
      return { stepCount, flowCount, noteCount, edgeCount: s.mentalEdges.length };
    }),
  );

  const updateSettings = useDesktopStore((s) => s.updateSettings);
  const removeMentalNode = useDesktopStore((s) => s.removeMentalNode);

  // Single-step status only: read just the ONE selected step's status (a
  // primitive) rather than subscribing to the entire `stepStatuses` map, so
  // some OTHER step finishing/failing no longer re-renders this panel. Hooks
  // must stay unconditional, so this selector always runs — `selectedStepId`
  // (derived below from `resolvedNodes`, already resolved above) is
  // `undefined` whenever the selection isn't exactly one Step, and the
  // selector mirrors that back out as `undefined` rather than branching.
  const singleNode = resolvedNodes.length === 1 ? resolvedNodes[0] : undefined;
  const selectedStepId = singleNode !== undefined && isStepNode(singleNode) ? singleNode.id : undefined;
  const stepStatus = useHarnessStore((s) => (selectedStepId !== undefined ? s.stepStatuses[selectedStepId] : undefined));

  const collapse = useCallback(() => updateSettings({ showInspector: false }), [updateSettings]);

  let body: React.ReactNode;
  if (resolvedNodes.length === 0) {
    body = (
      <BoardInfo
        boardName={boardName}
        stepCount={boardCounts.stepCount}
        flowCount={boardCounts.flowCount}
        noteCount={boardCounts.noteCount}
        edgeCount={boardCounts.edgeCount}
      />
    );
  } else if (resolvedNodes.length === 1) {
    const node = resolvedNodes[0];
    if (isStepNode(node)) {
      body = <StepInspector key={node.id} stepId={node.id} stepData={node.data} status={stepStatus} />;
    } else if (isFrameNode(node)) {
      body = <FlowInspector key={node.id} frameId={node.id} frameData={node.data} />;
    } else {
      body = <NoteInspector node={node as MentalGraphNode} />;
    }
  } else {
    const ids = resolvedNodes.map((n) => n.id);
    body = (
      <MultiSelectInspector
        count={ids.length}
        onDeleteAll={() => ids.forEach((id) => removeMentalNode(id))}
      />
    );
  }

  return (
    <div className="inspector-panel panel-border-l" data-testid="inspector-panel">
      <div className="inspector-header">
        <LucideIcon name="Settings" size={13} />
        <span className="inspector-header-label">Inspector</span>
        <button
          type="button"
          className="inspector-collapse-btn"
          onClick={collapse}
          title="Collapse inspector (⌘.)"
          aria-label="Collapse inspector"
          data-testid="inspector-collapse-btn"
        >
          <LucideIcon name="ChevronRight" size={16} />
        </button>
      </div>
      <div className="inspector-body">
        {body}
      </div>
    </div>
  );
}
