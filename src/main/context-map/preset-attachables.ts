import type { AttachablePreset } from '../../types/context-map';

export const PRESET_ATTACHABLES: AttachablePreset[] = [
  {
    name: 'No Comments Rule',
    type: 'constraint',
    body: 'Never add inline comments to code unless the logic is non-obvious.',
    injectMode: 'system',
    priority: 'normal',
  },
  {
    name: 'No Emojis',
    type: 'constraint',
    body: 'Never use emojis in any output — code, messages, or commit messages.',
    injectMode: 'system',
    priority: 'normal',
  },
  {
    name: 'Minimal Changes',
    type: 'instruction',
    body: 'Make the smallest change that satisfies the request. Do not refactor surrounding code.',
    injectMode: 'prefix',
    priority: 'high',
  },
  {
    name: 'Commit Message Format',
    type: 'instruction',
    body: 'Commit messages must follow: `type: description` (e.g. `feat:`, `fix:`, `refactor:`).',
    injectMode: 'suffix',
    priority: 'normal',
  },
  {
    name: 'Verify Before Edit',
    type: 'checklist',
    body: 'Before editing a file: read it, understand the current state, then make targeted changes.',
    injectMode: 'prefix',
    priority: 'high',
  },
];
