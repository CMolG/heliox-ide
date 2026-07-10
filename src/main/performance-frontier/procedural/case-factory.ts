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

const FLUXOR_IDE_PRODUCT_CONTEXT = [
  'Contexto del Producto (Fluxor IDE 2.0):',
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
        'Debes usar estrictamente el siguiente contexto de producto. No conviertas Fluxor IDE en un editor de texto generico.',
        '',
        FLUXOR_IDE_PRODUCT_CONTEXT,
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

  // Canonical file/export map injected into every step so each agent extends the
  // SAME modules instead of forking a parallel system (the cross-step incoherence
  // the judge flagged: dual i18n, mismatched imports, an unwired ProtectedRoute).
  const PROJECT_LAYOUT = [
    'CANONICAL PROJECT LAYOUT (single source of truth — never fork alternatives):',
    '- i18n: src/i18n/index.ts exports t(key, vars?) and setLocale; catalogs src/i18n/en.ts + es.ts. NEVER create src/locales/*, src/i18n.ts, or any other i18n module.',
    '- Auth schema: src/lib/auth-schema.ts exports loginSchema, signupSchema, resetSchema (zod) and the inferred types LoginValues, SignupValues, ResetValues. Forms AND tests import these EXACT names from "@/lib/auth-schema".',
    '- Auth client: src/lib/auth-client.ts exports authClient (signIn/signUp/resetPassword).',
    '- Route guard: src/components/ProtectedRoute.tsx exports ProtectedRoute, wired into the route table in src/App.tsx.',
    '- UI: shadcn primitives in src/components/ui/*; pages in src/pages/{Landing,Login,Signup,Reset}.tsx.',
    'If a canonical file already exists, READ and EXTEND it — never create a second version, and import the EXACT names above.',
  ].join('\n');

  // Coaching block (prompt-only) that breaks the observed failure mode on the
  // "meta" steps: the agent looping on list_directory/read_file and never
  // calling write_file (reactive exploration instead of proactive production).
  const EXECUTION_DISCIPLINE = [
    'EXECUTION DISCIPLINE (mandatory):',
    '- You already built this project in earlier steps; you KNOW its structure. Do NOT explore.',
    '- Do NOT call list_directory. read_file at most the few specific files named below, then act.',
    '- read_file takes a FILE path, never a directory (a directory path throws EISDIR).',
    '- The ONLY way to complete this step is to call write_file for each target file. Content written in your reply text is DISCARDED and the step FAILS — only files on disk count.',
    '- Do not loop reading/listing. After reading the few files you need, immediately write_file. Produce, do not deliberate.',
    '',
    PROJECT_LAYOUT,
  ].join('\n');

  const scaffold: AgenticStep = {
    id: 'scaffold-structure',
    type: 'llm_call',
    contract: {
      mustWriteFiles: true,
      requiredArtifacts: [
        { description: 'package.json (React 19 + Vite + Tailwind + Vitest)', pathPattern: 'package\\.json$', mustContain: ['react', 'vite', 'tailwind', 'vitest'] },
        { description: 'app entry with routing', pathPattern: 'src/App\\.(tsx|jsx)$', mustContain: ['Route|Router|Routes|createBrowserRouter'] },
        { description: 'skip-to-main-content link (WCAG 2.4.1)', pathPattern: 'src/(App|.*[Ll]ayout)\\.(tsx|jsx)$', mustContain: ['[Ss]kip'] },
        { description: 'app bootstrap (main entry)', pathPattern: 'src/main\\.(tsx|jsx)$' },
        { description: 'canonical i18n resolver (src/i18n/index.ts exporting t)', pathPattern: 'src/i18n/index\\.(ts|tsx)$', mustContain: ['export'] },
        { description: 'canonical auth-schema stub exporting the form schemas', pathPattern: 'src/lib/auth-schema\\.(ts|tsx)$', mustContain: ['loginSchema', 'signupSchema'] },
        { description: 'shadcn Button primitive', pathPattern: 'src/components/ui/button\\.(tsx|ts)$', mustContain: ['export'] },
        { description: 'shadcn Input primitive', pathPattern: 'src/components/ui/input\\.(tsx|ts)$', mustContain: ['export'] },
        { description: 'tokenized stylesheet', pathPattern: '\\.css$' },
      ],
    },
    prompt: [
      'STEP 1/6 — scaffold-structure: lay the project skeleton (NO page logic yet).',
      'Build, from scratch, a production-grade web-app skeleton for the product below.',
      'Mandatory stack: React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui.',
      'Create: package.json (scripts dev/build/test with vitest), vite.config.ts, tsconfig.json (with the "@/*" path alias to src), a Tailwind config exposing design tokens, src/main.tsx, src/App.tsx routing to /, /login, /signup, /reset, a ThemeProvider (light/dark/system via CSS variables) + a ThemeToggle, and clearly-stubbed pages (Landing, Login, Signup, Reset) marked TODO.',
      'Establish the canonical shared modules so later steps extend (never fork) them:',
      '  - src/i18n/index.ts (export t + setLocale), src/i18n/en.ts and src/i18n/es.ts containing ALL keys later steps need — including the auth keys (auth.login.*, auth.signup.*, auth.reset.*) and validation error keys (auth.errors.*). This is the ONLY i18n module.',
      '  - src/lib/auth-schema.ts: export loginSchema, signupSchema, resetSchema (zod) and the inferred types LoginValues, SignupValues, ResetValues. A minimal-but-valid stub is fine here; step 5 fills the real rules. The exports MUST exist so forms and tests can import them.',
      'Create the shadcn/ui primitives later steps reuse: src/components/ui/button.tsx (Button), src/components/ui/input.tsx (Input) and src/components/ui/label.tsx (Label), on a tokenized, mobile-first foundation.',
      'In src/App.tsx (the app shell): a "Skip to main content" link as the FIRST focusable element (href="#main"), and wrap the routed content in <main id="main">. Do NOT implement page bodies — leave obvious stubs for later steps.',
      '',
      PROJECT_LAYOUT,
      '',
      FLUXOR_IDE_PRODUCT_CONTEXT,
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
      FLUXOR_IDE_PRODUCT_CONTEXT,
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
        { description: 'default-deny ProtectedRoute / route guard', pathPattern: 'src/components/ProtectedRoute\\.(tsx|ts)$', mustContain: ['Navigate|redirect|isAuthenticated|requireAuth'] },
        { description: 'ProtectedRoute wired into the App.tsx route table', pathPattern: 'src/App\\.(tsx|jsx)$', mustContain: ['ProtectedRoute'] },
        { description: 'Login form imports the canonical auth-schema', pathPattern: 'src/pages/Login\\.(tsx|jsx)$', mustContain: ['auth-schema'] },
        { description: 'auth forms use the shadcn Input/Button primitives (no raw inputs)', pathPattern: 'src/pages/Login\\.(tsx|jsx)$', mustContain: ['components/ui/(button|input)|<Button|<Input'] },
      ],
      forbiddenArtifacts: [
        { description: 'parallel i18n module (use the canonical src/i18n)', pathPattern: '(src/locales/|src/i18n\\.(ts|tsx)$)' },
      ],
      requireDeclaredDependencies: true,
    },
    prompt: [
      'STEP 3/6 — auth-pages: build the FULL authentication UI surface (login, signup, password-reset). No stubs.',
      'Reuse the scaffold: shadcn form primitives (Input, Label, Button), the design tokens, and the canonical i18n catalogs (src/i18n). Do NOT create a second i18n system — add any missing keys to src/i18n/en.ts and es.ts.',
      'IMPORT the form schemas from the canonical "@/lib/auth-schema" (loginSchema, signupSchema, resetSchema + the types) — do NOT redefine or fork the schema here; step 5 fills its logic.',
      'Every external package you import (e.g. react-hook-form, @hookform/resolvers) MUST be added to package.json "dependencies" — otherwise the project will not install or build.',
      'Create or fully replace these files — completely implemented, ZERO TODO/placeholder:',
      '  - src/lib/auth-client.ts: a typed, provider-agnostic authClient with signIn/signUp/resetPassword (no real secrets).',
      '  - src/components/ProtectedRoute.tsx: a default-deny guard that redirects unauthenticated users (use <Navigate>).',
      '  - src/pages/Login.tsx, Signup.tsx, Reset.tsx: real, accessible forms BUILT FROM the shadcn primitives — import { Button } from "@/components/ui/button" and { Input } from "@/components/ui/input" (and Label); NEVER use raw <input>/<button>. Each field has a <label>; errors via aria-describedby + aria-invalid (never color alone). Forms import the canonical schemas + authClient. REPLACE any existing TODO stub entirely.',
      '  - src/App.tsx: import ProtectedRoute and wrap the protected routes with it so they are actually guarded.',
      'Every user-facing string MUST come from the canonical i18n catalogs (ICU, no hardcoded copy). Never store tokens/secrets in client-accessible storage.',
      '',
      EXECUTION_DISCIPLINE,
      '',
      'DONE WHEN: auth-schema.ts (zod) + auth-client.ts + ProtectedRoute.tsx exist; Login/Signup/Reset contain NO TODO markers and use the shared schema; App.tsx references ProtectedRoute.',
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
      'STEP 4/6 — write-failing-tests (TDD red): create failing unit tests. Do NOT implement the logic.',
      'The auth schema (src/lib/auth-schema.ts) and the i18n resolver (src/i18n/index.ts, exporting t()) already exist from earlier steps — test against their real exports.',
      'In the test files use RELATIVE imports (./auth-schema, ./index) — NOT the @/ alias — so the runner resolves them without alias config.',
      'Create EXACTLY these two test files, fully written (not described in prose):',
      '  - src/lib/auth-schema.test.ts: Vitest tests importing the schema from "./auth-schema" — valid email passes; malformed email fails; weak/short password fails; missing required fields fail; confirm-password mismatch fails. Edge cases: empty string, whitespace-only, null/undefined, wrong types.',
      '  - src/i18n/index.test.ts: Vitest tests importing t() from "./index" — a known key resolves; a missing key falls back; ICU interpolation substitutes a variable; an unknown variable is handled. Edge cases: missing locale, empty key.',
      'Each file MUST use describe(), it()/test() and expect() with real assertions.',
      'It is REQUIRED and CORRECT that these tests FAIL right now (red phase) because the implementation is still stubbed — a failing test here is SUCCESS, not a problem. Do NOT write or modify any implementation in this step.',
      '',
      EXECUTION_DISCIPLINE,
      '',
      'DONE WHEN: src/lib/auth-schema.test.ts and src/i18n/index.test.ts both exist, each containing describe/it/expect with real assertions.',
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
      'STEP 5/6 — implement-to-green (TDD green): write the real logic so the step-4 tests pass.',
      'read_file the two test files from step 4 (src/lib/auth-schema.test.ts, src/i18n/index.test.ts) to see the exact expected behavior, then implement against them.',
      'Create or fully replace, completely implemented (zero TODO/placeholder):',
      '  - src/lib/auth-schema.ts: real Zod schema logic (email format, password rules, confirm-password refine) covering every asserted edge case (nulls, boundaries, invalid types, missing fields).',
      '  - src/i18n/index.ts: the t() resolver — key lookup, missing-key fallback, ICU interpolation. General, correct logic; NEVER hardcode answers to satisfy specific assertions.',
      '',
      EXECUTION_DISCIPLINE,
      '',
      'DONE WHEN: src/lib/auth-schema.ts contains real z.object/refine/safeParse logic and src/i18n/index.ts resolves keys generally — no stubs, no hardcoded test answers.',
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
        { description: 'REVIEW.md report referencing the real test suite', pathPattern: 'REVIEW\\.md$', minBytes: 600, mustContain: ['test'] },
      ],
    },
    prompt: [
      'STEP 6/6 — review-diff: produce a written code review of the assembled project. Report only; do NOT rewrite code.',
      'Your SINGLE deliverable is the file REVIEW.md. A review written in your reply is ignored and the step FAILS — you MUST call write_file to create REVIEW.md.',
      'read_file a handful of key files (Landing, a Seo/Head component, auth-schema, ProtectedRoute, App.tsx, one auth page) AND BOTH test files (src/lib/auth-schema.test.ts, src/i18n/index.test.ts) so your coverage claim is FACTUAL, then immediately write REVIEW.md with this structure:',
      'CRITICAL: state the real number of test files you found. NEVER claim "no tests" or "zero coverage" — the project HAS a Vitest suite; verify every assertion against the files you actually read.',
      '  ## Cross-step cohesion — did landing/auth reuse the scaffold tokens, shadcn components and i18n catalogs?',
      '  ## Mod adherence — one bullet each: design-system, responsive+dark, SEO head + JSON-LD, Core Web Vitals, accessibility, auth default-deny, form validation, i18n externalization, test coverage.',
      '  ## Concrete defects & risks — file-referenced (path:line where possible).',
      'Be specific and critical; cite real files. Do not modify any source file other than creating REVIEW.md.',
      '',
      EXECUTION_DISCIPLINE,
      '',
      'DONE WHEN: REVIEW.md exists at the project root with the three sections above and concrete, file-referenced findings.',
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
    FLUXOR_IDE_PRODUCT_CONTEXT,
  ].join('\n');

  return {
    id: `pf-from-scratch-saas-${seed}`,
    suite: 'from-scratch',
    seed,
    prompt,
    variables: {
      product: 'Fluxor IDE',
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
