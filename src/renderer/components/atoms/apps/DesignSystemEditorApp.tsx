/**
 * DesignSystemEditorApp.tsx — Design System Editor Window
 *
 * Responsibility:
 * - Window-based app for creating / randomizing design systems interactively.
 * - Live BrandIdentityCard preview on the left, editor controls on the right.
 * - Randomizer generates themed design-system archetypes.
 * - Created design systems can be attached to agentic sessions.
 *
 * Boundaries:
 * - Owns: editor state, randomization logic, layout
 * - Does NOT own: session store mutations (delegates to desktop-store)
 */
import React, { useState, useCallback, useMemo } from 'react';
import { BrandIdentityCard } from '@/renderer/components/atoms/attachables/BrandIdentityCard';
import { useDesktopStore } from '@/renderer/store/desktop-store';
import type { MarketBrandIdentityTheme, MarketBrandIdentityBrand, MarketBrandIdentityCtaStyle } from '@/types/market';

// ─── Curated Randomization Pools ─────────────────────────────────

const FONT_DISPLAY_POOL = [
  "'Bebas Neue', 'Impact', sans-serif",
  "'Arial Black', 'Haettenschweiler', sans-serif",
  "'Cormorant Garamond', 'Didot', serif",
  "'Nunito', 'Quicksand', sans-serif",
  "'Share Tech Mono', 'Fira Code', monospace",
  "'Playfair Display', 'Georgia', serif",
  "'Oswald', 'Roboto Condensed', sans-serif",
  "'Merriweather', 'Cambria', serif",
  "'Space Grotesk', 'Inter', sans-serif",
  "'JetBrains Mono', 'Fira Code', monospace",
];

const FONT_BODY_POOL = [
  "'DM Sans', 'Helvetica Neue', sans-serif",
  "'Courier New', monospace",
  "'Cormorant Garamond', Georgia, serif",
  "'Nunito', 'Lato', sans-serif",
  "'Inter', 'SF Pro Display', sans-serif",
  "'Source Sans Pro', 'Segoe UI', sans-serif",
  "'Roboto', 'Arial', sans-serif",
  "'Libre Baskerville', 'Georgia', serif",
];

const FONT_MONO_POOL = [
  "'DM Mono', monospace",
  "'Courier New', monospace",
  "'Share Tech Mono', monospace",
  "'JetBrains Mono', monospace",
  "'Fira Code', monospace",
  "'IBM Plex Mono', monospace",
];

