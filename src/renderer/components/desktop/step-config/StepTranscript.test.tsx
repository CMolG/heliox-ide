/**
 * StepTranscript.test.tsx — Render tests for the step run transcript
 *
 * Pure presentational component: fixture `entries` arrays in, DOM out — no
 * store mocking needed. Covers the three transcript technologies absorbed
 * from the retired agentic-chat overhaul (#4): real Markdown (via
 * TranscriptMarkdown → CodeBlock), tool-call cards, and collapsible
 * reasoning, plus the live running indicator and entry ordering.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StepTranscript, type StepTranscriptEntry } from './StepTranscript';

describe('StepTranscript — real Markdown (text entries)', () => {
  const markdown =
    '## Title\n\n- item one\n\n[docs](https://fluxor.dev)\n\nInline `code` here.\n\n```ts\nconst x = 1;\n```';

  it('renders headings, lists and links from a text entry (core CommonMark)', () => {
    render(<StepTranscript entries={[{ kind: 'text', text: markdown }]} />);

    expect(screen.getByRole('heading', { level: 2, name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveTextContent('item one');
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://fluxor.dev');
  });

  it('routes fenced code through the existing CodeBlock (its copy affordance is present)', () => {
    render(<StepTranscript entries={[{ kind: 'text', text: markdown }]} />);

    // CodeBlock is the only element carrying this aria-label — proves the ```ts
    // fence went to CodeBlock, not the inline-code path.
    expect(screen.getByLabelText('Copy code to clipboard')).toBeInTheDocument();
    expect(screen.getByRole('log')).toHaveTextContent('const x = 1;');
  });

  it('opens links in a new tab safely', () => {
    render(<StepTranscript entries={[{ kind: 'text', text: markdown }]} />);
    const link = screen.getByRole('link', { name: 'docs' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });
});

describe('StepTranscript — tool-call cards (tool entries)', () => {
  it('renders a collapsed tool-call card labelled with the tool name', () => {
    render(<StepTranscript entries={[{ kind: 'tool', text: 'write_file({"path":"a.ts"})' }]} />);

    const card = screen.getByTestId('step-transcript-tool-card');
    expect(card).toBeInTheDocument();
    expect(within(card).getByTestId('step-transcript-tool-card-toggle')).toHaveTextContent('write_file');
    // Collapsed by default — raw body absent until expanded.
    expect(screen.queryByTestId('step-transcript-tool-card-body')).not.toBeInTheDocument();
  });

  it('expands to reveal the raw tool text on click', () => {
    render(<StepTranscript entries={[{ kind: 'tool', text: 'write_file({"path":"a.ts"})' }]} />);

    fireEvent.click(screen.getByTestId('step-transcript-tool-card-toggle'));
    const body = screen.getByTestId('step-transcript-tool-card-body');
    expect(body).toHaveTextContent('write_file({"path":"a.ts"})');
  });

  it('falls back to a generic label when the text is not a name(...) brief', () => {
    render(<StepTranscript entries={[{ kind: 'tool', text: 'ran some tools' }]} />);
    expect(screen.getByTestId('step-transcript-tool-card-toggle')).toHaveTextContent('Tool activity');
  });
});

describe('StepTranscript — collapsible reasoning (reasoning entries)', () => {
  it('renders a collapsed reasoning row that expands to the full text', () => {
    render(<StepTranscript entries={[{ kind: 'reasoning', text: 'weighing the options' }]} />);

    const toggle = screen.getByTestId('step-transcript-reasoning-toggle');
    expect(toggle).toHaveTextContent(/Reasoning \(\d+ chars\)/);
    expect(screen.queryByTestId('step-transcript-reasoning-body')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByTestId('step-transcript-reasoning-body')).toHaveTextContent('weighing the options');
  });
});

describe('StepTranscript — timeline behavior', () => {
  it('renders mixed entries in order', () => {
    const entries: StepTranscriptEntry[] = [
      { kind: 'reasoning', text: 'thinking' },
      { kind: 'tool', text: 'read_file({"path":"a.ts"})' },
      { kind: 'text', text: 'Done.' },
    ];
    render(<StepTranscript entries={entries} />);

    const log = screen.getByRole('log');
    // reasoning toggle, then tool card, then the assistant text — DOM order.
    const reasoning = within(log).getByTestId('step-transcript-reasoning');
    const tool = within(log).getByTestId('step-transcript-tool-card');
    expect(log).toHaveTextContent('Done.');
    // reasoning precedes tool in document order
    expect(reasoning.compareDocumentPosition(tool) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the live running indicator only while running', () => {
    const { rerender } = render(<StepTranscript entries={[{ kind: 'text', text: 'hi' }]} running />);
    expect(screen.getByTestId('step-transcript-running')).toBeInTheDocument();

    rerender(<StepTranscript entries={[{ kind: 'text', text: 'hi' }]} running={false} />);
    expect(screen.queryByTestId('step-transcript-running')).not.toBeInTheDocument();
  });

  it('renders an empty log with no entries and no running indicator', () => {
    render(<StepTranscript entries={[]} />);
    const log = screen.getByRole('log');
    expect(log).toBeInTheDocument();
    expect(screen.queryByTestId('step-transcript-running')).not.toBeInTheDocument();
  });
});
