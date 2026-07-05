import { describe, expect, it } from 'vitest';
import { AntiVerificationInterceptor } from '../../market/code-mods';
import { ConfidentExecutor } from '../../market/code-roles';
import {
  createAnalysisCase,
  createArchitectureCase,
  createBusinessKnowledgeCase,
  createDesignCase,
  createDevelopmentCase,
  createFlowAssemblerCase,
  createPerformanceCase,
  createProgressionCase,
  createTeamWorkCase,
} from './case-factory';

describe('performance frontier procedural cases', () => {
  it('creates deterministic but seed-varied architecture prompts', () => {
    const first = createArchitectureCase({ seed: 41 });
    const same = createArchitectureCase({ seed: 41 });
    const different = createArchitectureCase({ seed: 42 });

    expect(first.prompt).toBe(same.prompt);
    expect(first.variables).toEqual(same.variables);
    expect(first.prompt).not.toBe(different.prompt);
    expect(first.suite).toBe('architecture');
    expect(first.flow.stepsRecord[first.flow.rootStepId].prompt).toContain(String(first.variables.port));
  });

  it('uses the predefined ConfidentExecutor role by default', () => {
    const testCase = createArchitectureCase({ seed: 13 });
    const rootStep = testCase.flow.stepsRecord[testCase.flow.rootStepId];

    expect(rootStep.roles).toContainEqual({
      id: ConfidentExecutor.id,
      name: ConfidentExecutor.name,
      systemPrompt: ConfidentExecutor.systemPrompt,
    });
    expect(ConfidentExecutor.systemPrompt).toContain('ESTÁ TERMINANTEMENTE PROHIBIDO');
  });

  it('attaches the AntiVerificationInterceptor mod by default', () => {
    const testCase = createArchitectureCase({ seed: 14 });
    const rootStep = testCase.flow.stepsRecord[testCase.flow.rootStepId];

    expect(rootStep.mods).toContainEqual(AntiVerificationInterceptor);
  });

  it('creates a PF Analysis case with a seeded silent concurrency bug', () => {
    const testCase = createAnalysisCase({ seed: 21 });
    const rootStep = testCase.flow.stepsRecord[testCase.flow.rootStepId];
    const files = Object.values(testCase.initialFiles ?? {}).join('\n');

    expect(testCase.suite).toBe('analysis');
    expect(testCase.prompt).toBe('Hay un bug de concurrencia en la carga de usuarios. Usa tus herramientas para encontrarlo y explicar la línea exacta.');
    expect(rootStep.tools.map((tool) => tool.name)).toEqual(['list_directory', 'read_file']);
    expect(rootStep.mods.map((mod) => mod.id)).toContain('systematic-debug');
    expect(files).toContain('records.map');
    expect(files).toContain('Promise.all');
    expect(testCase.variables.bugLine).toEqual(expect.any(Number));
  });

  it('selects the requested PF suite procedurally', () => {
    expect(createPerformanceCase({ suite: 'architecture', seed: 1 }).suite).toBe('architecture');
    expect(createPerformanceCase({ suite: 'analysis', seed: 1 }).suite).toBe('analysis');
    expect(createPerformanceCase({ suite: 'team-work', seed: 1 }).suite).toBe('team-work');
    expect(createPerformanceCase({ suite: 'flow-assembler', seed: 1 }).suite).toBe('flow-assembler');
    expect(createPerformanceCase({ suite: 'development', seed: 1 }).suite).toBe('development');
    expect(createPerformanceCase({ suite: 'business-knowledge', seed: 1 }).suite).toBe('business-knowledge');
    expect(createPerformanceCase({ suite: 'design', seed: 1 }).suite).toBe('design');
    expect(createPerformanceCase({ suite: 'progression', seed: 1 }).suite).toBe('progression');
  });

  it('creates a deterministic Development TDD case with failing tests injected', () => {
    const first = createDevelopmentCase({ seed: 7 });
    const same = createDevelopmentCase({ seed: 7 });
    const different = createDevelopmentCase({ seed: 8 });
    const rootStep = first.flow.stepsRecord[first.flow.rootStepId];
    const testFile = first.initialFiles?.['calculator.test.ts'] ?? '';

    expect(first.suite).toBe('development');
    expect(first.prompt).toBe(same.prompt);
    expect(first.prompt).not.toBe(different.prompt);
    expect(testFile).toContain("from './calculator'");
    expect(testFile).toContain('throws on division by zero');
    expect(testFile).toContain('throws on non-integer input');
    expect(first.prompt).toContain('calculator.ts');
    expect(rootStep.tools.map((tool) => tool.name)).toEqual(['list_directory', 'read_file', 'write_file']);
    expect(rootStep.mods).toContainEqual(AntiVerificationInterceptor);
    expect(rootStep.mods.map((mod) => mod.id)).toContain('edge-case-coverage');
  });

  it('creates a Business-Knowledge case with complex billing rules in rules.md', () => {
    const testCase = createBusinessKnowledgeCase({ seed: 5 });
    const rules = testCase.initialFiles?.['rules.md'] ?? '';

    expect(testCase.suite).toBe('business-knowledge');
    expect(rules).toContain('Volume discounts');
    expect(rules).toContain('Proration');
    expect(rules).toContain('Taxes');
    expect(rules).toContain('order of operations');
    expect(rules).toContain('NEVER silently default to 0%');
    expect(testCase.prompt).toContain('BillingService.ts');
    expect(testCase.prompt).toContain('calculateInvoice');
    expect(testCase.flow.stepsRecord['business-knowledge-root'].mods.map((mod) => mod.id)).toContain('spec-adherence');
  });

  it('creates a Design case with a strict, parseable theme.json', () => {
    const first = createDesignCase({ seed: 9 });
    const different = createDesignCase({ seed: 10 });
    const theme = first.initialFiles?.['theme.json'] ?? '';

    expect(first.suite).toBe('design');
    expect(() => JSON.parse(theme)).not.toThrow();
    expect(JSON.parse(theme)).toMatchObject({ colors: expect.any(Object), radii: expect.any(Object) });
    expect(first.prompt).toContain('index.html');
    expect(first.prompt).toContain('cdn.tailwindcss.com');
    expect(first.prompt).toContain('ARIA');
    expect([first.variables.component, different.variables.component].length).toBe(2);
    const designStep = first.flow.stepsRecord['design-root'];
    expect(designStep.mods.map((mod) => mod.id)).toEqual(
      expect.arrayContaining(['a11y-enforcer', 'output-budget']),
    );
    // Domain persona from the market, not the generic executor.
    expect(designStep.roles.map((role) => role.id)).toEqual(['frontend-engineer']);
  });

  it('creates a Progression case with a seeded Express seed and two epochs', () => {
    const first = createProgressionCase({ seed: 3 });
    const different = createProgressionCase({ seed: 4 });
    const files = first.initialFiles ?? {};

    expect(first.suite).toBe('progression');
    expect(first.epochs).toHaveLength(2);
    expect(first.epochs?.[0].id).toBe('epoch-1');
    expect(first.epochs?.[1].id).toBe('epoch-2');
    expect(first.epochs?.[0].prompt).toContain('avatar');
    expect(first.epochs?.[1].prompt).toContain('JWT');
    expect(first.flow).toBe(first.epochs?.[0].flow);
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'package.json',
      'src/server.js',
      'src/middleware/auth.js',
      'src/routes/health.js',
      'src/routes/users.js',
      'src/routes/sessions.js',
    ]));
    expect(files['src/middleware/auth.js']).toContain('requireAuth');
    expect(first.prompt).not.toBe(different.prompt);
    const epoch1Step = first.epochs?.[0].flow.stepsRecord['epoch-1-root'];
    // Execution-heavy suite: only the base AntiVerification mod, no analysis-heavy guardrail.
    expect(epoch1Step?.mods.map((mod) => mod.id)).toContain('anti-verification-interceptor');
    expect(epoch1Step?.mods.map((mod) => mod.id)).not.toContain('regression-sentinel');
  });

  it('creates seeded Flow Assembler user intents', () => {
    const first = createFlowAssemblerCase({ seed: 101 });
    const same = createFlowAssemblerCase({ seed: 101 });
    const different = createFlowAssemblerCase({ seed: 102 });
    const rootStep = first.flow.stepsRecord[first.flow.rootStepId];

    expect(first).toMatchObject({
      id: 'pf-flow-assembler-101',
      suite: 'flow-assembler',
      seed: 101,
    });
    expect(first.prompt).toBe(same.prompt);
    expect(first.prompt).not.toBe(different.prompt);
    expect(first.variables.userIntent).toBe(first.prompt);
    expect(rootStep.type).toBe('meta_agent_assembly');
    expect(rootStep.tools).toEqual([]);
    expect([
      'Necesito un flujo que investigue noticias de IA',
      'Crea un pipeline que reciba un ticket de Jira',
    ].some((fragment) => first.prompt.includes(fragment) || different.prompt.includes(fragment))).toBe(true);
  });

  it('creates a three-step Team Work DAG with handoff artifacts', () => {
    const testCase = createTeamWorkCase({ seed: 42 });
    const steps = testCase.flow.stepsRecord;
    const planner = steps['team-planner'];
    const designer = steps['team-designer'];
    const developer = steps['team-developer'];

    expect(testCase.suite).toBe('team-work');
    expect(testCase.variables.product).toEqual(expect.any(String));
    expect(testCase.variables.visualStyle).toEqual(expect.any(String));
    expect(testCase.flow.rootStepId).toBe('team-planner');
    expect(planner.prevStepIds).toEqual([]);
    expect(planner.nextStepIds).toEqual(['team-designer']);
    expect(planner.prompt).toContain('content.md');
    expect(designer.prevStepIds).toEqual(['team-planner']);
    expect(designer.nextStepIds).toEqual(['team-developer']);
    expect(designer.prompt).toContain('theme.json');
    expect(designer.prompt).toContain('content.md');
    expect(developer.prevStepIds).toEqual(['team-designer']);
    expect(developer.nextStepIds).toEqual([]);
    expect(developer.prompt).toContain('index.html');
    expect(developer.prompt).toContain('https://cdn.tailwindcss.com');
    expect(developer.prompt).toContain('tailwind.config');
    expect(developer.prompt).toContain('NO React');
    expect(developer.prompt).toContain('NO TSX');
    expect(developer.prompt).toContain('NO build step');
    expect(developer.prompt).toContain('content.md');
    expect(developer.prompt).toContain('theme.json');
    expect(new Set([
      planner.roles[0]?.name,
      designer.roles[0]?.name,
      developer.roles[0]?.name,
    ])).toHaveProperty('size', 3);
  });

  it('dogfoods Heliox IDE as the fixed Team Work product while keeping visual style seeded', () => {
    const cases = [41, 42, 43, 44, 45, 46].map((seed) => createTeamWorkCase({ seed }));
    const products = new Set(cases.map((testCase) => testCase.variables.product));
    const audiences = new Set(cases.map((testCase) => testCase.variables.audience));
    const visualStyles = new Set(cases.map((testCase) => testCase.variables.visualStyle));
    const planner = cases.at(-1)?.flow.stepsRecord['team-planner'];
    const plannerSystemPrompt = planner?.roles[0]?.systemPrompt ?? '';

    expect(products).toEqual(new Set(['Heliox IDE']));
    expect(audiences).toEqual(new Set(['AI Engineers, Arquitectos de Sistemas y Equipos de Plataforma']));
    expect(visualStyles.size).toBeGreaterThan(1);
    expect(cases.at(-1)?.prompt).toContain('Producto: Heliox IDE.');
    expect(cases.at(-1)?.prompt).toContain('AI Engineers, Arquitectos de Sistemas y Equipos de Plataforma');
    expect(plannerSystemPrompt).toContain('The visual-first, open-source IDE that orchestrates AI agents on an infinite canvas');
    expect(plannerSystemPrompt).toContain('Steps, Flows, Roles & Mods');
    expect(plannerSystemPrompt).toContain('Text-to-Pipeline');
    expect(plannerSystemPrompt).toContain('Performance Frontier');
    expect(plannerSystemPrompt).toContain('Download Alpha');
    expect(plannerSystemPrompt).toContain('View Source on GitHub');
  });
});
