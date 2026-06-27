/**
 * StepInfoModal.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders a detailed "Ver Step" modal with advanced metadata for a pipeline step.
 * - Follows the AttachmentInfoModal aesthetic: glass card, accent border, overlay + backdrop blur.
 *
 * Boundaries:
 * - Owns: modal presentation, keyboard/click-outside close, sections layout.
 * - Does NOT own: step state mutations, edge data, execution orchestration.
 */
import React, { useEffect, useRef } from 'react';
import { LucideIcon } from './LucideIcon';
import { kebabToTitle } from './attachable-helpers';
import { theme } from '../../logic/theme';
import { stepTypeMeta } from './mental/step-type-meta';
import type { StepNodeData } from '@/types/desktop';
import type { AgenticExecutionStatus } from '@/types/harness';
import type { MarketRole, MarketMod } from '@/types/market';

// ─── Status badge ─────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  idle:      { text: theme.textDim,       bg: 'rgba(128,128,128,0.1)',  border: 'rgba(128,128,128,0.2)'  },
  compiling: { text: theme.warning,       bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)'  },
  running:   { text: theme.accentBlue,    bg: theme.accentBlueBg,      border: theme.accentBlueBorder   },
  paused:    { text: theme.warning,       bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)'  },
  completed: { text: theme.success,       bg: theme.successBg,         border: theme.successBorder      },
  error:     { text: theme.danger,        bg: theme.dangerBg,          border: theme.dangerBorder       },
};

function StatusBadge({ status }: { status?: AgenticExecutionStatus }) {
  const s = status ?? 'idle';
  const colors = STATUS_COLORS[s] ?? STATUS_COLORS['idle'];
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 10,
        color: colors.text, background: colors.bg, border: `1px solid ${colors.border}`,
      }}
    >
      {s}
    </span>
  );
}

// ─── Role row ─────────────────────────────────────────────────────