const PALETTE_POOL: Array<{
  name: string;
  primary: string; secondary: string; accent: string; surface: string;
  text: string; textMuted: string; textOnPrimary: string;
  badgeBg: string; badgeColor: string;
}> = [
  { name: 'Midnight', primary: '#0F1623', secondary: '#1A2332', accent: '#00D4FF', surface: '#131C2B', text: '#E2E8F0', textMuted: '#7090A0', textOnPrimary: '#0F1623', badgeBg: 'rgba(0,212,255,0.1)', badgeColor: '#00D4FF' },
  { name: 'Swiss', primary: '#0A0A0A', secondary: '#F5F5F5', accent: '#E63224', surface: '#FFFFFF', text: '#0A0A0A', textMuted: '#6B6B6B', textOnPrimary: '#FFFFFF', badgeBg: '#0A0A0A', badgeColor: '#FFFFFF' },
  { name: 'Forest', primary: '#3D6B4F', secondary: '#F3EDE3', accent: '#E07B5A', surface: '#FDFAF6', text: '#2C3E32', textMuted: '#7A8C7E', textOnPrimary: '#FFFFFF', badgeBg: '#EAF2EA', badgeColor: '#3D6B4F' },
  { name: 'Gold', primary: '#1A1209', secondary: '#F9F4E8', accent: '#C9A84C', surface: '#FEFCF5', text: '#1A1209', textMuted: '#7A6A50', textOnPrimary: '#F9F4E8', badgeBg: 'transparent', badgeColor: '#C9A84C' },
  { name: 'Brutalist', primary: '#FFEE02', secondary: '#0A0A0A', accent: '#FF2D00', surface: '#F0EDDE', text: '#0A0A0A', textMuted: '#333333', textOnPrimary: '#0A0A0A', badgeBg: '#FF2D00', badgeColor: '#FFEE02' },
  { name: 'Ocean', primary: '#0D3B66', secondary: '#E8F4FD', accent: '#F4845F', surface: '#FAFCFF', text: '#0D3B66', textMuted: '#5A7A99', textOnPrimary: '#FFFFFF', badgeBg: '#E8F4FD', badgeColor: '#0D3B66' },
  { name: 'Sunset', primary: '#2D1B69', secondary: '#FFF0E5', accent: '#FF6B35', surface: '#FFFAF5', text: '#2D1B69', textMuted: '#8A7EB5', textOnPrimary: '#FFFFFF', badgeBg: '#F0E8FF', badgeColor: '#2D1B69' },
  { name: 'Monochrome', primary: '#1A1A1A', secondary: '#E8E8E8', accent: '#555555', surface: '#F8F8F8', text: '#1A1A1A', textMuted: '#888888', textOnPrimary: '#F8F8F8', badgeBg: '#E0E0E0', badgeColor: '#333333' },
  { name: 'Neon', primary: '#0A0014', secondary: '#1A0028', accent: '#FF00FF', surface: '#0D001A', text: '#E8D5FF', textMuted: '#9966CC', textOnPrimary: '#0A0014', badgeBg: 'rgba(255,0,255,0.1)', badgeColor: '#FF00FF' },
  { name: 'Terracotta', primary: '#8B4513', secondary: '#FFF8F0', accent: '#CD853F', surface: '#FFFAF5', text: '#3E2723', textMuted: '#8D6E63', textOnPrimary: '#FFFAF5', badgeBg: '#EFEBE9', badgeColor: '#5D4037' },
  { name: 'Arctic', primary: '#E3F2FD', secondary: '#0D47A1', accent: '#00BCD4', surface: '#FAFEFF', text: '#0D47A1', textMuted: '#5C8DB8', textOnPrimary: '#0D47A1', badgeBg: '#E0F7FA', badgeColor: '#00838F' },
  { name: 'Rosé', primary: '#880E4F', secondary: '#FFF0F5', accent: '#E91E63', surface: '#FFFAFC', text: '#4A0028', textMuted: '#AD7D99', textOnPrimary: '#FFF0F5', badgeBg: '#FCE4EC', badgeColor: '#880E4F' },
];

const RADIUS_POOL = ['0px', '2px', '4px', '8px', '12px', '16px', '24px', '50px'];
const SPACING_POOL = ['1rem', '1.25rem', '1.5rem', '1.75rem', '2rem', '2.5rem'];
const LETTER_SPACING_POOL = ['-0.02em', '0em', '0.01em', '0.04em', '0.08em', '0.12em', '0.18em'];
const BORDER_POOL = [
  'none', '1px solid', '1.5px solid', '2px solid', '3px solid',
];

const BRAND_NAME_POOL = [
  { name: 'Lexora', initials: 'LX', tagline: 'Legal clarity for everyone.', description: 'Accessible legal services powered by technology and human expertise.', badge: 'Trusted · Affordable · Fast' },
  { name: 'Aethon', initials: 'AE', tagline: 'Build what matters.', description: 'Developer tools that reduce friction and amplify impact.', badge: 'Fast · Reliable · Open' },
  { name: 'Solara', initials: 'SL', tagline: 'Energy for tomorrow.', description: 'Sustainable energy solutions for homes, businesses, and communities.', badge: 'Clean · Smart · Affordable' },
  { name: 'Myndra', initials: 'MY', tagline: 'Think deeper.', description: 'AI-powered research and insights platform for knowledge workers.', badge: 'Intelligent · Private · Fast' },
  { name: 'Veloq', initials: 'VQ', tagline: 'Speed meets precision.', description: 'High-performance analytics for data-driven teams.', badge: 'Real-time · Accurate · Scalable' },
  { name: 'Kova', initials: 'KV', tagline: 'Design with intention.', description: 'Design system platform for product teams who care about craft.', badge: 'Minimal · Modular · Beautiful' },
  { name: 'Tundra', initials: 'TN', tagline: 'Cool under pressure.', description: 'Infrastructure monitoring that keeps your systems healthy.', badge: 'Reliable · Automated · 24/7' },
  { name: 'Prysm', initials: 'PR', tagline: 'Every angle, every insight.', description: 'Multi-dimensional analytics for complex business decisions.', badge: 'Visual · Interactive · Deep' },
];

