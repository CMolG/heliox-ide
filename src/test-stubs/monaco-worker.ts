/**
 * Test-only stand-in for Vite's `?worker` bundling of Monaco's language
 * workers — see vitest.config.ts's resolve.alias, which routes each
 * `monaco-editor/esm/.../*.worker?worker` specifier imported by
 * monaco-config.ts to this file under vitest.
 *
 * Vite's `?worker` suffix normally returns a Worker *constructor* (not the
 * module's real exports), so the stand-in must do the same: a class whose
 * instances look enough like a real `Worker` for `MonacoEnvironment.getWorker`
 * callers to construct one without crashing. No test in this suite spins up a
 * real Monaco editor or exercises worker message-passing, so the no-op
 * `postMessage`/`terminate` pair is sufficient.
 */
export default class MonacoWorkerStub {
  postMessage() {}
  terminate() {}
}
