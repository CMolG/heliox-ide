/**
 * ActionsPanel.tsx — Renderer Composite Component
 *
 * Responsibility:
 * - Renders the ActionsPanel surface in the renderer layer.
 * - Encapsulates Feature-level composition used by the renderer shell and panels.
 *
 * Boundaries:
 * - Owns: component-level rendering, styling, and local interaction wiring
 * - Does NOT own: cross-feature domain policy, persistence, IPC transport, or main-process orchestration
 *
 * Architectural role:
 * - UI boundary module in the renderer process (presentation + local interaction).
 */
// src/renderer/components/ActionsPanel.tsx — Predefined orchestration actions
import React, { useState, useCallback } from 'react';
import { VscSearch, VscShield, VscBeaker } from 'react-icons/vsc';
import { FiZap, FiLayers, FiLink, FiShield } from 'react-icons/fi';
import { MdAccessibility } from 'react-icons/md';
import { useHelioxStore } from '../store';
import { theme } from '../logic/theme';

const ACTION_ICONS: Record<string, React.ReactNode> = {
  'seo-audit':          <VscSearch size={18} color={theme.textMuted} />,
  'security-audit':     <VscShield size={18} color={theme.textMuted} />,
  'perf-audit':         <FiZap size={18} color={theme.textMuted} />,
  'test-coverage':      <VscBeaker size={18} color={theme.textMuted} />,
  'accessibility':      <MdAccessibility size={18} color={theme.textMuted} />,
  'refactor-complexity':<FiLayers size={18} color={theme.textMuted} />,
  'api-consistency':    <FiLink size={18} color={theme.textMuted} />,
  'error-resilience':   <FiShield size={18} color={theme.textMuted} />,
};

interface Action {
  id: string;
  name: string;
  description: string;
  prompt: string;
  category: string;
}

