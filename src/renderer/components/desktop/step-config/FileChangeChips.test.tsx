/**
 * FileChangeChips.test.tsx — Render tests for the file-change chips
 *
 * Covers the graceful-degradation contract (empty → nothing) and the
 * chip → diff-viewer callback wiring.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { FileChangeChips } from './FileChangeChips';

describe('FileChangeChips', () => {
  it('renders nothing when there are no files (graceful degradation)', () => {
    const { container } = render(<FileChangeChips files={[]} />);
    expect(screen.queryByTestId('step-transcript-file-chips')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one chip per file, showing the basename with the full path in the tooltip', () => {
    render(<FileChangeChips files={['src/renderer/a.ts', 'b.md']} />);

    const chips = screen.getAllByTestId('step-transcript-file-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent('a.ts');
    expect(chips[0]).toHaveAttribute('title', 'src/renderer/a.ts');
    expect(chips[1]).toHaveTextContent('b.md');
    expect(chips[1]).toHaveAttribute('title', 'b.md');
  });

  it('invokes onOpenDiff with the clicked file path', () => {
    const onOpenDiff = vi.fn();
    render(<FileChangeChips files={['src/renderer/a.ts', 'b.md']} onOpenDiff={onOpenDiff} />);

    fireEvent.click(screen.getAllByTestId('step-transcript-file-chip')[0]);
    expect(onOpenDiff).toHaveBeenCalledTimes(1);
    expect(onOpenDiff).toHaveBeenCalledWith('src/renderer/a.ts');
  });

  it('does not throw when clicked without an onOpenDiff handler', () => {
    render(<FileChangeChips files={['a.ts']} />);
    expect(() => fireEvent.click(screen.getByTestId('step-transcript-file-chip'))).not.toThrow();
  });
});
