/**
 * AttachableFlow.tsx — Renderer Attachable Component
 *
 * Responsibility:
 * - Renders the AttachableFlow surface in the renderer layer.
 * - Encapsulates Attachable panel implementation docked to desktop windows.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/attachables/AttachableFlow.tsx
import React, { useState } from 'react';
import { MarketFlow } from '@/types/market';
import type { AgenticExecutionStatus } from '@/types/harness';
import { theme } from '../../../logic/theme';
import { AttachableWrapper } from '../AttachableWrapper';
import * as MdIcons from 'react-icons/md'; // Importamos todos los iconos de Material

// ─── Props ───────────────────────────────────────────────────────

// Reconciled with the canonical AgenticExecutionStatus (src/types/harness.ts)
// instead of keeping its own drifted 4-value copy — states-polish.md §2:
// "AttachableFlow.tsx defines its own local FlowStatus with a working Start
// button for 'paused' — but harness-store.ts never sets the canonical status
// to 'paused'. Two models of the same concept; one is fiction." Safe to do
// here: AttachableContent.tsx is this component's only call site and it
// never passes a `status` prop, so every render today already falls back to
// the `= 'idle'` default below regardless of this type change. Kept as a
// local alias (rather than importing AgenticExecutionStatus at every
// reference below) so the rest of this file didn't need to change names.
type FlowStatus = AgenticExecutionStatus;

interface AttachableFlowProps {
  flow: MarketFlow;
  status?: FlowStatus;
  onStart?: () => void;
  onPause?: () => void;
  onStop?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────

function kebabToTitle(str: string): string {
  return str
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
}

function resolveFlowIcon(iconName: string): React.ComponentType<{ size?: number }> {
  return (MdIcons as any)[iconName] || MdIcons.MdExtension;
}

const InfinityIcon = MdIcons.MdAllInclusive;

const complexityColors: Record<string, string> = {
  low: theme.success,
  medium: theme.warning,
  high: theme.danger,
};

// ─── Inline keyframe injection ───────────────────────────────────

const FLOW_ANIMATION_ID = 'fluxor-flow-animations';

function ensureFlowAnimations() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FLOW_ANIMATION_ID)) return;
  const style = document.createElement('style');
  style.id = FLOW_ANIMATION_ID;
  style.textContent = `
    @keyframes fluxor-flow-border-pulse {
      0%, 100% { border-color: rgba(160,246,149,0.3); box-shadow: 0 0 0 rgba(160,246,149,0); }
      50% { border-color: rgba(160,246,149,0.8); box-shadow: 0 0 8px rgba(160,246,149,0.4); }
    }
    /* Animación ondulada simulando un fluido orgánico */
    @keyframes fluxor-liquid-shape {
      0% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
      50% { border-radius: 30% 60% 70% 40% / 50% 60% 30% 60%; }
      100% { border-radius: 60% 40% 30% 70% / 60% 30% 70% 40%; }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-testid^="attachable-flow-"] {
        animation: none !important;
        border-radius: 8px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

// ─── Component ───────────────────────────────────────────────────

export function AttachableFlow({
                                 flow,
                                 status = 'idle',
                                 onStart,
                                 onPause,
                                 onStop,
                               }: AttachableFlowProps) {
  const [hovered, setHovered] = useState(false);
  const displayName = kebabToTitle(flow.name);
  const isInfinite = flow.cost === 'infinite';
  const isRunning = status === 'running';

  const MainIcon = resolveFlowIcon(flow.icon);

  // Inyectamos la hoja de estilos de animación en el primer renderizado
  React.useEffect(() => { ensureFlowAnimations(); }, []);

  // Contenedor principal
  const containerStyle: React.CSSProperties = {
    position: 'relative', // Necesario para el badge absoluto en la esquina
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    width: '100%',
    padding: '12px',
    background: theme.surfaceHover,
    border: `1px solid ${theme.borderLight}`,
    // Base de la forma ondulada fluida
    animation: isRunning
        ? 'fluxor-liquid-shape 4s ease-in-out infinite, fluxor-flow-border-pulse 2s ease-in-out infinite'
        : 'fluxor-liquid-shape 8s ease-in-out infinite',
    transition: 'all 0.3s ease',
  };

  const cornerBadgeStyle: React.CSSProperties = {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: '50%',
    background: theme.warning,
    color: '#000', // Contraste oscuro para el icono
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 2px 6px ${theme.warning}40`,
    zIndex: 2,
  };

  const topRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  };

  const iconContainerStyle: React.CSSProperties = {
    width: 36,
    height: 36,
    borderRadius: '50%', // Redondo para que encaje con el tema fluido
    background: theme.surfaceRaised,
    border: `1.5px solid ${theme.borderMedium}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: theme.textSecondary,
    flexShrink: 0,
  };

  const infoStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
    flex: 1,
  };

  const nameStyle: React.CSSProperties = {
    fontFamily: theme.fontGrotesk,
    fontSize: 14,
    fontWeight: 700,
    color: theme.textPrimary,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  const descStyle: React.CSSProperties = {
    fontFamily: theme.fontInter,
    fontSize: 11,
    color: theme.textDim,
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  };

  const badgesRowStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
  };

  const badgeBase: React.CSSProperties = {
    fontFamily: theme.fontMono,
    fontSize: 10,
    padding: '3px 8px',
    borderRadius: 12, // Más redondeados para seguir el estilo líquido
    lineHeight: 1.2,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  };

  const complexityBadgeStyle: React.CSSProperties = {
    ...badgeBase,
    background: `${complexityColors[flow.recommendedComplexity] ?? theme.textMuted}18`,
    color: complexityColors[flow.recommendedComplexity] ?? theme.textMuted,
    border: `1px solid ${complexityColors[flow.recommendedComplexity] ?? theme.textMuted}33`,
  };

  const modelBadgeStyle: React.CSSProperties = {
    ...badgeBase,
    background: '#4dabf718',
    color: '#4dabf7',
    border: '1px solid #4dabf733',
  };

  const tagStyle: React.CSSProperties = {
    ...badgeBase,
    background: theme.surfaceRaised,
    color: theme.textFaint,
    border: `1px solid ${theme.borderLight}`,
  };

  // ── Execution controls ──

  const controlsRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: 8,
    paddingTop: 6,
    justifyContent: 'flex-end',
  };

  const controlBtnBase: React.CSSProperties = {
    width: 28,
    height: 28,
    borderRadius: '50%', // Botones redondos para mantener la consistencia fluida
    border: `1px solid ${theme.borderLight}`,
    background: theme.surfaceRaised,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 14,
    color: theme.textSecondary,
    transition: 'all 0.2s ease',
  };

  return (
      <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          style={{ padding: '8px' }} // Espacio extra para que la animación no corte los bordes
      >
        <AttachableWrapper type="flow" active={status !== 'idle'}>
          <div
              style={containerStyle}
              data-testid={`attachable-flow-${flow.name}`}
              role="region"
              aria-label={`Flow: ${displayName}, status: ${status}`}
          >
            {/* Badge de infinito en la esquina si aplica */}
            {isInfinite && (
                <div style={cornerBadgeStyle} title="Infinite Cost Loop">
                  <InfinityIcon size={14} />
                </div>
            )}

            {/* Fila superior: icono + nombre + descripción */}
            <div style={topRowStyle}>
              <div style={iconContainerStyle} aria-hidden="true">
                <MainIcon size={20} />
              </div>
              <div style={infoStyle}>
                <span style={nameStyle}>{displayName}</span>
                <span style={descStyle}>{flow.description}</span>
              </div>
            </div>

            {/* Badges: betterOn, complejidad, tags */}
            <div style={badgesRowStyle}>
              {flow.betterOn && (
                  <span style={modelBadgeStyle}>
                 🧠 {flow.betterOn}
               </span>
              )}
              <span style={complexityBadgeStyle}>
              ⚡ {flow.recommendedComplexity}
            </span>
              {flow.tags.slice(0, 3).map((tag) => (
                  <span key={tag} style={tagStyle}>{tag}</span>
              ))}
            </div>

            {/* Controles de ejecución — visibles cuando no está idle (o al hacer hover, opcional) */}
            {status !== 'idle' && (
                <div style={controlsRowStyle} data-testid="flow-controls" role="group" aria-label="Flow controls">
                  {/* 'error' joins paused/completed here — the canonical enum
                      the old local FlowStatus didn't have. A stopped flow
                      (however it stopped) must stay restartable; 'compiling'
                      deliberately gets no Start/Pause below, only Stop —
                      there's nothing to (re)start mid-compile. */}
                  {(status === 'paused' || status === 'completed' || status === 'error') && (
                      <button
                          style={{ ...controlBtnBase, color: theme.success }}
                          onClick={onStart}
                          aria-label={status === 'error' ? 'Restart flow' : 'Start flow'}
                          title={status === 'error' ? 'Restart' : 'Start'}
                      >
                        <MdIcons.MdPlayArrow />
                      </button>
                  )}
                  {status === 'running' && (
                      <button
                          style={{ ...controlBtnBase, color: theme.warning }}
                          onClick={onPause}
                          aria-label="Pause flow"
                          title="Pause"
                      >
                        <MdIcons.MdPause />
                      </button>
                  )}
                  <button
                      style={{ ...controlBtnBase, color: theme.danger }}
                      onClick={onStop}
                      aria-label="Stop flow"
                      title="Stop"
                  >
                    <MdIcons.MdStop />
                  </button>
                </div>
            )}
          </div>
        </AttachableWrapper>
      </div>
  );
}
