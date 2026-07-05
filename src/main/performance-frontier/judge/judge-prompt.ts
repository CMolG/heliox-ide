import type { PFJudgeInput, PFSuite } from '../types';

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Extra judge instructions injected per suite for the suite-specific dimensions. */
const SUITE_JUDGE_INSTRUCTIONS: Partial<Record<PFSuite, string[]>> = {
  development: [
    'Para la suite development evalua ADEMAS algorithmicAccuracy: 0-20.',
    'El agente recibio un archivo de unit tests que fallaban y debia escribir la implementacion para que pasen.',
    'algorithmicAccuracy debe verificar que la implementacion cubre casos limite (nulls, desbordamientos numericos, tipos invalidos, division por cero) y no solo el happy path. Penaliza fuerte si el agente hardcodeo respuestas para enganar a los tests en vez de implementar la logica real.',
  ],
  'business-knowledge': [
    'Para la suite business-knowledge evalua ADEMAS domainLogicAdherence: 0-20.',
    'El agente recibio un rules.md con reglas de negocio complejas (prorrata, impuestos por pais, descuentos por volumen) y debia escribir BillingService.ts.',
    'Actua como QA de negocio implacable: compara el codigo contra rules.md regla por regla. Penaliza en violatedRules cada impuesto olvidado, prorrata mal calculada o descuento por volumen mal aplicado.',
  ],
  design: [
    'Para la suite design evalua ADEMAS uxUiFidelity: 0-20 y accessibilityScore: 0-20.',
    'El agente debia construir un componente aislado complejo en HTML + Tailwind puro (zero-build) respetando un theme.json estricto.',
    'uxUiFidelity evalua estructura, jerarquia visual, interactividad simulada y respeto estricto a los tokens del theme.json (penaliza tokens inventados). accessibilityScore evalua contraste de color, semantica ARIA (roles, labels, aria-*), navegacion por teclado y manejo de foco.',
  ],
  progression: [
    'Para la suite progression (brownfield) evalua ADEMAS regressionScore: 0-30. Es la dimension critica.',
    'El proyecto evoluciono en epochs sobre el MISMO codigo vivo: Epoch 0 sembro una API Express funcional con middleware de auth; Epoch 1 anadio un endpoint de subida de avatares; Epoch 2 refactorizo el auth a JWT con refresh tokens.',
    'Examina el codigo final (Epoch 2) y compara los snapshots por epoch: al tocar el Auth, rompio el endpoint de avatares de la Epoch 1? Modifico dependencias, firmas o contratos que no debia? Penaliza fuerte cualquier regresion silenciosa en brokenEpoch1Features y unintendedDependencyChanges.',
  ],
  'from-scratch': [
    'IMPORTANTE — anula cualquier instruccion previa sobre "zero-build" o "index.html puro": la suite from-scratch construye un PROYECTO REAL multi-archivo CON build (React 19 + Vite + TypeScript + Tailwind v4 + shadcn/ui). NO penalices la existencia de package.json, TSX, bundler ni build step; aqui son obligatorios. outputQuality mide la calidad global del proyecto, no de un HTML suelto.',
    'Esta suite encadena 6 steps (scaffold-structure -> landing-page -> auth-pages -> write-failing-tests -> implement-to-green -> review-diff) ejecutados por roles distintos con mods apilados. pipelineCohesion debe medir la INTEGRACION entre steps: reutilizaron landing y auth el scaffold (design tokens, componentes shadcn, catalogos i18n) o alucinaron estructuras nuevas e inconsistentes?',
    'Evalua ADEMAS uxUiFidelity: 0-20, reinterpretado como ADHERENCIA DE LOS MODS DE UI: design-system shadcn coherente, responsive mobile-first (sin anchos fijos en px), theming light/dark por tokens/CSS variables, head SEO completo (title/meta/canonical/OpenGraph/Twitter), JSON-LD Schema.org valido y alineado al copy visible, y presupuesto Core Web Vitals (dimensiones en media, lazy-load, sin layout shift). En themeViolations lista cada mod de UI ignorado o token inventado.',
    'Evalua ADEMAS accessibilityScore: 0-20, cubriendo WCAG (landmarks, un solo h1, labels asociadas, aria-*, manejo de foco) Y la internacionalizacion: TODOS los strings de UI deben estar externalizados a los catalogos i18n (en/es), sin copy hardcodeado. En a11yViolations lista cada fallo WCAG y cada string hardcodeado.',
    'Evalua ADEMAS algorithmicAccuracy: 0-20 como DISCIPLINA TDD: el step 4 debia escribir tests que FALLAN y el step 5 implementarlos a verde con logica GENERAL (no hardcodeada) cubriendo casos limite del esquema de auth (email, fuerza de password, confirmacion) y del resolutor i18n (clave faltante, fallback, ICU). Penaliza si no hay tests reales, si se implemento antes de testear, o si se hardcodearon respuestas. Usa edgeCasesCovered y edgeCasesMissed.',
    'finalJudgeScore para from-scratch = SUMA de searchEfficiency + toolMastery + errorRecovery + pipelineCohesion + outputQuality + uxUiFidelity + accessibilityScore + algorithmicAccuracy. Maximo 150. Prohibido promediar.',
  ],
};

