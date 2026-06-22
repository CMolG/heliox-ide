/**
 * FlowQuickRail.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Vertical strip of one-click flow enablers, mounted on the right edge of
 *   AgenticChatApp. Each button toggles a Flow on the current chat window so
 *   the next user message is wrapped with that flow's system prompt.
 *
 * Boundaries:
 * - Owns: rail layout, enable/disable interaction, hover preview.
 * - Does NOT own: flow execution (handled by AgenticChatApp's send pipeline)
 *   or flow definitions (live in market/flows/ and market/inventory.json).
 *
 * Architectural role:
 * - IDE-app subcomponent — pure presentation + a single store mutation per click.
 */
import React, { useMemo, useState } from 'react';
import { useDesktopStore } from '../../../store/desktop-store';
import { LucideIcon } from '../../desktop/LucideIcon';
import { theme } from '../../../logic/theme';

/** Map registry icon names (react-icons/md) to the closest Lucide equivalent. */
const FLOW_ICON_FALLBACK: Record<string, string> = {
  MdLightbulb: 'Lightbulb',
  MdSpeed: 'Gauge',
  MdCompress: 'Minimize2',
  MdFormatShapes: 'Shapes',
  MdAccountTree: 'GitBranch',
  MdBuild: 'Wrench',
  MdEngineering: 'HardHat',
};

interface FlowInventoryEntry {
  name: string;
  icon?: string;
  iconLibrary?: string;
  description?: string;
  cost?: string;
  tags?: string[];
}

interface FlowQuickRailProps {
  /** Window id whose `flowId` we toggle. */
  windowId: string;
  /** Optional accent color matching the current role/session theme. */
  accent?: string;
}

export function FlowQuickRail({ windowId, accent }: FlowQuickRailProps) {
  const win = useDesktopStore(s => s.windows.find(w => w.id === windowId));
  const updateWindow = useDesktopStore(s => (s as any)._updateWindow as ((id: string, patch: any) => void));
  const marketInventory = useDesktopStore(s => s.marketInventory);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const flows: FlowInventoryEntry[] = useMemo(() => {
    const list = (marketInventory as any)?.flows;
    return Array.isArray(list) ? list : [];
  }, [marketInventory]);

  const activeFlowId = win?.flowId ?? null;

  const handleToggle = (name: string) => {
    if (!updateWindow) return;
    const next = activeFlowId === name ? undefined : name;
    updateWindow(windowId, { flowId: next });
  };

  if (flows.length === 0) return null;

  const railAccent = accent ?? theme.accentBlue;

  return (
    <aside
      data-testid="flow-quick-rail"
      aria-label="Flow quick enablers"
      style={{
        flexShrink: 0,
        width: 52,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 4,
        padding: '8px 6px',
        borderLeft: `1px solid ${theme.border}`,
        background: theme.surface,
      }}
    >
      <div
        style={{
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: theme.textFaint,
          fontFamily: theme.fontInter,
          textAlign: 'center',
          marginBottom: 4,
          userSelect: 'none',
        }}
      >
        Flows
      </div>

      {flows.map(flow => {
        const active = flow.name === activeFlowId;
        const hovered = hoveredId === flow.name;
        const iconName = FLOW_ICON_FALLBACK[flow.icon ?? ''] ?? 'Zap';
        const isFinite = (flow.cost ?? '').toLowerCase() === 'finite' || (flow.tags ?? []).includes('finite');

        return (
          <div key={flow.name} style={{ position: 'relative' }}>
            <button
              type="button"
              data-testid={`flow-quick-${flow.name}`}
              aria-pressed={active}
              title={flow.description ?? flow.name}
              onClick={() => handleToggle(flow.name)}
              onMouseEnter={() => setHoveredId(flow.name)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                width: '100%',
                height: 40,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                padding: 4,
                borderRadius: 10,
                border: `1px solid ${active ? `${railAccent}80` : 'transparent'}`,
                background: active
                  ? `linear-gradient(180deg, ${railAccent}26, ${railAccent}0d)`
                  : hovered
                    ? theme.surfaceHover
                    : 'transparent',
                color: active ? railAccent : theme.textDim,
                cursor: 'pointer',
                transition: 'all 140ms ease',
                position: 'relative',
              }}
            >
              <LucideIcon name={iconName} size={16} />
              {isFinite && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 3,
                    right: 4,
                    width: 5,
                    height: 5,
                    borderRadius: 999,
                    background: active ? railAccent : theme.textFaint,
                    opacity: active ? 1 : 0.6,
                  }}
                />
              )}
            </button>

            {hovered && (
              <div
                role="tooltip"
                style={{
                  position: 'absolute',
                  right: 'calc(100% + 8px)',
                  top: 4,
                  zIndex: 50,
                  width: 240,
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: `1px solid ${theme.borderMedium}`,
                  background: theme.surfaceCard,
                  fontSize: 11,
                  fontFamily: theme.fontInter,
                  color: theme.textPrimary,
                  boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
                  pointerEvents: 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{flow.name}</span>
                  {isFinite && (
                    <span style={{
                      fontSize: 8, fontWeight: 700, letterSpacing: '0.08em',
                      textTransform: 'uppercase', padding: '1px 5px', borderRadius: 999,
                      background: `${railAccent}1A`, color: railAccent,
                      border: `1px solid ${railAccent}55`,
                    }}>finite</span>
                  )}
                </div>
                {flow.description && (
                  <div style={{ color: theme.textMuted, lineHeight: 1.4 }}>{flow.description}</div>
                )}
                <div style={{ marginTop: 6, color: theme.textFaint, fontSize: 10 }}>
                  {active ? 'Click to deactivate' : 'Click to attach to this chat'}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </aside>
  );
}