// ─── Helpers ─────────────────────────────────────────────────────

function pick<T>(pool: T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

function randomHexColor(): string {
  return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
}

function generateRandomTheme(): { brand: MarketBrandIdentityBrand; theme: MarketBrandIdentityTheme } {
  const palette = pick(PALETTE_POOL);
  const brandData = pick(BRAND_NAME_POOL);
  const radius = pick(RADIUS_POOL);
  const spacing = pick(SPACING_POOL);
  const letterSpacing = pick(LETTER_SPACING_POOL);
  const fontDisplay = pick(FONT_DISPLAY_POOL);
  const fontBody = pick(FONT_BODY_POOL);
  const fontMono = pick(FONT_MONO_POOL);
  const borderStyle = pick(BORDER_POOL);

  const border = borderStyle === 'none' ? 'none' : `${borderStyle} ${palette.primary}`;

  const ctaStyle: MarketBrandIdentityCtaStyle = {
    background: palette.accent,
    color: palette.textOnPrimary,
    border: radius === '0px' ? `2px solid ${palette.primary}` : 'none',
    borderRadius: radius === '0px' ? '0px' : radius === '50px' ? '50px' : radius,
    padding: '12px 28px',
    fontWeight: '700',
    letterSpacing: letterSpacing,
    textTransform: 'uppercase',
    fontSize: '13px',
    cursor: 'pointer',
  };

  return {
    brand: {
      name: brandData.name,
      initials: brandData.initials,
      tagline: brandData.tagline,
      description: brandData.description,
      ctaLabel: 'Get started',
      badge: brandData.badge,
    },
    theme: {
      name: palette.name,
      fontDisplay,
      fontBody,
      fontMono,
      primary: palette.primary,
      secondary: palette.secondary,
      accent: palette.accent,
      surface: palette.surface,
      text: palette.text,
      textMuted: palette.textMuted,
      textOnPrimary: palette.textOnPrimary,
      border,
      radius,
      badgeBg: palette.badgeBg,
      badgeColor: palette.badgeColor,
      spacing,
      letterSpacing,
      ctaStyle,
    },
  };
}

// ─── Inline Styles ───────────────────────────────────────────────

const root: React.CSSProperties = {
  display: 'flex',
  height: '100%',
  overflow: 'hidden',
  background: '#111',
  color: '#d4d4d4',
  fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
  fontSize: 12,
};

const previewPane: React.CSSProperties = {
  flex: '0 0 50%',
  overflow: 'auto',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  background: '#0a0a0a',
};

const editorPane: React.CSSProperties = {
  flex: '0 0 50%',
  overflow: 'auto',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  borderLeft: '1px solid #222',
};

const sectionLabel: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#666',
  margin: '6px 0 2px',
  fontWeight: 600,
};

const fieldRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 26,
};

const fieldLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#888',
  width: 80,
  flexShrink: 0,
  textAlign: 'right',
};

const fieldInput: React.CSSProperties = {
  flex: 1,
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#d4d4d4',
  fontSize: 11,
  padding: '4px 8px',
  outline: 'none',
  fontFamily: 'inherit',
};

const colorSwatch: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 4,
  border: '1px solid #444',
  cursor: 'pointer',
  flexShrink: 0,
  padding: 0,
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '8px 0',
  borderBottom: '1px solid #222',
  marginBottom: 4,
};

const btnBase: React.CSSProperties = {
  background: '#1f1f1f',
  border: '1px solid #333',
  borderRadius: 6,
  color: '#ccc',
  fontSize: 11,
  padding: '5px 12px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 500,
  transition: 'all 0.12s',
};

const btnAccent: React.CSSProperties = {
  ...btnBase,
  background: '#1a3a5c',
  borderColor: '#2a5a8c',
  color: '#7cc4fa',
};

