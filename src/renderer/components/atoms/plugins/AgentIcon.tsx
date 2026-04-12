/**
 * AgentIcon.tsx — Renderer Plugin Surface Component
 *
 * Responsibility:
 * - Renders the AgentIcon surface in the renderer layer.
 * - Encapsulates Plugin-facing UI surface rendered inside the desktop shell.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useEffect } from 'react';
import type { SessionStatus } from '@/types';
import { RunningBars } from './RunningBars';
import { TickSvg } from './TickSvg';
import { CrossSvg } from './CrossSvg';

export interface AgentIconState {
  sessionId: string;
  sessionNumber: number;
  status: SessionStatus;
  prevStatus: SessionStatus | null;
  animatingOut: boolean;
}

export function AgentIcon({ icon, onDone }: { icon: AgentIconState; onDone: (id: string) => void }) {
  const isRunning = icon.status === 'running';
  const isCompleted = icon.status === 'completed';
  const isError = icon.status === 'error' || icon.status === 'stopped';
  const isTerminal = isCompleted || isError;

  useEffect(() => {
    if (isTerminal) {
      onDone(icon.sessionId);
    }
  }, [isTerminal, icon.sessionId, onDone]);

  return (
    <div
      className="agent-icon"
      data-status={icon.status}
      title={`Session ${icon.sessionNumber} — ${icon.status}`}
      aria-label={`Agent session ${icon.sessionNumber}: ${icon.status}`}
    >
      <div className="agent-icon-inner" aria-hidden="true">
        {isRunning && <RunningBars />}
        {isCompleted && <TickSvg />}
        {isError && <CrossSvg />}
        <span className="agent-icon-badge">{icon.sessionNumber}</span>
      </div>
    </div>
  );
}
