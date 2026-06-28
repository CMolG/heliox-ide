import type { AgenticFlow, AgenticMod, AgenticRole, AgenticStep } from '../../../types/harness';
import { ConfidentExecutor } from '../../market/code-roles';
import { AntiVerificationInterceptor } from '../../market/code-mods';
import { getMarketMod, getMarketRole } from '../../market/market-loader';
import type { PFCase, PFEpoch, PFSuite } from '../types';
import {
  mutateAnalysisCase,
  mutateArchitecturePrompt,
  mutateBusinessKnowledgeCase,
  mutateDesignCase,
  mutateDevelopmentCase,
  mutateFlowAssemblerIntent,
  mutateProgressionCase,
  mutateTeamWorkCase,
} from './prompt-mutator';

const HELIOX_IDE_PRODUCT_CONTEXT = [
  'Contexto del Producto (Heliox IDE 2.0):',
  '',
  'Concepto Principal: The visual-first, open-source IDE that orchestrates AI agents on an infinite canvas. A Figma-inspired spatial workspace for cognitive engineering.',
  '',
  'Feature 1 (Cognitive Architecture): "Steps, Flows, Roles & Mods". Construye grafos aciclicos dirigidos (DAGs) visuales. Cada "Step" es un agente que puede equiparse con "Roles" (personas de ejecucion) y "Mods" (interceptores estructurales y validadores).',
  '',
  'Feature 2 (Autonomous Orchestrator): Meta-Compilador "Text-to-Pipeline". Un chat inteligente que no solo escupe codigo, sino que traduce tus intenciones a flujos multi-step completos, ensamblandolos matematicamente en el lienzo mediante un motor espacial anti-colisiones.',
  '',
  'Feature 3 (Unprecedented Safety & Observability): Sandbox de evaluacion integrado (Performance Frontier), validacion E2E con Playwright y observabilidad total del "Cognitive Trace" del modelo.',
  '',
  'Feature 4 (No Vendor Lock-in): Switch underlying LLMs (Xiaomi Mimo, Claude, OpenAI) instantly. Tu codigo y tus agentes son tuyos.',
  '',
  'Tech Stack: React 19, Tailwind CSS 4, Zustand 5, Node.js/Electron.',
  '',
  'CTA principal: "Download Alpha" y "View Source on GitHub".',
].join('\n');

function makeArchitectureStep(prompt: string): AgenticStep {
  return {
    id: 'architecture-root',
    type: 'llm_call',
    prompt,
    tools: [
      { id: 'list-directory', name: 'list_directory' },
      { id: 'read-file', name: 'read_file' },
      { id: 'write-file', name: 'write_file' },
    ],
    prevStepIds: [],
    nextStepIds: [],
    mods: [AntiVerificationInterceptor],
    roles: [{
      id: ConfidentExecutor.id,
      name: ConfidentExecutor.name,
      systemPrompt: ConfidentExecutor.systemPrompt,
    }],
    mentalContext: [],
  };
}

/**
 * Single-agent step with the full read/write filesystem surface — shared by the
 * development, business-knowledge, design, and progression-epoch suites.
 */
function makeSingleAgentStep(
  id: string,
  prompt: string,
  extraMods: AgenticMod[] = [],
  role?: AgenticRole,
): AgenticStep {
  const resolvedRole: AgenticRole = role ?? {
    id: ConfidentExecutor.id,
    name: ConfidentExecutor.name,
    systemPrompt: ConfidentExecutor.systemPrompt,
  };
  return {
    id,
    type: 'llm_call',
    prompt,
    tools: [
      { id: 'list-directory', name: 'list_directory' },
      { id: 'read-file', name: 'read_file' },
      { id: 'write-file', name: 'write_file' },
    ],
    prevStepIds: [],
    nextStepIds: [],
    mods: [AntiVerificationInterceptor, ...extraMods],
    roles: [resolvedRole],
    mentalContext: [],
  };
}

function makeAnalysisStep(prompt: string): AgenticStep {
  return {
    id: 'analysis-root',
    type: 'llm_call',
    prompt,
    tools: [
      { id: 'list-directory', name: 'list_directory' },
      { id: 'read-file', name: 'read_file' },
    ],
    prevStepIds: [],
    nextStepIds: [],
    mods: [getMarketMod('systematic-debug')],
    roles: [],
    mentalContext: [],
  };
}

