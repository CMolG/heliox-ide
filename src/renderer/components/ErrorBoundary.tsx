/**
 * ErrorBoundary.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the ErrorBoundary surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { theme } from '../logic/theme';

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error(`[ErrorBoundary:${this.props.fallbackLabel ?? 'unknown'}]`, error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-8" role="alert" aria-live="assertive" style={{ background: theme.bg }}>
          <div className="text-center max-w-sm">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center" style={{ background: 'rgba(248,113,113,0.1)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <p className="text-sm mb-1" style={{ fontFamily: theme.fontGrotesk, color: theme.textSecondary }}>
              {this.props.fallbackLabel ?? 'Component'} crashed
            </p>
            <p className="text-xs mb-4" style={{ fontFamily: theme.fontManrope, color: theme.textFaint }}>
              {this.state.error?.message ?? 'An unexpected error occurred'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              aria-label="Retry loading component"
              className="px-3 py-1.5 rounded-full text-xs font-medium uppercase tracking-wider"
              style={{
                fontFamily: theme.fontInter,
                background: 'rgba(214,211,209,0.08)',
                color: theme.textMid,
                border: '1px solid rgba(214,211,209,0.15)',
              }}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
