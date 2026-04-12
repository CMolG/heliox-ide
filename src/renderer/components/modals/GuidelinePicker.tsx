/**
 * GuidelinePicker.tsx — Renderer Modal Component
 *
 * Responsibility:
 * - Renders a compact modal with 60 design guideline swatches (6 rows × 10).
 * - Supports live preview on hover, lock on click, and clock-driven reset.
 * - Includes search filtering by name/displayName.
 *
 * Boundaries:
 * - Owns: guideline picker UI, hover preview, search filtering
 * - Does NOT own: theme resolution, guideline definitions, or store persistence
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useDesktopStore } from '../../store/desktop-store';
import { guidelines, getActiveGuideline, injectGuidelineCSSVars } from '../../logic/design-guidelines';
import type { DesignGuideline, GuidelineFamily } from '../../logic/design-guidelines/types';
import { theme } from '../../logic/theme';

const FAMILIES: GuidelineFamily[] = ['void', 'terminal', 'studio', 'minimal', 'nature', 'future'];

const FAMILY_LABELS: Record<GuidelineFamily, string> = {
  void: 'Void',
  terminal: 'Terminal',
  studio: 'Studio',
  minimal: 'Minimal',
  nature: 'Nature',
  future: 'Future',
};

interface GuidelinePickerProps {
  open: boolean;
  onClose: () => void;
}

export function GuidelinePicker({ open, onClose }: GuidelinePickerProps) {
  const designGuidelineId = useDesktopStore((s) => s.designGuidelineId);
  const setDesignGuideline = useDesktopStore((s) => s.setDesignGuideline);
  const [search, setSearch] = useState('');
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Live preview on hover — inject CSS vars temporarily
  useEffect(() => {
    if (hoveredId !== null && guidelines[hoveredId]) {
      injectGuidelineCSSVars(guidelines[hoveredId].tokens);
    }
    return () => {
      // Restore current guideline's CSS vars on unhover
      const current = getActiveGuideline(designGuidelineId);
      injectGuidelineCSSVars(current.tokens);
    };
  }, [hoveredId, designGuidelineId]);

  const filteredGuidelines = useMemo(() => {
    if (!search) return guidelines;
    const q = search.toLowerCase();
    return guidelines.map((g) =>
      g && (g.name.includes(q) || g.displayName.toLowerCase().includes(q)) ? g : undefined
    );
  }, [search]);

  const handleSelect = useCallback((id: number) => {
    setDesignGuideline(id);
    onClose();
  }, [setDesignGuideline, onClose]);

  const activeGuideline = getActiveGuideline(designGuidelineId);

  if (!open) return null;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10010, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
      data-testid="guideline-picker-backdrop"
    >
      <div
        data-testid="guideline-picker"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.bgDeep,
          border: `1px solid ${theme.borderLight}`,
          borderRadius: 12,
          padding: 20,
          width: 620,
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontFamily: theme.fontGrotesk, fontSize: 16, fontWeight: 600, color: theme.textPrimary, margin: 0 }}>
            Design Guidelines
          </h2>
          <span style={{ fontFamily: theme.fontMono, fontSize: 11, color: theme.textMuted }}>
            Active: {activeGuideline.displayName}
          </span>
        </div>

        {/* Search */}
        <input
          ref={inputRef}
          data-testid="guideline-search"
          type="text"
          placeholder="Search guidelines..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            height: 32,
            padding: '0 10px',
            borderRadius: 6,
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            color: theme.textPrimary,
            fontFamily: theme.fontMono,
            fontSize: 12,
            outline: 'none',
            marginBottom: 16,
          }}
        />

        {/* Swatch grid — 6 families, 10 each */}
        {FAMILIES.map((family, rowIdx) => (
          <div key={family} style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: theme.fontGrotesk, fontSize: 10, color: theme.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {FAMILY_LABELS[family]} ({rowIdx * 10}–{rowIdx * 10 + 9})
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {Array.from({ length: 10 }, (_, i) => {
                const id = rowIdx * 10 + i;
                const g = filteredGuidelines[id];
                if (!g) {
                  return (
                    <div key={id} style={{ width: 48, height: 48, borderRadius: 6, background: 'transparent', opacity: 0.2, border: `1px dashed ${theme.borderLight}` }} />
                  );
                }
                const isActive = designGuidelineId === id;
                const accentColor = g.tokens.accentBlue ?? theme.accentBlue;
                const bgColor = g.tokens.bg ?? theme.bg;

                return (
                  <button
                    key={id}
                    data-testid={`guideline-swatch-${g.name}`}
                    title={`${g.displayName}: ${g.description}`}
                    onClick={() => handleSelect(id)}
                    onMouseEnter={() => setHoveredId(id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 6,
                      background: bgColor,
                      border: isActive
                        ? `2px solid ${accentColor}`
                        : `1px solid ${theme.borderLight}`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                      transition: 'transform 120ms ease',
                      transform: hoveredId === id ? 'scale(1.1)' : 'scale(1)',
                    }}
                  >
                    {/* Accent dot */}
                    <div style={{
                      width: 12, height: 12, borderRadius: '50%',
                      background: accentColor,
                      boxShadow: `0 0 6px ${accentColor}44`,
                    }} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${theme.border}` }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: theme.surfaceHover,
              color: theme.textPrimary,
              fontFamily: theme.fontGrotesk,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
