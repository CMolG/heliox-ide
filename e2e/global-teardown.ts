/**
 * e2e/global-teardown.ts — Playwright Global Teardown
 *
 * Removes the temporary userData directory created in global-setup.ts
 * to ensure no test artifacts persist after a run.
 */
import fs from 'fs';
import path from 'path';

export default async function globalTeardown() {
  const markerPath = path.join(__dirname, '.e2e-user-data-dir');
  const vitePidPath = path.join(__dirname, '.e2e-vite-pid');

  try {
    const tmpDir = fs.readFileSync(markerPath, 'utf-8').trim();
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  } catch {
    // Teardown is best-effort — don't fail the suite
  }

  try {
    fs.unlinkSync(markerPath);
  } catch {
    // Marker cleanup is best-effort
  }

  try {
    const pid = Number(fs.readFileSync(vitePidPath, 'utf-8').trim());
    if (Number.isFinite(pid) && pid > 0) {
      if (process.platform === 'win32') {
        process.kill(pid, 'SIGTERM');
      } else {
        process.kill(-pid, 'SIGTERM');
      }
    }
  } catch {
    // Dev-server cleanup is best-effort
  }

  try {
    fs.unlinkSync(vitePidPath);
  } catch {
    // Marker cleanup is best-effort
  }
}