function RoleRow({ role }: { role: MarketRole }) {
  const accent = role.color?.startsWith('#') ? role.color : role.color ? `#${role.color}` : '#E87040';
  return (
    <div style={{
      padding: '8px 10px', borderRadius: 8, marginBottom: 6,
      background: `${accent}0d`, border: `1px solid ${accent}22`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: role.description || (role.tags?.length ?? 0) > 0 ? 4 : 0 }}>
        <div style={{
          width: 20, height: 20, borderRadius: 5,
          background: `${accent}1a`, border: `1px solid ${accent}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <LucideIcon name="User" size={11} style={{ color: accent }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>
          {kebabToTitle(role.name)}
        </span>
      </div>
      {role.description && (
        <p style={{ fontSize: 11, color: theme.textSecondary, margin: '0 0 4px', lineHeight: 1.45 }}>
          {role.description}
        </p>
      )}
      {role.tags && role.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {role.tags.map(tag => (
            <span key={tag} style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 8,
              background: `${accent}12`, color: accent,
              border: `1px solid ${accent}20`,
            }}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Mod row ──────────────────────────────────────────────────────

function ModRow({ mod }: { mod: MarketMod }) {
  const accent = theme.accentBlue;
  return (
    <div style={{
      padding: '8px 10px', borderRadius: 8, marginBottom: 6,
      background: 'rgba(77,168,255,0.06)', border: '1px solid rgba(77,168,255,0.15)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: mod.description || (mod.tags?.length ?? 0) > 0 ? 4 : 0 }}>
        <div style={{
          width: 20, height: 20, borderRadius: 5,
          background: 'rgba(77,168,255,0.12)', border: '1px solid rgba(77,168,255,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <LucideIcon name="Wrench" size={11} style={{ color: accent }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>
          {kebabToTitle(mod.name)}
        </span>
      </div>
      {mod.description && (
        <p style={{ fontSize: 11, color: theme.textSecondary, margin: '0 0 4px', lineHeight: 1.45 }}>
          {mod.description}
        </p>
      )}
      {mod.tags && mod.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {mod.tags.map(tag => (
            <span key={tag} style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 8,
              background: 'rgba(77,168,255,0.1)', color: accent,
              border: '1px solid rgba(77,168,255,0.2)',
            }}>{tag}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.08em', color: theme.textFaint,
      marginBottom: 8, marginTop: 16,
    }}>
      {children}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────

export interface StepInfoModalProps {
  stepId: string;
  stepData: StepNodeData;
  connections: {
    incoming: string[];
    outgoing: string[];
  };
  status?: AgenticExecutionStatus;
  onClose: () => void;
}

// ─── Modal ────────────────────────────────────────────────────────

export function StepInfoModal({ stepId: _stepId, stepData, connections, status, onClose }: StepInfoModalProps) {
  const meta = stepTypeMeta(stepData.stepType as string | undefined);
  const accent = meta.accent;
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const roles = stepData.roles ?? [];
  const mods = stepData.mods ?? [];
  const promptText = stepData.prompt ?? stepData.description ?? '';

  // Focus close button on mount for keyboard accessibility
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Escape key closes the modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      data-testid="step-info-modal"
      role="dialog"
      aria-label={`Step details: ${stepData.title}`}
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surfaceCard,
          borderRadius: 14,
          border: `1px solid ${accent}33`,
          boxShadow: `0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px ${accent}18`,
          padding: '20px 24px',
          maxWidth: 480,
          width: '92%',
          maxHeight: '80vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 9,
            background: `${accent}1a`, border: `1.5px solid ${accent}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <LucideIcon name={meta.icon} size={18} style={{ color: accent }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: theme.fontGrotesk, fontSize: 16, fontWeight: 700,
              color: theme.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {stepData.title}
            </div>
            <div style={{
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
              color: accent, letterSpacing: '0.05em',
            }}>
              {meta.label}
            </div>
          </div>
          <StatusBadge status={status} />
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close modal"
            data-testid="step-info-modal-close"
            style={{
              marginLeft: 6, background: 'none', border: 'none',
              color: theme.textGhost, cursor: 'pointer', padding: 4,
              borderRadius: 6, display: 'flex', alignItems: 'center',
            }}
          >
            <LucideIcon name="X" size={15} />
          </button>
        </div>

        {/* ── Divider ── */}
        <div style={{ height: 1, background: `${accent}1a`, marginBottom: 2 }} />

        {/* ── Prompt / Description ── */}
        {promptText && (
          <>
            <SectionLabel>Prompt</SectionLabel>
            <div style={{
              fontFamily: theme.fontMono, fontSize: 11.5, lineHeight: 1.6,
              color: theme.textSecondary,
              background: theme.surface, borderRadius: 8,
              border: `1px solid ${theme.borderLight}`,
              padding: '10px 12px',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 180, overflowY: 'auto',
            }}>
              {promptText}
            </div>
          </>
        )}

        {/* ── Roles ── */}
        {roles.length > 0 && (
          <>
            <SectionLabel>Roles ({roles.length})</SectionLabel>
            {roles.map((role) => <RoleRow key={role.name} role={role} />)}
          </>
        )}

        {/* ── Mods ── */}
        {mods.length > 0 && (
          <>
            <SectionLabel>Mods ({mods.length})</SectionLabel>
            {mods.map((mod) => <ModRow key={mod.name} mod={mod} />)}
          </>
        )}

        {/* ── Connections ── */}
        <SectionLabel>Connections</SectionLabel>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
        }}>
          <div style={{
            padding: '8px 10px', borderRadius: 8,
            background: theme.surface, border: `1px solid ${theme.borderLight}`,
          }}>
            <div style={{ fontSize: 10, color: theme.textFaint, marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Incoming
            </div>
            {connections.incoming.length === 0 ? (
              <span style={{ fontSize: 11, color: theme.textGhost }}>None (root)</span>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>
                {connections.incoming.length} step{connections.incoming.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div style={{
            padding: '8px 10px', borderRadius: 8,
            background: theme.surface, border: `1px solid ${theme.borderLight}`,
          }}>
            <div style={{ fontSize: 10, color: theme.textFaint, marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Outgoing
            </div>
            {connections.outgoing.length === 0 ? (
              <span style={{ fontSize: 11, color: theme.textGhost }}>None (terminal)</span>
            ) : (
              <span style={{ fontSize: 12, fontWeight: 600, color: theme.textPrimary }}>
                {connections.outgoing.length} step{connections.outgoing.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
