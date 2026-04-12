/**
 * sounds.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/renderer/logic/sounds.ts — Melodic notification sounds via Web Audio API

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/**
 * Plays a short ascending major arpeggio chime (C5 → E5 → G5 → C6)
 * with soft sine tones and gentle decay — signals agent success.
 */
export function playAgentCompleteSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    // C5, E5, G5, C6 — a bright ascending major chord
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const noteDuration = 0.14;
    const noteGap = 0.1;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.18, now);
    masterGain.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const start = now + i * (noteDuration + noteGap);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.6, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, start + noteDuration + 0.2);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(start);
      osc.stop(start + noteDuration + 0.3);
    });

    // Gentle reverb shimmer on the last note
    const shimmerStart = now + (notes.length - 1) * (noteDuration + noteGap);
    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(notes[notes.length - 1] * 2, shimmerStart);
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.setValueAtTime(0, shimmerStart);
    shimmerGain.gain.linearRampToValueAtTime(0.08, shimmerStart + 0.05);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, shimmerStart + 0.8);
    shimmer.connect(shimmerGain);
    shimmerGain.connect(masterGain);
    shimmer.start(shimmerStart);
    shimmer.stop(shimmerStart + 0.9);
  } catch {
    // Silently fail — sound is non-critical
  }
}

/**
 * Plays a short descending two-tone to signal agent failure.
 */
export function playAgentErrorSound(): void {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const notes = [440, 330]; // A4 → E4 descending
    const noteDuration = 0.18;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.14, now);
    masterGain.connect(ctx.destination);

    notes.forEach((freq, i) => {
      const start = now + i * noteDuration;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.5, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, start + noteDuration + 0.15);

      osc.connect(gain);
      gain.connect(masterGain);
      osc.start(start);
      osc.stop(start + noteDuration + 0.2);
    });
  } catch {
    // Silently fail
  }
}
