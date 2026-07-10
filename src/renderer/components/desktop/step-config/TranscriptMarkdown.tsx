/**
 * TranscriptMarkdown.tsx — Real Markdown rendering for a step transcript's
 * 'text' entries
 *
 * Responsibility:
 * - Renders a single `stepThinkings` entry of kind 'text' (the model's
 *   actual prose output) as real Markdown via `react-markdown`, replacing
 *   the bare plain-text treatment `StepThinkingPopover` uses for the same
 *   `kind` with something that actually understands headings/lists/links/
 *   emphasis/fenced code.
 * - Routes fenced code through the existing `CodeBlock` (chat/CodeBlock.tsx)
 *   so transcript code and chat code look and behave identically — copy
 *   affordance included — without forking or duplicating that component.
 *
 * Boundaries:
 * - Owns: Markdown-to-DOM mapping + this surface's own typographic styling
 *   (deliberately re-expressed via inline style objects + the existing
 *   `step-config-*` visual language, NOT the Tailwind utility classes
 *   `chat/MessageRenderer.tsx` uses for the same job — this surface lives in
 *   the Inspector's evidence panel, which never uses Tailwind, so matching
 *   ITS convention keeps the panel visually one system).
 * - Does NOT own: what content it's given, or any transcript/store state —
 *   pure presentational, `content` is the only input.
 *
 * GFM note (2026-07-10, Task T — see final report "Escalación"): `remark-gfm`
 * is NOT an installed dependency (verified against package.json and
 * package-lock.json — only bare `react-markdown@^10.1.0` is present). Per
 * this task's brief ("si NO está, NO lo añadas: usa react-markdown solo y
 * repórtalo"), it was NOT added. Practical effect: GFM extensions — tables,
 * `~~strikethrough~~`, task-list checkboxes, and bare-URL autolinking —
 * render as their literal source characters instead of formatted elements.
 * Headings, lists, links, blockquotes, emphasis, and fenced code are core
 * CommonMark and render correctly without the plugin. The moment the
 * dependency is actually added, this file only needs one line:
 * `import remarkGfm from 'remark-gfm';` + `remarkPlugins={[remarkGfm]}`
 * below.
 */
import React, { memo } from 'react';
import Markdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from '../../chat/CodeBlock';
import { theme } from '../../../logic/theme';

function textContent(children: React.ReactNode): string {
  if (Array.isArray(children)) return children.map(textContent).join('');
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  return '';
}

/**
 * True when a `code` node is a fenced block, not an inline `` `span` ``: a
 * `language-*` class (from ```lang fences) is the strong signal, but a
 * lang-less ``` fence carries no className at all — its content always
 * contains at least one newline (CommonMark keeps a trailing "\n" before the
 * closing fence marker), which an inline span's content never does, so that
 * doubles as the fallback signal for the no-language-tag case.
 */
function isBlockCode(className: string | undefined, raw: string): boolean {
  return /language-/.test(className ?? '') || raw.includes('\n');
}

const LINK_STYLE: React.CSSProperties = {
  color: theme.accentBlue,
  textDecoration: 'underline',
};
const PARAGRAPH_STYLE: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 12,
  lineHeight: 1.6,
  color: theme.textPrimary,
  fontFamily: theme.fontManrope,
};
const HEADING_BASE_STYLE: React.CSSProperties = {
  margin: '10px 0 6px',
  fontWeight: 700,
  color: '#f4f4f5',
  fontFamily: theme.fontGrotesk,
};
const LIST_STYLE: React.CSSProperties = {
  margin: '0 0 8px',
  paddingLeft: 18,
  fontSize: 12,
  lineHeight: 1.6,
  color: theme.textPrimary,
};
const BLOCKQUOTE_STYLE: React.CSSProperties = {
  margin: '6px 0',
  padding: '2px 10px',
  borderLeft: `2px solid ${theme.accentBlue}`,
  color: theme.textMuted,
  fontStyle: 'italic',
};
const INLINE_CODE_STYLE: React.CSSProperties = {
  background: 'rgba(63,63,70,0.5)',
  padding: '1px 5px',
  borderRadius: 4,
  fontFamily: theme.fontMono,
  fontSize: 11,
  color: '#d6d3d1',
};

// Stable module-level object (no per-render identity churn) — none of these
// overrides close over component-instance state, so there's no reason for
// react-markdown to see a new `components` object on every render.
const markdownComponents: Components = {
  // CodeBlock already renders its own bordered/padded container — an outer
  // <pre> would just double up on box/whitespace semantics around it, so
  // this unwraps to a fragment and lets the nested `code` override (below)
  // do all the actual rendering.
  pre({ children }) {
    return <>{children}</>;
  },
  code({ className, children }) {
    const raw = textContent(children);
    if (isBlockCode(className, raw)) {
      return <CodeBlock code={raw.replace(/\n$/, '')} />;
    }
    return <code style={INLINE_CODE_STYLE}>{children}</code>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer" style={LINK_STYLE}>
        {children}
      </a>
    );
  },
  p({ children }) {
    return <p style={PARAGRAPH_STYLE}>{children}</p>;
  },
  h1({ children }) {
    return <h1 style={{ ...HEADING_BASE_STYLE, fontSize: 16 }}>{children}</h1>;
  },
  h2({ children }) {
    return <h2 style={{ ...HEADING_BASE_STYLE, fontSize: 15 }}>{children}</h2>;
  },
  h3({ children }) {
    return <h3 style={{ ...HEADING_BASE_STYLE, fontSize: 13.5 }}>{children}</h3>;
  },
  h4({ children }) {
    return <h4 style={{ ...HEADING_BASE_STYLE, fontSize: 12.5 }}>{children}</h4>;
  },
  ul({ children }) {
    return <ul style={LIST_STYLE}>{children}</ul>;
  },
  ol({ children }) {
    return <ol style={LIST_STYLE}>{children}</ol>;
  },
  li({ children }) {
    return <li style={{ margin: '2px 0' }}>{children}</li>;
  },
  blockquote({ children }) {
    return <blockquote style={BLOCKQUOTE_STYLE}>{children}</blockquote>;
  },
};

export interface TranscriptMarkdownProps {
  content: string;
}

export const TranscriptMarkdown = memo(function TranscriptMarkdown({ content }: TranscriptMarkdownProps) {
  return <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</Markdown>;
});
