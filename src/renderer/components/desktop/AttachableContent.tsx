/**
 * AttachableContent.tsx — Renderer Desktop Surface Component
 */
import React from 'react';
import { AttachableRole } from '../atoms/attachables/AttachableRole';
import { AttachableMod } from '../atoms/attachables/AttachableMod';
import { AttachableFlow } from '../atoms/attachables/AttachableFlow';
import { AttachableDesignSystem } from '../atoms/attachables/AttachableDesignSystem';
import { useDesktopStore } from '../../store/desktop-store';
import type { DesktopAttachable as AttachableT } from '@/types/desktop';
import type { MarketRole, MarketMod, MarketFlow, MarketDesignSystem } from '@/types/market';
import { TYPE_META } from './DesktopAttachable';
import { kebabToTitle } from './attachable-helpers';
import { theme } from '../../logic/theme';
import { DockPopover } from './DockPopover';
import { getHueFromHex, getMentalTextContrastColor, mentalHueToHex } from '../../logic/mental-colors';

const MENTAL_COLOR_SWATCHES = [
  '#EDE9FE',
  '#FBCFE8',
  '#FDE68A',
  '#86EFAC',
  '#BFDBFE',
  '#F9A8D4',
  '#FDBA74',
  '#C4B5FD',
];

export function AttachableContent({ attachable, marketItem }: { attachable: AttachableT; marketItem: MarketRole | MarketMod | MarketFlow | MarketDesignSystem | null }) {
  const mentalMode = useDesktopStore((s) => s.mentalMode);
  const updateMentalAttachableText = useDesktopStore((s) => s.updateMentalAttachableText);
  const updateMentalAttachableColor = useDesktopStore((s) => s.updateMentalAttachableColor);
  const mentalColorForHooks = attachable.type === 'mental' ? (attachable.mental?.color ?? '#EDE9FE') : '#EDE9FE';
  const [isColorModalOpen, setIsColorModalOpen] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [hue, setHue] = React.useState(0);
  const textAreaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    if (mentalMode === 'lines') {
      setIsColorModalOpen(false);
      setIsEditing(false);
    }
  }, [mentalMode]);

  React.useEffect(() => {
    setHue(getHueFromHex(mentalColorForHooks));
  }, [mentalColorForHooks]);

  if (attachable.type !== 'mental') {
    if (attachable.type === 'role' && marketItem) return <AttachableRole role={marketItem as MarketRole} />;
    if (attachable.type === 'mod' && marketItem) return <AttachableMod mod={marketItem as MarketMod} />;
    if (attachable.type === 'flow' && marketItem) return <AttachableFlow flow={marketItem as MarketFlow} />;
    if (attachable.type === 'design-system' && marketItem) return <AttachableDesignSystem designSystem={marketItem as MarketDesignSystem} />;

    const meta = TYPE_META[attachable.type];
    return (
      <div style={{
        padding: '10px 12px', borderRadius: 10, background: theme.surfaceCard,
        border: `1.5px solid ${theme.borderLight}`, display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontFamily: theme.fontGrotesk, fontSize: 13, fontWeight: 600, color: theme.textPrimary }}>
          {kebabToTitle(attachable.name)}
        </span>
        <span style={{
          fontFamily: theme.fontMono, fontSize: 9, padding: '1px 6px', borderRadius: 4,
          background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}30`,
        }}>{meta.label}</span>
      </div>
    );
  }

  const width = attachable.mental?.width ?? 220;
  const height = attachable.mental?.height ?? 120;
  const text = attachable.mental?.text ?? '';
  const color = attachable.mental?.color ?? '#EDE9FE';
  const textColor = getMentalTextContrastColor(color);
  const placeholderColor = textColor === '#000000' ? 'rgba(0, 0, 0, 0.46)' : 'rgba(255, 255, 255, 0.68)';

  const textAreaStyle: React.CSSProperties & { '--mental-placeholder-color': string } = {
    width: '100%',
    height: '100%',
    pointerEvents: mentalMode === 'lines' ? 'none' : (isEditing ? 'auto' : 'none'),
    color: textColor,
    '--mental-placeholder-color': placeholderColor,
  };

  return (
    <div
      data-testid={`attachable-mental-${attachable.id}`}
      className="mental-card"
      style={{ width, height, background: color }}
      onClick={(e) => {
        if (mentalMode === 'lines') return;
        const target = e.target as HTMLElement;
        if (target.closest('[data-mental-no-drag="true"]')) return;
        setIsEditing(true);
        requestAnimationFrame(() => textAreaRef.current?.focus());
      }}
    >
      <button
        className="mental-card-color-chip"
        data-mental-color-chip={attachable.id}
        data-mental-no-drag="true"
        aria-label="Change mental card color"
        title={mentalMode === 'lines' ? 'Line mode uses click as connection selection' : 'Change card color'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (mentalMode === 'lines') return;
          e.stopPropagation();
          setIsColorModalOpen(true);
        }}
        style={{ background: color }}
      />
      {isColorModalOpen && (
        <DockPopover
          className="mental-color-modal"
          role="dialog"
          ariaLabel="Mental color picker"
          onPointerDownOutside={() => setIsColorModalOpen(false)}
          onEscape={() => setIsColorModalOpen(false)}
        >
          <div className="mental-color-modal-title">Card color</div>
          <div className="mental-color-swatches" data-mental-no-drag="true">
            {MENTAL_COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                data-mental-no-drag="true"
                className={`mental-color-swatch${swatch.toUpperCase() === color.toUpperCase() ? ' active' : ''}`}
                style={{ background: swatch }}
                aria-label={`Set color ${swatch}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => updateMentalAttachableColor(attachable.id, swatch)}
              />
            ))}
          </div>
          <div className="mental-color-slider-row" data-mental-no-drag="true">
            <span className="mental-color-slider-label">Hue</span>
            <input
              data-mental-no-drag="true"
              className="mental-color-hue-slider"
              type="range"
              min={0}
              max={360}
              value={hue}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                const nextHue = Number(e.target.value);
                setHue(nextHue);
                updateMentalAttachableColor(attachable.id, mentalHueToHex(nextHue));
              }}
            />
          </div>
          <div className="mental-color-modal-footer">
            <span className="mental-color-code">{color.toUpperCase()}</span>
            <button className="mental-color-modal-close" onClick={() => setIsColorModalOpen(false)}>
              Done
            </button>
          </div>
        </DockPopover>
      )}
      <textarea
        ref={textAreaRef}
        className="mental-card-text"
        data-mental-no-drag="true"
        data-mental-textarea="true"
        value={text}
        readOnly={mentalMode === 'lines'}
        placeholder={mentalMode === 'lines' ? '' : 'Type your mental note...'}
        onPointerDown={(e) => e.stopPropagation()}
        onFocus={() => setIsEditing(true)}
        onBlur={() => setIsEditing(false)}
        onChange={(e) => updateMentalAttachableText(attachable.id, e.target.value)}
        style={textAreaStyle}
      />
    </div>
  );
}