function makeFlowAssemblerProbeStep(prompt: string): AgenticStep {
  return {
    id: 'flow-assembler-probe',
    type: 'meta_agent_assembly',
    prompt,
    tools: [],
    prevStepIds: [],
    nextStepIds: [],
    mods: [],
    roles: [],
    mentalContext: [],
  };
}

function makeTeamWorkSteps(mutation: ReturnType<typeof mutateTeamWorkCase>): Record<string, AgenticStep> {
  const planner: AgenticStep = {
    id: 'team-planner',
    type: 'llm_call',
    prompt: [
      mutation.prompt,
      '',
      'Step A - Planner.',
      'Create a file named content.md with the complete landing page copy.',
      'The copy must include: hero headline, hero subheadline, primary CTA, 3 feature blocks, social proof, and final CTA.',
      'The copy must explicitly cover Steps, Flows, Roles & Mods, the Autonomous Orchestrator, Text-to-Pipeline, Performance Frontier, Cognitive Trace, and no vendor lock-in.',
      `Use the product "${mutation.variables.product}", the audience "${mutation.variables.audience}", and the requested style "${mutation.variables.visualStyle}".`,
      'Use MCP filesystem tools and write content.md. Do not create React or theme files in this step.',
    ].join('\n'),
    tools: [
      { id: 'write-file', name: 'write_file' },
    ],
    prevStepIds: [],
    nextStepIds: ['team-designer'],
    mods: [],
    roles: [{
      id: 'landing-content-planner',
      name: 'LandingContentPlanner',
      systemPrompt: [
        'Eres un estratega de contenido para productos developer-first. Tu unico entregable es copy claro, reutilizable y especifico para la landing page.',
        'Debes usar estrictamente el siguiente contexto de producto. No conviertas Heliox IDE en un editor de texto generico.',
        '',
        HELIOX_IDE_PRODUCT_CONTEXT,
      ].join('\n'),
    }],
    mentalContext: [],
  };

  const designer: AgenticStep = {
    id: 'team-designer',
    type: 'llm_call',
    prompt: [
      mutation.prompt,
      '',
      'Step B - Designer.',
      'Read content.md first. Then create a file named theme.json with the Tailwind design tokens for the landing page.',
      'theme.json must include: colors, typography, spacing, radii, shadows, and component tone notes.',
      `The theme must fit "${mutation.variables.visualStyle}" and preserve the product/audience choices from content.md.`,
      'Use MCP filesystem tools. Do not create index.html in this step.',
    ].join('\n'),
    tools: [
      { id: 'read-file', name: 'read_file' },
      { id: 'write-file', name: 'write_file' },
    ],
    prevStepIds: ['team-planner'],
    nextStepIds: ['team-developer'],
    mods: [],
    roles: [{
      id: 'landing-visual-designer',
      name: 'LandingVisualDesigner',
      systemPrompt: 'Eres un disenador visual senior. Tu tarea es transformar copy existente en un sistema visual Tailwind coherente, no reescribir el producto.',
    }],
    mentalContext: [],
  };

  const developer: AgenticStep = {
    id: 'team-developer',
    type: 'llm_call',
    prompt: [
      mutation.prompt,
      '',
      'Step C - Developer.',
      'Read content.md and theme.json before writing code.',
      'Create exactly one renderable file named index.html at the project root.',
      'NO React. NO TSX. NO TypeScript. NO Vite. NO package.json. NO Node. NO build step. The result must open directly in a browser.',
      'Use vanilla HTML, inline CSS only when necessary, and vanilla JavaScript inside <script> tags only if useful.',
      'Import Tailwind CSS through the CDN with exactly this script tag: <script src="https://cdn.tailwindcss.com"></script>.',
      'Configure tailwind.config in an inline <script> using the colors, typography, spacing, radii, shadows, and tone notes from theme.json.',
      'The index.html must preserve the exact content strategy from content.md and visibly apply the colors/style decisions from theme.json.',
      'Include real sections for hero, features, proof, and final CTA. Do not hallucinate a new product, audience, or palette.',
    ].join('\n'),
    tools: [
      { id: 'read-file', name: 'read_file' },
      { id: 'write-file', name: 'write_file' },
    ],
    prevStepIds: ['team-designer'],
    nextStepIds: [],
    mods: [getMarketMod('output-budget'), getMarketMod('a11y-enforcer')],
    roles: [{
      id: 'landing-react-developer',
      name: 'LandingHtmlDeveloper',
      systemPrompt: 'Eres un frontend engineer experto en HTML zero-build y Tailwind CDN. Construyes un index.html renderizable directamente en navegador, sin React, TSX, Node ni build step, respetando estrictamente los artefactos previos del equipo.',
    }],
    mentalContext: [],
  };

  return {
    [planner.id]: planner,
    [designer.id]: designer,
    [developer.id]: developer,
  };
}

