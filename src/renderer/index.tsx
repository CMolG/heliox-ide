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
import './index.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
