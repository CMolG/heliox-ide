/**
 * ContextMapPanel.tsx — Renderer Desktop Component
 *
 * Responsibility:
 * - Renders the Context Map as a searchable, browsable panel.
 * - Fetches nodes/edges via the preload IPC bridge.
 * - Supports search, node type filtering, edge visualization, and context digest export.
 *
 * Boundaries:
 * - Owns: context map visualization, search, node CRUD UI
 * - Does NOT own: persistence (main process), injection logic, attachable registry
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useHelioxStore } from '../../store';
import { theme } from '../../logic/theme';
import type {
  ContextMapNode,
  ContextMapEdge,
  ContextMapNodeType,
} from '../../../types/context-map';

// ─── Constants ───────────────────────────────────────────────────

const NODE_TYPE_ICONS: Record<ContextMapNodeType, string> = {
  concept: '💡',
  file: '📄',
  pattern: '🔁',
  constraint: '🔒',
  goal: '🎯',
  decision: '⚖️',
  reference: '📎',
  person: '👤',
  question: '❓',
  instruction: '📋',
  'persona-mod': '🎭',
  'context-snippet': '✂️',
  checklist: '☑️',
  session: '💬',
};

const NODE_TYPE_COLORS: Record<ContextMapNodeType, string> = {
  concept: '#60A5FA',
  file: '#34D399',
  pattern: '#A78BFA',
  constraint: '#F87171',
  goal: '#FBBF24',
  decision: '#FB923C',
  reference: '#94A3B8',
  person: '#F472B6',
  question: '#38BDF8',
  instruction: '#4ADE80',
  'persona-mod': '#C084FC',
  'context-snippet': '#22D3EE',
  checklist: '#A3E635',
  session: '#818CF8',
};

// ─── Component ───────────────────────────────────────────────────

interface ContextMapPanelProps {
  open: boolean;
  onClose: () => void;
}

export function ContextMapPanel({ open, onClose }: ContextMapPanelProps) {
  const projectPath = useHelioxStore((s) => s.projectPath);
  const [nodes, setNodes] = useState<ContextMapNode[]>([]);
  const [edges, setEdges] = useState<ContextMapEdge[]>([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<ContextMapNodeType | 'all'>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [addNodeLabel, setAddNodeLabel] = useState('');
  const [addNodeType, setAddNodeType] = useState<ContextMapNodeType>('concept');
  const [showAddForm, setShowAddForm] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Fetch context map data
  const fetchData = useCallback(async () => {
    if (!projectPath) return;
    setLoading(true);
    try {
      const map = await window.helioxAPI!.contextMapGetAll(projectPath);
      setNodes(map.nodes);
      setEdges(map.edges);
    } catch (err) {
      console.error('Failed to load context map:', err);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    if (open) {
      fetchData();
      searchRef.current?.focus();
    }
  }, [open, fetchData]);

  // Escape to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Filtered + searched nodes
  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (filterType !== 'all') {
      result = result.filter((n) => n.type === filterType);
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (n) =>
          n.label.toLowerCase().includes(q) ||
          n.body?.toLowerCase().includes(q) ||
          n.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [nodes, filterType, search]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const connectedEdges = useMemo(
    () =>
      selectedNodeId
        ? edges.filter((e) => e.from === selectedNodeId || e.to === selectedNodeId)
        : [],
    [edges, selectedNodeId]
  );

  // Export digest
  const handleExportDigest = useCallback(async () => {
    if (!projectPath) return;
    const text = await window.helioxAPI!.contextMapExportText(projectPath);
    setDigest(text);
  }, [projectPath]);

  // Add node
  const handleAddNode = useCallback(async () => {
    if (!projectPath || !addNodeLabel.trim()) return;
    await window.helioxAPI!.contextMapUpsertNode(projectPath, {
      id: crypto.randomUUID(),
      type: addNodeType,
      label: addNodeLabel.trim(),
      source: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setAddNodeLabel('');
    setShowAddForm(false);
    fetchData();
  }, [projectPath, addNodeLabel, addNodeType, fetchData]);

  // Delete node
  const handleDeleteNode = useCallback(
    async (nodeId: string) => {
      if (!projectPath) return;
      await window.helioxAPI!.contextMapDeleteNode(projectPath, nodeId);
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      fetchData();
    },
    [projectPath, selectedNodeId, fetchData]
  );

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10010,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
      data-testid="context-map-panel-backdrop"
    >
      <div
        data-testid="context-map-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.bgDeep,
          border: `1px solid ${theme.borderLight}`,
          borderRadius: 12,
          padding: 20,
          width: 720,
          maxHeight: '85vh',
          overflow: 'hidden',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontFamily: theme.fontGrotesk, fontSize: 16, fontWeight: 600, color: theme.textPrimary, margin: 0 }}>
            Context Map
          </h2>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              data-testid="context-map-add-node"
              onClick={() => setShowAddForm((v) => !v)}
              style={{
                padding: '4px 10px', borderRadius: 6, border: `1px solid ${theme.border}`,
                background: showAddForm ? theme.surfaceHover : 'transparent',
                color: theme.textSecondary, fontFamily: theme.fontGrotesk, fontSize: 11, cursor: 'pointer',
              }}
            >
              + Add Node
            </button>
            <button
              data-testid="context-map-export"
              onClick={handleExportDigest}
              style={{
                padding: '4px 10px', borderRadius: 6, border: `1px solid ${theme.border}`,
                background: 'transparent', color: theme.textSecondary,
                fontFamily: theme.fontGrotesk, fontSize: 11, cursor: 'pointer',
              }}
            >
              📋 Export Digest
            </button>
            <button
              onClick={onClose}
              style={{
                padding: '4px 10px', borderRadius: 6, border: 'none',
                background: theme.surfaceHover, color: theme.textPrimary,
                fontFamily: theme.fontGrotesk, fontSize: 11, cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Add node form */}
        {showAddForm && (
          <div
            data-testid="context-map-add-form"
            style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center' }}
          >
            <select
              value={addNodeType}
              onChange={(e) => setAddNodeType(e.target.value as ContextMapNodeType)}
              style={{
                height: 28, borderRadius: 4, border: `1px solid ${theme.border}`,
                background: theme.surface, color: theme.textPrimary,
                fontFamily: theme.fontMono, fontSize: 11, padding: '0 6px',
              }}
            >
              {Object.entries(NODE_TYPE_ICONS).map(([type, icon]) => (
                <option key={type} value={type}>{icon} {type}</option>
              ))}
            </select>
            <input
              data-testid="context-map-add-label"
              type="text"
              placeholder="Node label..."
              value={addNodeLabel}
              onChange={(e) => setAddNodeLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddNode(); }}
              style={{
                flex: 1, height: 28, padding: '0 8px', borderRadius: 4,
                border: `1px solid ${theme.border}`, background: theme.surface,
                color: theme.textPrimary, fontFamily: theme.fontMono, fontSize: 12,
              }}
            />
            <button
              data-testid="context-map-add-submit"
              onClick={handleAddNode}
              style={{
                padding: '4px 12px', borderRadius: 4, border: 'none',
                background: theme.accentBlue, color: '#fff',
                fontFamily: theme.fontGrotesk, fontSize: 11, cursor: 'pointer',
              }}
            >
              Add
            </button>
          </div>
        )}

        {/* Search + filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            ref={searchRef}
            data-testid="context-map-search"
            type="text"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1, height: 30, padding: '0 10px', borderRadius: 6,
              border: `1px solid ${theme.border}`, background: theme.surface,
              color: theme.textPrimary, fontFamily: theme.fontMono, fontSize: 12, outline: 'none',
            }}
          />
          <select
            data-testid="context-map-filter"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as ContextMapNodeType | 'all')}
            style={{
              height: 30, borderRadius: 6, border: `1px solid ${theme.border}`,
              background: theme.surface, color: theme.textPrimary,
              fontFamily: theme.fontMono, fontSize: 11, padding: '0 8px',
            }}
          >
            <option value="all">All types</option>
            {Object.entries(NODE_TYPE_ICONS).map(([type, icon]) => (
              <option key={type} value={type}>{icon} {type}</option>
            ))}
          </select>
        </div>

        {/* Stats bar */}
        <div style={{
          fontFamily: theme.fontMono, fontSize: 10, color: theme.textMuted, marginBottom: 8,
          display: 'flex', gap: 12,
        }}>
          <span>{nodes.length} nodes</span>
          <span>{edges.length} edges</span>
          {search && <span>{filteredNodes.length} matching</span>}
        </div>

        {/* Content area */}
        <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Node list */}
          <div
            data-testid="context-map-node-list"
            style={{
              flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4,
            }}
          >
            {loading && (
              <div style={{ fontFamily: theme.fontMono, fontSize: 11, color: theme.textMuted, padding: 20, textAlign: 'center' }}>
                Loading context map…
              </div>
            )}
            {!loading && filteredNodes.length === 0 && (
              <div style={{ fontFamily: theme.fontMono, fontSize: 11, color: theme.textMuted, padding: 20, textAlign: 'center' }}>
                {nodes.length === 0 ? 'No nodes yet. Add one to get started.' : 'No matching nodes.'}
              </div>
            )}
            {filteredNodes.map((node) => (
              <div
                key={node.id}
                data-testid={`context-map-node-${node.id}`}
                onClick={() => setSelectedNodeId(node.id === selectedNodeId ? null : node.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  borderRadius: 6, cursor: 'pointer',
                  background: node.id === selectedNodeId ? theme.surfaceHover : 'transparent',
                  border: `1px solid ${node.id === selectedNodeId ? NODE_TYPE_COLORS[node.type] + '44' : 'transparent'}`,
                  transition: 'background 120ms ease',
                }}
              >
                <span style={{ fontSize: 14 }}>{NODE_TYPE_ICONS[node.type]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: theme.fontGrotesk, fontSize: 12, fontWeight: 500,
                    color: theme.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {node.label}
                  </div>
                  {node.tags && node.tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                      {node.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          style={{
                            fontFamily: theme.fontMono, fontSize: 8,
                            padding: '0 4px', borderRadius: 3,
                            background: `${NODE_TYPE_COLORS[node.type]}22`,
                            color: NODE_TYPE_COLORS[node.type],
                          }}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span style={{
                  fontFamily: theme.fontMono, fontSize: 9, color: theme.textGhost,
                  background: `${NODE_TYPE_COLORS[node.type]}18`,
                  padding: '1px 5px', borderRadius: 3,
                }}>
                  {node.type}
                </span>
              </div>
            ))}
          </div>

          {/* Detail pane */}
          {selectedNode && (
            <div
              data-testid="context-map-detail"
              style={{
                width: 260, borderLeft: `1px solid ${theme.border}`, paddingLeft: 12,
                overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 18 }}>{NODE_TYPE_ICONS[selectedNode.type]}</span>
                <span style={{
                  fontFamily: theme.fontGrotesk, fontSize: 14, fontWeight: 600,
                  color: theme.textPrimary,
                }}>
                  {selectedNode.label}
                </span>
              </div>

              <div style={{ fontFamily: theme.fontMono, fontSize: 10, color: theme.textMuted }}>
                Type: {selectedNode.type} · Source: {selectedNode.source}
              </div>

              {selectedNode.priority && (
                <div style={{
                  fontFamily: theme.fontMono, fontSize: 10,
                  color: selectedNode.priority === 'critical' ? '#F87171' : selectedNode.priority === 'high' ? '#FBBF24' : theme.textMuted,
                }}>
                  Priority: {selectedNode.priority}
                </div>
              )}

              {selectedNode.body && (
                <div style={{
                  fontFamily: theme.fontMono, fontSize: 11, color: theme.textSecondary,
                  lineHeight: 1.5, background: theme.surface, borderRadius: 6, padding: 8,
                  maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap',
                }}>
                  {selectedNode.body}
                </div>
              )}

              {/* Connected edges */}
              {connectedEdges.length > 0 && (
                <div>
                  <div style={{ fontFamily: theme.fontGrotesk, fontSize: 10, color: theme.textMuted, marginBottom: 4 }}>
                    Connections ({connectedEdges.length})
                  </div>
                  {connectedEdges.map((edge) => {
                    const other = edge.from === selectedNodeId
                      ? nodes.find((n) => n.id === edge.to)
                      : nodes.find((n) => n.id === edge.from);
                    const direction = edge.from === selectedNodeId ? '→' : '←';
                    return (
                      <div
                        key={edge.id}
                        style={{
                          fontFamily: theme.fontMono, fontSize: 10, color: theme.textSecondary,
                          padding: '2px 0',
                        }}
                      >
                        {direction} {other?.label ?? 'unknown'}
                        {edge.label && <span style={{ color: theme.textMuted }}> ({edge.label})</span>}
                      </div>
                    );
                  })}
                </div>
              )}

              <button
                data-testid="context-map-delete-node"
                onClick={() => handleDeleteNode(selectedNode.id)}
                style={{
                  marginTop: 'auto', padding: '4px 10px', borderRadius: 4,
                  border: `1px solid #F8717144`, background: 'transparent',
                  color: '#F87171', fontFamily: theme.fontGrotesk, fontSize: 10, cursor: 'pointer',
                }}
              >
                Delete node
              </button>
            </div>
          )}
        </div>

        {/* Digest display */}
        {digest !== null && (
          <div
            data-testid="context-map-digest"
            style={{
              marginTop: 12, padding: 10, borderRadius: 6,
              background: theme.surface, border: `1px solid ${theme.border}`,
              maxHeight: 120, overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontFamily: theme.fontGrotesk, fontSize: 10, color: theme.textMuted }}>Context Digest</span>
              <button
                onClick={() => { navigator.clipboard.writeText(digest); }}
                style={{
                  background: 'none', border: 'none', color: theme.textMuted,
                  fontFamily: theme.fontMono, fontSize: 9, cursor: 'pointer',
                }}
              >
                Copy
              </button>
            </div>
            <pre style={{
              fontFamily: theme.fontMono, fontSize: 10, color: theme.textSecondary,
              margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.4,
            }}>
              {digest || '(empty digest — no nodes yet)'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
