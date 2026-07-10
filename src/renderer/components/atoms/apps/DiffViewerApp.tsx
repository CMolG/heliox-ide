/**
 * DiffViewerApp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders a Monaco DiffEditor surface for side-by-side code diff analysis.
 * - Encapsulates file selection, original-vs-modified loading, and diff navigation.
 *
 * Boundaries:
 * - Owns: diff display, file list, inline/side-by-side toggle, loading states
 * - Does NOT own: git operations (delegated to IPC), session state, agent lifecycle
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/apps/DiffViewerApp.tsx — Side-by-side Monaco diff viewer spawned from agentic sessions
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import { useFluxorStore } from '../../../store';
import { detectLanguage, FLUXOR_MONACO_THEME, configureLinting } from '../../../logic/monaco-config';
import { getFileIcon } from '../../../logic/file-icons';
import { theme } from '../../../logic/theme';
import { LucideIcon } from '../../desktop/LucideIcon';

// ─── Types ───────────────────────────────────────────────────────

interface DiffViewerAppProps {
  windowId: string;
  sessionId?: string;
}

interface DiffFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';
}

// ─── Status badge colors ─────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  modified:  { bg: 'rgba(251,191,36,0.12)', text: '#fbbf24', label: 'M' },
  added:     { bg: 'rgba(160,246,149,0.12)', text: '#A0F695', label: 'A' },
  untracked: { bg: 'rgba(160,246,149,0.12)', text: '#A0F695', label: 'U' },
  deleted:   { bg: 'rgba(240,37,37,0.12)', text: '#F02525', label: 'D' },
  renamed:   { bg: 'rgba(96,165,250,0.12)', text: '#60a5fa', label: 'R' },
};

// ─── Shared widget root (body-level, escapes transform context) ──

let _diffWidgetRoot: HTMLElement | null = null;

function getDiffWidgetRoot(): HTMLElement {
  if (_diffWidgetRoot && document.body.contains(_diffWidgetRoot)) return _diffWidgetRoot;
  _diffWidgetRoot = document.createElement('div');
  _diffWidgetRoot.id = 'fluxor-diff-widgets';
  _diffWidgetRoot.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:visible;';
  document.body.appendChild(_diffWidgetRoot);
  return _diffWidgetRoot;
}

// ─── Component ───────────────────────────────────────────────────

export function DiffViewerApp({ windowId, sessionId }: DiffViewerAppProps) {
  const projectPath = useFluxorStore(s => s.projectPath);
  const sessionChangedFiles = useFluxorStore(s => s.sessionChangedFiles);

  const [files, setFiles] = useState<DiffFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string>('');
  const [modifiedContent, setModifiedContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [renderSideBySide, setRenderSideBySide] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const widgetRoot = useRef(getDiffWidgetRoot());

  // Merge session files with git status to build the file list
  const loadFiles = useCallback(async () => {
    if (!projectPath || !window.fluxorAPI) return;
    setLoading(true);
    try {
      const gitStatuses = await window.fluxorAPI.gitFileStatuses(projectPath).catch(() => []);

      // Session files get priority
      const sessionFiles = sessionId ? (sessionChangedFiles[sessionId] ?? []) : [];
      const sessionPaths = new Set(sessionFiles.map(f => f.path));

      const merged: DiffFile[] = [];
      // Add session files first
      for (const sf of sessionFiles) {
        const gitEntry = gitStatuses.find(g => g.path === sf.path);
        merged.push({ path: sf.path, status: gitEntry?.status ?? 'modified' });
      }
      // Then add any other git-changed files not already in session
      for (const gs of gitStatuses) {
        if (!sessionPaths.has(gs.path)) {
          merged.push({ path: gs.path, status: gs.status });
        }
      }

      setFiles(merged);
      // Auto-select first file
      if (merged.length > 0 && !selectedFile) {
        setSelectedFile(merged[0].path);
      }
    } finally {
      setLoading(false);
    }
  }, [projectPath, sessionId, sessionChangedFiles, selectedFile]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // Load original (HEAD) and modified (working copy) for selected file
  useEffect(() => {
    if (!selectedFile || !projectPath || !window.fluxorAPI) return;
    let cancelled = false;
    setFileLoading(true);

    const absolutePath = `${projectPath}/${selectedFile}`;
    const fileInfo = files.find(f => f.path === selectedFile);

    Promise.all([
      // Original from git HEAD (null for new/untracked files)
      fileInfo?.status === 'added' || fileInfo?.status === 'untracked'
        ? Promise.resolve(null)
        : window.fluxorAPI.gitShowFile(projectPath, selectedFile),
      // Modified from working tree (null for deleted files)
      fileInfo?.status === 'deleted'
        ? Promise.resolve(null)
        : window.fluxorAPI.readFile(absolutePath),
    ]).then(([original, modified]) => {
      if (cancelled) return;
      setOriginalContent(original ?? '');
      setModifiedContent(modified ?? '');
      setFileLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setOriginalContent('');
      setModifiedContent('');
      setFileLoading(false);
    });

    return () => { cancelled = true; };
  }, [selectedFile, projectPath, files]);

  // Monaco diff editor mount handler
  const handleDiffMount: DiffOnMount = useCallback((editor, monaco) => {
    monaco.editor.defineTheme('fluxor-dark', FLUXOR_MONACO_THEME);
    monaco.editor.setTheme('fluxor-dark');
    configureLinting(monaco);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const idx = files.findIndex(f => f.path === selectedFile);
        if (idx < files.length - 1) setSelectedFile(files[idx + 1].path);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const idx = files.findIndex(f => f.path === selectedFile);
        if (idx > 0) setSelectedFile(files[idx - 1].path);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [files, selectedFile]);

  const language = selectedFile ? detectLanguage(selectedFile) : 'plaintext';
  const sessionPaths = sessionId ? new Set((sessionChangedFiles[sessionId] ?? []).map(f => f.path)) : new Set<string>();

  // ─── Loading state ──────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: theme.bg, color: theme.textGhost, fontSize: 12 }}>
        <LucideIcon name="Loader2" size={16} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
        Loading changed files…
      </div>
    );
  }

  // ─── Empty state ────────────────────────────────────────────────

  if (files.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', background: theme.bg, gap: 12 }}>
        <div style={{ opacity: 0.15, fontSize: 32 }}>◈</div>
        <span style={{ fontFamily: theme.fontManrope, fontSize: 13, color: theme.textFaint }}>
          No changed files detected
        </span>
        <button
          onClick={loadFiles}
          style={{
            padding: '4px 12px', borderRadius: 6, fontSize: 11,
            background: 'transparent', border: `1px solid ${theme.borderLight}`,
            color: theme.textDim, cursor: 'pointer',
          }}
        >
          ↺ Refresh
        </button>
      </div>
    );
  }

  // ─── Main layout ────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bg }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 10px', borderBottom: `1px solid ${theme.borderLight}`,
        background: theme.surface, flexShrink: 0, gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LucideIcon name="GitCompareArrows" size={13} style={{ color: theme.textDim, flexShrink: 0 }} />
          <span style={{
            fontFamily: theme.fontInter, fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em', color: theme.textFaint,
          }}>
            Diff Viewer
          </span>
          <span style={{
            fontFamily: theme.fontMono, fontSize: 10,
            padding: '1px 6px', borderRadius: 10,
            background: theme.surfaceHover, color: theme.textDim,
          }}>
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Side-by-side / inline toggle */}
          <button
            onClick={() => setRenderSideBySide(!renderSideBySide)}
            title={renderSideBySide ? 'Switch to inline diff' : 'Switch to side-by-side diff'}
            aria-label={renderSideBySide ? 'Switch to inline diff' : 'Switch to side-by-side diff'}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 4, fontSize: 10,
              border: `1px solid ${theme.borderLight}`,
              background: theme.bg, color: theme.textDim, cursor: 'pointer',
            }}
          >
            <LucideIcon name="Columns2" size={11} style={{ color: theme.textDim }} />
            {renderSideBySide ? 'Side-by-side' : 'Inline'}
          </button>
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarCollapsed(c => !c)}
            title={sidebarCollapsed ? 'Show file list' : 'Hide file list'}
            aria-label={sidebarCollapsed ? 'Show file list' : 'Hide file list'}
            style={{
              padding: '2px 6px', borderRadius: 4, fontSize: 10,
              border: `1px solid ${theme.borderLight}`,
              background: sidebarCollapsed ? theme.surfaceHover : theme.bg,
              color: theme.textDim, cursor: 'pointer',
            }}
          >
            <LucideIcon name="FileText" size={11} style={{ color: theme.textDim }} />
          </button>
          {/* Refresh */}
          <button
            onClick={loadFiles}
            title="Refresh file list"
            aria-label="Refresh file list"
            style={{
              padding: '2px 6px', borderRadius: 4, fontSize: 10,
              border: `1px solid ${theme.borderLight}`,
              background: theme.bg, color: theme.textDim, cursor: 'pointer',
            }}
          >
            <LucideIcon name="RefreshCw" size={11} style={{ color: theme.textDim }} />
          </button>
        </div>
      </div>

      {/* Content: sidebar + diff editor */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* File sidebar */}
        {!sidebarCollapsed && (
          <div style={{
            width: 220, flexShrink: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column',
            borderRight: `1px solid ${theme.borderLight}`, background: theme.bgDeep,
          }}>
            {/* File list header */}
            <div style={{
              padding: '6px 10px', borderBottom: `1px solid ${theme.border}`,
              fontFamily: theme.fontInter, fontSize: 9, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.08em', color: theme.textGhost,
            }}>
              Changed Files
            </div>
            {/* File list */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {files.map(file => {
                const fileName = file.path.split('/').pop() ?? file.path;
                const dirPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
                const isSelected = selectedFile === file.path;
                const isSession = sessionPaths.has(file.path);
                const statusInfo = STATUS_COLORS[file.status] ?? STATUS_COLORS.modified;

                return (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file.path)}
                    aria-selected={isSelected}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      width: '100%', padding: '5px 10px', border: 'none',
                      background: isSelected ? theme.surfaceHover : 'transparent',
                      cursor: 'pointer', textAlign: 'left',
                      borderLeft: isSelected ? `2px solid ${theme.accentBlue}` : '2px solid transparent',
                    }}
                  >
                    {/* Status badge */}
                    <span style={{
                      width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, fontFamily: theme.fontMono,
                      background: statusInfo.bg, color: statusInfo.text,
                    }}>
                      {statusInfo.label}
                    </span>
                    {/* File icon + name */}
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ lineHeight: 1, flexShrink: 0 }}>{getFileIcon(fileName, 11)}</span>
                        <span style={{
                          fontFamily: theme.fontMono, fontSize: 11, fontWeight: 500,
                          color: isSelected ? theme.textPrimary : theme.textMuted,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {fileName}
                        </span>
                      </div>
                      {dirPath && (
                        <span style={{
                          fontFamily: theme.fontMono, fontSize: 9,
                          color: theme.textGhost, overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          marginLeft: 15,
                        }}>
                          {dirPath}
                        </span>
                      )}
                    </div>
                    {/* Session badge */}
                    {isSession && (
                      <span style={{
                        fontSize: 8, fontWeight: 700, fontFamily: theme.fontInter,
                        padding: '1px 4px', borderRadius: 6, flexShrink: 0,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                        background: 'rgba(99,102,241,0.15)', color: '#818cf8',
                        border: '1px solid rgba(99,102,241,0.25)',
                      }}>
                        session
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Monaco Diff Editor */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* File path bar */}
          {selectedFile && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '3px 12px',
              borderBottom: `1px solid ${theme.border}`, background: theme.surfaceLight,
              flexShrink: 0,
            }}>
              <span style={{ lineHeight: 1 }}>{getFileIcon(selectedFile.split('/').pop() ?? '', 12)}</span>
              <span style={{
                fontFamily: theme.fontMono, fontSize: 11, color: theme.textSecondary,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {selectedFile}
              </span>
              {(() => {
                const statusInfo = STATUS_COLORS[files.find(f => f.path === selectedFile)?.status ?? 'modified'];
                return (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                    background: statusInfo.bg, color: statusInfo.text,
                    fontFamily: theme.fontInter, textTransform: 'uppercase',
                  }}>
                    {files.find(f => f.path === selectedFile)?.status ?? 'modified'}
                  </span>
                );
              })()}
            </div>
          )}

          {/* Diff content */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {fileLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textGhost, fontSize: 12 }}>
                <LucideIcon name="Loader2" size={16} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
                Loading diff…
              </div>
            ) : !selectedFile ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: theme.textGhost, fontSize: 12 }}>
                Select a file to view its diff
              </div>
            ) : (
              <DiffEditor
                original={originalContent}
                modified={modifiedContent}
                language={language}
                theme="fluxor-dark"
                onMount={handleDiffMount}
                options={{
                  readOnly: true,
                  renderSideBySide,
                  fontSize: 12,
                  fontFamily: "'Liberation Mono', 'JetBrains Mono', monospace",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  lineNumbers: 'on',
                  padding: { top: 8 },
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  fixedOverflowWidgets: true,
                  overflowWidgetsDomNode: widgetRoot.current,
                  scrollbar: {
                    verticalScrollbarSize: 6,
                    horizontalScrollbarSize: 6,
                    verticalSliderSize: 6,
                    horizontalSliderSize: 6,
                    useShadows: false,
                  },
                  automaticLayout: true,
                  renderIndicators: true,
                  ignoreTrimWhitespace: false,
                  renderOverviewRuler: false,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '3px 10px', borderTop: `1px solid ${theme.border}`,
        background: theme.surface, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            fontFamily: theme.fontInter, fontSize: 9, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em', color: theme.textGhost,
          }}>
            {selectedFile ? language : 'No file selected'}
          </span>
          {selectedFile && (
            <span style={{ fontFamily: theme.fontMono, fontSize: 10, color: theme.textFaint }}>
              {renderSideBySide ? 'Side-by-side' : 'Inline'} · HEAD vs Working Tree
            </span>
          )}
        </div>
        <span style={{
          fontFamily: theme.fontMono, fontSize: 10, color: theme.textGhost,
        }}>
          ↑↓ navigate · ⌘B sidebar
        </span>
      </div>
    </div>
  );
}
