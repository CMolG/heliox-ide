/**
 * MentalAttachmentChips.tsx — Renderer Embedded App Subcomponent
 *
 * Responsibility:
 * - Render a chip per mental subgraph attached to a chat window.
 * - Hover → preview popover with the first few node labels + count.
 * - Click ✕ → detach that attachment.
 *
 * Boundaries:
 * - Owns: chip presentation + detach interaction.
 * - Does NOT own: serialization (mental-digest.ts) or the actual injection
 *   into the prompt (AgenticChatApp.handleSend).
 */
import React, { useMemo, useState } from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import { theme } from '../../../logic/theme';
import { pickMentalSubgraph, UNTITLED_NODE_LABEL } from '../../../logic/ai/mental-digest';

interface Props {
  windowId: string;
  accent?: string;
}

const PREVIEW_NODE_LIMIT = 5;

export function MentalAttachmentChips({ windowId, accent }: Props) {
  const win = useDesktopStore(s => s.windows.find(w => w.id === windowId));
  const mentalNodes = useDesktopStore(s => s.mentalNodes);
  const mentalEdges = useDesktopStore(s => s.mentalEdges);
  const detachMentalAttachment = useDesktopStore(s => s.detachMentalAttachment);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const attachments = win?.mentalAttachments ?? [];
  const accentColor = accent ?? '#A78BFA';

  // Pre-compute live subgraphs for each attachment so chip labels reflect
  // current node counts (live mode).
  const resolved = useMemo(() => {
    return attachments.map(att => pickMentalSubgraph(mentalNodes, mentalEdges, att.nodeIds));
  }, [attachments, mentalNodes, mentalEdges]);

  if (attachments.length === 0) return null;

  return (
    <div
      data-testid="mental-attachment-chips"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {attachments.map((att, idx) => {
        const sub = resolved[idx];
        const nodeCount = sub.nodes.length;
        const edgeCount = sub.edges.length;
        const isWhole = att.nodeIds.length === 0;
        const hovered = hoveredIdx === idx;

        return (
          <div key={`${att.attachedAt}-${idx}`} style={{ position: 'relative' }}>
            <div
              data-testid={`mental-chip-${idx}`}
              data-mental-chip-whole={isWhole || undefined}
              role="group"
              aria-label={`Mental attachment ${idx + 1}`}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 4px 2px 8px',
                borderRadius: 999,
                border: `1px solid ${accentColor}55`,
                background: `${accentColor}14`,
                color: accentColor,
                fontFamily: theme.fontInter,
                fontSize: 10,
                lineHeight: 1.4,
                fontWeight: 600,
                letterSpacing: '0.02em',
              }}
            >
              <span aria-hidden style={{ fontSize: 11 }}>🧠</span>
              <span>
                {isWhole ? 'whole map' : `${nodeCount} node${nodeCount === 1 ? '' : 's'}`}
                {edgeCount > 0 && (
                  <span style={{ opacity: 0.7 }}>{` · ${edgeCount} link${edgeCount === 1 ? '' : 's'}`}</span>
                )}
                <span style={{ opacity: 0.6, marginLeft: 4, fontSize: 9, textTransform: 'uppercase' }}>live</span>
              </span>
              <button
                type="button"
                aria-label={`Detach mental attachment ${idx + 1}`}
                data-testid={`mental-chip-detach-${idx}`}
                onClick={(e) => {
                  e.stopPropagation();
                  detachMentalAttachment(windowId, idx);
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  padding: '0 2px',
                  fontSize: 12,
                  lineHeight: 1,
                  opacity: 0.6,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.6'; }}
              >
                ×
              </button>
            </div>

            {hovered && (
              <div
                role="tooltip"
                data-testid={`mental-chip-preview-${idx}`}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  left: 0,
                  zIndex: 60,
                  minWidth: 220,
                  maxWidth: 320,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1px solid ${theme.borderMedium}`,
                  background: theme.surfaceCard,
                  fontSize: 11,
                  fontFamily: theme.fontInter,
                  color: theme.textPrimary,
                  boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                  pointerEvents: 'auto',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>
                  {isWhole ? 'Entire mental map' : 'Selected subgraph'}
                </div>
                {nodeCount === 0 ? (
                  <div style={{ color: theme.textDim, fontSize: 10 }}>
                    No matching nodes (they may have been deleted).
                  </div>
                ) : (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {sub.nodes.slice(0, PREVIEW_NODE_LIMIT).map(n => (
                      <li key={n.id} style={{ color: theme.textSecondary }}>
                        • {n.text.trim() || UNTITLED_NODE_LABEL}
                      </li>
                    ))}
                    {nodeCount > PREVIEW_NODE_LIMIT && (
                      <li style={{ color: theme.textDim, fontSize: 10 }}>
                        … and {nodeCount - PREVIEW_NODE_LIMIT} more
                      </li>
                    )}
                  </ul>
                )}
                <div style={{ marginTop: 8, color: theme.textFaint, fontSize: 10 }}>
                  Serialized live on each send.
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
