/**
 * file-patcher.ts — Main process
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/main/file-patcher.ts — Applies unified diff patches to the filesystem
import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, resolve, isAbsolute } from 'path';
import { EventEmitter } from 'events';
import { errMsg } from '../types';

interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
}

/**
 * Applies unified diff patches from AI adapters to the filesystem.
 * Emits 'applied' on success and 'failed' on error for each file.
 */
export class FilePatcher extends EventEmitter {

  async applyPatch(filePath: string, patch: string, cwd: string): Promise<boolean> {
    const absPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);

    try {
      const hunks = this.parseUnifiedDiff(patch);
      if (hunks.length === 0) {
        this.emit('failed', { path: absPath, error: 'No valid hunks found in patch' });
        return false;
      }

      // Read existing file or start with empty for new files
      let originalLines: string[];
      try {
        const content = await readFile(absPath, 'utf-8');
        originalLines = content.split('\n');
      } catch {
        // File doesn't exist — likely a new file creation
        await mkdir(dirname(absPath), { recursive: true });
        originalLines = [];
      }

      const result = this.applyHunks(originalLines, hunks);
      await writeFile(absPath, result.join('\n'), 'utf-8');

      this.emit('applied', { path: absPath, hunks: hunks.length });
      return true;
    } catch (err) {
      this.emit('failed', { path: absPath, error: errMsg(err) });
      return false;
    }
  }

  private parseUnifiedDiff(patch: string): PatchHunk[] {
    const lines = patch.split('\n');
    const hunks: PatchHunk[] = [];
    let current: PatchHunk | null = null;

    for (const line of lines) {
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
      if (hunkMatch) {
        if (current) hunks.push(current);
        current = {
          oldStart: parseInt(hunkMatch[1], 10),
          oldCount: parseInt(hunkMatch[2] ?? '1', 10),
          newStart: parseInt(hunkMatch[3], 10),
          newCount: parseInt(hunkMatch[4] ?? '1', 10),
          lines: [],
        };
        continue;
      }

      // Skip diff headers
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ')) continue;

      if (current && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ') || line === '')) {
        current.lines.push(line);
      }
    }
    if (current) hunks.push(current);
    return hunks;
  }

  private applyHunks(originalLines: string[], hunks: PatchHunk[]): string[] {
    const result = [...originalLines];
    // Apply hunks in reverse order to preserve line numbers
    const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

    for (const hunk of sortedHunks) {
      const startIdx = hunk.oldStart - 1; // Convert to 0-indexed
      const newLines: string[] = [];

      for (const line of hunk.lines) {
        if (line.startsWith('+')) {
          newLines.push(line.slice(1));
        } else if (line.startsWith('-')) {
          // Skip removed lines (handled by splice)
        } else {
          // Context line (starts with ' ' or is empty)
          newLines.push(line.startsWith(' ') ? line.slice(1) : line);
        }
      }

      result.splice(startIdx, hunk.oldCount, ...newLines);
    }

    return result;
  }
}
