/**
 * LucideIcon.tsx — Renderer Desktop Surface Component
 *
 * Responsibility:
 * - Renders the LucideIcon surface in the renderer layer.
 * - Encapsulates Desktop canvas/window composition within the renderer workspace.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/desktop/LucideIcon.tsx — Optimized icon component using react-icons (md + lu)
import React, { lazy, Suspense, memo } from 'react';
import type { IconType } from 'react-icons';

// ─── Static imports for frequently used UI chrome icons (always in bundle) ───
import {
  LuMessageSquare, LuStore, LuPalette, LuServer, LuSearchCode, LuFlaskConical,
  LuFileText, LuGitCommitVertical, LuShieldCheck, LuBookOpen, LuRoute, LuZap,
  LuScrollText, LuTerminal, LuBlocks, LuGitBranch, LuBot, LuSparkles, LuCpu,
  LuX, LuMinus, LuSquare, LuGripVertical, LuPlus, LuPackage, LuBell, LuBellDot,
  LuZoomIn, LuZoomOut, LuArrowLeft, LuChevronLeft, LuChevronRight, LuChevronUp,
  LuChevronDown, LuFolder, LuFolderOpen, LuFolderPlus, LuFolderRoot, LuRefreshCw,
  LuInbox, LuPlay, LuFileCode2, LuFilePlus, LuLoader, LuUnlink, LuKanban,
  LuUser, LuWrench, LuClock, LuCircleCheck, LuCircleX, LuEye, LuHistory,
  LuBan, LuClipboardList, LuListChecks, LuShield, LuCloud, LuDatabase,
  LuGlobe, LuGauge, LuMinimize2, LuShapes, LuPenTool, LuGitFork, LuTrendingUp,
  LuBug, LuAccessibility, LuSettings, LuOrbit, LuGitCompareArrows, LuColumns2,
  LuWorkflow, LuFlag, LuTriangleAlert, LuDownload,
} from 'react-icons/lu';

// ─── Static imports for inventory Material Design icons ──────────────────────
import {
  MdSpeed, MdCompress, MdFormatShapes, MdDesignServices, MdBuild, MdWeb,
  MdStorage, MdCloud, MdSecurity, MdAccountTree, MdTimeline, MdBugReport,
  MdAssignment, MdMenuBook, MdFactCheck, MdScience, MdBlock, MdShield,
  MdComment, MdPreview, MdHistory, MdBolt, MdAccessibility,
} from 'react-icons/md';

// ─── Unified icon map: PascalCase name → react-icons component ──────────────
// Supports both Lucide PascalCase names (used in UI) and Md* names (from inventory)
const ICON_MAP: Record<string, IconType> = {
  // Lucide (Lu) — UI chrome, dock, window controls, nav
  MessageSquare: LuMessageSquare, Store: LuStore, Palette: LuPalette,
  Server: LuServer, SearchCode: LuSearchCode, FlaskConical: LuFlaskConical,
  FileText: LuFileText, GitCommitVertical: LuGitCommitVertical,
  ShieldCheck: LuShieldCheck, BookOpen: LuBookOpen, Route: LuRoute, Zap: LuZap,
  ScrollText: LuScrollText, Terminal: LuTerminal, Blocks: LuBlocks,
  Github: LuGitBranch, GitBranch: LuGitBranch, Bot: LuBot, Sparkles: LuSparkles,
  Cpu: LuCpu, X: LuX, Minus: LuMinus, Square: LuSquare,
  GripVertical: LuGripVertical, Plus: LuPlus, Package: LuPackage,
  Bell: LuBell, BellDot: LuBellDot, ZoomIn: LuZoomIn, ZoomOut: LuZoomOut,
  ArrowLeft: LuArrowLeft, ChevronLeft: LuChevronLeft, ChevronRight: LuChevronRight,
  ChevronUp: LuChevronUp, ChevronDown: LuChevronDown,
  Folder: LuFolder, FolderOpen: LuFolderOpen, FolderPlus: LuFolderPlus,
  FolderRoot: LuFolderRoot, RefreshCw: LuRefreshCw, Inbox: LuInbox, Play: LuPlay,
  FileCode2: LuFileCode2, FilePlus: LuFilePlus, Loader2: LuLoader, Loader: LuLoader,
  Unlink: LuUnlink, KanbanSquare: LuKanban, User: LuUser, Wrench: LuWrench,
  Clock: LuClock, CheckCircle: LuCircleCheck, XCircle: LuCircleX,
  Eye: LuEye, History: LuHistory, Ban: LuBan,
  ClipboardList: LuClipboardList, ListChecks: LuListChecks,
  Shield: LuShield, Cloud: LuCloud, Database: LuDatabase, Globe: LuGlobe,
  Gauge: LuGauge, Minimize2: LuMinimize2, Shapes: LuShapes, PenTool: LuPenTool,
  GitFork: LuGitFork, TrendingUp: LuTrendingUp, Bug: LuBug,
  Accessibility: LuAccessibility, Settings: LuSettings, Orbit: LuOrbit,
  GitCompareArrows: LuGitCompareArrows, Columns2: LuColumns2,
  Workflow: LuWorkflow, Flag: LuFlag, TriangleAlert: LuTriangleAlert,
  Download: LuDownload,

  // Material Design (Md) — inventory/market icons (used directly from inventory.json)
  MdSpeed, MdCompress, MdFormatShapes, MdDesignServices, MdBuild, MdWeb,
  MdStorage, MdCloud, MdSecurity, MdAccountTree, MdTimeline, MdBugReport,
  MdAssignment, MdMenuBook, MdFactCheck, MdScience, MdBlock, MdShield,
  MdComment, MdPreview, MdHistory, MdBolt, MdAccessibility,
};

// ─── Dynamic import cache for icons not in the static map ────────────────────
const lazyCache = new Map<string, React.LazyExoticComponent<React.ComponentType<any>>>();

function getLazyIcon(name: string): React.LazyExoticComponent<React.ComponentType<any>> | null {
  if (lazyCache.has(name)) return lazyCache.get(name)!;

  // Determine library prefix
  const isMd = name.startsWith('Md');
  const isLu = /^[A-Z][a-z]/.test(name) && !isMd;

  if (isMd) {
    const component = lazy(() =>
      import('react-icons/md').then(mod => ({
        default: (mod as unknown as Record<string, IconType>)[name] ?? (mod as unknown as Record<string, IconType>)['MdHelp'],
      }))
    );
    lazyCache.set(name, component);
    return component;
  }

  if (isLu) {
    const luName = `Lu${name}`;
    const component = lazy(() =>
      import('react-icons/lu').then(mod => ({
        default: (mod as unknown as Record<string, IconType>)[luName] ?? (mod as unknown as Record<string, IconType>)['LuTerminal'],
      }))
    );
    lazyCache.set(name, component);
    return component;
  }

  return null;
}

// ─── Public component ────────────────────────────────────────────────────────

interface LucideIconProps {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}

export const LucideIcon = memo(function LucideIcon({
  name,
  size = 16,
  className,
  strokeWidth,
  style,
}: LucideIconProps) {
  // Defensive guard: a missing/undefined name must never crash the React tree
  // (icon resolution calls name.startsWith). Render a neutral fallback instead.
  if (!name) {
    return <LuTerminal aria-hidden="true" size={size} className={className} style={{ opacity: 0.4, ...style }} />;
  }

  // 1. Try static map first (zero-cost, no lazy)
  const StaticIcon = ICON_MAP[name];
  if (StaticIcon) {
    return (
      <StaticIcon
        aria-hidden="true"
        size={size}
        className={className}
        style={style}
      />
    );
  }

  // 2. Try dynamic lazy import
  const LazyIcon = getLazyIcon(name);
  if (LazyIcon) {
    return (
      <Suspense fallback={<span style={{ display: 'inline-block', width: size, height: size }} />}>
        <LazyIcon aria-hidden="true" size={size} className={className} style={style} />
      </Suspense>
    );
  }

  // 3. Fallback
  return (
    <LuTerminal
      aria-hidden="true"
      size={size}
      className={className}
      style={{ opacity: 0.4, ...style }}
    />
  );
});

