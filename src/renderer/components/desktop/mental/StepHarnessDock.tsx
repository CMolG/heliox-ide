/**
 * StepHarnessDock.tsx — Phase 1 StepNode test dock
 *
 * Responsibility:
 * - Provides a compact creation/drop-test surface for the StepNode sprint.
 * - Lets users spawn StepNodes and drag sample Mods/Roles onto them.
 */
import React, { useCallback, useEffect } from 'react';
import type { MarketMod, MarketRole } from '@/types/market';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHarnessStore } from '../../../store/harness-store';
import { LucideIcon } from '../LucideIcon';
import { DraggableModBadge } from './DraggableModBadge';

const FALLBACK_MODS: MarketMod[] = [
  {
    name: 'strict-linting',
    icon: 'MdRule',
    iconLibrary: 'md',
    description: 'Fail fast on lint drift',
    tags: ['quality', 'lint'],
  },
  {
    name: 'security-hardened',
    icon: 'MdSecurity',
    iconLibrary: 'md',
    description: 'Bias the agent toward secure defaults',
    tags: ['security'],
  },
];

const FALLBACK_ROLE: MarketRole = {
  name: 'frontend-engineer',
  icon: 'MdCode',
  iconLibrary: 'md',
  description: 'Builds polished, accessible frontend systems',
  tags: ['frontend', 'react'],
  color: '#E87040',
};

export function StepHarnessDock() {
  const marketInventory = useDesktopStore((s) => s.marketInventory);
  const addStepNode = useDesktopStore((s) => s.addStepNode);
  const stepCount = useDesktopStore((s) => s.mentalNodes.filter((node) => node.type === 'step').length);
  const compileCurrentCanvas = useHarnessStore((s) => s.compileCurrentCanvas);
  const startExecution = useHarnessStore((s) => s.startExecution);
  const executionStatus = useHarnessStore((s) => s.executionStatus);
  const subscribeToHarnessEvents = useHarnessStore((s) => s.subscribeToHarnessEvents);
  const unsubscribeFromHarnessEvents = useHarnessStore((s) => s.unsubscribeFromHarnessEvents);

  const strictLinting = marketInventory?.mods.find((mod) => mod.name === 'strict-linting') ?? FALLBACK_MODS[0];
  const secondaryMod = marketInventory?.mods.find((mod) => mod.name !== strictLinting.name) ?? FALLBACK_MODS[1];
  const role = marketInventory?.roles.find((item) => item.name === 'frontend-engineer') ?? FALLBACK_ROLE;

  const handleAddStep = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    addStepNode({
      title: `Pipeline step ${stepCount + 1}`,
      description: 'Compose role and mod constraints here.',
    });
  }, [addStepNode, stepCount]);

  const stopCanvasGesture = useCallback((event: React.MouseEvent | React.PointerEvent) => {
    event.stopPropagation();
  }, []);

  useEffect(() => {
    subscribeToHarnessEvents();
    return () => {
      unsubscribeFromHarnessEvents();
    };
  }, [subscribeToHarnessEvents, unsubscribeFromHarnessEvents]);

  const handleCompileRun = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    const flow = compileCurrentCanvas();
    if (flow) {
      console.log('[Heliox Harness AST]', JSON.stringify(flow, null, 2));
      void startExecution();
    } else {
      console.warn('[Heliox Harness AST] Compile failed. Check useHarnessStore.executionLogs for details.');
    }
  }, [compileCurrentCanvas, startExecution]);

  return (
    <aside
      className="step-harness-dock"
      data-testid="step-harness-dock"
      aria-label="Step harness dock"
      onMouseDown={stopCanvasGesture}
      onPointerDown={stopCanvasGesture}
      onDoubleClick={stopCanvasGesture}
    >
      <div className="step-harness-dock-header">
        <span>Harness</span>
        <button
          type="button"
          className="step-harness-add"
          data-testid="add-step-node-button"
          aria-label="Add Step node"
          onClick={handleAddStep}
        >
          <LucideIcon name="Plus" size={13} />
          <span>Step</span>
        </button>
      </div>

      <button
        type="button"
        className="step-harness-export"
        data-testid="compile-export-json-button"
        aria-label="Compile and run harness"
        disabled={executionStatus === 'compiling' || executionStatus === 'running'}
        onClick={handleCompileRun}
      >
        <LucideIcon name="Play" size={13} />
        <span>{executionStatus === 'running' ? 'Harness Running' : 'Compile & Run'}</span>
      </button>

      <div className="step-harness-badges">
        <DraggableModBadge atomType="mod" item={strictLinting} />
        <DraggableModBadge atomType="mod" item={secondaryMod} />
        <DraggableModBadge atomType="role" item={role} />
      </div>
    </aside>
  );
}
