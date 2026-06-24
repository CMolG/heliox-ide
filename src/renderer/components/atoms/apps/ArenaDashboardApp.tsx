/**
 * ArenaDashboardApp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders the Arena Leaderboard surface in the renderer layer.
 * - Encapsulates a sortable, filterable table of Arena benchmark results
 *   inside the resizable DesktopWindow wrapper.
 *
 * Boundaries:
 * - Owns: component-level rendering, sorting/filtering logic, IPC call to read
 *   the leaderboard JSON, and local interaction wiring.
 * - Does NOT own: writing leaderboard data, running Arena benchmarks,
 *   or any main-process logic. Data flows exclusively through the
 *   `arena:read-leaderboard` IPC channel (read-only).
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 * - Follows the Wrapper Principle: no hard-coded widths; layout is fully fluid
 *   so the window resizes gracefully from 400 px to full-screen.
 */
// src/renderer/components/atoms/apps/ArenaDashboardApp.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { theme } from '../../../logic/theme';
import { LucideIcon } from '../../desktop/LucideIcon';
import { useHelioxStore } from '../../../store';
import type { ArenaLeaderboardEntry } from '@/types/arena';

// ─── Props ────────────────────────────────────────────────────────

interface ArenaDashboardAppProps {
  windowId: string;
}

// ─── Column definition ────────────────────────────────────────────

type SortKey =
  | 'name'
  | 'architecture'
  | 'teamWork'
  | 'assembler'
  | 'finalArenaScore'
  | 'totalTokens'
  | 'executionCostUsd'
  | 'costPer1k'
  | 'avgLatencyMs'
  | 'tier'
  | 'status';

type SortDir = 'asc' | 'desc';

// ─── Tier filter ──────────────────────────────────────────────────

type TierFilter = 'all' | 'Free' | 'Paid';

// ─── Pure helpers (exported for unit testing) ─────────────────────

/**
 * Derive the pricing tier of an entry from its execution cost.
 * Free models report zero cost; anything above that is Paid.
 */
export function tierOf(entry: ArenaLeaderboardEntry): 'Free' | 'Paid' {
  return entry.executionCostUsd === 0 ? 'Free' : 'Paid';
}

/**
 * Compute cost per 1 000 tokens.
 * Guards against divide-by-zero when a model consumed 0 tokens
 * (e.g. the run errored before inference began).
 */
export function costPer1kTokens(entry: ArenaLeaderboardEntry): number {
  if (entry.totalTokens === 0) return 0;
  return entry.executionCostUsd / (entry.totalTokens / 1000);
}

/**
 * Sort a copy of the entries array by the given key and direction.
 *
 * - Numeric columns: standard numeric comparison; null values sort last
 *   regardless of direction.
 * - String columns ('name', 'status'): lexicographic comparison.
 * - Derived columns ('costPer1k'): computed inline.
 * - Sort is stable: equal values retain their original relative order
 *   (Array.prototype.sort is stable in V8 since Node 12).
 */
export function sortEntries(
  entries: ArenaLeaderboardEntry[],
  key: SortKey,
  dir: SortDir,
): ArenaLeaderboardEntry[] {
  const copy = [...entries];

  copy.sort((a, b) => {
    let av: number | string | null;
    let bv: number | string | null;

    switch (key) {
      case 'name':
        av = a.name;
        bv = b.name;
        break;
      case 'status':
        av = a.status;
        bv = b.status;
        break;
      case 'architecture':
        av = a.scores.architecture;
        bv = b.scores.architecture;
        break;
      case 'teamWork':
        av = a.scores.teamWork;
        bv = b.scores.teamWork;
        break;
      case 'assembler':
        av = a.scores.assembler;
        bv = b.scores.assembler;
        break;
      case 'costPer1k':
        av = costPer1kTokens(a);
        bv = costPer1kTokens(b);
        break;
      case 'avgLatencyMs':
        av = a.avgLatencyMs ?? null;
        bv = b.avgLatencyMs ?? null;
        break;
      case 'tier':
        av = tierOf(a);
        bv = tierOf(b);
        break;
      default:
        av = a[key];
        bv = b[key];
    }

    // Null values always sort to the bottom
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;

    if (typeof av === 'string' && typeof bv === 'string') {
      const cmp = av.localeCompare(bv);
      return dir === 'asc' ? cmp : -cmp;
    }

    const numA = av as number;
    const numB = bv as number;
    return dir === 'asc' ? numA - numB : numB - numA;
  });

  return copy;
}

