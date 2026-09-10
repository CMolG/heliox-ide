/**
 * index.tsx — Renderer Entrypoint
 *
 * Responsibility:
 * - Bootstraps the React root and mounts the renderer application tree.
 * - Defines the entry boundary between Electron preload APIs and React UI runtime.
 *
 * Boundaries:
 * - Owns: renderer bootstrap wiring and root mount lifecycle
 * - Does NOT own: feature-level UI behavior, domain state logic, or main-process window control
 *
 * Architectural role:
 * - Boundary/orchestration entry module for renderer startup.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Self-hosted display typeface for titles (variable weight). Loaded as a webfont so
// titles render crisply instead of falling back to a system font (the font tokens
// listed 'Atkinson Hyperlegible' with no @font-face, so titles silently fell back).
import '@fontsource-variable/doto';
// Self-hosted UI/body + code-editor typefaces (audit 1.3 — previously loaded from
// Google Fonts CDN in index.html: broke offline, leaked a request to Google from a
// local-first IDE, and caused a flash of unstyled text). Only families with a real
// `font-family` reference somewhere in src/renderer/ are bundled here; Manrope and
// Lexend tokens already resolve to Atkinson Hyperlegible/Inter (never rendered) and
// Permanent Marker / Space Mono have zero references, so none of those four ship.
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/space-grotesk';
// @cmolg/daba-engine's chrome CSS (adoption plan #20, javadaba-web Core):
// class rules for ContextMenu/Dock/HUD/etc, driven by --daba-* custom
// properties. Imported BEFORE index.css so this app's own :root override
// block in index.css (Fluxor's actual dark palette) wins by source order —
// the engine's tokens.css values are neutral light-mode defaults otherwise.
import '@cmolg/daba-engine/dist/theme/tokens.css';
import '@cmolg/daba-engine/dist/theme/engine.css';
import './index.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
