/**
 * Test-only stand-in for the real `monaco-editor` npm package — see
 * vitest.config.ts's resolve.alias, which routes every `import ... from
 * 'monaco-editor'` to this file ONLY under vitest (the real renderer bundle
 * resolves the actual package normally; this alias never reaches it).
 *
 * Two independent problems make the real package untestable under vitest:
 *   1. It ships only a browser "module" package.json field (no "main"/
 *      "exports"), which vitest's resolution cannot locate an entry point
 *      for at all.
 *   2. Even if resolved, it runs real browser feature-detection at import
 *      time (e.g. `document.queryCommandSupported`) that jsdom doesn't
 *      implement, crashing on load.
 *
 * No test in this suite mounts a real Monaco editor — components that
 * reference it (CodeEditor.tsx, DiffViewerApp.tsx, monaco-config.ts) are only
 * ever imported transitively — so an empty object is a sufficient stand-in
 * for monaco-config.ts's `loader.config({ monaco })` self-hosting call.
 */
export default {};
