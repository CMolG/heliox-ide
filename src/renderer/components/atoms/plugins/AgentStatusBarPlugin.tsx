/**
 * AgentStatusBarPlugin.tsx — Renderer Plugin Surface Component
 *
 * Responsibility:
 * - Renders the AgentStatusBarPlugin surface in the renderer layer.
 * - Encapsulates Plugin-facing UI surface rendered inside the desktop shell.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/AgentStatusBar.tsx — Floating top bar showing active/completed agent sessions
import React, { useEffect, useRef, useState } from 'react';
import { useHelioxStore } from '../../../store';
import { AgentIcon } from './AgentIcon';
import type { AgentIconState } from './AgentIcon';

export function AgentStatusBarPlugin() {
  const sessions = useHelioxStore(s => s.sessions);
  const [icons, setIcons] = useState<AgentIconState[]>([]);
  const prevSessionsRef = useRef<typeof sessions>([]);
  // Track which sessions have been dismissed after completion animation
  const dismissedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const activeSessions = sessions.filter(
      s => s.status === 'running' || s.status === 'completed' || s.status === 'error' || s.status === 'stopped'
    );

    setIcons(prev => {
      const newIcons: AgentIconState[] = [];

      for (const session of activeSessions) {
        if (dismissedRef.current.has(session.id)) continue;

        const existing = prev.find(i => i.sessionId === session.id);
        const isTerminal = session.status === 'completed' || session.status === 'error' || session.status === 'stopped';

        if (existing) {
          const statusChanged = existing.status !== session.status;
          newIcons.push({
            ...existing,
            prevStatus: statusChanged ? existing.status : existing.prevStatus,
            status: session.status,
            animatingOut: isTerminal,
          });
        } else {
          newIcons.push({
            sessionId: session.id,
            sessionNumber: session.number,
            status: session.status,
            prevStatus: null,
            animatingOut: isTerminal,
          });
        }
      }

      return newIcons;
    });

    prevSessionsRef.current = sessions;
  }, [sessions]);

  // Auto-dismiss completed icons after animation
  const handleAnimationEnd = (sessionId: string) => {
    setTimeout(() => {
      dismissedRef.current.add(sessionId);
      setIcons(prev => prev.filter(i => i.sessionId !== sessionId));
    }, 4000); // Keep visible for 4s after transition
  };

  if (icons.length === 0) return null;

  return (
    <div className="agent-status-bar" role="status" aria-label="Agent status">
      {icons.map(icon => (
        <AgentIcon key={icon.sessionId} icon={icon} onDone={handleAnimationEnd} />
      ))}
    </div>
  );
}