export function createArchitectureCase({ seed }: { seed: number }): PFCase {
  const mutation = mutateArchitecturePrompt(seed);
  const step = makeArchitectureStep(mutation.prompt);
  const flow: AgenticFlow = {
    id: `pf-architecture-${seed}`,
    name: 'PF Architecture: Express API Structure',
    rootStepId: step.id,
    stepsRecord: {
      [step.id]: step,
    },
  };

  return {
    id: `pf-architecture-express-${seed}`,
    suite: 'architecture',
    seed,
    prompt: mutation.prompt,
    variables: mutation.variables,
    flow,
  };
}

export function createAnalysisCase({ seed }: { seed: number }): PFCase {
  const mutation = mutateAnalysisCase(seed);
  const step = makeAnalysisStep(mutation.prompt);
  const flow: AgenticFlow = {
    id: `pf-analysis-${seed}`,
    name: 'PF Analysis: Silent User Loading Concurrency Bug',
    rootStepId: step.id,
    stepsRecord: {
      [step.id]: step,
    },
  };

  return {
    id: `pf-analysis-users-${seed}`,
    suite: 'analysis',
    seed,
    prompt: mutation.prompt,
    variables: mutation.variables,
    initialFiles: mutation.initialFiles,
    flow,
  };
}

export function createTeamWorkCase({ seed }: { seed: number }): PFCase {
  const mutation = mutateTeamWorkCase(seed);
  const stepsRecord = makeTeamWorkSteps(mutation);
  const flow: AgenticFlow = {
    id: `pf-team-work-${seed}`,
    name: 'PF Team Work: Landing Page Pipeline Cohesion',
    rootStepId: 'team-planner',
    stepsRecord,
  };

  return {
    id: `pf-team-work-landing-${seed}`,
    suite: 'team-work',
    seed,
    prompt: mutation.prompt,
    variables: mutation.variables,
    flow,
  };
}

export function createFlowAssemblerCase({ seed }: { seed: number }): PFCase {
  const mutation = mutateFlowAssemblerIntent(seed);
  const step = makeFlowAssemblerProbeStep(mutation.prompt);
  const flow: AgenticFlow = {
    id: `pf-flow-assembler-${seed}`,
    name: 'PF Flow Assembler: Meta-Agent DAG Assembly',
    rootStepId: step.id,
    stepsRecord: {
      [step.id]: step,
    },
  };

  return {
    id: `pf-flow-assembler-${seed}`,
    suite: 'flow-assembler',
    seed,
    prompt: mutation.prompt,
    variables: mutation.variables,
    flow,
  };
}

export function createDevelopmentCase({ seed }: { seed: number }): PFCase {
  const mutation = mutateDevelopmentCase(seed);
  // `edge-case-coverage` (not `test-driven`): the case already ships failing
  // tests and asks for the implementation, so a "write tests first" mod misfits.
  const step = makeSingleAgentStep('development-root', mutation.prompt, [getMarketMod('edge-case-coverage')]);
  const flow: AgenticFlow = {
    id: `pf-development-${seed}`,
    name: 'PF Development: TDD Calculator Implementation',
    rootStepId: step.id,
    stepsRecord: { [step.id]: step },
  };

  return {
    id: `pf-development-calculator-${seed}`,
    suite: 'development',
    seed,
    prompt: mutation.prompt,
    variables: mutation.variables,
    initialFiles: mutation.initialFiles,
    flow,
  };
}

