/**
 * monaco-config.test.ts — Worker-registration smoke test
 *
 * Strategy:
 * - monaco-config.ts self-hosts Monaco (loader.config) AND, as of this change,
 *   registers `self.MonacoEnvironment.getWorker` so Monaco's language workers
 *   run as real Web Workers instead of falling back to Monaco's slower
 *   main-thread language-service mode (the "Could not create web worker(s)"
 *   startup warning this fixes).
 * - Under vitest, the five `monaco-editor/esm/.../*.worker?worker` specifiers
 *   and the bare `monaco-editor` package are aliased to lightweight stubs
 *   (see vitest.config.ts + src/test-stubs/). Importing this module for its
 *   side effect is enough to verify `getWorker` is wired up and dispatches to
 *   a constructor per language label without needing a real Monaco instance.
 */
import { describe, expect, it } from 'vitest';
import './monaco-config';

describe('monaco-config — MonacoEnvironment', () => {
  it('registers a getWorker function', () => {
    expect(typeof self.MonacoEnvironment?.getWorker).toBe('function');
  });

  it('returns a worker instance for every known label without throwing', () => {
    const labels = ['json', 'css', 'scss', 'less', 'html', 'handlebars', 'razor', 'typescript', 'javascript', 'anything-else'];
    for (const label of labels) {
      const worker = self.MonacoEnvironment!.getWorker!('id', label);
      expect(worker).toBeTruthy();
    }
  });
});