const PREDEFINED_ACTIONS: Action[] = [
  {
    id: 'seo-audit',
    name: 'SEO Analyzer',
    description: 'Analyze the entire codebase for SEO improvements',
    category: 'Quality',
    prompt: `Analyze the entire codebase and identify all SEO improvement opportunities. For each file that contains HTML, React components with JSX, or server-rendered content:

1. Check for missing or incorrect meta tags (title, description, og:*, twitter:*)
2. Identify missing semantic HTML elements (h1, h2, nav, main, article, aside, footer)
3. Find images without alt attributes
4. Detect missing or incorrect canonical URLs
5. Check for missing structured data (JSON-LD schema markup)
6. Identify slow-loading resources that hurt Core Web Vitals
7. Check for missing robots.txt, sitemap.xml handling
8. Find non-descriptive link text ("click here", "read more")
9. Identify missing or incorrect hreflang for multi-language sites
10. Check for duplicate content issues

For each issue found: provide the exact file path, line number, current code, and the corrected version. Prioritize by SEO impact (Critical > High > Medium > Low). Output a structured report with all findings and fixes.`,
  },
  {
    id: 'security-audit',
    name: 'Security Audit',
    description: 'Full security vulnerability scan of the codebase',
    category: 'Quality',
    prompt: `Perform a comprehensive security audit of this codebase. Systematically scan every file for:

1. **Secrets & Credentials**: Hardcoded API keys, passwords, tokens, private keys in code or config files
2. **Injection Vulnerabilities**: SQL injection, command injection, LDAP injection, XPath injection
3. **XSS**: Unescaped user input in HTML, dangerouslySetInnerHTML, eval(), innerHTML
4. **Authentication Issues**: Weak JWT handling, missing auth checks, insecure session management
5. **Insecure Dependencies**: Check package.json for known vulnerable packages (CVEs)
6. **Sensitive Data Exposure**: Logging sensitive data, insecure storage, unencrypted transmission
7. **CSRF**: Missing CSRF tokens on state-changing operations
8. **Path Traversal**: Unsanitized file paths from user input
9. **Rate Limiting**: Missing rate limits on sensitive endpoints
10. **Insecure Direct Object References**: Unvalidated user-supplied IDs

For each finding: file path, line number, severity (Critical/High/Medium/Low), CWE reference, and specific remediation code. Fix all Critical and High severity issues immediately.`,
  },
  {
    id: 'perf-audit',
    name: 'Performance Optimizer',
    description: 'Identify and fix performance bottlenecks',
    category: 'Quality',
    prompt: `Analyze the entire codebase for performance issues and optimize them. Focus on:

1. **React Performance**: Unnecessary re-renders, missing React.memo/useMemo/useCallback, large component trees
2. **Bundle Size**: Heavy imports that could be tree-shaken, duplicate dependencies, missing code splitting
3. **Data Fetching**: N+1 queries, missing caching, waterfall requests, over-fetching
4. **Memory Leaks**: Event listeners not cleaned up, intervals/timeouts not cleared, large closures
5. **Rendering Bottlenecks**: Expensive computations in render, missing virtualization for large lists
6. **Image Optimization**: Missing lazy loading, unoptimized formats, missing srcset
7. **Algorithm Complexity**: O(n²) operations that could be O(n), linear scans that should use Maps/Sets
8. **Async/Await Patterns**: Sequential awaits that should be parallel (Promise.all), missing error handling
9. **CSS Performance**: Layout thrashing, expensive selectors, missing will-change hints

For each issue: provide the file, current code, optimized version, and expected performance improvement. Implement fixes for the highest-impact bottlenecks.`,
  },
  {
    id: 'test-coverage',
    name: 'Test Coverage Expander',
    description: 'Generate comprehensive tests for uncovered code paths',
    category: 'Quality',
    prompt: `Analyze the codebase and identify all code paths that lack test coverage. For each uncovered area:

1. Identify functions, components, and modules with zero or insufficient tests
2. Find untested edge cases in existing tested code
3. Detect missing error path tests
4. Identify missing integration tests for critical user flows
5. Find untested async behavior and race conditions

Then write comprehensive tests for all identified gaps:
- Unit tests for pure functions and utilities
- Component tests for React components
- Integration tests for service/API interactions
- E2E test stubs for critical user flows

Use the existing test framework and patterns in the codebase. Each test must:
- Have a descriptive name explaining what it tests
- Use arrange-act-assert pattern
- Cover the happy path, edge cases, and error paths
- Mock external dependencies appropriately`,
  },
  {
    id: 'accessibility',
    name: 'Accessibility Audit',
    description: 'Fix WCAG 2.1 accessibility violations',
    category: 'Quality',
    prompt: `Perform a complete WCAG 2.1 Level AA accessibility audit of this codebase. Check every component and page for:

1. **Perceivable**:
   - All images have meaningful alt text
   - Color is not the only visual means of conveying information
   - Text has sufficient contrast ratio (4.5:1 normal, 3:1 large)
   - Captions for video/audio content

2. **Operable**:
   - All functionality accessible via keyboard
   - No keyboard traps
   - Skip navigation links present
   - Focus indicators visible on all interactive elements
   - No seizure-inducing flashing content

3. **Understandable**:
   - Forms have proper labels and error messages
   - Language of page declared
   - Consistent navigation and naming
   - Error suggestions provided

4. **Robust**:
   - Valid HTML structure
   - ARIA roles, properties, states used correctly
   - Interactive elements have accessible names
   - Status messages programmatically determined

Fix every violation found. Add ARIA attributes, fix HTML semantics, improve focus management, and add keyboard handlers. Provide before/after code for each fix.`,
  },
  {
    id: 'refactor-complexity',
    name: 'Complexity Reducer',
    description: 'Refactor complex functions and reduce cognitive load',
    category: 'Architecture',
    prompt: `Analyze the entire codebase for high-complexity code and refactor it. Target:

1. **Cyclomatic Complexity**: Functions with more than 10 branches (if/else/switch/loops)
2. **Long Functions**: Functions exceeding 50 lines that should be decomposed
3. **Deep Nesting**: More than 3 levels of nesting (extract to named functions)
4. **God Components/Classes**: Components doing too many things (split by responsibility)
5. **Duplicate Logic**: Identical or near-identical code blocks (extract to shared utilities)
6. **Complex Conditionals**: Hard-to-read boolean logic (extract to named predicates)
7. **Magic Numbers/Strings**: Replace with named constants
8. **Implicit Coupling**: Components/modules that depend on implementation details of others

For each refactor:
- Show the current complex code
- Explain why it's a problem
- Show the refactored version
- Confirm the behavior is preserved (suggest tests if they don't exist)

Apply refactors that reduce complexity without changing behavior. Commit each logical group separately.`,
  },
  {
    id: 'api-consistency',
    name: 'API Consistency Checker',
    description: 'Enforce consistent API design across the codebase',
    category: 'Architecture',
    prompt: `Audit the entire codebase for API design consistency. Analyze all:

1. **REST API endpoints**: Naming conventions (kebab-case vs camelCase), HTTP method usage, response shapes
2. **Function signatures**: Inconsistent parameter ordering, mixed callback/promise patterns, inconsistent return types
3. **Error handling**: Mixed error formats (strings vs objects vs Error instances), inconsistent error codes
4. **Data models**: Same concept named differently in different parts (user vs account, id vs userId)
5. **Event naming**: Inconsistent event name formats across different modules
6. **Configuration keys**: Mixed naming conventions in config objects
7. **TypeScript interfaces**: Similar interfaces that should be unified or properly extended

Create a standardization plan:
1. Document the inconsistencies found
2. Propose a canonical pattern for each inconsistency
3. Implement the migrations to enforce consistency
4. Add TypeScript types/interfaces to prevent future regressions`,
  },
  {
    id: 'error-resilience',
    name: 'Error Resilience Builder',
    description: 'Add structured error handling and graceful degradation',
    category: 'Architecture',
    prompt: `Analyze the codebase and add comprehensive error resilience everywhere it's missing. For each module:

1. **Missing try/catch**: Identify async operations, JSON.parse, file I/O, API calls without error handling
2. **Silent failures**: console.error without recovery, empty catch blocks that swallow errors
3. **Missing fallback states**: UI components that crash instead of showing error states
4. **Unhandled promise rejections**: .then() chains without .catch(), unawaited promises
5. **Missing boundary conditions**: Array access without bounds check, undefined property access
6. **Resource cleanup**: Missing finally blocks for resource cleanup (connections, timers, subscriptions)
7. **Partial failure handling**: Multi-step operations that don't handle partial success/failure

For each finding:
- Add structured error handling with specific error types
- Implement graceful degradation (show cached data, fallback UI, retry logic)
- Add proper error logging with context (not just the error, but what was being attempted)
- Ensure errors bubble up appropriately (don't swallow errors that should propagate)
- Add user-facing error messages where appropriate`,
  },
];

