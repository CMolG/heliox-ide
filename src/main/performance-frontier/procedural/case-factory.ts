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

export function createPerformanceCase({ suite, seed }: { suite: PFSuite; seed: number }): PFCase {
  if (suite === 'architecture') return createArchitectureCase({ seed });
  if (suite === 'analysis') return createAnalysisCase({ seed });
  if (suite === 'team-work') return createTeamWorkCase({ seed });
  if (suite === 'flow-assembler') return createFlowAssemblerCase({ seed });
  if (suite === 'development') return createDevelopmentCase({ seed });
  if (suite === 'business-knowledge') return createBusinessKnowledgeCase({ seed });
  if (suite === 'design') return createDesignCase({ seed });
  if (suite === 'progression') return createProgressionCase({ seed });
  throw new Error(`PF suite "${suite}" is not implemented yet.`);
}
