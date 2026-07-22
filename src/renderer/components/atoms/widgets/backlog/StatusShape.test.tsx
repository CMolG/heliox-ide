import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusShape } from './StatusShape';

describe('StatusShape', () => {
  it('renders a polygon for sides=3 (triangle)', () => {
    const { container } = render(<StatusShape sides={3} />);
    expect(container.querySelector('polygon')).toBeInTheDocument();
    expect(container.querySelector('rect')).not.toBeInTheDocument();
  });

  it('renders a rect for sides=2 (line)', () => {
    const { container } = render(<StatusShape sides={2} />);
    expect(container.querySelector('rect')).toBeInTheDocument();
    expect(container.querySelector('polygon')).not.toBeInTheDocument();
  });

  it('renders a rect for sides=4 (square)', () => {
    const { container } = render(<StatusShape sides={4} />);
    expect(container.querySelector('rect')).toBeInTheDocument();
  });

  it('renders a polygon for sides 5, 6, and 7', () => {
    for (const sides of [5, 6, 7]) {
      const { container } = render(<StatusShape sides={sides} />);
      expect(container.querySelector('polygon')).toBeInTheDocument();
    }
  });

  it('applies fillClass/strokeClass/className onto the root svg', () => {
    const { container } = render(<StatusShape sides={3} className="w-5 h-5" fillClass="fill-pink-100" strokeClass="stroke-pink-500" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveClass('w-5', 'h-5', 'fill-pink-100', 'stroke-pink-500');
  });

  it('falls back to a circle for an out-of-range sides value', () => {
    const { container } = render(<StatusShape sides={99} />);
    expect(container.querySelector('circle')).toBeInTheDocument();
  });
});
