import { z } from 'zod';

const score20Description = 'Puntuacion del 0 al 20. OBLIGATORIO usar toda la escala. Un trabajo perfecto merece un 20.';

const assemblerEvaluationSchemas = {
  dagValidity: z.object({
    score: z.number().min(0).max(20).describe('Puntuacion del 0 al 20. OBLIGATORIO usar toda la escala. Un DAG matematicamente valido merece un 20.'),
    justification: z.string().describe('Evalua si el JSON generado es un DAG valido: ids unicos, sin ciclos, y prevStepIds apuntando solo a steps existentes.'),
    missingDependencyIds: z.array(z.string()).describe('Dependencias prevStepIds que no existen en el array steps.'),
    cycleDetected: z.boolean().describe('True si hay ciclos o dependencias infinitas.'),
  }).strict(),
  componentSelection: z.object({
    score: z.number().min(0).max(20).describe('Puntuacion del 0 al 20. OBLIGATORIO usar toda la escala. Una seleccion perfecta de catalogo merece un 20.'),
    justification: z.string().describe('Evalua si eligio roles y mods adecuados del catalogo descubierto para la intencion del usuario.'),
    inappropriateRoleIds: z.array(z.string()).describe('roleId usados de forma inadecuada o fuera del catalogo descubierto.'),
    inappropriateModIds: z.array(z.string()).describe('modIds usados de forma inadecuada o fuera del catalogo descubierto.'),
  }).strict(),
  instructionQuality: z.object({
    score: z.number().min(0).max(20).describe('Puntuacion del 0 al 20. OBLIGATORIO usar toda la escala. Prompts claros, delimitados y delegables merecen un 20.'),
    justification: z.string().describe('Evalua si cada prompt de step es claro y delimitado, o si el Meta-Agente intento resolver la tarea en vez de delegarla.'),
    weakStepIds: z.array(z.string()).describe('Steps con prompts ambiguos, demasiado amplios o mal delimitados.'),
    selfSolvingDetected: z.boolean().describe('True si el assembler resolvio la tarea en el prompt/AST en vez de programar agentes que la ejecuten.'),
  }).strict(),
};

const domainEvaluationSchemas = {
  algorithmicAccuracy: z.object({
    score: z.number().min(0).max(20).describe('Puntuacion del 0 al 20. OBLIGATORIO usar toda la escala. Una implementacion que pasa los tests cubriendo casos limite merece un 20.'),
    justification: z.string().describe('Evalua si la implementacion cubre casos limite (nulls, desbordamientos numericos, tipos invalidos, division por cero) y no solo el happy path. Penaliza hardcodear valores para enganar a los tests.'),
    edgeCasesCovered: z.array(z.string()).describe('Casos limite que la implementacion maneja correctamente.'),
    edgeCasesMissed: z.array(z.string()).describe('Casos limite que la implementacion ignora o resuelve mal.'),
  }).strict(),
  domainLogicAdherence: z.object({
    score: z.number().min(0).max(20).describe('Puntuacion del 0 al 20. OBLIGATORIO usar toda la escala. Adherencia perfecta a las reglas de negocio del Markdown merece un 20.'),
    justification: z.string().describe('Actua como QA de negocio. Compara el codigo contra rules.md regla por regla: prorrata, impuestos por pais, descuentos por volumen. Penaliza fuerte cada regla olvidada o mal calculada.'),
    violatedRules: z.array(z.string()).describe('Reglas concretas de rules.md que el codigo omite, contradice o calcula mal.'),
  }).strict(),
  uxUiFidelity: z.object({
    score: z.number().min(0).max(20).describe('Puntuacion del 0 al 20. OBLIGATORIO usar toda la escala. Fidelidad visual perfecta al theme y al componente pedido merece un 20.'),
    justification: z.string().describe('Evalua estructura, jerarquia visual, interactividad simulada y respeto estricto al theme.json (colores, tipografia, spacing, radii). Penaliza si invento tokens fuera del theme.'),
    themeViolations: z.array(z.string()).describe('Desviaciones concretas respecto a los tokens definidos en theme.json.'),
  }).strict(),
  accessibilityScore: z.object({
    score: z.number().min(0).max(20).describe('Puntuacion del 0 al 20. OBLIGATORIO usar toda la escala. Un componente con semantica ARIA correcta, foco gestionado y contraste AA merece un 20.'),
    justification: z.string().describe('Evalua contraste de color, semantica ARIA (roles, labels, aria-*), navegacion por teclado y manejo de foco. Penaliza divs clicables sin rol, inputs sin label y contrastes insuficientes.'),
    a11yViolations: z.array(z.string()).describe('Violaciones concretas de accesibilidad detectadas.'),
  }).strict(),
  regressionScore: z.object({
    score: z.number().min(0).max(30).describe('Puntuacion del 0 al 30. OBLIGATORIO usar toda la escala. Mutar el proyecto SIN romper nada previo merece un 30.'),
    justification: z.string().describe('Examina el codigo de la Epoch 2 (refactor del auth) y pregunta: al tocar el Auth, rompio el endpoint de avatares de la Epoch 1? Cambio dependencias, firmas o contratos que no debia? Penaliza fuerte cualquier regresion silenciosa.'),
    brokenEpoch1Features: z.array(z.string()).describe('Funcionalidades introducidas en epochs previas que la mutacion final rompio o degrado.'),
    unintendedDependencyChanges: z.array(z.string()).describe('Dependencias, imports, firmas o contratos modificados sin que la tarea lo pidiera.'),
  }).strict(),
};