export function buildJudgePrompts(input: PFJudgeInput): { system: string; prompt: string } {
  const isFlowAssembler = input.suite === 'flow-assembler';
  const systemLines = [
    'Actua como un Staff Engineer implacable evaluando a un Junior en un entorno agentico.',
    'Cero indulgencia. No premies intentos, premia evidencia.',
    'Tu objetivo no es ser amable: es detectar sobrelectura, mal uso de herramientas, bucles, alucinaciones, y defectos reales.',
    'Evalua el proceso cognitivo, no solo si hay archivos al final.',
    'Si el agente logro algo por fuerza bruta con exceso de tokens, lecturas inutiles o errores MCP repetidos, penaliza fuerte.',
    'Escala obligatoria: searchEfficiency: 0-20, toolMastery: 0-20, errorRecovery: 0-20, pipelineCohesion: 0-20, outputQuality: 0-10.',
    'pipelineCohesion debe evaluar si Step C respeto el copy de Step A y el theme de Step B, o si alucino contenido/estilos ignorando al equipo.',
    'outputQuality debe evaluar la calidad estetica y estructural de un index.html puro, zero-build, renderizable directamente en navegador.',
    'Penaliza fuerte si el resultado requiere React, TSX, Node, Vite, package managers, bundlers o cualquier build step; debe ser sin build step. Debe usar Tailwind por CDN y configurar tailwind.config inline cuando aplique.',
  ];

  if (isFlowAssembler) {
    systemLines.push(
      'Para la suite flow-assembler, estas dimensiones base se reinterpretan sobre el Meta-Agente: searchEfficiency = si consulto/uso solo el catalogo descubierto relevante; toolMastery = si obedecio estrictamente el schema JSON estructurado; errorRecovery = si evito bucles, reparaciones ciegas o dependencia de texto libre.',
      'Para flow-assembler tambien debes evaluar dagValidity: 0-20, componentSelection: 0-20, instructionQuality: 0-20.',
      'dagValidity debe verificar ids unicos, ausencia de ciclos, y que todos los prevStepIds apunten a steps existentes.',
      'componentSelection debe verificar que roleId y modIds salgan del catalogo descubierto y encajen logicamente con la intencion.',
      'instructionQuality debe penalizar prompts ambiguos, steps monoliticos o cualquier intento del Meta-Agente de resolver la tarea en vez de delegarla.',
      'Para flow-assembler, finalJudgeScore debe ser la SUMA exacta de las ocho dimensiones semanticas. Prohibido promediar. Maximo 150.',
    );
  }

  for (const line of SUITE_JUDGE_INSTRUCTIONS[input.suite] ?? []) {
    systemLines.push(line);
  }

  if (input.groundTruth?.tests) {
    systemLines.push(
      'GROUND TRUTH — RESULTADOS DE TESTS EJECUTADOS REALMENTE: Los resultados de tests en <ground_truth_test_results_json> son REALES y fueron ejecutados de forma determinista. La dimension algorithmicAccuracy DEBE anclarse en ellos — si los tests fallan, la implementacion no cubre esos casos, puntua bajo; no contradigas la ejecucion verificada con una lectura del codigo. Un pase completo (passed === total, total > 0) es evidencia solida de corrección.',
    );
  }

  if (input.groundTruth?.a11y) {
    systemLines.push(
      'GROUND TRUTH — VIOLACIONES DE ACCESIBILIDAD (axe-core WCAG): Los resultados en <ground_truth_a11y_json> provienen de un analisis axe-core REAL ejecutado sobre el HTML estatico del componente. La dimension accessibilityScore DEBE anclarse en ellos — N violaciones estructurales WCAG = no accesible, penaliza en proporcion; no contradigas estas violaciones verificadas con una lectura del codigo. NOTA: el contraste de color NO esta capturado por el analizador estatico (jsdom no renderiza CSS visual), por lo que debes evaluar esa dimension tu mismo basandote en los tokens del theme.',
    );
  }

  if (input.groundTruth?.api) {
    systemLines.push(
      'GROUND TRUTH — VERIFICACION HTTP REAL DE LA API EXPRESS: Los resultados en <ground_truth_api_json> provienen de arrancar REALMENTE el servidor Express del agente y ejecutar peticiones HTTP deterministas contra el. Son HECHOS verificados, no inferencias del codigo. La dimension regressionScore DEBE reflejarlos con total fidelidad — no los contradiga:',
      '  • Si booted:false → el servidor no arranco (error de sintaxis, dependencia faltante, crash). Eso es una regresion critica: penaliza fuertemente.',
      '  • Si avatar-endpoint-exists ok:false (status 404) → el endpoint POST /users/:id/avatar de la Epoch 1 no existe en el codigo final. Es una regresion probada: penaliza fuertemente en brokenEpoch1Features.',
      '  • Si auth-enforced ok:false → la ruta protegida /users devolvio 200 sin credenciales: el middleware de auth esta roto. Penaliza fuertemente.',
      '  • Si todos los checks son ok:true → la API supero la verificacion en tiempo de ejecucion; refleja eso positivamente en regressionScore.',
      '  Ningun analisis textual del codigo puede anular estos resultados de ejecucion real.',
    );
  }

  systemLines.push(
    'Usa toda la escala. Un desempeno perfecto debe recibir el maximo de su dimension.',
    'finalJudgeScore debe ser la SUMA exacta de TODAS las dimensiones semanticas aplicables a esta suite. Prohibido promediar.',
    'Devuelve solo JSON valido que cumpla exactamente el schema solicitado.',
  );

  const flowAssemblerEvidence = input.flowAssembler
    ? [
      '',
      '<flow_assembler_user_intent>',
      input.flowAssembler.userIntent,
      '</flow_assembler_user_intent>',
      '',
      '<flow_assembler_discovered_catalog_json>',
      stringify(input.flowAssembler.discoveredCatalog),
      '</flow_assembler_discovered_catalog_json>',
      '',
      '<flow_assembler_generated_ast_json>',
      stringify(input.flowAssembler.generatedAst),
      '</flow_assembler_generated_ast_json>',
    ]
    : [];

  const progressionEvidence = input.progression
    ? [
      '',
      '<progression_epochs_json>',
      stringify(input.progression.epochs.map((epoch) => ({
        id: epoch.id,
        label: epoch.label,
        prompt: epoch.prompt,
        vfsSnapshot: epoch.vfsSnapshot,
      }))),
      '</progression_epochs_json>',
      '',
      'Para regressionScore: compara el snapshot de la Epoch 1 (anadir avatares) con el de la Epoch 2 (refactor del auth). Verifica que el endpoint de avatares sobrevivio intacto y que no se cambiaron dependencias/firmas fuera del scope del refactor de auth.',
    ]
    : [];

  const groundTruthEvidence = input.groundTruth?.tests
    ? [
      '',
      '<ground_truth_test_results_json>',
      stringify({
        ran: input.groundTruth.tests.ran,
        passed: input.groundTruth.tests.passed,
        failed: input.groundTruth.tests.failed,
        total: input.groundTruth.tests.total,
      }),
      '</ground_truth_test_results_json>',
    ]
    : [];

  const groundTruthA11yEvidence = input.groundTruth?.a11y
    ? [
      '',
      '<ground_truth_a11y_json>',
      stringify({
        ran: input.groundTruth.a11y.ran,
        violations: input.groundTruth.a11y.violations,
        critical: input.groundTruth.a11y.critical,
        passes: input.groundTruth.a11y.passes,
      }),
      '</ground_truth_a11y_json>',
    ]
    : [];

  const groundTruthApiEvidence = input.groundTruth?.api
    ? [
      '',
      '<ground_truth_api_json>',
      stringify({
        booted: input.groundTruth.api.booted,
        checks: input.groundTruth.api.checks,
        errorMessage: input.groundTruth.api.errorMessage,
      }),
      '</ground_truth_api_json>',
    ]
    : [];

  return {
    system: systemLines.join('\n'),
    prompt: [
      `<run_id>${input.runId}</run_id>`,
      `<case_id>${input.caseId}</case_id>`,
      `<suite>${input.suite}</suite>`,
      `<model_under_test>${input.modelUnderTest}</model_under_test>`,
      '',
      '<evaluation_user_prompt>',
      input.userPrompt,
      '</evaluation_user_prompt>',
      '',
      '<agent_conversation_history_json>',
      stringify(input.conversation),
      '</agent_conversation_history_json>',
      '',
      '<cognitive_execution_trace_json>',
      stringify(input.cognitiveTrace),
      '</cognitive_execution_trace_json>',
      '',
      '<vfs_snapshot_json>',
      stringify(input.vfsSnapshot),
      '</vfs_snapshot_json>',
      '',
      '<telemetry_json>',
      stringify(input.telemetry),
      '</telemetry_json>',
      '',
      '<mcp_tool_execution_log_json>',
      stringify(input.toolEvents),
      '</mcp_tool_execution_log_json>',
      ...flowAssemblerEvidence,
      ...progressionEvidence,
      ...groundTruthEvidence,
      ...groundTruthA11yEvidence,
      ...groundTruthApiEvidence,
    ].join('\n'),
  };
}
