/**
 * BottomModAttachment.tsx — Renderer Attachment Component
 *
 * Responsibility:
 * - Renders the BottomModAttachment surface in the renderer layer.
 * - Encapsulates Attachment strip/tab presentation for attachable relationships.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/attachment/BottomModAttachment.tsx — Mod tabs protruding from the bottom edge of a window
import React from 'react';
import { MarketMod } from '@/types/market';
import { ModTab } from './ModTab';

// ─── Props ───────────────────────────────────────────────────────

interface BottomModAttachmentProps {
  mods: MarketMod[];
  onDetach: (modName: string) => void;
  onClickMod?: (mod: MarketMod) => void;
  /** Whether the parent window is active, selected, or highlighted */
  parentActive?: boolean;
  /** Role color from the parent window (overrides default MOD_COLOR) */
  roleColor?: string | null;
}

const MOD_COLOR = '#4285F4';

// ─── Inline keyframe injection ───────────────────────────────────

const ANIM_ID = 'fluxor-mod-attach-anim';

function ensureModAnimation() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(ANIM_ID)) return;
  const style = document.createElement('style');
  style.id = ANIM_ID;
  style.textContent = `
    @keyframes fluxorModSlideIn {
      0% { opacity: 0; transform: translateY(-6px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    .fluxor-mod-tab {
      animation: fluxorModSlideIn 0.25s ease-out forwards;
    }
  `;
  document.head.appendChild(style);
}

// ─── Component ───────────────────────────────────────────────────

export function BottomModAttachment({ mods, onDetach, onClickMod, parentActive = false, roleColor }: BottomModAttachmentProps) {
  React.useEffect(() => { ensureModAnimation(); }, []);

  if (mods.length === 0) return null;

  const accentColor = roleColor ?? MOD_COLOR;

  if (mods.length === 0) return null;

  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: '50%',
    transform: 'translateX(-50%) translateY(100%)',
    display: 'flex',
    gap: 4,
    zIndex: 0,
    pointerEvents: 'none',
    paddingTop: 0,
  };

  return (
    <div
      style={containerStyle}
      data-testid="bottom-mod-attachment"
      role="region"
      aria-label="Attached modifiers"
    >
      {mods.map((mod, i) => (
        <ModTab
          key={mod.name}
          mod={mod}
          index={i}
          onDetach={() => onDetach(mod.name)}
          onClick={onClickMod ? () => onClickMod(mod) : undefined}
          accentColor={accentColor}
          parentActive={parentActive}
        />
      ))}
    </div>
  );
}
