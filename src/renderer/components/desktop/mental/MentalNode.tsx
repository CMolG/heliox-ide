/**
 * MentalNode.tsx — Custom React Flow node for the mental graph canvas
 *
 * Architecture (follows @xyflow/react custom-node conventions):
 * - The node container is a plain positioned div (no clip-path).
 * - An SVG fills the container and renders the shape (rect, circle, polygon).
 * - The text overlay sits on top of the SVG via absolute positioning.
 * - Handles are placed at the shape perimeter using absolute positioning.
 *   Four handles (top, right, bottom, left) allow connections from any side.
 *
 * Why SVG and not CSS clip-path?
 * clip-path clips *everything* inside the element — handles, text, overflow
 * menus — making them invisible or unreachable. The @xyflow/react pattern
 * is: SVG background → content overlay → handles outside the clip boundary.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useDesktopStore } from '../../../store/desktop-store';
import { DockPopover } from '../DockPopover';
import { getHueFromHex, getMentalTextContrastColor, mentalHueToHex } from '../../../logic/mental-colors';
import type { MentalShape } from '@/types/desktop';

const MENTAL_COLOR_SWATCHES = [
  '#EDE9FE', '#FBCFE8', '#FDE68A', '#86EFAC',
  '#BFDBFE', '#F9A8D4', '#FDBA74', '#C4B5FD',
];

export interface MentalNodeData {
  text: string;
  color: string;
  width: number;
  height: number;
  shape: MentalShape;
  [key: string]: unknown;
}

// ─── SVG Shape Renderers ─────────────────────────────────────────

function ShapeSvg({ shape, width, height, fill, stroke }: {
  shape: MentalShape;
  width: number;
  height: number;
  fill: string;
  stroke: string;
}) {
  switch (shape) {
    case 'circle':
      return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mental-shape-svg">
          <ellipse
            cx={width / 2}
            cy={height / 2}
            rx={width / 2 - 1.5}
            ry={height / 2 - 1.5}
            fill={fill}
            stroke={stroke}
            strokeWidth={1.5}
          />
        </svg>
      );
    case 'triangle':
      return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mental-shape-svg">
          <polygon
            points={`${width / 2},2 ${width - 2},${height - 2} 2,${height - 2}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'square':
    default:
      return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mental-shape-svg">
          <rect
            x={1}
            y={1}
            width={width - 2}
            height={height - 2}
            rx={12}
            ry={12}
            fill={fill}
            stroke={stroke}
            strokeWidth={1.5}
          />
        </svg>
      );
  }
}

// ─── Text inset per shape (keeps text inside the shape outline) ──

function getTextInset(shape: MentalShape): React.CSSProperties {
  switch (shape) {
    case 'circle':
      // Inscribed rectangle inside an ellipse: ~29% inset on each axis
      return { top: '20%', left: '15%', right: '15%', bottom: '20%' };
    case 'triangle':
      // Text sits in the lower-center of the triangle
      return { top: '38%', left: '18%', right: '18%', bottom: '8%' };
    case 'square':
    default:
      return { top: 6, left: 8, right: 8, bottom: 6 };
  }
}

// ─── Handle layout per shape (positions handles at the perimeter) ─

interface HandlePosition {
  id: string;
  type: 'source' | 'target';
  position: Position;
  style?: React.CSSProperties;
}

function getHandles(shape: MentalShape): HandlePosition[] {
  // All shapes get 4 handles so connections work from any side.
  // Each handle is both source AND target (we use ConnectionMode.Loose).
  // The `type` alternates to keep React Flow happy with the API,
  // but with Loose mode any handle can connect to any other.
  const base: HandlePosition[] = [
    { id: 'top',    type: 'target', position: Position.Top,    style: { left: '50%' } },
    { id: 'right',  type: 'source', position: Position.Right,  style: { top: '50%' } },
    { id: 'bottom', type: 'source', position: Position.Bottom, style: { left: '50%' } },
    { id: 'left',   type: 'target', position: Position.Left,   style: { top: '50%' } },
  ];

  if (shape === 'triangle') {
    // Triangle: top handle at apex, bottom-left and bottom-right at base corners
    return [
      { id: 'top',    type: 'target', position: Position.Top,    style: { left: '50%' } },
      { id: 'right',  type: 'source', position: Position.Right,  style: { top: '70%' } },
      { id: 'bottom', type: 'source', position: Position.Bottom, style: { left: '50%' } },
      { id: 'left',   type: 'target', position: Position.Left,   style: { top: '70%' } },
    ];
  }

  return base;
}

// ─── Node Component ──────────────────────────────────────────────

export function MentalNode({ id, data }: NodeProps) {
  const nodeData = data as unknown as MentalNodeData;
  const { text, color, width, height, shape = 'square' } = nodeData;

  const updateMentalNode = useDesktopStore((s) => s.updateMentalNode);
  const removeMentalNode = useDesktopStore((s) => s.removeMentalNode);
  const mentalTool = useDesktopStore((s) => s.mentalTool);
  const mentalEditingNodeId = useDesktopStore((s) => s.mentalEditingNodeId);
  const setMentalEditingNodeId = useDesktopStore((s) => s.setMentalEditingNodeId);

  const [isColorModalOpen, setIsColorModalOpen] = useState(false);
  const [hue, setHue] = useState(() => getHueFromHex(color));
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const isEditing = mentalEditingNodeId === id;

  useEffect(() => {
    setHue(getHueFromHex(color));
  }, [color]);

  useEffect(() => {
    if (isEditing && textAreaRef.current) {
      textAreaRef.current.focus();
    }
  }, [isEditing]);

  const textColor = getMentalTextContrastColor(color);
  const placeholderColor = textColor === '#000000' ? 'rgba(0, 0, 0, 0.46)' : 'rgba(255, 255, 255, 0.68)';

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateMentalNode(id, { text: e.target.value });
  }, [id, updateMentalNode]);

  const handleColorChange = useCallback((newColor: string) => {
    updateMentalNode(id, { color: newColor });
  }, [id, updateMentalNode]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const textInset = getTextInset(shape);
  const handles = getHandles(shape);
  const strokeColor = 'rgba(109, 40, 217, 0.3)';

  return (
    <>
      {/* Outer wrapper — the draggable surface */}
      <div
        data-testid={`mental-graph-node-${id}`}
        className={`mental-card mental-shape-${shape}`}
        style={{ width, height, position: 'relative' }}
        onClick={() => {
          if (mentalTool === 'ramification') return;
          setMentalEditingNodeId(id);
        }}
        onContextMenu={handleContextMenu}
      >
        {/* SVG shape background */}
        <ShapeSvg shape={shape} width={width} height={height} fill={color} stroke={strokeColor} />

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
                  onClick={() => handleColorChange(swatch)}
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
                  handleColorChange(mentalHueToHex(nextHue));
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

        {/* Text overlay — absolutely positioned inside the shape boundary */}
        <textarea
          ref={textAreaRef}
          className="mental-card-text"
          data-mental-no-drag="true"
          data-mental-textarea="true"
          value={text}
          placeholder="Type a note..."
          onPointerDown={(e) => e.stopPropagation()}
          onFocus={() => setMentalEditingNodeId(id)}
          onBlur={() => {
            if (mentalEditingNodeId === id) setMentalEditingNodeId(null);
          }}
          onChange={handleTextChange}
          style={{
            ...textInset,
            position: 'absolute',
            pointerEvents: isEditing ? 'auto' : 'none',
            color: textColor,
            '--mental-placeholder-color': placeholderColor,
          } as React.CSSProperties}
        />

        {/* Connection handles — positioned at shape perimeter */}
        {handles.map((h) => (
          <Handle
            key={h.id}
            id={h.id}
            type={h.type}
            position={h.position}
            className="mental-node-handle"
            style={h.style}
          />
        ))}
      </div>

      {/* Context menu — portaled to body to escape React Flow transform */}
      {contextMenu && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 10002 }}
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            data-testid={`mental-node-ctx-menu-${id}`}
            style={{
              position: 'absolute',
              left: contextMenu.x,
              top: contextMenu.y,
              minWidth: 130,
              padding: 6,
              borderRadius: 8,
              background: 'rgba(20, 20, 20, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              style={{
                width: '100%',
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: '#f4f4f5',
                fontSize: 12,
                textAlign: 'left',
                padding: '6px 8px',
                cursor: 'pointer',
              }}
              onClick={() => {
                setIsColorModalOpen(true);
                setContextMenu(null);
              }}
              data-testid={`mental-node-color-${id}`}
            >
              Change color
            </button>
            <button
              style={{
                width: '100%',
                border: 'none',
                borderRadius: 6,
                background: 'transparent',
                color: '#f4f4f5',
                fontSize: 12,
                textAlign: 'left',
                padding: '6px 8px',
                cursor: 'pointer',
              }}
              onClick={() => {
                removeMentalNode(id);
                setContextMenu(null);
              }}
              data-testid={`mental-node-delete-${id}`}
            >
              Delete card
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
