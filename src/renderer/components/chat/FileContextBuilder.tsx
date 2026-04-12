/**
 * FileContextBuilder.tsx — Renderer Chat Component
 *
 * Responsibility:
 * - Renders the FileContextBuilder surface in the renderer layer.
 * - Encapsulates Chat conversation rendering and chat-surface interactions.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/chat/FileContextBuilder.tsx — @file autocomplete and file chips
import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { theme } from '../../logic/theme';

interface FileContextPanelProps {
  input: string;
  setInput: (value: string | ((prev: string) => string)) => void;
  projectFiles: string[];
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  showAtAutocomplete: boolean;
  setShowAtAutocomplete: (show: boolean) => void;
  atQuery: string;
  atSelectedIndex: number;
  setAtSelectedIndex: (index: number) => void;
  atCursorIndex: number;
}

export function FileContextPanel({
  input,
  setInput,
  projectFiles,
  inputRef,
  showAtAutocomplete,
  setShowAtAutocomplete,
  atQuery,
  atSelectedIndex,
  setAtSelectedIndex,
  atCursorIndex,
}: FileContextPanelProps) {
  const autocompleteRef = useRef<HTMLDivElement>(null);

  // Close autocomplete on outside click
  useEffect(() => {
    if (!showAtAutocomplete) return;
    const handler = (e: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(e.target as Node)) {
        setShowAtAutocomplete(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAtAutocomplete, setShowAtAutocomplete]);

  const atSuggestions = useMemo(() => {
    if (!showAtAutocomplete || !atQuery) return projectFiles.slice(0, 15);
    const q = atQuery.toLowerCase();
    return projectFiles.filter(f => f.toLowerCase().includes(q)).slice(0, 15);
  }, [showAtAutocomplete, atQuery, projectFiles]);

  const attachedFiles = useMemo(() => {
    const matches = input.match(/@([\w./\-[\]()]+)/g);
    if (!matches) return [] as string[];
    return matches.map(m => m.slice(1));
  }, [input]);

  const handleAtSelect = useCallback((file: string) => {
    const textarea = inputRef.current;
    if (!textarea) return;
    const before = input.slice(0, atCursorIndex);
    const after = input.slice(textarea.selectionStart);
    const newInput = `${before}@${file} ${after}`;
    setInput(newInput);
    setShowAtAutocomplete(false);
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = before.length + file.length + 2;
      textarea.setSelectionRange(pos, pos);
    });
  }, [input, atCursorIndex, inputRef, setInput, setShowAtAutocomplete]);

  const handleRemoveFile = useCallback((file: string) => {
    setInput((prev: string) => prev.replace(new RegExp(`@${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s?`), ''));
    inputRef.current?.focus();
  }, [setInput, inputRef]);

  return (
    <>
      {/* @-mention autocomplete dropdown */}
      {showAtAutocomplete && atSuggestions.length > 0 && (
        <div
          ref={autocompleteRef}
          className="py-1 rounded-lg overflow-hidden max-h-48 overflow-y-auto"
          style={{ background: theme.surfaceCard, border: `1px solid ${theme.borderMedium}` }}
          role="listbox"
          id="file-autocomplete-listbox"
          aria-label="File suggestions"
        >
          {atSuggestions.map((file, i) => (
            <button
              key={file}
              id={`file-option-${i}`}
              onClick={() => handleAtSelect(file)}
              className="w-full text-left px-3 py-1.5 text-xs font-normal transition-colors"
              role="option"
              aria-selected={i === atSelectedIndex}
              style={{
                fontFamily: theme.fontMono,
                color: i === atSelectedIndex ? theme.textPrimary : theme.textMuted,
                background: i === atSelectedIndex ? 'rgba(214,211,209,0.08)' : 'transparent',
              }}
              onMouseEnter={() => setAtSelectedIndex(i)}
            >
              {file}
            </button>
          ))}
        </div>
      )}

      {/* Attached file chips */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pb-1">
          {attachedFiles.map((file, i) => (
            <span
              key={`${file}-${i}`}
              className="bg-zinc-800 px-2 py-1 rounded text-xs text-stone-300 font-mono inline-flex items-center gap-1"
            >
              <svg width="8" height="10" viewBox="0 0 8 10" fill="none" aria-hidden="true">
                <path d="M1 1h4l2 2v6H1V1z" stroke="#737373" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {file}
              <button
                onClick={() => handleRemoveFile(file)}
                className="ml-0.5 hover:text-zinc-200 transition"
                aria-label={`Remove ${file}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