export function createBusinessKnowledgeCase({ seed }: { seed: number }): PFCase {
  const mutation = mutateBusinessKnowledgeCase(seed);
  const step = makeSingleAgentStep('business-knowledge-root', mutation.prompt, [getMarketMod('spec-adherence')]);
  const flow: AgenticFlow = {
    id: `pf-business-knowledge-${seed}`,
    name: 'PF Business-Knowledge: SaaS Billing Domain Logic',
    rootStepId: step.id,
    stepsRecord: { [step.id]: step },
  };

  return {
    id: `pf-business-knowledge-billing-${seed}`,
    suite: 'business-knowledge',
    seed,
    prompt: mutation.prompt,
    variables: mutation.variables,
    initialFiles: mutation.initialFiles,
    flow,
  };
}

export function createDesignCase({ seed }: { seed: number }): PFCase {
  const mutation = mutateDesignCase(seed);
  // Domain persona (frontend-engineer) from the market instead of the generic
  // executor — UI work benefits from a real frontend expert.
  const step = makeSingleAgentStep(
    'design-root',
    mutation.prompt,
    [getMarketMod('a11y-enforcer'), getMarketMod('output-budget')],
    getMarketRole('frontend-engineer'),
  );
  const flow: AgenticFlow = {
    id: `pf-design-${seed}`,
    name: 'PF Design: Atomic Accessible UI Component',
    rootStepId: step.id,
    stepsRecord: { [step.id]: step },
  };

  return {
    id: `pf-design-component-${seed}`,
    suite: 'design',
    seed,
    prompt: mutation.prompt,
    variables: mutation.variables,
    initialFiles: mutation.initialFiles,
    flow,
  };
}

export function createProgressionCase({ seed }: { seed: number }): PFCase {
  const mutation = mutateProgressionCase(seed);
  const epochs: PFEpoch[] = mutation.epochs.map((epoch) => {
    // No extra mod: progression is execution-heavy and the judge already measures
    // regression. `regression-sentinel` induced analysis-paralysis (agent discussed
    // the mutation but never wrote files), so it is left to interactive use only.
    const step = makeSingleAgentStep(`${epoch.id}-root`, epoch.prompt);
    return {
      id: epoch.id,
      label: epoch.label,
      prompt: epoch.prompt,
      flow: {
        id: `pf-progression-${seed}-${epoch.id}`,
        name: `PF Progression: ${epoch.label}`,
        rootStepId: step.id,
        stepsRecord: { [step.id]: step },
      },
    };
  });

  return {
    id: `pf-progression-express-${seed}`,
    suite: 'progression',
    seed,
    prompt: mutation.prompt,
    variables: mutation.variables,
    initialFiles: mutation.initialFiles,
    // `flow` mirrors the first epoch to satisfy the required field; the runner
    // drives execution from `epochs`.
    flow: epochs[0].flow,
    epochs,
  };
}

/**
 * The "from-scratch" suite: a single complex DAG that builds an advanced project
 * end-to-end, exercising the full atom catalog the marketplace just gained —
 * 6 steps, 5 roles, and every web mod (one design system, since `ds-*` mods are
 * mutually exclusive) wired across the pipeline.
 */
