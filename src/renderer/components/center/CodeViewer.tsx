/**
 * CodeViewer.tsx — Renderer Center Panel Component
 *
 * Responsibility:
 * - Renders the CodeViewer surface in the renderer layer.
 * - Encapsulates Center-pane visualization for sessions, diffs, and code context.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/center/CodeViewer.tsx — File code viewer with syntax highlighting
import React, { useState, useEffect } from 'react';
import { getFileIcon } from '@/renderer/logic/file-icons';
import { theme } from '@/renderer/logic/theme';

// ─── Syntax highlighting helpers ─────────────────────────────────

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'import', 'export',
  'if', 'else', 'for', 'while', 'class', 'interface', 'type',
]);

function highlightLine(line: string): React.ReactNode[] {
  // Comment lines
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
    return [<span key="c" style={{ color: '#71717a' }}>{line}</span>];
  }

  const parts: React.ReactNode[] = [];
  // Regex to match strings, numbers, and keywords as tokens
  const tokenRegex = /(["'`])(?:(?!\1|\\).|\\.)*?\1|\b(\d+(?:\.\d+)?)\b|\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b|([^"'`\w]+)/g;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenRegex.exec(line)) !== null) {
    const token = match[0];
    if (match[1] !== undefined) {
      // String literal
      parts.push(<span key={key++} style={{ color: '#fcd34d' }}>{token}</span>);
    } else if (match[2] !== undefined) {
      // Number
      parts.push(<span key={key++} style={{ color: '#60a5fa' }}>{token}</span>);
    } else if (match[3] !== undefined) {
      // Identifier — check if keyword
      if (KEYWORDS.has(token)) {
        parts.push(<span key={key++} style={{ color: '#c084fc' }}>{token}</span>);
      } else {
        parts.push(<span key={key++} style={{ color: '#d4d4d8' }}>{token}</span>);
      }
    } else {
      parts.push(<span key={key++} style={{ color: '#d4d4d8' }}>{token}</span>);
    }
  }

  return parts.length > 0 ? parts : [<span key="empty">{line}</span>];
}

// ─── Code Viewer ─────────────────────────────────────────────────

export function CodeViewer({ filePath, onClose }: { filePath: string; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fileName = filePath.split('/').pop() ?? filePath;
  const fileIcon = getFileIcon(fileName, 12);

  useEffect(() => {
    setLoading(true);
    setContent(null);
    if (window.helioxAPI) {
      window.helioxAPI.readFile(filePath).then((c) => {
        setContent(c);
        setLoading(false);
      }).catch(() => {
        setContent('// Failed to load file');
        setLoading(false);
      });
    }
  }, [filePath]);

  return (
    <div className="flex flex-col h-full" style={{ background: theme.bg }}>
      {/* Tab bar */}
      <div
        className="flex items-center shrink-0"
        style={{ background: theme.surfaceLight, borderBottom: `1px solid ${theme.borderLight}` }}
      >
        <div
          className="flex items-center gap-2 px-4 py-2"
          style={{ background: theme.bg, borderRight: `1px solid ${theme.borderLight}` }}
        >
          <span style={{ fontSize: '12px', lineHeight: 1 }}>{fileIcon}</span>
          <span
            className="text-xs font-medium"
            style={{ fontFamily: theme.fontMono, color: theme.textSecondary }}
          >
            {fileName}
          </span>
          <button
            onClick={onClose}
            className="ml-2 text-xs px-1 rounded hover:bg-white/10 transition"
            style={{ color: theme.textDim }}
            aria-label={`Close tab: ${fileName}`}
          >
            ✕
          </button>
        </div>
        <div className="flex-1 px-3">
          <span className="text-[10px]" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>
            {filePath}
          </span>
        </div>
      </div>

      {/* File content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>Loading…</span>
          </div>
        ) : content === null ? (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>
              Cannot read file (binary or too large)
            </span>
          </div>
        ) : (
          <pre
            className="text-xs leading-5 whitespace-pre"
            style={{ fontFamily: theme.fontMono }}
          >
            {content.split('\n').map((line, i) => (
              <div key={i} className="flex hover:bg-white/2">
                <span
                  className="text-neutral-500 text-xs font-mono w-12 text-right pr-4 select-none shrink-0"
                  style={{ fontFamily: theme.fontMono }}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <span className="flex-1">{highlightLine(line)}</span>
              </div>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}
