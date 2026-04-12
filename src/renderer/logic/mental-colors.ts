/**
 * mental-colors.ts — Renderer mental canvas color helpers
 */

const HEX_COLOR_RE = /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeHexPair = (pair: string) => pair.padEnd(2, pair[0]).slice(0, 2);

export function normalizeHexColor(color: string): string {
  const raw = color.trim();
  if (!HEX_COLOR_RE.test(raw)) return '#EDE9FE';
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (hex.length === 3) {
    const [r, g, b] = hex;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return `#${hex}`.toUpperCase();
}

function hexToRgb(color: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(color).slice(1);
  return {
    r: Number.parseInt(normalizeHexPair(normalized.slice(0, 2)), 16),
    g: Number.parseInt(normalizeHexPair(normalized.slice(2, 4)), 16),
    b: Number.parseInt(normalizeHexPair(normalized.slice(4, 6)), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (channel: number) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const { r, g, b } = hexToRgb(color);
  const rLin = srgbToLinear(r);
  const gLin = srgbToLinear(g);
  const bLin = srgbToLinear(b);
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

function contrastRatio(l1: number, l2: number): number {
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

function rgbToHsl(color: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(color);
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;

  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const delta = max - min;
  const lightness = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness * 100 };
  }

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;

  if (max === rN) hue = ((gN - bN) / delta) % 6;
  else if (max === gN) hue = (bN - rN) / delta + 2;
  else hue = (rN - gN) / delta + 4;

  return {
    h: (hue * 60 + 360) % 360,
    s: saturation * 100,
    l: lightness * 100,
  };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;

  if (sat === 0) {
    const gray = Math.round(light * 255);
    return { r: gray, g: gray, b: gray };
  }

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = light - c / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (hue < 60) {
    rPrime = c;
    gPrime = x;
  } else if (hue < 120) {
    rPrime = x;
    gPrime = c;
  } else if (hue < 180) {
    gPrime = c;
    bPrime = x;
  } else if (hue < 240) {
    gPrime = x;
    bPrime = c;
  } else if (hue < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

export function getMentalTextContrastColor(backgroundColor: string): '#000000' | '#FFFFFF' {
  const backgroundLuminance = relativeLuminance(backgroundColor);
  const blackContrast = contrastRatio(backgroundLuminance, 0);
  const whiteContrast = contrastRatio(backgroundLuminance, 1);
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF';
}

export function getHueFromHex(color: string): number {
  return Math.round(rgbToHsl(color).h);
}

export function mentalHueToHex(hue: number): string {
  const pastelSaturation = 72;
  const pastelLightness = 76;
  const { r, g, b } = hslToRgb(hue, pastelSaturation, pastelLightness);
  return rgbToHex(r, g, b);
}
