/**
 * CodeBlock.tsx — Renderer Chat Component
 *
 * Responsibility:
 * - Renders the CodeBlock surface in the renderer layer.
 * - Encapsulates Chat conversation rendering and chat-surface interactions.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/chat/CodeBlock.tsx — Copyable code block renderer
import React, { useState, useCallback } from 'react';
import { theme } from '../../logic/theme';

export function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className="bg-hx-bg rounded-md p-3 my-2 relative group overflow-x-auto">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-normal opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: 'rgba(63,63,70,0.4)', color: theme.textMuted, fontFamily: theme.fontInter }}
        aria-label="Copy code to clipboard"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      {code.split('\n').map((line, j) => (
        <div key={j}>
          <span className="text-xs font-normal leading-4" style={{ fontFamily: theme.fontMono, color: theme.textMuted }}>
            {line || '\u00A0'}
          </span>
        </div>
      ))}
    </div>
  );
}
