/**
 * void.ts — Design Guidelines: Void Family (00–09)
 * Ultra-dark, near-invisible surfaces. Maximum darkness, minimal chrome.
 */
import type { DesignGuideline } from '../types';

export const voidFamily: DesignGuideline[] = [
  {
    id: 0, name: 'void', displayName: 'Void', family: 'void',
    description: 'Absolute black. No borders, no shadows. Text at 40% opacity until interacted with.',
    tokens: {
      bg: '#000000', bgDeep: '#000000', bgApp: '#000000',
      surface: '#080808', surfaceLight: '#0d0d0d', surfaceCard: '#0f0f0f',
      surfaceHover: '#181818', border: 'rgba(255,255,255,0.04)',
      borderLight: 'rgba(255,255,255,0.06)', textPrimary: 'rgba(228,228,231,0.65)',
      textSecondary: 'rgba(228,228,231,0.45)', textMuted: 'rgba(228,228,231,0.3)',
      '--shadow-card': 'none', '--radius-base': '2px',
      '--transition-base': 'opacity 120ms ease',
    },
    meta: { radius: 'subtle', density: 'compact', shadow: 'none', animation: 'crisp', borderWeight: 'none' },
  },
  {
    id: 1, name: 'obsidian', displayName: 'Obsidian', family: 'void',
    description: 'Deep warm charcoal with gold accents and sharp geometry.',
    tokens: {
      bg: '#0d0b09', bgDeep: '#080705', surface: '#151210',
      surfaceCard: '#1c1814', surfaceHover: '#252019',
      accentBlue: '#C9A84C', accentBlueBg: 'rgba(201,168,76,0.12)',
      accentBlueSolid: '#A8882E', accentBlueBorder: 'rgba(201,168,76,0.3)',
      border: 'rgba(201,168,76,0.08)', borderLight: 'rgba(201,168,76,0.12)',
      '--radius-base': '0px', '--shadow-card': '0 1px 0 rgba(201,168,76,0.1)',
    },
    meta: { radius: 'none', density: 'default', shadow: 'flat', animation: 'crisp', borderWeight: 'hairline' },
  },
  {
    id: 2, name: 'nightwatch', displayName: 'Night Watch', family: 'void',
    description: 'Blue-black surfaces, electric cyan accent, monospace-first typography.',
    tokens: {
      bg: '#050810', bgDeep: '#020509', surface: '#0a0f1e',
      surfaceCard: '#0d1424', surfaceHover: '#141d33',
      accentBlue: '#00E5FF', accentBlueBg: 'rgba(0,229,255,0.1)',
      accentBlueSolid: '#00B8CC', accentBlueBorder: 'rgba(0,229,255,0.25)',
      border: 'rgba(0,229,255,0.08)', borderAccent: 'rgba(0,229,255,0.15)',
      '--radius-base': '3px',
    },
    meta: { radius: 'subtle', density: 'compact', shadow: 'glow', animation: 'crisp', borderWeight: 'hairline' },
  },
  {
    id: 3, name: 'pitch', displayName: 'Pitch', family: 'void',
    description: '#050505 surfaces. White text only. A single accent color is the only chromatic signal.',
    tokens: {
      bg: '#050505', bgDeep: '#020202', surface: '#0a0a0a',
      surfaceCard: '#0e0e0e', surfaceHover: '#161616',
      accentBlue: '#FF6B35', accentBlueBg: 'rgba(255,107,53,0.1)',
      accentBlueSolid: '#E05520', accentBlueBorder: 'rgba(255,107,53,0.25)',
      textPrimary: '#FFFFFF', textSecondary: '#E0E0E0',
      border: 'rgba(255,255,255,0.04)', '--radius-base': '2px', '--shadow-card': 'none',
    },
    meta: { radius: 'subtle', density: 'compact', shadow: 'none', animation: 'instant', borderWeight: 'none' },
  },
  {
    id: 4, name: 'onyx', displayName: 'Onyx', family: 'void',
    description: 'Pure black, no borders. Drop shadows are the only depth signal.',
    tokens: {
      bg: '#000000', bgDeep: '#000000', surface: '#0a0a0a',
      surfaceCard: '#111111', surfaceHover: '#1a1a1a',
      border: 'transparent', borderLight: 'transparent',
      '--shadow-card': '0 4px 16px rgba(0,0,0,0.6)', '--radius-base': '4px',
    },
    meta: { radius: 'subtle', density: 'default', shadow: 'elevated', animation: 'smooth', borderWeight: 'none' },
  },
  {
    id: 5, name: 'redshift', displayName: 'Redshift', family: 'void',
    description: 'Near-black with a deep crimson accent. Maximum contrast text.',
    tokens: {
      bg: '#050000', bgDeep: '#030000', surface: '#0e0305',
      surfaceCard: '#14060a', surfaceHover: '#1e0a10',
      accentBlue: '#FF1744', accentBlueBg: 'rgba(255,23,68,0.1)',
      accentBlueSolid: '#D50000', accentBlueBorder: 'rgba(255,23,68,0.25)',
      danger: '#FF1744', success: '#FF1744', border: 'rgba(255,23,68,0.06)',
      '--radius-base': '2px',
    },
    meta: { radius: 'subtle', density: 'compact', shadow: 'glow', animation: 'crisp', borderWeight: 'hairline' },
  },
  {
    id: 6, name: 'corvus', displayName: 'Corvus', family: 'void',
    description: 'Dark surfaces, indigo-violet accent, pill-radius geometry throughout.',
    tokens: {
      bg: '#06040d', bgDeep: '#03020a', surface: '#0c081a',
      surfaceCard: '#120e24', surfaceHover: '#1a1432',
      accentBlue: '#818CF8', accentBlueBg: 'rgba(129,140,248,0.1)',
      accentBlueSolid: '#6366F1', accentBlueBorder: 'rgba(129,140,248,0.25)',
      border: 'rgba(129,140,248,0.06)',
      '--radius-base': '24px',
    },
    meta: { radius: 'pill', density: 'default', shadow: 'glow', animation: 'smooth', borderWeight: 'subtle' },
  },
  {
    id: 7, name: 'blackout', displayName: 'Blackout', family: 'void',
    description: 'Maximum dark. Neon chartreuse accent. Terminal lineage made modern.',
    tokens: {
      bg: '#000000', surface: '#0a0a0a', surfaceCard: '#111',
      surfaceHover: '#1a1a1a',
      accentBlue: '#CCFF00', accentBlueBg: 'rgba(204,255,0,0.08)',
      accentBlueSolid: '#AADD00', accentBlueBorder: 'rgba(204,255,0,0.25)',
      success: '#CCFF00', successBg: 'rgba(204,255,0,0.08)',
      border: 'rgba(204,255,0,0.06)', borderLight: 'rgba(204,255,0,0.1)',
      '--radius-base': '0px',
    },
    meta: { radius: 'none', density: 'compact', shadow: 'none', animation: 'instant', borderWeight: 'hairline' },
  },
  {
    id: 8, name: 'nightfall', displayName: 'Nightfall', family: 'void',
    description: 'Warm dark (#100c0a), amber accent, editorial Manrope typography.',
    tokens: {
      bg: '#100c0a', bgDeep: '#0a0806', surface: '#181210',
      surfaceCard: '#201a16', surfaceHover: '#2a221c',
      accentBlue: '#F59E0B', accentBlueBg: 'rgba(245,158,11,0.1)',
      accentBlueSolid: '#D97706', accentBlueBorder: 'rgba(245,158,11,0.25)',
      border: 'rgba(245,158,11,0.08)',
      '--radius-base': '6px',
    },
    meta: { radius: 'rounded', density: 'default', shadow: 'flat', animation: 'smooth', borderWeight: 'hairline' },
  },
  {
    id: 9, name: 'carbon', displayName: 'Carbon', family: 'void',
    description: 'Zero hue. Pure neutral black-to-grey scale. Only luminance for hierarchy.',
    tokens: {
      bg: '#080808', bgDeep: '#040404', surface: '#0f0f0f',
      surfaceCard: '#161616', surfaceHover: '#1e1e1e',
      accentBlue: '#A0A0A0', accentBlueBg: 'rgba(160,160,160,0.1)',
      accentBlueSolid: '#808080', accentBlueBorder: 'rgba(160,160,160,0.2)',
      textPrimary: '#D4D4D4', textSecondary: '#A3A3A3', textMuted: '#737373',
      border: 'rgba(255,255,255,0.06)', '--radius-base': '3px', '--shadow-card': 'none',
    },
    meta: { radius: 'subtle', density: 'compact', shadow: 'none', animation: 'crisp', borderWeight: 'hairline' },
  },
];
