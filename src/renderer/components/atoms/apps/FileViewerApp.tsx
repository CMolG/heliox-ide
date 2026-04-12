/**
 * FileViewerApp.tsx — Renderer Embedded App Component
 *
 * Responsibility:
 * - Renders the FileViewerApp surface in the renderer layer.
 * - Encapsulates Embedded mini-app surface mounted inside desktop windows.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/atoms/apps/FileViewerApp.tsx — Standalone single-file Monaco viewer (spawned from tab drag-out)
import React, { useState, useEffect, useCallback } from 'react';
import { useHelioxStore } from '../../../store';
import { detectLanguage } from '../../../logic/monaco-config';
import { theme } from '../../../logic/theme';
import { LucideIcon } from '../../desktop/LucideIcon';
import { CodeEditor } from '../../ui/CodeEditor';

interface FileViewerAppProps {
  windowId: string;
  filePath: string;
}

export function FileViewerApp({ windowId, filePath }: FileViewerAppProps) {
  const projectPath = useHelioxStore(s => s.projectPath);
  const [content, setContent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const filename = filePath.split('/').pop() ?? 'file';
  const relPath = projectPath ? filePath.replace(projectPath + '/', '') : filename;
  const language = detectLanguage(filename);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.helioxAPI?.readFile(filePath).then(data => {
      if (cancelled) return;
      setContent(data);
      setEditContent(data ?? '');
      setDirty(false);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [filePath]);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    setSaving(true);
    const ok = await window.helioxAPI?.writeFile(filePath, editContent);
    if (ok) {
      setContent(editContent);
      setDirty(false);
    }
    setSaving(false);
  }, [filePath, editContent, dirty, saving]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: theme.bg, color: theme.textGhost, fontSize: 12 }}>
        <LucideIcon name="Loader2" size={16} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
        Loading…
      </div>
    );
  }

  if (content === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: theme.bg, color: theme.textGhost, fontSize: 12 }}>
        Failed to load file
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.bg }}>
      {/* File bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
        borderBottom: `1px solid ${theme.borderLight}`, background: theme.surface, flexShrink: 0,
      }}>
        <LucideIcon name="FileCode2" size={13} style={{ color: theme.textDim, flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: theme.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {relPath}
        </span>
        {dirty && <span style={{ fontSize: 10, color: theme.warning, fontWeight: 600 }}>●</span>}
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{
            background: dirty ? 'rgba(160,246,149,0.12)' : 'none',
            border: `1px solid ${dirty ? theme.success : 'transparent'}`,
            borderRadius: 4, padding: '2px 8px', fontSize: 11,
            color: dirty ? theme.success : theme.textGhost,
            cursor: dirty ? 'pointer' : 'default', fontWeight: 600,
          }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Monaco Editor */}
      <div style={{ flex: 1, background: '#2B2B2B' }}>
        <CodeEditor
          fileName={filename}
          value={editContent}
          onChange={(v) => { setEditContent(v); setDirty(true); }}
          onSave={handleSave}
          scrollbarSize={4}
        />
      </div>
    </div>
  );
}
