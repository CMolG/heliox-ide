/**
 * studio.ts — Design Guidelines: Studio Family (20–29)
 * Creative & expressive. Late-night session palettes.
 */
import type { DesignGuideline } from '../types';

export const studioFamily: DesignGuideline[] = [
  {
    id: 20, name: 'midnight', displayName: 'Midnight', family: 'studio',
    description: 'Deep indigo surfaces, neon lavender accent. Late-night creative session.',
    tokens: {
      bg: '#06051a', bgDeep: '#030211', surface: '#0d0c2a',
      surfaceCard: '#141336', surfaceHover: '#1d1c47',
      accentBlue: '#B794FF', accentBlueBg: 'rgba(183,148,255,0.1)',
      accentBlueSolid: '#9B6EFF', accentBlueBorder: 'rgba(183,148,255,0.28)',
      border: 'rgba(183,148,255,0.08)', borderAccent: 'rgba(183,148,255,0.15)',
      '--shadow-card': '0 0 12px rgba(183,148,255,0.06)', '--radius-base': '6px',
    },
    meta: { radius: 'rounded', density: 'default', shadow: 'glow', animation: 'smooth', borderWeight: 'subtle' },
  },
  {
    id: 21, name: 'aurora', displayName: 'Aurora', family: 'studio',
    description: 'Dark base, gradient-kissed teal-to-violet accents. Northern lights palette.',
    tokens: {
      bg: '#040a0f', bgDeep: '#020608', surface: '#081420',
      surfaceCard: '#0c1c2c', surfaceHover: '#122838',
      accentBlue: '#22D3EE', accentBlueBg: 'rgba(34,211,238,0.08)',
      accentBlueSolid: '#06B6D4', accentBlueBorder: 'rgba(34,211,238,0.2)',
      success: '#A78BFA', border: 'rgba(34,211,238,0.06)',
      '--shadow-card': '0 0 14px rgba(34,211,238,0.05)', '--radius-base': '8px',
    },
    meta: { radius: 'rounded', density: 'default', shadow: 'glow', animation: 'smooth', borderWeight: 'subtle' },
  },
  {
    id: 22, name: 'solstice', displayName: 'Solstice', family: 'studio',
    description: 'Dark warm navy, gold accent. Heavy editorial Manrope typography.',
    tokens: {
      bg: '#0a0c14', bgDeep: '#060810', surface: '#121620',
      surfaceCard: '#1a1e2c', surfaceHover: '#222838',
      accentBlue: '#EAB308', accentBlueBg: 'rgba(234,179,8,0.1)',
      accentBlueSolid: '#CA8A04', accentBlueBorder: 'rgba(234,179,8,0.25)',
      border: 'rgba(234,179,8,0.08)', '--radius-base': '4px',
    },
    meta: { radius: 'subtle', density: 'default', shadow: 'flat', animation: 'smooth', borderWeight: 'hairline' },
  },
  {
    id: 23, name: 'infrared', displayName: 'Infrared', family: 'studio',
    description: 'Dark surfaces, vivid orange-red accent. Bold and urgent.',
    tokens: {
      bg: '#0d0504', bgDeep: '#090302', surface: '#180a08',
      surfaceCard: '#22100c', surfaceHover: '#2e1812',
      accentBlue: '#FF4500', accentBlueBg: 'rgba(255,69,0,0.1)',
      accentBlueSolid: '#DD3800', accentBlueBorder: 'rgba(255,69,0,0.28)',
      danger: '#FF4500', border: 'rgba(255,69,0,0.08)',
      '--shadow-card': '0 0 10px rgba(255,69,0,0.05)', '--radius-base': '3px',
    },
    meta: { radius: 'subtle', density: 'compact', shadow: 'glow', animation: 'crisp', borderWeight: 'hairline' },
  },
  {
    id: 24, name: 'ultraviolet', displayName: 'Ultraviolet', family: 'studio',
    description: 'Near-black with electric purple. Neon-glow card borders.',
    tokens: {
      bg: '#07020f', surface: '#0f0622', surfaceCard: '#160a30',
      surfaceHover: '#1f1040',
      accentBlue: '#9B00FF', accentBlueBg: 'rgba(155,0,255,0.1)',
      accentBlueSolid: '#7700CC', accentBlueBorder: 'rgba(155,0,255,0.3)',
      border: 'rgba(155,0,255,0.1)', borderAccent: 'rgba(155,0,255,0.2)',
      '--shadow-card': '0 0 16px rgba(155,0,255,0.08)', '--radius-base': '4px',
    },
    meta: { radius: 'subtle', density: 'default', shadow: 'glow', animation: 'smooth', borderWeight: 'subtle' },
  },
  {
    id: 25, name: 'plasma', displayName: 'Plasma', family: 'studio',
    description: 'Deep magenta-dark surface, cyan accent. High-energy contrast.',
    tokens: {
      bg: '#0a020e', bgDeep: '#060108', surface: '#140620',
      surfaceCard: '#1e0a30', surfaceHover: '#28103e',
      accentBlue: '#00FFDD', accentBlueBg: 'rgba(0,255,221,0.08)',
      accentBlueSolid: '#00CCAA', accentBlueBorder: 'rgba(0,255,221,0.25)',
      border: 'rgba(0,255,221,0.06)',
      '--shadow-card': '0 0 14px rgba(0,255,221,0.06)', '--radius-base': '6px',
    },
    meta: { radius: 'rounded', density: 'default', shadow: 'glow', animation: 'smooth', borderWeight: 'subtle' },
  },
  {
    id: 26, name: 'bioluminescence', displayName: 'Bioluminescence', family: 'studio',
    description: 'Black base, soft cyan-green glow on interactive elements.',
    tokens: {
      bg: '#020806', bgDeep: '#010504', surface: '#04120c',
      surfaceCard: '#081c14', surfaceHover: '#0e281e',
      accentBlue: '#48FFD0', accentBlueBg: 'rgba(72,255,208,0.06)',
      accentBlueSolid: '#30DDB0', accentBlueBorder: 'rgba(72,255,208,0.2)',
      border: 'rgba(72,255,208,0.05)',
      '--shadow-card': '0 0 16px rgba(72,255,208,0.04)', '--radius-base': '8px',
    },
    meta: { radius: 'rounded', density: 'airy', shadow: 'glow', animation: 'slow', borderWeight: 'hairline' },
  },
  {
    id: 27, name: 'neon-noir', displayName: 'Neon Noir', family: 'studio',
    description: 'Dark cool-grey surface, hot pink accent. Film noir relit by neon.',
    tokens: {
      bg: '#0a090d', surface: '#121118', surfaceCard: '#181622',
      surfaceHover: '#211e2e',
      accentBlue: '#FF2D78', accentBlueBg: 'rgba(255,45,120,0.1)',
      accentBlueSolid: '#CC0055', accentBlueBorder: 'rgba(255,45,120,0.28)',
      success: '#FF2D78', border: 'rgba(255,45,120,0.07)',
      '--shadow-card': '0 0 10px rgba(255,45,120,0.06)', '--radius-base': '3px',
    },
    meta: { radius: 'subtle', density: 'compact', shadow: 'glow', animation: 'crisp', borderWeight: 'hairline' },
  },
  {
    id: 28, name: 'velvet', displayName: 'Velvet', family: 'studio',
    description: 'Deep purple-black, rose-gold accent. Soft, luxurious.',
    tokens: {
      bg: '#0a040c', bgDeep: '#060208', surface: '#140a18',
      surfaceCard: '#1e1024', surfaceHover: '#281830',
      accentBlue: '#E8A0B0', accentBlueBg: 'rgba(232,160,176,0.08)',
      accentBlueSolid: '#C87888', accentBlueBorder: 'rgba(232,160,176,0.2)',
      border: 'rgba(232,160,176,0.06)',
      '--radius-base': '12px', '--shadow-card': '0 2px 8px rgba(232,160,176,0.06)',
    },
    meta: { radius: 'rounded', density: 'airy', shadow: 'elevated', animation: 'smooth', borderWeight: 'subtle' },
  },
  {
    id: 29, name: 'cinema', displayName: 'Cinema', family: 'studio',
    description: 'Warm-black surfaces, cream text, letterbox-inspired spacing.',
    tokens: {
      bg: '#0c0a08', bgDeep: '#080604', surface: '#141110',
      surfaceCard: '#1c1816', surfaceHover: '#262220',
      accentBlue: '#E8DCC8', accentBlueBg: 'rgba(232,220,200,0.08)',
      accentBlueSolid: '#C8B898', accentBlueBorder: 'rgba(232,220,200,0.2)',
      textPrimary: '#F0E8D8', textSecondary: '#D0C8B0', textMuted: '#988868',
      border: 'rgba(232,220,200,0.06)',
      '--radius-base': '4px', '--density-spacing': '16px',
    },
    meta: { radius: 'subtle', density: 'airy', shadow: 'flat', animation: 'smooth', borderWeight: 'hairline' },
  },
];
