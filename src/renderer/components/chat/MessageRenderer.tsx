/**
 * MessageRenderer.tsx — Renderer Chat Component
 *
 * Responsibility:
 * - Renders the MessageRenderer surface in the renderer layer.
 * - Encapsulates Chat conversation rendering and chat-surface interactions.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/chat/MessageRenderer.tsx — Message rendering components
import React from 'react';
import type { ChatMessage } from '@/types';
import { formatTimestamp } from '@/types';
import { theme } from '../../logic/theme';
import { CodeBlock } from './CodeBlock';

export function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*(?:(?!\*\*).)+\*\*|\*(?:(?!\*).)+\*)/g);
  return parts.map((part, k) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={k} className="bg-zinc-800 px-1.5 py-0.5 rounded text-sm font-mono text-stone-300">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={k} className="font-bold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={k} className="italic">{part.slice(1, -1)}</em>;
    }
    return <span key={k}>{part}</span>;
  });
}

export function renderMessageContent(content: string): React.ReactNode[] {
  const segments = content.split(/(```[\s\S]*?```)/g);
  return segments.map((seg, i) => {
    if (seg.startsWith('```') && seg.endsWith('```')) {
      const code = seg.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
      return <CodeBlock key={i} code={code} />;
    }
    return seg.split('\n').map((paragraph, j) => {
      if (!paragraph.trim()) return <div key={`${i}-${j}`} className="h-2" />;
      return (
        <p key={`${i}-${j}`} className="text-zinc-200 text-sm font-normal leading-6" style={{ fontFamily: theme.fontManrope }}>
          {renderInlineMarkdown(paragraph)}
        </p>
      );
    });
  });
}

const AgentMessage = React.memo(function AgentMessage({ msg }: { msg: ChatMessage }) {
  const isSystem = msg.role === 'system';
  const isAssistant = msg.role === 'assistant';
  const isCode = isSystem && (msg.content.startsWith('File changed:') || msg.content.startsWith('Using tool:'));

  if (isCode || (isSystem && !isAssistant)) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span
            className="text-right text-neutral-500/50 text-[9px] font-normal leading-3"
            style={{ fontFamily: theme.fontManrope }}
          >
            {formatTimestamp(msg.timestamp)}
          </span>
          <span
            className="text-neutral-500 text-[10px] font-bold uppercase leading-4 tracking-wide"
            style={{ fontFamily: theme.fontInter }}
          >
            System
          </span>
        </div>
        <div
          className="p-3 rounded-sm overflow-hidden"
          style={{ background: '#000000', borderLeft: `2px solid ${theme.textSecondary}` }}
        >
          {msg.content.split('\n').map((line, i) => (
            <div key={i} style={{ opacity: line.startsWith('//') ? 0.5 : 1 }}>
              <span
                className="text-xs font-normal leading-4"
                style={{ fontFamily: theme.fontMono, color: theme.textMuted }}
              >
                {line}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span
          className="text-right text-neutral-500/50 text-[9px] font-normal leading-3"
          style={{ fontFamily: theme.fontManrope }}
        >
          {formatTimestamp(msg.timestamp)}
        </span>
        <span
          className="text-neutral-500 text-[10px] font-bold uppercase leading-4 tracking-wide"
          style={{ fontFamily: theme.fontInter }}
        >
          Fluxor
        </span>
      </div>
      <div
        className="p-4 rounded-tr-4xl rounded-bl-4xl rounded-br-4xl"
        style={{ background: theme.surfaceHover, outline: `1px solid ${theme.border}`, outlineOffset: '-1px' }}
      >
        {renderMessageContent(msg.content)}
      </div>
    </div>
  );
});

const UserMessage = React.memo(function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-col items-end gap-0.5">
        <span
          className="text-neutral-500/50 text-[9px] font-normal leading-3"
          style={{ fontFamily: theme.fontManrope }}
        >
          {formatTimestamp(msg.timestamp)}
        </span>
        <span
          className="text-neutral-500 text-[10px] font-bold uppercase leading-4 tracking-wide"
          style={{ fontFamily: theme.fontInter }}
        >
          User
        </span>
      </div>
      <div
        className="pl-16 pr-4 py-4 rounded-tl-4xl rounded-bl-4xl rounded-br-4xl"
        style={{ background: 'rgba(214,211,209,0.05)', outline: '1px solid rgba(214,211,209,0.2)', outlineOffset: '-1px' }}
      >
        <p className="text-right text-sm font-normal leading-5" style={{ fontFamily: theme.fontManrope, color: theme.textPrimary }}>
          {msg.content}
        </p>
      </div>
    </div>
  );
});

export const ChatMessageItem = React.memo(function ChatMessageItem({ msg }: { msg: ChatMessage }) {
  return msg.role === 'user'
    ? <UserMessage msg={msg} />
    : <AgentMessage msg={msg} />;
});