// ─── Color Field ─────────────────────────────────────────────────

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const testId = `ds-field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div style={fieldRow} data-testid={testId}>
      <span style={fieldLabel}>{label}</span>
      <input
        type="color"
        value={value.startsWith('#') ? value : '#000000'}
        onChange={e => onChange(e.target.value)}
        style={{ ...colorSwatch, background: value }}
        title={value}
      />
      <input
        style={{ ...fieldInput, flex: '0 1 90px', fontFamily: "'JetBrains Mono', monospace", fontSize: 10 }}
        value={value}
        onChange={e => onChange(e.target.value)}
        spellCheck={false}
        data-testid={`${testId}-input`}
      />
    </div>
  );
}

// ─── Select Field ────────────────────────────────────────────────

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const testId = `ds-field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div style={fieldRow} data-testid={testId}>
      <span style={fieldLabel}>{label}</span>
      <select
        style={{ ...fieldInput, cursor: 'pointer' }}
        value={value}
        onChange={e => onChange(e.target.value)}
        data-testid={`${testId}-select`}
      >
        {options.map(o => <option key={o} value={o}>{o.replace(/'/g, '')}</option>)}
      </select>
    </div>
  );
}

// ─── Text Field ──────────────────────────────────────────────────

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const testId = `ds-field-${label.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <div style={fieldRow} data-testid={testId}>
      <span style={fieldLabel}>{label}</span>
      <input
        style={fieldInput}
        value={value}
        onChange={e => onChange(e.target.value)}
        spellCheck={false}
        data-testid={`${testId}-input`}
      />
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────

export function DesignSystemEditorApp({ windowId }: { windowId: string }) {
  const [current, setCurrent] = useState(() => generateRandomTheme());
  const windows = useDesktopStore(s => s.windows);
  const assignDesignSystem = useDesktopStore(s => s.assignDesignSystem);

  const { brand, theme } = current;

  const updateBrand = useCallback((patch: Partial<MarketBrandIdentityBrand>) => {
    setCurrent(prev => ({ ...prev, brand: { ...prev.brand, ...patch } }));
  }, []);

  const updateTheme = useCallback((patch: Partial<MarketBrandIdentityTheme>) => {
    setCurrent(prev => ({ ...prev, theme: { ...prev.theme, ...patch } }));
  }, []);

  const updateCtaStyle = useCallback((patch: Partial<MarketBrandIdentityCtaStyle>) => {
    setCurrent(prev => ({
      ...prev,
      theme: {
        ...prev.theme,
        ctaStyle: { ...prev.theme.ctaStyle, ...patch },
      },
    }));
  }, []);

  const randomize = useCallback(() => setCurrent(generateRandomTheme()), []);

  // Chat windows that could receive a design system
  const chatWindows = useMemo(
    () => windows.filter(w => w.type === 'chat' && w.id !== windowId),
    [windows, windowId],
  );

  const generateConstraintPrompt = useCallback(() => {
    const t = current.theme;
    return [
      `Design System: ${t.name}`,
      `Primary: ${t.primary} | Secondary: ${t.secondary} | Accent: ${t.accent} | Surface: ${t.surface}`,
      `Text: ${t.text} | Muted: ${t.textMuted}`,
      `Display Font: ${t.fontDisplay}`,
      `Body Font: ${t.fontBody}`,
      `Mono Font: ${t.fontMono}`,
      `Border: ${t.border} | Radius: ${t.radius} | Spacing: ${t.spacing}`,
      `Letter Spacing: ${t.letterSpacing}`,
    ].join('\n');
  }, [current.theme]);

  const [copied, setCopied] = useState(false);
  const copyConstraints = useCallback(() => {
    navigator.clipboard.writeText(generateConstraintPrompt());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [generateConstraintPrompt]);

  const [exportedJSON, setExportedJSON] = useState(false);
  const exportJSON = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(current, null, 2));
    setExportedJSON(true);
    setTimeout(() => setExportedJSON(false), 1500);
  }, [current]);

  return (
    <div style={root} data-testid="ds-editor-root">
      {/* ── Preview Pane ── */}
      <div style={previewPane} data-testid="ds-editor-preview">
        <div style={{ width: '100%', maxWidth: 360 }}>
          <BrandIdentityCard data={{ brand, theme }} size="md" />
        </div>
      </div>

      {/* ── Editor Pane ── */}
      <div style={editorPane} data-testid="ds-editor-controls">
        {/* Toolbar */}
        <div style={toolbarStyle}>
          <button style={btnAccent} onClick={randomize} title="Generate random design system" data-testid="ds-editor-randomize">
            🎲 Randomize
          </button>
          <button style={btnBase} onClick={copyConstraints} title="Copy design constraints for an agentic session" data-testid="ds-editor-copy">
            {copied ? '✓ Copied' : '📋 Copy Constraints'}
          </button>
          <button style={btnBase} onClick={exportJSON} title="Export full JSON to clipboard" data-testid="ds-editor-export">
            {exportedJSON ? '✓ Exported' : '{ } JSON'}
          </button>
        </div>

        {/* Brand */}
        <div style={sectionLabel}>Brand</div>
        <TextField label="Name" value={brand.name} onChange={v => updateBrand({ name: v })} />
        <TextField label="Initials" value={brand.initials} onChange={v => updateBrand({ initials: v })} />
        <TextField label="Tagline" value={brand.tagline} onChange={v => updateBrand({ tagline: v })} />
        <TextField label="Badge" value={brand.badge} onChange={v => updateBrand({ badge: v })} />

        {/* Colors */}
        <div style={sectionLabel}>Colors</div>
        <ColorField label="Primary" value={theme.primary} onChange={v => updateTheme({ primary: v })} />
        <ColorField label="Secondary" value={theme.secondary} onChange={v => updateTheme({ secondary: v })} />
        <ColorField label="Accent" value={theme.accent} onChange={v => updateTheme({ accent: v })} />
        <ColorField label="Surface" value={theme.surface} onChange={v => updateTheme({ surface: v })} />
        <ColorField label="Text" value={theme.text} onChange={v => updateTheme({ text: v })} />
        <ColorField label="Text Muted" value={theme.textMuted} onChange={v => updateTheme({ textMuted: v })} />
        <ColorField label="On Primary" value={theme.textOnPrimary} onChange={v => updateTheme({ textOnPrimary: v })} />
        <ColorField label="Badge BG" value={theme.badgeBg} onChange={v => updateTheme({ badgeBg: v })} />
        <ColorField label="Badge Color" value={theme.badgeColor} onChange={v => updateTheme({ badgeColor: v })} />

        {/* Typography */}
        <div style={sectionLabel}>Typography</div>
        <SelectField label="Display" value={theme.fontDisplay} options={FONT_DISPLAY_POOL} onChange={v => updateTheme({ fontDisplay: v })} />
        <SelectField label="Body" value={theme.fontBody} options={FONT_BODY_POOL} onChange={v => updateTheme({ fontBody: v })} />
        <SelectField label="Mono" value={theme.fontMono} options={FONT_MONO_POOL} onChange={v => updateTheme({ fontMono: v })} />

        {/* Layout */}
        <div style={sectionLabel}>Layout</div>
        <TextField label="Radius" value={theme.radius} onChange={v => updateTheme({ radius: v })} />
        <TextField label="Spacing" value={theme.spacing} onChange={v => updateTheme({ spacing: v })} />
        <TextField label="Tracking" value={theme.letterSpacing} onChange={v => updateTheme({ letterSpacing: v })} />
        <TextField label="Border" value={theme.border} onChange={v => updateTheme({ border: v })} />
        <TextField label="Theme Name" value={theme.name} onChange={v => updateTheme({ name: v })} />

        {/* CTA */}
        <div style={sectionLabel}>CTA Button</div>
        <ColorField label="CTA BG" value={theme.ctaStyle.background} onChange={v => updateCtaStyle({ background: v })} />
        <ColorField label="CTA Text" value={theme.ctaStyle.color} onChange={v => updateCtaStyle({ color: v })} />
        <TextField label="CTA Radius" value={theme.ctaStyle.borderRadius} onChange={v => updateCtaStyle({ borderRadius: v })} />
        <TextField label="CTA Border" value={theme.ctaStyle.border} onChange={v => updateCtaStyle({ border: v })} />

        {/* Attach to session */}
        {chatWindows.length > 0 && (
          <>
            <div style={sectionLabel}>Attach to Session</div>
            {chatWindows.map(w => (
              <button
                key={w.id}
                style={{ ...btnBase, textAlign: 'left', fontSize: 10, padding: '4px 10px' }}
                onClick={() => assignDesignSystem(w.id, `custom:${theme.name}`)}
                title={`Attach "${theme.name}" to ${w.title}`}
              >
                → {w.title}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
