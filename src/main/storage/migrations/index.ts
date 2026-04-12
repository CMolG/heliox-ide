/**
 * Migration Changelog Registry
 *
 * Responsibility:
 * - Static barrel import of all JSON changelog files
 * - Ensures changelogs are bundled by Vite (no runtime filesystem reads needed)
 *
 * Boundaries:
 * - Owns: changeset registration and ordering
 * - Does NOT own: migration execution (see migration-runner.ts)
 *
 * When adding a new migration:
 * 1. Create NNN-description.json in this directory
 * 2. Import it below and add to the CHANGESETS array
 * 3. Run the app — migrations apply automatically on startup
 */
import type { Changeset } from '../migration-runner';
import { computeChecksum } from '../migration-runner';

import changelog001 from './001-create-sessions.json';
import changelog002 from './002-create-messages.json';
import changelog003 from './003-create-diff-history.json';
import changelog004 from './004-create-prompt-versions.json';

// Validate and attach computed checksums at import time
function prepareChangeset(raw: Changeset): Changeset {
  const checksum = computeChecksum(raw);
  if (raw.checksum && raw.checksum !== '' && raw.checksum !== checksum) {
    throw new Error(
      `[migrations] Checksum mismatch in "${raw.id}": ` +
      `file=${raw.checksum}, computed=${checksum}`
    );
  }
  return { ...raw, checksum };
}

/**
 * All changelog entries in version order.
 * The migration runner processes these sequentially.
 */
export const CHANGESETS: Changeset[] = [
  prepareChangeset(changelog001 as unknown as Changeset),
  prepareChangeset(changelog002 as unknown as Changeset),
  prepareChangeset(changelog003 as unknown as Changeset),
  prepareChangeset(changelog004 as unknown as Changeset),
];
