/**
 * CodeEditor.tsx — Renderer UI Primitive Component
 *
 * Responsibility:
 * - Renders the CodeEditor surface in the renderer layer.
 * - Encapsulates Reusable UI primitive used by higher-level panels and surfaces.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { useCallback, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { detectLanguage, HELIOX_MONACO_THEME, configureLinting } from '../../logic/monaco-config';

// ─── Types ───────────────────────────────────────────────────────

export interface CodeEditorProps {
  /** File name or path — used to auto-detect language via detectLanguage() */
  fileName?: string;
  /** Explicit language override (takes precedence over fileName detection) */
  language?: string;
  /** Editor content value */
  value: string;
  /** Called on content change (omit for readOnly editors) */
  onChange?: (value: string) => void;
  /** Called when Cmd/Ctrl+S is pressed */
  onSave?: () => void;
  /** Disables editing */
  readOnly?: boolean;
  /** CSS height — defaults to '100%' */
  height?: string;
  /** Word wrap mode — defaults to 'off' */
  wordWrap?: 'on' | 'off';
  /** Font size — defaults to 12 */
  fontSize?: number;
  /** Line highlight style — defaults to 'line' */
  lineHighlight?: 'line' | 'none';
  /** Scrollbar track size — defaults to 6 */
  scrollbarSize?: number;
  /** Enable TS/JS/JSON linting diagnostics — defaults to true */
  enableLinting?: boolean;
  /** React key to force remount on file switch */
  editorKey?: string;
}

// ─── Shared widget root (body-level, escapes transform context) ──

let _widgetRoot: HTMLElement | null = null;

function getWidgetRoot(): HTMLElement {
  if (_widgetRoot && document.body.contains(_widgetRoot)) return _widgetRoot;
  _widgetRoot = document.createElement('div');
  _widgetRoot.id = 'heliox-monaco-widgets';
  _widgetRoot.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:visible;';
  document.body.appendChild(_widgetRoot);
  return _widgetRoot;
}

// ─── Component ───────────────────────────────────────────────────

export function CodeEditor({
  fileName,
  language,
  value,
  onChange,
  onSave,
  readOnly = false,
  height = '100%',
  wordWrap = 'off',
  fontSize = 12,
  lineHighlight = 'line',
  scrollbarSize = 6,
  enableLinting = true,
  editorKey,
}: CodeEditorProps) {
  const widgetRoot = useRef(getWidgetRoot());
  const resolvedLanguage = language ?? (fileName ? detectLanguage(fileName) : 'plaintext');

  const handleMount: OnMount = useCallback((editor, monaco) => {
    monaco.editor.defineTheme('heliox-dark', HELIOX_MONACO_THEME);
    monaco.editor.setTheme('heliox-dark');
    if (enableLinting) configureLinting(monaco);
    if (onSave) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave);
    }
  }, [enableLinting, onSave]);

  return (
    <Editor
      key={editorKey}
      height={height}
      language={resolvedLanguage}
      value={value}
      onChange={onChange ? (v) => onChange(v ?? '') : undefined}
      onMount={handleMount}
      theme="heliox-dark"
      options={{
        readOnly,
        fontSize,
        fontFamily: "'Liberation Mono', 'JetBrains Mono', monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: lineHighlight,
        lineNumbers: 'on',
        padding: { top: 8 },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        fixedOverflowWidgets: true,
        overflowWidgetsDomNode: widgetRoot.current,
        scrollbar: {
          verticalScrollbarSize: scrollbarSize,
          horizontalScrollbarSize: scrollbarSize,
          verticalSliderSize: scrollbarSize,
          horizontalSliderSize: scrollbarSize,
          useShadows: false,
        },
        wordWrap,
        tabSize: 2,
        automaticLayout: true,
      }}
    />
  );
}
