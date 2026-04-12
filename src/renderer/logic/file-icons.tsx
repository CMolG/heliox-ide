/**
 * file-icons.tsx — Renderer Icon Mapping Module
 *
 * Responsibility:
 * - Maps file metadata to visual icon components used across file-oriented surfaces.
 * - Provides reusable icon-selection logic for explorer and diff presentation layers.
 *
 * Boundaries:
 * - Owns: icon mapping rules and presentational icon helpers
 * - Does NOT own: filesystem discovery, tree state management, or file content loading
 *
 * Architectural role:
 * - Pure renderer logic/presentation module.
 */
// src/renderer/utils/file-icons.tsx — Shared file icon resolution
import React from 'react';
import { SiTypescript, SiJavascript, SiPython, SiGo, SiRust, SiCss, SiHtml5 } from 'react-icons/si';
import { VscJson, VscMarkdown, VscFile, VscFolder, VscFolderOpened } from 'react-icons/vsc';

export function getFileIcon(name: string, size = 13): React.ReactNode {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const style: React.CSSProperties = { flexShrink: 0 };
  switch (ext) {
    case 'ts': case 'tsx': return <SiTypescript size={size} color="#3178c6" style={style} />;
    case 'js': case 'jsx': return <SiJavascript size={size} color="#f7df1e" style={style} />;
    case 'json': return <VscJson size={size} color="#a1a1aa" style={style} />;
    case 'md': return <VscMarkdown size={size} color="#525252" style={style} />;
    case 'css': case 'scss': return <SiCss size={size} color="#60a5fa" style={style} />;
    case 'html': return <SiHtml5 size={size} color="#f97316" style={style} />;
    case 'py': return <SiPython size={size} color="#3776ab" style={style} />;
    case 'go': return <SiGo size={size} color="#00add8" style={style} />;
    case 'rs': return <SiRust size={size} color="#dea584" style={style} />;
    default: return <VscFile size={size} color="#525252" style={style} />;
  }
}

export function getFolderIcon(isOpen: boolean, size = 13): React.ReactNode {
  return isOpen
    ? <VscFolderOpened size={size} color="#d6d3d1" style={{ flexShrink: 0 }} />
    : <VscFolder size={size} color="#d6d3d1" style={{ flexShrink: 0 }} />;
}
