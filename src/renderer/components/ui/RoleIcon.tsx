/**
 * RoleIcon.tsx — Renderer UI Primitive Component
 *
 * Responsibility:
 * - Renders the RoleIcon surface in the renderer layer.
 * - Encapsulates Reusable UI primitive used by higher-level panels and surfaces.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/RoleIcon.tsx — Shared icon renderer for roles (no emojis)
import React from 'react';
import {
  FiCpu, FiSearch, FiEdit, FiShield, FiZap,
  FiTool, FiBarChart2, FiGlobe, FiSettings,
  FiLayers, FiStar, FiTarget,
} from 'react-icons/fi';
import { VscBeaker, VscBug, VscSymbolStructure } from 'react-icons/vsc';

export const ROLE_ICON_NAMES = [
  'cpu', 'palette', 'gear', 'search', 'beaker',
  'edit', 'shield', 'zap', 'bulb', 'wrench',
  'chart', 'globe',
] as const;

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  cpu: FiCpu,
  palette: FiLayers,
  gear: FiSettings,
  search: FiSearch,
  beaker: VscBeaker,
  edit: FiEdit,
  shield: FiShield,
  zap: FiZap,
  bulb: FiStar,
  wrench: FiTool,
  chart: FiBarChart2,
  globe: FiGlobe,
  structure: VscSymbolStructure,
  bug: VscBug,
  target: FiTarget,
};

interface RoleIconProps {
  icon: string;
  size?: number;
  color?: string;
  className?: string;
}

export function RoleIcon({ icon, size = 14, color, className }: RoleIconProps) {
  const Component = ICON_MAP[icon];
  if (Component) {
    return <span aria-hidden="true" className={className}><Component size={size} color={color} /></span>;
  }
  // Fallback for any legacy/unknown icon string
  return <span aria-hidden="true" className={className}><FiCpu size={size} color={color} /></span>;
}