export const judgeSchema = z.object({
  runId: z.string(),
  evaluations: z.object({
    searchEfficiency: z.object({
      score: z.number().min(0).max(20).describe(score20Description),
      justification: z.string().describe('Evalua si encontro los archivos rapido o leyo medio repo a ciegas.'),
      unnecessaryFilesRead: z.array(z.string()),
    }).strict(),
    toolMastery: z.object({
      score: z.number().min(0).max(20).describe(score20Description),
      justification: z.string().describe('Penaliza si fallo la sintaxis del JSON MCP o si reescribio archivos enteros en vez de usar diffs.'),
      syntaxErrorsCount: z.number(),
    }).strict(),
    errorRecovery: z.object({
      score: z.number().min(0).max(20).describe(score20Description),
      justification: z.string().describe('Soluciono errores de las herramientas inteligentemente o entro en un bucle ciego.'),
      loopDetected: z.boolean(),
    }).strict(),
    pipelineCohesion: z.object({
      score: z.number().min(0).max(20).describe(score20Description),
      justification: z.string().describe('Evalua explicitamente: ¿El codigo final (Step C) respeto los textos generados en el Step A y los colores/estilos definidos en el Step B, o el agente final alucino su propio contenido ignorando al equipo?'),
      handoffBreaks: z.array(z.string()).describe('Perdidas de informacion entre Planner, Designer y Developer.'),
    }).strict(),
    outputQuality: z.object({
      score: z.number().min(0).max(10).describe('Puntuacion del 0 al 10. OBLIGATORIO usar toda la escala. Un index.html zero-build excelente merece un 10.'),
      justification: z.string().describe('Evalua la calidad estetica, estructura, accesibilidad basica y robustez de un index.html puro, renderizable directamente en navegador y sin build step. Penaliza fuerte si requiere React, TSX, Node, Vite, bundlers o cualquier paso de compilacion.'),
      edgeCasesMissed: z.array(z.string()),
    }).strict(),
    dagValidity: assemblerEvaluationSchemas.dagValidity.optional(),
    componentSelection: assemblerEvaluationSchemas.componentSelection.optional(),
    instructionQuality: assemblerEvaluationSchemas.instructionQuality.optional(),
    algorithmicAccuracy: domainEvaluationSchemas.algorithmicAccuracy.optional(),
    domainLogicAdherence: domainEvaluationSchemas.domainLogicAdherence.optional(),
    uxUiFidelity: domainEvaluationSchemas.uxUiFidelity.optional(),
    accessibilityScore: domainEvaluationSchemas.accessibilityScore.optional(),
    regressionScore: domainEvaluationSchemas.regressionScore.optional(),
  }).strict(),
  finalJudgeScore: z.number().min(0).max(150).describe('Suma exacta de las dimensiones semanticas aplicables. No promediar. Maximo 90 general o 150 para flow-assembler.'),
  verdict: z.enum(['pass', 'partial', 'fail']),
  criticalFailures: z.array(z.string()).describe('Errores imperdonables: salir del sandbox, romper dependencias previas, alucinaciones graves.'),
}).strict();

export const flowAssemblerJudgeSchema = judgeSchema.extend({
  evaluations: judgeSchema.shape.evaluations.extend({
    dagValidity: assemblerEvaluationSchemas.dagValidity,
    componentSelection: assemblerEvaluationSchemas.componentSelection,
    instructionQuality: assemblerEvaluationSchemas.instructionQuality,
  }).strict(),
});

export const developmentJudgeSchema = judgeSchema.extend({
  evaluations: judgeSchema.shape.evaluations.extend({
    algorithmicAccuracy: domainEvaluationSchemas.algorithmicAccuracy,
  }).strict(),
});

export const businessKnowledgeJudgeSchema = judgeSchema.extend({
  evaluations: judgeSchema.shape.evaluations.extend({
    domainLogicAdherence: domainEvaluationSchemas.domainLogicAdherence,
  }).strict(),
});

export const designJudgeSchema = judgeSchema.extend({
  evaluations: judgeSchema.shape.evaluations.extend({
    uxUiFidelity: domainEvaluationSchemas.uxUiFidelity,
    accessibilityScore: domainEvaluationSchemas.accessibilityScore,
  }).strict(),
});

export const progressionJudgeSchema = judgeSchema.extend({
  evaluations: judgeSchema.shape.evaluations.extend({
    regressionScore: domainEvaluationSchemas.regressionScore,
  }).strict(),
});

export type SemanticJudgeResult = z.infer<typeof judgeSchema>;
