/**
 * AttachmentInfoModal.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the AttachmentInfoModal surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/AttachmentInfoModal.tsx — Modal showing attachment details
import React from 'react';
import { LucideIcon } from './LucideIcon';
import { TYPE_META } from './DesktopAttachable';
import { kebabToTitle } from './attachable-helpers';
import { theme } from '../../logic/theme';
import type { AttachableType } from '@/types/desktop';

export interface AttachmentModalInfo {
  type: AttachableType;
  name: string;
  description: string;
  tags?: string[];
  color?: string;
  extra?: Record<string, string>;
}

export function AttachmentInfoModal({ info, onClose }: { info: AttachmentModalInfo; onClose: () => void }) {
  const meta = TYPE_META[info.type];
  const accentColor = info.color ? (info.color.startsWith('#') ? info.color : `#${info.color}`) : meta.color;

  return (
    <div
      data-testid="attachment-info-modal"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surfaceCard, borderRadius: 12,
          border: `1px solid ${accentColor}44`,
          boxShadow: `0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px ${accentColor}22`,
          padding: '20px 24px', maxWidth: 400, width: '90%',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `${accentColor}18`, border: `1.5px solid ${accentColor}55`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <LucideIcon name={meta.icon} size={16} style={{ color: accentColor }} />
          </div>
          <div>
            <div style={{
              fontFamily: theme.fontGrotesk, fontSize: 15, fontWeight: 700,
              color: theme.textPrimary,
            }}>
              {kebabToTitle(info.name)}
            </div>
            <div style={{
              fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
              color: accentColor, letterSpacing: '0.05em',
            }}>
              {meta.label}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            data-testid="attachment-modal-close"
            style={{
              marginLeft: 'auto', background: 'none', border: 'none',
              color: theme.textGhost, cursor: 'pointer', padding: 4,
            }}
          >
            <LucideIcon name="X" size={14} />
          </button>
        </div>

        {/* Description */}
        <p style={{
          fontFamily: theme.fontInter, fontSize: 13, lineHeight: 1.5,
          color: theme.textSecondary, margin: '0 0 12px',
        }}>
          {info.description}
        </p>

        {/* Extra fields */}
        {info.extra && Object.entries(info.extra).map(([key, val]) => (
          <div key={key} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '4px 0', fontSize: 12,
          }}>
            <span style={{ color: theme.textDim, textTransform: 'capitalize' }}>{key}</span>
            <span style={{ color: theme.textSecondary, fontWeight: 500 }}>{val}</span>
          </div>
        ))}

        {/* Tags */}
        {info.tags && info.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 10 }}>
            {info.tags.map(tag => (
              <span key={tag} style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 10,
                background: `${accentColor}12`, color: accentColor,
                border: `1px solid ${accentColor}25`,
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
