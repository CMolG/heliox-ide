/**
 * MentalAttachActionBubble.tsx — Renderer Mental Surface Subcomponent
 *
 * Responsibility:
 * - Floating action sitting on the mental graph canvas. Lets the user attach
 *   either the current selection or the entire mental map to a chat window.
 *
 * Boundaries:
 * - Owns: the popover UI + chat picker rendering.
 * - Does NOT own: serialization (mental-digest.ts), attachment state
 *   (desktop-store.ts), or send-time injection (AgenticChatApp.handleSend).
 */
import React, { useMemo, useState } from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import { useHelioxStore } from '../../../store';
import { theme } from '../../../logic/theme';
import { LucideIcon } from '../LucideIcon';

export function MentalAttachActionBubble() {
  const selectedIds = useDesktopStore(s => s.selectedMentalNodeIds);
  const mentalNodes = useDesktopStore(s => s.mentalNodes);
  const windows = useDesktopStore(s => s.windows);
  const attachMentalToWindow = useDesktopStore(s => s.attachMentalToWindow);
  const navigateToWindow = useDesktopStore(s => s.navigateToWindow);
  const sessions = useHelioxStore(s => s.sessions);
  const addToast = useHelioxStore(s => s.addToast);

  const [open, setOpen] = useState(false);

  const chatWindows = useMemo(
    () => windows.filter(w => w.type === 'chat'),
    [windows],
  );

  const hasSelection = selectedIds.length > 0;
  const hasNodes = mentalNodes.length > 0;

  // Nothing on the board → nothing to attach.
  if (!hasNodes) return null;

  const label = hasSelection
    ? `Attach ${selectedIds.length} selected`
    : 'Attach whole mental map';

  const handlePick = (chatWindowId: string) => {
    const idsToAttach = hasSelection ? selectedIds : [];
    attachMentalToWindow(chatWindowId, idsToAttach);
    setOpen(false);
    const chat = chatWindows.find(w => w.id === chatWindowId);
    const session = chat?.sessionId ? sessions.find(s => s.id === chat.sessionId) : undefined;
    const chatLabel = session ? `Session #${session.number}` : (chat?.title ?? 'chat');
    addToast(`Attached to ${chatLabel}`, 'success');
    navigateToWindow(chatWindowId);
  };

  return (
    <div
      data-testid="mental-attach-bubble"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 20,
        pointerEvents: 'auto',
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="mental-attach-trigger"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 999,
          border: `1px solid ${theme.borderMedium}`,
          background: open ? theme.surfaceHover : theme.surfaceCard,
          color: theme.textPrimary,
          fontFamily: theme.fontInter,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
        }}
      >
        <LucideIcon name="Brain" size={13} />
        <span>{label}</span>
        <LucideIcon name="ChevronDown" size={11} />
      </button>

      {open && (
        <>
          <div
            data-testid="mental-attach-backdrop"
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 19, pointerEvents: 'auto' }}
          />
          <div
            role="menu"
            data-testid="mental-attach-menu"
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              zIndex: 21,
              minWidth: 240,
              maxHeight: 280,
              overflowY: 'auto',
              padding: 4,
              borderRadius: 10,
              border: `1px solid ${theme.borderMedium}`,
              background: theme.surfaceCard,
              boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
              fontFamily: theme.fontInter,
            }}
          >
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: theme.textFaint,
                padding: '6px 8px 4px',
              }}
            >
              Attach to chat
            </div>

            {chatWindows.length === 0 ? (
              <div
                style={{
                  padding: '8px 10px',
                  color: theme.textDim,
                  fontSize: 11,
                  lineHeight: 1.4,
                }}
              >
                No chat windows open. Spawn one from the dock first.
              </div>
            ) : (
              chatWindows.map(w => {
                const session = w.sessionId ? sessions.find(s => s.id === w.sessionId) : undefined;
                const itemLabel = session
                  ? `Session #${session.number}${session.description ? ` — ${session.description}` : ''}`
                  : (w.title || 'chat');
                const existingCount = w.mentalAttachments?.length ?? 0;
                return (
                  <button
                    key={w.id}
                    type="button"
                    role="menuitem"
                    data-testid={`mental-attach-target-${w.id}`}
                    onClick={() => handlePick(w.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 8px',
                      borderRadius: 6,
                      border: 'none',
                      background: 'transparent',
                      color: theme.textPrimary,
                      fontSize: 11,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = theme.surfaceHover; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {itemLabel}
                    </span>
                    {existingCount > 0 && (
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          color: theme.textDim,
                          background: theme.surfaceLight,
                          padding: '1px 6px',
                          borderRadius: 999,
                          flexShrink: 0,
                        }}
                      >
                        {existingCount} attached
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
