import { describe, expect, it } from 'vitest';
import { getMentalTextContrastColor, getHueFromHex, mentalHueToHex, normalizeHexColor } from './mental-colors';

describe('mental color helpers', () => {
  it('normalizes supported hex forms and falls back for invalid values', () => {
    expect(normalizeHexColor('#abc')).toBe('#AABBCC');
    expect(normalizeHexColor('f0a1bc')).toBe('#F0A1BC');
    expect(normalizeHexColor('not-a-color')).toBe('#EDE9FE');
  });

  it('picks black or white by maximum grayscale contrast ratio', () => {
    expect(getMentalTextContrastColor('#FFFFFF')).toBe('#000000');
    expect(getMentalTextContrastColor('#0F172A')).toBe('#FFFFFF');
    expect(getMentalTextContrastColor('#A78BFA')).toBe('#000000');
  });

  it('converts between hue and hex for picker integration', () => {
    const hex = mentalHueToHex(220);
    expect(hex).toMatch(/^#[0-9A-F]{6}$/);
    const hue = getHueFromHex(hex);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThanOrEqual(360);
  });
});