function makeFromScratchSteps(): Record<string, AgenticStep> {
  const fileTools = [
    { id: 'list-directory', name: 'list_directory' },
    { id: 'read-file', name: 'read_file' },
    { id: 'write-file', name: 'write_file' },
  ];

  const scaffold: AgenticStep = {
    id: 'scaffold-structure',
    type: 'llm_call',
    contract: {
      mustWriteFiles: true,
      requiredArtifacts: [
        { description: 'package.json (React 19 + Vite + Tailwind + Vitest)', pathPattern: 'package\\.json$', mustContain: ['react', 'vite', 'tailwind', 'vitest'] },
        { description: 'app entry with routing', pathPattern: 'src/App\\.(tsx|jsx)$', mustContain: ['Route|Router|Routes|createBrowserRouter'] },
        { description: 'app bootstrap (main entry)', pathPattern: 'src/main\\.(tsx|jsx)$' },
        { description: 'i18n catalog + resolver', pathPattern: 'i18n/(index|en)\\.(ts|tsx)$' },
        { description: 'tokenized stylesheet', pathPattern: '\\.css$' },
      ],
    },
    prompt: [
      'STEP 1/6 — scaffold-structure: lay the project skeleton (NO page logic yet).',
      'Build, from scratch, a production-grade web-app skeleton for the product below.',
      'Mandatory stack: React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui.',
      'Create: package.json (scripts dev/build/test with vitest), vite.config.ts, tsconfig.json, a Tailwind config exposing design tokens, src/main.tsx, src/App.tsx routing to /, /login, /signup, /reset, a ThemeProvider (light/dark/system via CSS variables) + a ThemeToggle, an i18n scaffold (src/i18n with en + es message catalogs and a t() resolver), and clearly-stubbed pages (Landing, Login, Signup, Reset) marked TODO.',
      'Set up the shadcn/ui structure (src/components/ui) and a tokenized, mobile-first foundation. Do NOT implement page bodies — leave obvious stubs for later steps.',
      '',
      HELIOX_IDE_PRODUCT_CONTEXT,
    ].join('\n'),
    tools: fileTools,
    prevStepIds: [],
    nextStepIds: ['landing-page'],
    mods: [
      AntiVerificationInterceptor,
      getMarketMod('ds-shadcn'),
      getMarketMod('responsive-design'),
      getMarketMod('dark-mode'),
    ],
    roles: [getMarketRole('software-architect')],
    mentalContext: [],
  };

  const landing: AgenticStep = {
    id: 'landing-page',
    type: 'llm_call',
    contract: {
      forbidStubMarkers: true,
      requiredArtifacts: [
        { description: 'SEO document head (title/meta/OG/Twitter)', pathPattern: '(Landing|Seo|SEO|Head|Meta|Helmet)\\.(tsx|jsx|ts)$', mustContain: ['og:|twitter:|<meta|<title|[Hh]elmet'] },
        { description: 'Schema.org JSON-LD structured data', pathPattern: '(Landing|Seo|SEO|Head|Meta|Jsonld|JsonLd|structured)\\.(tsx|jsx|ts)$', mustContain: ['application/ld\\+json|@context|schema\\.org'] },
      ],
    },
    prompt: [
      'STEP 2/6 — landing-page: build the conversion-focused marketing page as one artifact.',
      'First read the scaffold (package.json, src/App.tsx, the Tailwind tokens, src/i18n) to match conventions and reuse shadcn components + design tokens.',
      'Implement src/pages/Landing.tsx (plus small section components if useful) with: a hero (headline, subheadline, primary CTA "Download Alpha", secondary CTA "View Source on GitHub"), value-prop sections covering Steps/Flows/Roles & Mods, the Autonomous Orchestrator (Text-to-Pipeline), Performance Frontier + Cognitive Trace, and no vendor lock-in; social proof; a final CTA and footer.',
      'Apply the active mods strictly: a complete SEO document head (unique title + meta description + canonical + Open Graph + Twitter cards via a Head/helmet component), valid Schema.org JSON-LD (SoftwareApplication + Organization + BreadcrumbList) reflecting the visible copy, a Core Web Vitals budget (explicit width/height or aspect-ratio on media, lazy-load offscreen assets, no layout-shifting injections), and WCAG semantics (landmarks, exactly one h1, logical headings, accessible names).',
      'Use the exact product context for the copy — do not invent a different product.',
      '',
      HELIOX_IDE_PRODUCT_CONTEXT,
    ].join('\n'),
    tools: fileTools,
    prevStepIds: ['scaffold-structure'],
    nextStepIds: ['auth-pages'],
    mods: [
      AntiVerificationInterceptor,
      getMarketMod('seo-meta'),
      getMarketMod('structured-data'),
      getMarketMod('web-vitals'),
      getMarketMod('a11y-enforcer'),
    ],
    roles: [getMarketRole('frontend-engineer')],
    mentalContext: [],
  };

  const auth: AgenticStep = {
    id: 'auth-pages',
    type: 'llm_call',
    contract: {
      forbidStubMarkers: true,
      requiredArtifacts: [
        { description: 'shared Zod auth validation schema', pathPattern: 'auth-schema\\.(ts|tsx)$|lib/.*[Ss]chema.*\\.ts$', mustContain: ['zod|z\\.object'] },
        { description: 'default-deny ProtectedRoute / route guard', pathPattern: '(ProtectedRoute|RequireAuth|auth-guard|guard)\\.(tsx|ts)$', mustContain: ['Navigate|redirect|isAuthenticated|requireAuth'] },
      ],
    },
    prompt: [
      'STEP 3/6 — auth-pages: build the authentication UI surface (login, signup, password-reset).',
      'Read the scaffold and the i18n catalogs first. Reuse shadcn form primitives and the design tokens.',
      'Implement src/pages/Login.tsx, Signup.tsx and Reset.tsx plus: a single shared Zod schema (src/lib/auth-schema.ts) used by every form; accessible forms (each input has a <label>, errors surfaced via aria-describedby + aria-invalid, never color alone); a typed, provider-agnostic authClient (src/lib/auth-client.ts) with signIn/signUp/resetPassword (no real secrets); and a default-deny ProtectedRoute that redirects unauthenticated users.',
      'Apply the active mods strictly: every protected route enforces auth (default-deny, RBAC-ready), all form validation runs through the shared schema, and EVERY user-facing string is externalized to the en/es i18n catalogs (ICU, no hardcoded copy). Never store tokens or secrets in client-accessible storage.',
    ].join('\n'),
    tools: fileTools,
    prevStepIds: ['landing-page'],
    nextStepIds: ['write-failing-tests'],
    mods: [
      AntiVerificationInterceptor,
      getMarketMod('auth-guarded'),
      getMarketMod('form-validation'),
      getMarketMod('i18n-ready'),
    ],
    roles: [getMarketRole('frontend-engineer')],
    mentalContext: [],
  };

  const writeTests: AgenticStep = {
    id: 'write-failing-tests',
    type: 'llm_call',
    contract: {
      mustWriteFiles: true,
      requiredArtifacts: [
        { description: 'Vitest unit tests for the auth schema and i18n resolver', pathPattern: '\\.test\\.(ts|tsx)$|__tests__/.*\\.(ts|tsx)$', mustContain: ['describe\\(|it\\(|test\\(', 'expect\\('] },
      ],
    },
    prompt: [
      'STEP 4/6 — write-failing-tests (TDD red): specify behavior as failing tests; do NOT implement.',
      'Read src/lib/auth-schema.ts and the i18n resolver produced by the previous steps.',
      'Write Vitest + @testing-library tests (src/lib/__tests__/auth-schema.test.ts and src/i18n/__tests__/i18n.test.ts) specifying: email-format validation, password-strength rules, required fields and confirm-password matching for the auth schema; and locale resolution, missing-key fallback and ICU interpolation/plurals for the i18n resolver.',
      'Cover edge cases explicitly (empty string, whitespace-only, invalid types, missing locale key, unknown ICU variable). The tests MUST fail now because the logic is still stubbed. Do not write the implementation in this step.',
    ].join('\n'),
    tools: fileTools,
    prevStepIds: ['auth-pages'],
    nextStepIds: ['implement-to-green'],
    mods: [getMarketMod('test-driven')],
    roles: [getMarketRole('qa-engineer')],
    mentalContext: [],
  };

  const implement: AgenticStep = {
    id: 'implement-to-green',
    type: 'llm_call',
    contract: {
      forbidStubMarkers: true,
      requiredArtifacts: [
        { description: 'implemented auth schema with real validation logic', pathPattern: 'auth-schema\\.(ts|tsx)$', mustContain: ['z\\.object|safeParse|\\.parse|refine'] },
      ],
    },
    prompt: [
      'STEP 5/6 — implement-to-green (TDD green): write the smallest correct logic to pass the failing tests.',
      'Read the failing tests from the previous step and the existing schema / i18n stubs.',
      'Implement the real validation logic (auth-schema.ts) and the i18n resolver so ALL the step-4 tests pass. Write general, correct logic — never hardcode answers to satisfy specific assertions. Handle every edge case the tests cover (nulls, boundaries, invalid types, missing keys).',
    ].join('\n'),
    tools: fileTools,
    prevStepIds: ['write-failing-tests'],
    nextStepIds: ['review-diff'],
    mods: [
      AntiVerificationInterceptor,
      getMarketMod('edge-case-coverage'),
    ],
    roles: [getMarketRole('backend-engineer')],
    mentalContext: [],
  };

  const review: AgenticStep = {
    id: 'review-diff',
    type: 'llm_call',
    contract: {
      requiredArtifacts: [
        { description: 'REVIEW.md report with concrete findings', pathPattern: 'REVIEW\\.md$', minBytes: 600 },
      ],
    },
    prompt: [
      'STEP 6/6 — review-diff: review the assembled project against the brief; report, do NOT rewrite.',
      'Read the key files produced across all steps (landing, auth pages, auth-schema, i18n, tests, config).',
      'Write REVIEW.md with concrete, file-referenced findings assessing: cross-step cohesion (did landing/auth reuse the scaffold tokens, shadcn components and i18n catalogs?), and adherence to each mod dimension — design-system consistency, responsive + dark mode, SEO head + JSON-LD, Core Web Vitals, accessibility, auth default-deny, form validation, i18n externalization, and test coverage / edge cases. List concrete defects and risks with file:line references. Do not rewrite the code — produce a rigorous review only.',
    ].join('\n'),
    tools: fileTools,
    prevStepIds: ['implement-to-green'],
    nextStepIds: [],
    mods: [getMarketMod('self-review')],
    roles: [getMarketRole('security-researcher')],
    mentalContext: [],
  };

  return {
    [scaffold.id]: scaffold,
    [landing.id]: landing,
    [auth.id]: auth,
    [writeTests.id]: writeTests,
    [implement.id]: implement,
    [review.id]: review,
  };
}

