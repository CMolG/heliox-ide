/**
 * minimal.ts — Design Guidelines: Minimal Family (30–39)
 * Professional, typographic, restrained. Maximum clarity.
 */
import type { DesignGuideline } from '../types';

export const minimalFamily: DesignGuideline[] = [
  {
    id: 30, name: 'studio-grey', displayName: 'Studio Grey', family: 'minimal',
    description: 'Medium-dark grey. White text. Zero decoration. Typography carries everything.',
    tokens: {
      bg: '#1a1a1a', bgDeep: '#141414', surface: '#222222',
      surfaceCard: '#2a2a2a', surfaceHover: '#333333',
      textPrimary: '#F0F0F0', textSecondary: '#C0C0C0', textMuted: '#808080',
      accentBlue: '#E0E0E0', accentBlueBg: 'rgba(224,224,224,0.08)',
      accentBlueSolid: '#BBBBBB', border: 'rgba(255,255,255,0.06)',
      '--radius-base': '4px', '--shadow-card': 'none',
    },
    meta: { radius: 'subtle', density: 'default', shadow: 'none', animation: 'crisp', borderWeight: 'hairline' },
  },
  {
    id: 31, name: 'monolith', displayName: 'Monolith', family: 'minimal',
    description: 'Single grey scale. Strong typographic hierarchy. No accent color.',
    tokens: {
      bg: '#0e0e0e', bgDeep: '#080808', surface: '#161616',
      surfaceCard: '#1e1e1e', surfaceHover: '#282828',
      textPrimary: '#E4E4E4', textSecondary: '#A0A0A0', textMuted: '#666666',
      accentBlue: '#D4D4D4', accentBlueBg: 'rgba(212,212,212,0.06)',
      accentBlueSolid: '#A0A0A0', border: 'rgba(255,255,255,0.04)',
      '--radius-base': '0px', '--shadow-card': 'none',
    },
    meta: { radius: 'none', density: 'default', shadow: 'none', animation: 'instant', borderWeight: 'none' },
  },
  {
    id: 32, name: 'paper', displayName: 'Paper', family: 'minimal',
    description: 'Light mode: off-white surfaces, dark grey text. The IDE in daylight.',
    tokens: {
      bg: '#F5F2EE', bgDeep: '#EDE9E4', bgApp: '#EEEBE6',
      surface: '#FFFFFF', surfaceLight: '#F9F7F5', surfaceCard: '#FFFFFF',
      surfaceHover: '#F0EDE9',
      border: 'rgba(28,25,23,0.08)', borderLight: 'rgba(28,25,23,0.12)',
      textPrimary: '#1C1917', textSecondary: '#292524', textMuted: '#57534E',
      textDim: '#78716C', textFaint: '#A8A29E',
      accentBlue: '#1D4ED8', accentBlueBg: 'rgba(29,78,216,0.08)',
      accentBlueSolid: '#1E40AF', accentBlueBorder: 'rgba(29,78,216,0.2)',
      '--shadow-card': '0 1px 3px rgba(0,0,0,0.08)', '--radius-base': '6px',
    },
    meta: { radius: 'rounded', density: 'airy', shadow: 'elevated', animation: 'smooth', borderWeight: 'hairline' },
  },
  {
    id: 33, name: 'blueprint', displayName: 'Blueprint', family: 'minimal',
    description: 'Deep technical blue, engineering drawing aesthetic. Grid-line borders.',
    tokens: {
      bg: '#0a1628', bgDeep: '#061020', surface: '#0e1e38',
      surfaceCard: '#142848', surfaceHover: '#1a3458',
      accentBlue: '#60A5FA', accentBlueBg: 'rgba(96,165,250,0.1)',
      accentBlueSolid: '#3B82F6', accentBlueBorder: 'rgba(96,165,250,0.25)',
      textPrimary: '#DBEAFE', textSecondary: '#93C5FD', textMuted: '#3B82F6',
      border: 'rgba(96,165,250,0.12)', '--radius-base': '0px',
    },
    meta: { radius: 'none', density: 'compact', shadow: 'none', animation: 'crisp', borderWeight: 'visible' },
  },
  {
    id: 34, name: 'manuscript', displayName: 'Manuscript', family: 'minimal',
    description: 'Off-white light mode, Lexend as primary font. Long-form reading feel.',
    tokens: {
      bg: '#FAF8F5', bgDeep: '#F2EFE8', bgApp: '#F5F2ED',
      surface: '#FFFFFF', surfaceCard: '#FFFFFF', surfaceHover: '#F0EDE8',
      textPrimary: '#1A1A1A', textSecondary: '#3A3A3A', textMuted: '#6A6A6A',
      accentBlue: '#2563EB', accentBlueBg: 'rgba(37,99,235,0.06)',
      accentBlueSolid: '#1D4ED8', border: 'rgba(0,0,0,0.06)',
      '--radius-base': '8px', '--shadow-card': '0 1px 2px rgba(0,0,0,0.05)',
      '--density-spacing': '14px',
    },
    meta: { radius: 'rounded', density: 'airy', shadow: 'flat', animation: 'smooth', borderWeight: 'hairline' },
  },
  {
    id: 35, name: 'nordic', displayName: 'Nordic', family: 'minimal',
    description: 'Cool blue-grey dark surfaces. Icy blue accent. Scandinavian restraint.',
    tokens: {
      bg: '#0c1018', bgDeep: '#080c14', surface: '#141c28',
      surfaceCard: '#1a2436', surfaceHover: '#222e42',
      accentBlue: '#88C0D0', accentBlueBg: 'rgba(136,192,208,0.1)',
      accentBlueSolid: '#5E81AC', accentBlueBorder: 'rgba(136,192,208,0.2)',
      textPrimary: '#ECEFF4', textSecondary: '#D8DEE9', textMuted: '#81A1C1',
      border: 'rgba(136,192,208,0.08)', '--radius-base': '6px',
    },
    meta: { radius: 'rounded', density: 'default', shadow: 'flat', animation: 'smooth', borderWeight: 'hairline' },
  },
  {
    id: 36, name: 'graphite', displayName: 'Graphite', family: 'minimal',
    description: 'Warm charcoal. Zero accent hue. Pure neutrals only.',
    tokens: {
      bg: '#151312', bgDeep: '#0e0c0b', surface: '#1d1b19',
      surfaceCard: '#252322', surfaceHover: '#302e2c',
      textPrimary: '#D6D3D1', textSecondary: '#A8A29E', textMuted: '#78716C',
      accentBlue: '#D6D3D1', accentBlueBg: 'rgba(214,211,209,0.08)',
      accentBlueSolid: '#A8A29E', border: 'rgba(214,211,209,0.06)',
      '--radius-base': '3px', '--shadow-card': 'none',
    },
    meta: { radius: 'subtle', density: 'default', shadow: 'none', animation: 'crisp', borderWeight: 'hairline' },
  },
  {
    id: 37, name: 'wire', displayName: 'Wire', family: 'minimal',
    description: 'Dark base, outline-only components. Everything is drawn, not filled.',
    tokens: {
      bg: '#0c0c0c', surface: '#111', surfaceCard: '#111',
      surfaceHover: '#1a1a1a',
      border: 'rgba(255,255,255,0.18)', borderLight: 'rgba(255,255,255,0.22)',
      borderMedium: 'rgba(255,255,255,0.28)', borderAccent: 'rgba(255,255,255,0.35)',
      accentBlue: '#E4E4E7', accentBlueBg: 'transparent',
      accentBlueBorder: 'rgba(228,228,231,0.4)',
      '--shadow-card': 'none', '--radius-base': '0px',
    },
    meta: { radius: 'none', density: 'compact', shadow: 'none', animation: 'instant', borderWeight: 'visible' },
  },
  {
    id: 38, name: 'fieldwork', displayName: 'Fieldwork', family: 'minimal',
    description: 'Mid-dark earthy surfaces. Muted sage-green accent. Grounded.',
    tokens: {
      bg: '#0e100c', bgDeep: '#090a08', surface: '#161a14',
      surfaceCard: '#1e241a', surfaceHover: '#282e24',
      accentBlue: '#84CC16', accentBlueBg: 'rgba(132,204,22,0.08)',
      accentBlueSolid: '#65A30D', accentBlueBorder: 'rgba(132,204,22,0.2)',
      border: 'rgba(132,204,22,0.06)', '--radius-base': '4px',
    },
    meta: { radius: 'subtle', density: 'default', shadow: 'flat', animation: 'crisp', borderWeight: 'hairline' },
  },
  {
    id: 39, name: 'calibration', displayName: 'Calibration', family: 'minimal',
    description: 'OS system-UI aesthetic. No personality. All function.',
    tokens: {
      bg: '#1c1c1e', bgDeep: '#141416', surface: '#2c2c2e',
      surfaceCard: '#3a3a3c', surfaceHover: '#48484a',
      textPrimary: '#F2F2F7', textSecondary: '#AEAEB2', textMuted: '#8E8E93',
      accentBlue: '#0A84FF', accentBlueBg: 'rgba(10,132,255,0.12)',
      accentBlueSolid: '#0071E3', accentBlueBorder: 'rgba(10,132,255,0.3)',
      border: 'rgba(255,255,255,0.08)', '--radius-base': '8px',
      '--shadow-card': '0 1px 4px rgba(0,0,0,0.2)',
    },
    meta: { radius: 'rounded', density: 'default', shadow: 'elevated', animation: 'smooth', borderWeight: 'hairline' },
  },
];