// ─── Helpers: formatting ─────────────────────────────────────────

function fmtTokens(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtCostPer1k(n: number): string {
  if (n === 0) return '$0.0000';
  return `$${n.toFixed(5)}`;
}

function fmtScore(v: number | null): string {
  return v === null ? '—' : String(v);
}

// ─── Sub-component: sortable column header ─────────────────────

interface ThProps {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (key: SortKey) => void;
  numeric?: boolean;
}

function Th({ label, sortKey, currentKey, currentDir, onSort, numeric }: ThProps) {
  const isActive = currentKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        padding: '5px 8px',
        textAlign: numeric ? 'right' : 'left',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        userSelect: 'none',
        borderBottom: `1px solid ${theme.borderMedium}`,
        color: isActive ? theme.accentBlue : theme.textFaint,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontFamily: theme.fontInter,
        background: 'transparent',
        transition: 'color 0.12s',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {label}
        {isActive ? (
          <LucideIcon
            name={currentDir === 'desc' ? 'ChevronDown' : 'ChevronUp'}
            size={10}
            style={{ color: theme.accentBlue }}
          />
        ) : (
          <LucideIcon
            name="ArrowUpDown"
            size={9}
            style={{ color: theme.textGhost, opacity: 0.6 }}
          />
        )}
      </span>
    </th>
  );
}

// ─── Main component ──────────────────────────────────────────────

