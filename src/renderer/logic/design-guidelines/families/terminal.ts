/**
 * terminal.ts — Design Guidelines: Terminal Family (10–19)
 * Phosphor & retro CRT aesthetics. Classic computing nostalgia.
 */
import type { DesignGuideline } from '../types';

export const terminalFamily: DesignGuideline[] = [
  {
    id: 10, name: 'phosphor', displayName: 'Phosphor', family: 'terminal',
    description: 'Classic green phosphor on near-black. P1 screen feel.',
    tokens: {
      bg: '#030a03', bgDeep: '#010601', surface: '#071007',
      surfaceCard: '#0d180d', surfaceHover: '#142214',
      accentBlue: '#33FF33', accentBlueBg: 'rgba(51,255,51,0.08)',
      accentBlueSolid: '#22CC22', accentBlueBorder: 'rgba(51,255,51,0.2)',
      textPrimary: '#8FFF8F', textSecondary: '#66EE66', textMuted: '#3AB83A',
      success: '#33FF33', border: 'rgba(51,255,51,0.1)',
      '--radius-base': '0px', '--shadow-card': '0 0 8px rgba(51,255,51,0.05)',
    },
    meta: { radius: 'none', density: 'compact', shadow: 'glow', animation: 'instant', borderWeight: 'hairline' },
  },
  {
    id: 11, name: 'amber', displayName: 'Amber', family: 'terminal',
    description: 'Orange-amber phosphor. VT100 warm display.',
    tokens: {
      bg: '#090600', bgDeep: '#050400', surface: '#110c00',
      surfaceCard: '#1a1200', surfaceHover: '#241900',
      accentBlue: '#FFB300', accentBlueBg: 'rgba(255,179,0,0.1)',
      accentBlueSolid: '#CC8F00', accentBlueBorder: 'rgba(255,179,0,0.25)',
      textPrimary: '#FFCC44', textSecondary: '#E6AA22', textMuted: '#B87800',
      success: '#FFB300', border: 'rgba(255,179,0,0.1)',
      '--radius-base': '0px',
    },
    meta: { radius: 'none', density: 'compact', shadow: 'glow', animation: 'instant', borderWeight: 'hairline' },
  },
  {
    id: 12, name: 'vt220', displayName: 'VT220', family: 'terminal',
    description: 'Cream-grey text on a dark warm grey. Classic serial terminal.',
    tokens: {
      bg: '#0d0c0a', bgDeep: '#080706', surface: '#14120f',
      surfaceCard: '#1c1a16', surfaceHover: '#24221e',
      accentBlue: '#D4C9A8', accentBlueBg: 'rgba(212,201,168,0.1)',
      accentBlueSolid: '#B8A880', accentBlueBorder: 'rgba(212,201,168,0.2)',
      textPrimary: '#E8DEC8', textSecondary: '#C8BEA0', textMuted: '#908668',
      border: 'rgba(212,201,168,0.08)', '--radius-base': '0px',
    },
    meta: { radius: 'none', density: 'compact', shadow: 'none', animation: 'instant', borderWeight: 'hairline' },
  },
  {
    id: 13, name: 'c64', displayName: 'C64', family: 'terminal',
    description: 'Cornflower blue background, light blue text. Commodore heritage.',
    tokens: {
      bg: '#3434B8', bgDeep: '#2828A0', surface: '#3E3EC2',
      surfaceCard: '#4848CC', surfaceHover: '#5252D6',
      accentBlue: '#9898FF', accentBlueBg: 'rgba(152,152,255,0.15)',
      textPrimary: '#9898FF', textSecondary: '#7878DD', textMuted: '#5858BB',
      border: 'rgba(152,152,255,0.2)',
      '--radius-base': '0px', fontGrotesk: "'Liberation Mono', monospace",
    },
    meta: { radius: 'none', density: 'default', shadow: 'none', animation: 'instant', borderWeight: 'visible' },
  },
  {
    id: 14, name: 'ibm3270', displayName: 'IBM 3270', family: 'terminal',
    description: 'Dark green-teal on near-black. Mainframe glass-TTY.',
    tokens: {
      bg: '#010805', bgDeep: '#000503', surface: '#021008',
      surfaceCard: '#041a0e', surfaceHover: '#062414',
      accentBlue: '#00CC88', accentBlueBg: 'rgba(0,204,136,0.08)',
      accentBlueSolid: '#009966', accentBlueBorder: 'rgba(0,204,136,0.2)',
      textPrimary: '#66FFCC', textSecondary: '#44DDAA', textMuted: '#228866',
      border: 'rgba(0,204,136,0.08)', '--radius-base': '0px',
    },
    meta: { radius: 'none', density: 'compact', shadow: 'glow', animation: 'instant', borderWeight: 'hairline' },
  },
  {
    id: 15, name: 'cpm', displayName: 'CP/M', family: 'terminal',
    description: 'White-on-black. Monospace-only. No rounded corners. Zero decoration.',
    tokens: {
      bg: '#000000', bgDeep: '#000000', surface: '#0a0a0a',
      surfaceCard: '#111111', surfaceHover: '#1a1a1a',
      textPrimary: '#FFFFFF', textSecondary: '#CCCCCC', textMuted: '#888888',
      accentBlue: '#FFFFFF', accentBlueBg: 'rgba(255,255,255,0.08)',
      accentBlueSolid: '#CCCCCC', border: 'rgba(255,255,255,0.1)',
      '--radius-base': '0px', '--shadow-card': 'none',
      fontGrotesk: "'Liberation Mono', monospace",
    },
    meta: { radius: 'none', density: 'compact', shadow: 'none', animation: 'instant', borderWeight: 'hairline' },
  },
  {
    id: 16, name: 'bbs', displayName: 'BBS', family: 'terminal',
    description: 'Deep blue surfaces, bright ANSI palette accents. Bulletin board energy.',
    tokens: {
      bg: '#00002a', bgDeep: '#000020', surface: '#000038',
      surfaceCard: '#000048', surfaceHover: '#000060',
      accentBlue: '#55FFFF', accentBlueBg: 'rgba(85,255,255,0.1)',
      accentBlueSolid: '#00CCCC', accentBlueBorder: 'rgba(85,255,255,0.25)',
      textPrimary: '#AAAAAA', textSecondary: '#888888',
      success: '#55FF55', danger: '#FF5555', warning: '#FFFF55',
      border: 'rgba(85,85,255,0.15)', '--radius-base': '0px',
    },
    meta: { radius: 'none', density: 'compact', shadow: 'none', animation: 'instant', borderWeight: 'visible' },
  },
  {
    id: 17, name: 'eightbit', displayName: '8-Bit', family: 'terminal',
    description: 'Hard pixel edges. Limited flat palette. No gradients, no blur.',
    tokens: {
      bg: '#1a1a2e', bgDeep: '#111122', surface: '#222244',
      surfaceCard: '#2a2a55', surfaceHover: '#333366',
      accentBlue: '#E94560', accentBlueBg: 'rgba(233,69,96,0.12)',
      accentBlueSolid: '#C03050', accentBlueBorder: 'rgba(233,69,96,0.3)',
      textPrimary: '#EAEAEA', border: 'rgba(233,69,96,0.12)',
      '--radius-base': '0px', '--shadow-card': 'none',
    },
    meta: { radius: 'none', density: 'compact', shadow: 'none', animation: 'instant', borderWeight: 'visible' },
  },
  {
    id: 18, name: 'teletype', displayName: 'Teletype', family: 'terminal',
    description: 'Warm off-white on near-black. Mechanical typewriter inspiration.',
    tokens: {
      bg: '#0c0a08', bgDeep: '#070605', surface: '#141110',
      surfaceCard: '#1c1916', surfaceHover: '#24201c',
      accentBlue: '#D4C9B0', accentBlueBg: 'rgba(212,201,176,0.08)',
      accentBlueSolid: '#A89878', accentBlueBorder: 'rgba(212,201,176,0.2)',
      textPrimary: '#F0E8D8', textSecondary: '#C8BEA8', textMuted: '#887860',
      border: 'rgba(212,201,176,0.08)', '--radius-base': '0px',
    },
    meta: { radius: 'none', density: 'default', shadow: 'none', animation: 'instant', borderWeight: 'hairline' },
  },
  {
    id: 19, name: 'dithered', displayName: 'Dithered', family: 'terminal',
    description: 'Monochrome only. Opacity patterns simulate depth. No color whatsoever.',
    tokens: {
      bg: '#0a0a0a', bgDeep: '#050505', surface: '#141414',
      surfaceCard: '#1c1c1c', surfaceHover: '#262626',
      textPrimary: '#C8C8C8', textSecondary: '#A0A0A0', textMuted: '#686868',
      accentBlue: '#B0B0B0', accentBlueBg: 'rgba(176,176,176,0.08)',
      accentBlueSolid: '#888888', accentBlueBorder: 'rgba(176,176,176,0.2)',
      border: 'rgba(255,255,255,0.08)', '--radius-base': '0px', '--shadow-card': 'none',
    },
    meta: { radius: 'none', density: 'compact', shadow: 'none', animation: 'instant', borderWeight: 'hairline' },
  },
];
