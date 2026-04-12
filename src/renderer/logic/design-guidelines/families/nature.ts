/**
 * nature.ts — Design Guidelines: Nature Family (40–49)
 * Organic & elemental. Earth, water, fire, ice.
 */
import type { DesignGuideline } from '../types';

export const natureFamily: DesignGuideline[] = [
  {
    id: 40, name: 'forest', displayName: 'Forest', family: 'nature',
    description: 'Deep green-black surfaces, bright verdant accent.',
    tokens: {
      bg: '#030a04', bgDeep: '#020602', surface: '#081209',
      surfaceCard: '#0f1c10', surfaceHover: '#172919',
      accentBlue: '#4ADE80', accentBlueBg: 'rgba(74,222,128,0.1)',
      accentBlueSolid: '#22C55E', accentBlueBorder: 'rgba(74,222,128,0.25)',
      success: '#4ADE80', successBg: 'rgba(74,222,128,0.08)',
      border: 'rgba(74,222,128,0.08)', borderAccent: 'rgba(74,222,128,0.14)',
      '--shadow-card': '0 0 10px rgba(74,222,128,0.04)',
    },
    meta: { radius: 'subtle', density: 'default', shadow: 'glow', animation: 'smooth', borderWeight: 'hairline' },
  },
  {
    id: 41, name: 'ocean', displayName: 'Ocean', family: 'nature',
    description: 'Deep teal-black, aqua accent. Pressure and depth.',
    tokens: {
      bg: '#02080a', bgDeep: '#010506', surface: '#061418',
      surfaceCard: '#0a1e24', surfaceHover: '#102a32',
      accentBlue: '#22D3EE', accentBlueBg: 'rgba(34,211,238,0.08)',
      accentBlueSolid: '#06B6D4', accentBlueBorder: 'rgba(34,211,238,0.2)',
      border: 'rgba(34,211,238,0.06)',
      '--shadow-card': '0 0 12px rgba(34,211,238,0.04)', '--radius-base': '6px',
    },
    meta: { radius: 'rounded', density: 'default', shadow: 'glow', animation: 'smooth', borderWeight: 'hairline' },
  },
  {
    id: 42, name: 'dusk', displayName: 'Dusk', family: 'nature',
    description: 'Warm dark purple-to-orange. Twilight gradient accents.',
    tokens: {
      bg: '#0e0810', bgDeep: '#08040a', surface: '#18101c',
      surfaceCard: '#221828', surfaceHover: '#2e2036',
      accentBlue: '#E879F9', accentBlueBg: 'rgba(232,121,249,0.08)',
      accentBlueSolid: '#C026D3', accentBlueBorder: 'rgba(232,121,249,0.2)',
      warning: '#FB923C', border: 'rgba(232,121,249,0.06)',
      '--shadow-card': '0 0 10px rgba(232,121,249,0.05)', '--radius-base': '8px',
    },
    meta: { radius: 'rounded', density: 'default', shadow: 'glow', animation: 'smooth', borderWeight: 'subtle' },
  },
  {
    id: 43, name: 'ember', displayName: 'Ember', family: 'nature',
    description: 'Deep red-brown surfaces, glowing ember-orange accent.',
    tokens: {
      bg: '#0d0502', bgDeep: '#090300', surface: '#1a0a04',
      surfaceCard: '#231108', surfaceHover: '#2f1a0e',
      accentBlue: '#F97316', accentBlueBg: 'rgba(249,115,22,0.1)',
      accentBlueSolid: '#EA580C', accentBlueBorder: 'rgba(249,115,22,0.25)',
      border: 'rgba(249,115,22,0.08)', textPrimary: '#FDE8D5',
      textSecondary: '#F5C9A8', textMuted: '#C2845A',
      '--shadow-card': '0 0 12px rgba(249,115,22,0.05)',
    },
    meta: { radius: 'subtle', density: 'default', shadow: 'glow', animation: 'smooth', borderWeight: 'hairline' },
  },
  {
    id: 44, name: 'moss', displayName: 'Moss', family: 'nature',
    description: 'Dark olive surfaces, muted yellow-green text. Still and earthy.',
    tokens: {
      bg: '#0a0c06', bgDeep: '#060804', surface: '#141808',
      surfaceCard: '#1c220e', surfaceHover: '#262e16',
      accentBlue: '#BEF264', accentBlueBg: 'rgba(190,242,100,0.08)',
      accentBlueSolid: '#A3E635', accentBlueBorder: 'rgba(190,242,100,0.2)',
      textPrimary: '#E8F0D0', textSecondary: '#C8D8A0', textMuted: '#889860',
      border: 'rgba(190,242,100,0.06)', '--radius-base': '4px',
    },
    meta: { radius: 'subtle', density: 'default', shadow: 'flat', animation: 'smooth', borderWeight: 'hairline' },
  },
  {
    id: 45, name: 'volcanic', displayName: 'Volcanic', family: 'nature',
    description: 'Near-black with deep-lava orange accents. Slow-burn energy.',
    tokens: {
      bg: '#080302', bgDeep: '#040200', surface: '#120806',
      surfaceCard: '#1c0e0a', surfaceHover: '#281610',
      accentBlue: '#FF6B35', accentBlueBg: 'rgba(255,107,53,0.1)',
      accentBlueSolid: '#E05520', accentBlueBorder: 'rgba(255,107,53,0.28)',
      danger: '#FF6B35', border: 'rgba(255,107,53,0.06)',
      '--shadow-card': '0 0 14px rgba(255,107,53,0.05)', '--radius-base': '2px',
    },
    meta: { radius: 'subtle', density: 'compact', shadow: 'glow', animation: 'crisp', borderWeight: 'hairline' },
  },
  {
    id: 46, name: 'arctic', displayName: 'Arctic', family: 'nature',
    description: 'Very dark blue-black, ice-white accent. Cold and precise.',
    tokens: {
      bg: '#02040d', bgDeep: '#010308', surface: '#05091a',
      surfaceCard: '#090f24', surfaceHover: '#0e172e',
      accentBlue: '#E0F2FF', accentBlueBg: 'rgba(224,242,255,0.06)',
      accentBlueSolid: '#B8DAEF', accentBlueBorder: 'rgba(224,242,255,0.2)',
      textPrimary: '#EFF6FF', textSecondary: '#DBEAFE', textMuted: '#93C5FD',
      border: 'rgba(224,242,255,0.07)',
      '--shadow-card': '0 0 8px rgba(224,242,255,0.03)',
    },
    meta: { radius: 'subtle', density: 'compact', shadow: 'flat', animation: 'crisp', borderWeight: 'hairline' },
  },
  {
    id: 47, name: 'verdant', displayName: 'Verdant', family: 'nature',
    description: 'Dark cool-green surfaces, electric lime accent.',
    tokens: {
      bg: '#030a06', bgDeep: '#020604', surface: '#08160c',
      surfaceCard: '#0e2214', surfaceHover: '#162e1c',
      accentBlue: '#66FF66', accentBlueBg: 'rgba(102,255,102,0.08)',
      accentBlueSolid: '#44DD44', accentBlueBorder: 'rgba(102,255,102,0.2)',
      success: '#66FF66', border: 'rgba(102,255,102,0.06)',
      '--shadow-card': '0 0 10px rgba(102,255,102,0.04)', '--radius-base': '4px',
    },
    meta: { radius: 'subtle', density: 'default', shadow: 'glow', animation: 'smooth', borderWeight: 'hairline' },
  },
  {
    id: 48, name: 'terracotta', displayName: 'Terracotta', family: 'nature',
    description: 'Warm dark clay-brown surfaces, dusty orange accent.',
    tokens: {
      bg: '#0e0806', bgDeep: '#080504', surface: '#1a100c',
      surfaceCard: '#241814', surfaceHover: '#30221c',
      accentBlue: '#D2691E', accentBlueBg: 'rgba(210,105,30,0.1)',
      accentBlueSolid: '#B85418', accentBlueBorder: 'rgba(210,105,30,0.25)',
      textPrimary: '#F0DCC8', textSecondary: '#D0B898', textMuted: '#A08060',
      border: 'rgba(210,105,30,0.08)', '--radius-base': '6px',
    },
    meta: { radius: 'rounded', density: 'default', shadow: 'flat', animation: 'smooth', borderWeight: 'hairline' },
  },
  {
    id: 49, name: 'deep-sea', displayName: 'Deep Sea', family: 'nature',
    description: 'Absolute black-teal, dim cyan-green bioluminescent accents.',
    tokens: {
      bg: '#010606', bgDeep: '#000404', surface: '#021010',
      surfaceCard: '#041818', surfaceHover: '#062222',
      accentBlue: '#2DD4BF', accentBlueBg: 'rgba(45,212,191,0.06)',
      accentBlueSolid: '#14B8A6', accentBlueBorder: 'rgba(45,212,191,0.18)',
      border: 'rgba(45,212,191,0.05)',
      '--shadow-card': '0 0 12px rgba(45,212,191,0.03)', '--radius-base': '6px',
    },
    meta: { radius: 'rounded', density: 'default', shadow: 'glow', animation: 'slow', borderWeight: 'hairline' },
  },
];