export function ArenaDashboardApp({ windowId: _windowId }: ArenaDashboardAppProps) {
  const projectPath = useHelioxStore(s => s.projectPath);

  // ── Data state ──────────────────────────────────────────────────
  const [entries, setEntries] = useState<ArenaLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Table state ─────────────────────────────────────────────────
  // Default sort: finalArenaScore descending (mirrors backend's sortLeaderboard)
  const [sortKey, setSortKey] = useState<SortKey>('finalArenaScore');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');

  // ── Data fetcher ────────────────────────────────────────────────
  // helioxAPI is always present in the Electron renderer — the contextBridge
  // is wired before React mounts. The optional type in the global declaration
  // is a TypeScript precaution for non-Electron test environments; we guard
  // here to satisfy strict mode cleanly.
  const load = useCallback(async () => {
    if (!projectPath) return;
    const api = window.helioxAPI;
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.readArenaLeaderboard(projectPath);
      if (result.success) {
        setEntries(result.data ?? []);
      } else {
        setError(result.error ?? 'Unknown error reading leaderboard.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // Load on mount and whenever the project changes
  useEffect(() => { void load(); }, [load]);

  // ── Sort handler: clicking the active column flips direction ────
  const handleSort = useCallback((key: SortKey) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
        return key;
      }
      // New column: numeric columns default desc, string columns default asc
      const stringCols: SortKey[] = ['name', 'status'];
      setSortDir(stringCols.includes(key) ? 'asc' : 'desc');
      return key;
    });
  }, []);

  // ── Derived table data ───────────────────────────────────────────
  const filtered = tierFilter === 'all'
    ? entries
    : entries.filter(e => tierOf(e) === tierFilter);

  const sorted = sortEntries(filtered, sortKey, sortDir);

  // ── Style constants ──────────────────────────────────────────────
  const cellStyle: React.CSSProperties = {
    padding: '5px 8px',
    fontSize: 11,
    fontFamily: theme.fontMono,
    borderBottom: `1px solid ${theme.borderSubtle}`,
    whiteSpace: 'nowrap',
  };
  const numericCellStyle: React.CSSProperties = {
    ...cellStyle,
    textAlign: 'right',
    color: theme.textSecondary,
  };

  // ── Tier filter chips ────────────────────────────────────────────
  const tierOptions: TierFilter[] = ['all', 'Free', 'Paid'];

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: theme.bg, overflow: 'hidden',
    }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', flexShrink: 0,
        borderBottom: `1px solid ${theme.borderLight}`,
        background: theme.surface,
      }}>
        <LucideIcon name="Trophy" size={13} style={{ color: theme.warning, flexShrink: 0 }} />
        <span style={{
          fontSize: 11, fontWeight: 700, color: theme.textPrimary,
          fontFamily: theme.fontInter, letterSpacing: '-0.01em',
        }}>
          Heliox Arena
        </span>
        <span style={{ fontSize: 10, color: theme.textGhost, fontFamily: theme.fontInter }}>
          Model Intelligence Leaderboard
        </span>

        {/* Tier filter chips */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
          {tierOptions.map(t => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              style={{
                fontSize: 9, padding: '2px 7px', borderRadius: 5,
                border: `1px solid ${tierFilter === t ? theme.accentBlueBorder : theme.borderLight}`,
                background: tierFilter === t ? theme.accentBlueBg : 'transparent',
                color: tierFilter === t ? theme.accentBlue : theme.textFaint,
                cursor: 'pointer', fontFamily: theme.fontInter, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.04em',
                transition: 'all 0.12s',
              }}
            >
              {t === 'all' ? 'All' : t}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Entry count badge */}
        <span style={{ fontSize: 9, color: theme.textGhost, fontFamily: theme.fontMono }}>
          {sorted.length} {sorted.length === 1 ? 'model' : 'models'}
        </span>

        {/* Refresh button */}
        <button
          onClick={() => { void load(); }}
          disabled={loading}
          aria-label="Refresh leaderboard"
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 6, cursor: loading ? 'not-allowed' : 'pointer',
            border: `1px solid ${theme.borderLight}`, background: 'transparent',
            color: loading ? theme.textGhost : theme.textMuted,
            fontSize: 10, fontFamily: theme.fontInter, fontWeight: 600,
            transition: 'all 0.12s',
          }}
        >
          <LucideIcon
            name="RefreshCw"
            size={10}
            style={{
              color: 'inherit',
              animation: loading ? 'spin 1s linear infinite' : undefined,
            }}
          />
          Refresh
        </button>
      </div>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* Error state */}
        {error && (
          <div style={{
            margin: 16, padding: '10px 14px', borderRadius: 8,
            background: theme.dangerBg, border: `1px solid ${theme.dangerBorder}`,
            color: theme.danger, fontSize: 11, fontFamily: theme.fontInter,
          }}>
            <LucideIcon name="AlertCircle" size={12} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            {error}
          </div>
        )}

        {/* Empty state — no runs yet */}
        {!loading && !error && sorted.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', gap: 10, padding: 32,
          }}>
            <LucideIcon name="Trophy" size={28} style={{ color: theme.borderMedium }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: theme.textDim, fontFamily: theme.fontInter }}>
              No Arena runs yet
            </span>
            <span style={{
              fontSize: 11, color: theme.textGhost, fontFamily: theme.fontMono,
              background: theme.surface, padding: '4px 10px', borderRadius: 6,
              border: `1px solid ${theme.borderLight}`,
            }}>
              npm run pf:arena
            </span>
            <span style={{ fontSize: 10, color: theme.textGhost, fontFamily: theme.fontInter, textAlign: 'center', maxWidth: 320 }}>
              Run the command above in your project to populate the leaderboard.
            </span>
          </div>
        )}

        {/* Table */}
        {!error && sorted.length > 0 && (
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            tableLayout: 'auto',
          }}>
            <thead style={{ position: 'sticky', top: 0, background: theme.surface, zIndex: 1 }}>
              <tr>
                <Th label="Model"        sortKey="name"           currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <Th label="Arch"         sortKey="architecture"   currentKey={sortKey} currentDir={sortDir} onSort={handleSort} numeric />
                <Th label="TeamWork"     sortKey="teamWork"       currentKey={sortKey} currentDir={sortDir} onSort={handleSort} numeric />
                <Th label="Assembler"    sortKey="assembler"      currentKey={sortKey} currentDir={sortDir} onSort={handleSort} numeric />
                <Th label="Final"        sortKey="finalArenaScore" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} numeric />
                <Th label="Tokens"       sortKey="totalTokens"    currentKey={sortKey} currentDir={sortDir} onSort={handleSort} numeric />
                <Th label="Cost"         sortKey="executionCostUsd" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} numeric />
                <Th label="$/1k tok"     sortKey="costPer1k"      currentKey={sortKey} currentDir={sortDir} onSort={handleSort} numeric />
                <Th label="Tier"         sortKey="tier"           currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
                <Th label="Latency"      sortKey="avgLatencyMs"   currentKey={sortKey} currentDir={sortDir} onSort={handleSort} numeric />
                <Th label="Status"       sortKey="status"         currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map(entry => {
                const isError = entry.status === 'api_error';
                const tier = tierOf(entry);
                const cPer1k = costPer1kTokens(entry);
                const errorTitle = entry.errors?.join('\n');
                return (
                  <tr
                    key={entry.modelId}
                    title={isError && errorTitle ? errorTitle : undefined}
                    style={{
                      opacity: isError ? 0.5 : 1,
                      background: 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = theme.surfaceHover; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'; }}
                  >
                    {/* Model name */}
                    <td style={{ ...cellStyle, color: isError ? theme.textDim : theme.textPrimary, fontFamily: theme.fontInter }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {isError && (
                          <LucideIcon
                            name="AlertCircle"
                            size={10}
                            style={{ color: theme.danger, flexShrink: 0 }}
                          />
                        )}
                        {entry.name}
                      </span>
                    </td>

                    {/* Architecture score */}
                    <td style={{ ...numericCellStyle, color: entry.scores.architecture === null ? theme.textGhost : theme.textSecondary }}>
                      {fmtScore(entry.scores.architecture)}
                    </td>

                    {/* TeamWork score */}
                    <td style={{ ...numericCellStyle, color: entry.scores.teamWork === null ? theme.textGhost : theme.textSecondary }}>
                      {fmtScore(entry.scores.teamWork)}
                    </td>

                    {/* Assembler score */}
                    <td style={{ ...numericCellStyle, color: entry.scores.assembler === null ? theme.textGhost : theme.textSecondary }}>
                      {fmtScore(entry.scores.assembler)}
                    </td>

                    {/* Final Arena score — highlighted */}
                    <td style={{
                      ...numericCellStyle,
                      color: isError ? theme.textGhost : theme.accentBlue,
                      fontWeight: 700,
                    }}>
                      {entry.finalArenaScore}
                    </td>

                    {/* Total tokens */}
                    <td style={numericCellStyle}>
                      {fmtTokens(entry.totalTokens)}
                    </td>

                    {/* Execution cost */}
                    <td style={numericCellStyle}>
                      {fmtCost(entry.executionCostUsd)}
                    </td>

                    {/* Cost per 1k tokens */}
                    <td style={numericCellStyle}>
                      {fmtCostPer1k(cPer1k)}
                    </td>

                    {/* Tier badge */}
                    <td style={{ ...cellStyle }}>
                      <span style={{
                        fontSize: 9, padding: '2px 6px', borderRadius: 4,
                        fontWeight: 700, fontFamily: theme.fontInter,
                        letterSpacing: '0.05em', textTransform: 'uppercase',
                        background: tier === 'Free' ? theme.successBg : theme.accentBlueBg,
                        color: tier === 'Free' ? theme.success : theme.accentBlue,
                        border: `1px solid ${tier === 'Free' ? theme.successBorder : theme.accentBlueBorder}`,
                      }}>
                        {tier}
                      </span>
                    </td>

                    {/* Latency — rendered when present, '—' otherwise */}
                    <td style={{ ...numericCellStyle, color: entry.avgLatencyMs != null ? theme.textSecondary : theme.textGhost }}>
                      {entry.avgLatencyMs != null ? `${entry.avgLatencyMs.toLocaleString('en-US')} ms` : '—'}
                    </td>

                    {/* Status */}
                    <td style={{ ...cellStyle }}>
                      <span style={{
                        fontSize: 9, padding: '2px 6px', borderRadius: 4,
                        fontWeight: 600, fontFamily: theme.fontInter,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                        background: isError ? theme.dangerBg : theme.successBg,
                        color: isError ? theme.danger : theme.success,
                        border: `1px solid ${isError ? theme.dangerBorder : theme.successBorder}`,
                      }}>
                        {isError ? 'error' : 'ok'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Footer note ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 12px', flexShrink: 0,
        borderTop: `1px solid ${theme.borderSubtle}`,
        background: theme.surface,
      }}>
        <LucideIcon name="Info" size={9} style={{ color: theme.textGhost }} />
        <span style={{ fontSize: 9, color: theme.textGhost, fontFamily: theme.fontInter }}>
          Latency column not yet populated by the backend — shows&nbsp;
          <span style={{ fontFamily: theme.fontMono }}>—</span> until the runner is updated (separate task).
        </span>
      </div>
    </div>
  );
}