export function createFromScratchCase({ seed }: { seed: number }): PFCase {
  const stepsRecord = makeFromScratchSteps();
  const flow: AgenticFlow = {
    id: `pf-from-scratch-${seed}`,
    name: 'PF From Scratch: Advanced SaaS Project (full atom integration)',
    rootStepId: 'scaffold-structure',
    stepsRecord,
  };
  const prompt = [
    'Build an advanced, production-grade web project FROM SCRATCH for the product below, end to end:',
    'a marketing landing page plus a complete authentication surface (login / signup / password-reset), on a React 19 + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui stack;',
    'internationalized (en/es), accessible (WCAG), SEO-complete (meta tags + Schema.org JSON-LD), within a Core Web Vitals budget, themeable (light/dark/system), responsive (mobile-first);',
    'with default-deny authenticated routes, accessible validated forms, and a TDD test suite (failing tests, then implementation), closed by a security/quality review.',
    '',
    HELIOX_IDE_PRODUCT_CONTEXT,
  ].join('\n');

  return {
    id: `pf-from-scratch-saas-${seed}`,
    suite: 'from-scratch',
    seed,
    prompt,
    variables: {
      product: 'Heliox IDE',
      stack: 'React 19 + Vite + TypeScript + Tailwind CSS v4 + shadcn/ui',
      locales: 'en,es',
      steps: 6,
    },
    flow,
  };
}

export function createPerformanceCase({ suite, seed }: { suite: PFSuite; seed: number }): PFCase {
  if (suite === 'architecture') return createArchitectureCase({ seed });
  if (suite === 'analysis') return createAnalysisCase({ seed });
  if (suite === 'team-work') return createTeamWorkCase({ seed });
  if (suite === 'flow-assembler') return createFlowAssemblerCase({ seed });
  if (suite === 'development') return createDevelopmentCase({ seed });
  if (suite === 'business-knowledge') return createBusinessKnowledgeCase({ seed });
  if (suite === 'design') return createDesignCase({ seed });
  if (suite === 'progression') return createProgressionCase({ seed });
  if (suite === 'from-scratch') return createFromScratchCase({ seed });
  throw new Error(`PF suite "${suite}" is not implemented yet.`);
}