const CATEGORIES = Array.from(new Set(PREDEFINED_ACTIONS.map(a => a.category)));

export function ActionsPanel() {
  const { addSession, setSelectedSessionId, setActiveTab, addToast, addSessionMessage, updateSessionDescription } = useHelioxStore();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const visibleActions = selectedCategory
    ? PREDEFINED_ACTIONS.filter(a => a.category === selectedCategory)
    : PREDEFINED_ACTIONS;

  const handleRunAction = useCallback((action: Action) => {
    const sessionId = addSession();
    setSelectedSessionId(sessionId);
    setActiveTab('sessions');
    // Inject the action prompt into the new session
    setTimeout(() => {
      addSessionMessage(sessionId, {
        id: `action-${Date.now()}`,
        role: 'user',
        content: action.prompt,
        timestamp: Date.now(),
      });
      updateSessionDescription(sessionId, action.name);
      // Trigger the send via custom event
      window.dispatchEvent(new CustomEvent('heliox:run-action', { detail: { sessionId, prompt: action.prompt } }));
      window.dispatchEvent(new CustomEvent('heliox:focus-chat'));
    }, 100);
    addToast(`Running: ${action.name}`, 'info');
  }, [addSession, setSelectedSessionId, setActiveTab, addToast, addSessionMessage, updateSessionDescription]);

  return (
    <div className="flex flex-col overflow-hidden h-full" style={{ background: theme.bgApp }}>
      {/* Header */}
      <div
        className="h-16 px-8 flex items-center justify-between shrink-0"
        style={{ borderBottom: '1px solid rgba(63,63,70,0.1)' }}
      >
        <span className="text-sm font-medium leading-5" style={{ fontFamily: theme.fontGrotesk, color: theme.textSecondary }}>
          ACTIONS
        </span>
        <div className="flex items-center gap-1" role="group" aria-label="Filter by category">
          {[null, ...CATEGORIES].map(cat => (
            <button
              key={cat ?? 'all'}
              onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
              className="px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider transition"
              aria-pressed={selectedCategory === cat}
              style={{
                fontFamily: theme.fontInter,
                background: selectedCategory === cat ? 'rgba(214,211,209,0.15)' : 'transparent',
                color: selectedCategory === cat ? theme.textSecondary : theme.textDim,
              }}
            >
              {cat ?? 'All'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-3">
        <p className="text-[11px] leading-5" style={{ fontFamily: theme.fontManrope, color: theme.textDim }}>
          Predefined orchestration prompts — each action runs a systematic analysis or refactor on your codebase. Select an action to launch it as a new agent session.
        </p>

        <div className="grid grid-cols-1 gap-3 mt-2">
          {visibleActions.map(action => (
            <button
              key={action.id}
              onClick={() => handleRunAction(action)}
              className="text-left p-4 rounded-[20px] transition-all group hover:brightness-110"
              aria-label={`${action.name}: ${action.description}`}
              style={{
                background: theme.surfaceMid,
                outline: '1px solid rgba(63,63,70,0.08)',
                outlineOffset: '-1px',
              }}
            >
              <div className="flex items-start gap-3">
                <span className="shrink-0 mt-0.5 flex items-center justify-center w-5 h-5">{ACTION_ICONS[action.id]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium leading-5" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>
                      {action.name}
                    </span>
                    <span
                      className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded shrink-0"
                      style={{ fontFamily: theme.fontInter, color: theme.textFaint, background: theme.border }}
                    >
                      {action.category}
                    </span>
                  </div>
                  <span className="text-xs font-normal leading-4 block" style={{ fontFamily: theme.fontManrope, color: theme.textMuted }}>
                    {action.description}
                  </span>
                </div>
                <div
                  className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: 'rgba(214,211,209,0.1)' }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M1 5h8M6 1l4 4-4 4" stroke={theme.textSecondary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Bottom stats */}
      <div
        className="h-16 px-8 flex items-center gap-8 shrink-0"
        style={{ background: 'rgba(23,23,23,0.5)', borderTop: '1px solid rgba(63,63,70,0.1)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Actions</span>
          <span className="text-sm font-bold" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>{PREDEFINED_ACTIONS.length}</span>
        </div>
        <div className="w-px h-5" style={{ background: 'rgba(63,63,70,0.2)' }} />
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-normal uppercase tracking-wide" style={{ fontFamily: theme.fontInter, color: theme.textFaint }}>Categories</span>
          <span className="text-sm font-bold" style={{ fontFamily: theme.fontGrotesk, color: theme.textPrimary }}>{CATEGORIES.length}</span>
        </div>
      </div>
    </div>
  );
}
