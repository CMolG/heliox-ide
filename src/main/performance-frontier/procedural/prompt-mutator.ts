import { createSeededRng } from './seeded-rng';

const PROJECT_PREFIXES = ['aurora', 'vector', 'atlas', 'pulse', 'nimbus'] as const;
const PROJECT_SUFFIXES = ['api', 'gateway', 'core', 'edge', 'service'] as const;
const USER_LOADER_NAMES = ['hydrateUser', 'resolveUser', 'loadUserProfile', 'attachUserProfile'] as const;
const USER_BATCH_NAMES = ['loadUsers', 'fetchUsers', 'hydrateUsersBatch', 'resolveUsers'] as const;
const TEAM_PRODUCT = 'Heliox IDE';
const TEAM_AUDIENCE = 'AI Engineers, Arquitectos de Sistemas y Equipos de Plataforma';
const TEAM_VISUAL_STYLES = [
  'Cyberpunk sobrio',
  'Neobrutalism editorial',
  'Apple-like Minimalism',
  'Terminal/Retro',
  'Nothing OS minimalista',
  'Liquid Glass oscuro',
  'Dashboard tecnico premium',
  'Spatial Canvas Futurism',
] as const;
const FLOW_ASSEMBLER_BASE_INTENTS = [
  'Necesito un flujo que investigue noticias de IA y luego escriba un post sarcastico para Twitter.',
  'Crea un pipeline que reciba un ticket de Jira, escriba los tests unitarios, y luego implemente la funcion.',
  'Disena un flujo que lea feedback de usuarios, agrupe patrones de dolor y redacte acciones para el equipo de producto.',
  'Quiero un pipeline que revise una pull request, detecte riesgos de seguridad y prepare un resumen ejecutivo.',
  'Necesito coordinar agentes para analizar logs de produccion, aislar la causa raiz y proponer un hotfix minimo.',
] as const;
const FLOW_ASSEMBLER_MUTATIONS = [
  'Optimiza para pasos pequenos y dependencias explicitas.',
  'Incluye una etapa de revision antes del entregable final.',
  'Evita que un unico agente intente hacerlo todo.',
  'Haz que el flujo sea facil de auditar por un humano.',
  'Separa investigacion, sintesis y produccion.',
] as const;

export interface ArchitecturePromptMutation {
  prompt: string;
  variables: {
    projectName: string;
    port: number;
  };
}

export function mutateArchitecturePrompt(seed: number): ArchitecturePromptMutation {
  const rng = createSeededRng(seed);
  const projectName = `${rng.pick(PROJECT_PREFIXES)}-${rng.pick(PROJECT_SUFFIXES)}-${rng.int(100, 999)}`;
  const port = rng.int(3100, 8999);

  return {
    variables: { projectName, port },
    prompt: [
      'Performance Frontier Architecture case.',
      '',
      `Create the folder and file structure for an Express API named "${projectName}".`,
      `The server must listen on port ${port}.`,
      'Use MCP filesystem tools only. Do not describe the files without creating them.',
      '',
      'Required artifacts:',
      '- package.json with a dev script and express dependency',
      '- src/server.js or src/server.ts with an Express app',
      '- src/routes/health.js or src/routes/health.ts exposing /health',
      '- README.md documenting how to start the API',
      '',
      'Keep implementation minimal but runnable.',
    ].join('\n'),
  };
}

export interface AnalysisCaseMutation {
  prompt: string;
  variables: {
    loaderName: string;
    batchFunctionName: string;
    bugLine: number;
  };
  initialFiles: Record<string, string>;
}

export function mutateAnalysisCase(seed: number): AnalysisCaseMutation {
  const rng = createSeededRng(seed);
  const loaderName = rng.pick(USER_LOADER_NAMES);
  const batchFunctionName = rng.pick(USER_BATCH_NAMES);

  const userLoaderLines = [
    "import { readUserRecords } from './user-repository';",
    "import { rememberUser } from './user-cache';",
    '',
    'type UserRecord = { id: string; active: boolean; tier: string };',
    'type LoadedUser = UserRecord & { profileLoaded: true };',
    '',
    `async function ${loaderName}(record: UserRecord): Promise<LoadedUser> {`,
    '  await rememberUser(record.id);',
    '  return { ...record, profileLoaded: true };',
    '}',
    '',
    `export async function ${batchFunctionName}(tenantId: string): Promise<LoadedUser[]> {`,
    '  const records = await readUserRecords(tenantId);',
    `  const users = records.map((record) => ${loaderName}(record)) as unknown as LoadedUser[];`,
    '  return users.filter((user) => user.active);',
    '}',
    '',
    'export async function preloadTenants(tenantIds: string[]): Promise<UserRecord[][]> {',
    '  return Promise.all(tenantIds.map((tenantId) => readUserRecords(tenantId)));',
    '}',
  ];
  const bugLine = userLoaderLines.findIndex((line) => line.includes('records.map')) + 1;

  return {
    variables: {
      loaderName,
      batchFunctionName,
      bugLine,
    },
    prompt: 'Hay un bug de concurrencia en la carga de usuarios. Usa tus herramientas para encontrarlo y explicar la línea exacta.',
    initialFiles: {
      'package.json': JSON.stringify({
        type: 'module',
        scripts: { test: 'vitest run' },
        dependencies: {},
      }, null, 2),
      'src/user-loader.ts': userLoaderLines.join('\n'),
      'src/user-repository.ts': [
        'export async function readUserRecords(tenantId: string) {',
        '  await Promise.resolve();',
        '  return [',
        "    { id: `${tenantId}:u1`, active: true, tier: 'pro' },",
        "    { id: `${tenantId}:u2`, active: false, tier: 'free' },",
        '  ];',
        '}',
      ].join('\n'),
      'src/user-cache.ts': [
        'export async function rememberUser(userId: string): Promise<void> {',
        '  await Promise.resolve(userId);',
        '}',
        '',
        'export async function warmUserCache(userIds: string[]): Promise<void[]> {',
        '  return Promise.all(userIds.map((userId) => rememberUser(userId)));',
        '}',
      ].join('\n'),
    },
  };
}

export interface TeamWorkCaseMutation {
  prompt: string;
  variables: {
    product: string;
    visualStyle: string;
    audience: string;
  };
}

export function mutateTeamWorkCase(seed: number): TeamWorkCaseMutation {
  const rng = createSeededRng(seed);
  const product = TEAM_PRODUCT;
  const visualStyle = TEAM_VISUAL_STYLES[rng.int(1000, 9999) % TEAM_VISUAL_STYLES.length];
  const audience = TEAM_AUDIENCE;

  return {
    variables: {
      product,
      visualStyle,
      audience,
    },
    prompt: [
      'Performance Frontier Team Work case.',
      `Producto: ${product}.`,
      `Estilo visual: ${visualStyle}.`,
      `Audiencia principal: ${audience}.`,
      'Tres agentes deben colaborar secuencialmente para producir una landing page zero-build con HTML puro y Tailwind CDN sin perder informacion entre pasos.',
    ].join('\n'),
  };
}

const DESIGN_COMPONENTS = [
  { id: 'datepicker', label: 'un DatePicker accesible con navegacion por teclado y seleccion de rango' },
  { id: 'pricing-table', label: 'una tabla de precios con 3 planes y un toggle mensual/anual' },
  { id: 'combobox', label: 'un combobox con autocompletado y listado filtrable por teclado' },
  { id: 'confirm-modal', label: 'un modal de confirmacion accesible con focus trap y cierre por Escape' },
] as const;

const DESIGN_PALETTES = [
  { name: 'Indigo Noir', primary: '#6366f1', surface: '#0b0b12', text: '#e8e8f0' },
  { name: 'Emerald Mist', primary: '#10b981', surface: '#07120e', text: '#e6fff5' },
  { name: 'Amber Forge', primary: '#f59e0b', surface: '#140d02', text: '#1a1205' },
  { name: 'Rose Quartz', primary: '#f43f5e', surface: '#140309', text: '#ffe6ec' },
] as const;

const BILLING_COUNTRY_TAXES = [
  { code: 'ES', label: 'Espana', rate: 0.21, tax: 'IVA' },
  { code: 'DE', label: 'Alemania', rate: 0.19, tax: 'VAT' },
  { code: 'FR', label: 'Francia', rate: 0.20, tax: 'TVA' },
  { code: 'US', label: 'Estados Unidos', rate: 0.0, tax: 'externo' },
] as const;

function factorialOf(n: number): number {
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
}

export interface DevelopmentCaseMutation {
  prompt: string;
  variables: {
    moduleName: string;
    factorialInput: number;
    datasetA: number;
    datasetB: number;
  };
  initialFiles: Record<string, string>;
}

export function mutateDevelopmentCase(seed: number): DevelopmentCaseMutation {
  const rng = createSeededRng(seed);
  const factorialInput = rng.int(5, 9);
  const datasetA = rng.int(10, 40);
  const datasetB = rng.int(41, 80);
  const moduleName = 'calculator';

  const testFile = [
    "import { describe, it, expect } from 'vitest';",
    "import { divide, factorial, average, safeParseAmount } from './calculator';",
    '',
    "describe('divide', () => {",
    "  it('divides two finite numbers', () => { expect(divide(10, 2)).toBe(5); });",
    "  it('throws on division by zero', () => { expect(() => divide(1, 0)).toThrow(); });",
    "  it('rejects non-finite operands', () => {",
    '    expect(() => divide(1, NaN)).toThrow();',
    '    expect(() => divide(Infinity, 2)).toThrow();',
    '  });',
    '});',
    '',
    "describe('factorial', () => {",
    `  it('computes factorial of ${factorialInput}', () => { expect(factorial(${factorialInput})).toBe(${factorialOf(factorialInput)}); });`,
    "  it('returns 1 for 0', () => { expect(factorial(0)).toBe(1); });",
    "  it('throws on negative input', () => { expect(() => factorial(-3)).toThrow(); });",
    "  it('throws on non-integer input', () => { expect(() => factorial(2.5)).toThrow(); });",
    '});',
    '',
    "describe('average', () => {",
    `  it('averages a list', () => { expect(average([${datasetA}, ${datasetB}])).toBeCloseTo(${(datasetA + datasetB) / 2}); });`,
    "  it('returns 0 for an empty list', () => { expect(average([])).toBe(0); });",
    "  it('rejects lists with non-finite members', () => { expect(() => average([1, NaN])).toThrow(); });",
    '});',
    '',
    "describe('safeParseAmount', () => {",
    "  it('parses numeric strings', () => { expect(safeParseAmount('12.5')).toBe(12.5); });",
    "  it('returns 0 for null or undefined', () => {",
    '    expect(safeParseAmount(null)).toBe(0);',
    '    expect(safeParseAmount(undefined)).toBe(0);',
    '  });',
    "  it('returns 0 for non-numeric input', () => { expect(safeParseAmount('abc')).toBe(0); });",
    '});',
    '',
  ].join('\n');

  return {
    variables: { moduleName, factorialInput, datasetA, datasetB },
    prompt: [
      'Performance Frontier Development case (TDD y logica algoritmica).',
      '',
      'Ya existe un archivo de unit tests calculator.test.ts que actualmente FALLA porque no hay implementacion.',
      'Lee calculator.test.ts con cuidado y escribe el archivo de implementacion calculator.ts para que TODOS los tests pasen.',
      `Debe exportar: divide, factorial, average y safeParseAmount. Casos de prueba clave: factorial(${factorialInput}) y average([${datasetA}, ${datasetB}]).`,
      'Cubre los casos limite (division por cero, operandos no finitos, factorial negativo o no entero, listas vacias, parseo de null/valores invalidos), no solo el happy path.',
      'PROHIBIDO modificar calculator.test.ts. PROHIBIDO hardcodear valores de retorno para enganar a los tests: implementa la logica real.',
      'Usa solo herramientas MCP de filesystem para leer el test y escribir calculator.ts.',
    ].join('\n'),
    initialFiles: {
      'package.json': JSON.stringify({
        type: 'module',
        scripts: { test: 'vitest run' },
        devDependencies: { vitest: '^4' },
      }, null, 2),
      'calculator.test.ts': testFile,
    },
  };
}

export interface BusinessKnowledgeCaseMutation {
  prompt: string;
  variables: {
    projectName: string;
    basePriceUsd: number;
    tier1Seats: number;
    tier1Pct: number;
    tier2Seats: number;
    tier2Pct: number;
  };
  initialFiles: Record<string, string>;
}

export function mutateBusinessKnowledgeCase(seed: number): BusinessKnowledgeCaseMutation {
  const rng = createSeededRng(seed);
  const projectName = `${rng.pick(PROJECT_PREFIXES)}-billing-${rng.int(100, 999)}`;
  const basePriceUsd = rng.int(20, 60);
  const tier1Seats = rng.int(8, 12);
  const tier1Pct = rng.int(8, 12);
  const tier2Seats = rng.int(40, 60);
  const tier2Pct = rng.int(18, 25);
  const tier3Seats = rng.int(95, 120);
  const tier3Pct = rng.int(28, 35);

  const rulesMd = [
    `# SaaS Billing Rules — ${projectName}`,
    '',
    '## 1. Base subscription',
    `- Plan price: $${basePriceUsd} per seat per month.`,
    '',
    '## 2. Volume discounts (applied to the seat subtotal, BEFORE proration and tax)',
    `- ${tier1Seats}+ seats: ${tier1Pct}% off`,
    `- ${tier2Seats}+ seats: ${tier2Pct}% off`,
    `- ${tier3Seats}+ seats: ${tier3Pct}% off`,
    '- Only the single highest qualifying tier applies. Discounts are NOT cumulative.',
    '',
    '## 3. Proration',
    '- For a partial billing period, multiply the discounted subtotal by (remainingDays / daysInMonth).',
    '- `remainingDays` and `daysInMonth` are provided in the input.',
    '',
    '## 4. Taxes (applied AFTER discount and proration)',
    ...BILLING_COUNTRY_TAXES.map((country) => (
      `- ${country.code} (${country.label}): ${Math.round(country.rate * 100)}% ${country.tax}`
    )),
    '- Unknown country: throw an error. NEVER silently default to 0%.',
    '',
    '## 5. Strict order of operations',
    '1. subtotal = basePrice * seats',
    '2. apply the single highest volume discount',
    '3. apply proration',
    '4. apply the country tax',
    '5. round the final total to 2 decimals (only at the end)',
    '',
  ].join('\n');

  return {
    variables: { projectName, basePriceUsd, tier1Seats, tier1Pct, tier2Seats, tier2Pct },
    prompt: [
      'Performance Frontier Business-Knowledge case (traduccion de dominio).',
      '',
      `Lee rules.md, que define la logica de facturacion del SaaS "${projectName}" (precio base $${basePriceUsd}/asiento, prorrata, impuestos por pais y descuentos por volumen).`,
      'Implementa src/BillingService.ts exportando:',
      '  calculateInvoice(input: { seats: number; country: string; remainingDays: number; daysInMonth: number })',
      '    => { subtotal: number; discountedSubtotal: number; proratedSubtotal: number; tax: number; total: number }',
      'Respeta rules.md AL PIE DE LA LETRA: descuentos no acumulativos (solo el tramo mas alto), impuestos despues de descuento y prorrata, paises desconocidos lanzan error, y el orden estricto de operaciones.',
      'Usa solo herramientas MCP de filesystem para leer rules.md y escribir src/BillingService.ts.',
    ].join('\n'),
    initialFiles: {
      'rules.md': rulesMd,
    },
  };
}

export interface DesignCaseMutation {
  prompt: string;
  variables: {
    component: string;
    palette: string;
    primaryColor: string;
  };
  initialFiles: Record<string, string>;
}

export function mutateDesignCase(seed: number): DesignCaseMutation {
  const rng = createSeededRng(seed);
  const component = DESIGN_COMPONENTS[rng.int(0, DESIGN_COMPONENTS.length - 1)];
  const palette = DESIGN_PALETTES[rng.int(0, DESIGN_PALETTES.length - 1)];

  const theme = {
    name: palette.name,
    colors: {
      primary: palette.primary,
      surface: palette.surface,
      text: palette.text,
      muted: '#8b8b9a',
      border: 'rgba(255,255,255,0.12)',
    },
    typography: {
      fontFamily: 'Inter, system-ui, sans-serif',
      scale: { sm: '13px', base: '15px', lg: '20px', xl: '30px' },
    },
    spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px' },
    radii: { sm: '6px', md: '10px', lg: '16px' },
    shadow: '0 16px 42px rgba(0,0,0,0.35)',
  };

  return {
    variables: { component: component.id, palette: palette.name, primaryColor: palette.primary },
    prompt: [
      'Performance Frontier Design case (Atomic UI Component).',
      '',
      `Construye ${component.label} como un UNICO index.html autocontenido.`,
      'Lee theme.json primero y respeta sus tokens de forma ESTRICTA (colors, typography, spacing, radii). No inventes colores fuera del theme.',
      'Usa HTML puro + Tailwind via CDN: <script src="https://cdn.tailwindcss.com"></script>, y configura tailwind.config inline a partir de theme.json. NO React, NO TSX, NO build step.',
      'La accesibilidad se evalua con dureza: roles y atributos ARIA correctos (aria-*), navegacion completa por teclado, manejo de foco visible y contraste de color AA.',
      'Simula la interactividad con JavaScript vanilla dentro de <script> donde haga falta.',
      'Usa solo herramientas MCP de filesystem para leer theme.json y escribir index.html.',
    ].join('\n'),
    initialFiles: {
      'theme.json': JSON.stringify(theme, null, 2),
    },
  };
}

export interface ProgressionEpochMutation {
  id: string;
  label: string;
  prompt: string;
}

export interface ProgressionCaseMutation {
  prompt: string;
  variables: {
    projectName: string;
    port: number;
  };
  initialFiles: Record<string, string>;
  epochs: ProgressionEpochMutation[];
}

export function mutateProgressionCase(seed: number): ProgressionCaseMutation {
  const rng = createSeededRng(seed);
  const projectName = `${rng.pick(PROJECT_PREFIXES)}-${rng.pick(PROJECT_SUFFIXES)}-${rng.int(100, 999)}`;
  const port = rng.int(3100, 8999);

  const initialFiles: Record<string, string> = {
    'package.json': JSON.stringify({
      name: projectName,
      type: 'commonjs',
      scripts: { start: 'node src/server.js' },
      dependencies: { express: '^4.19.2' },
    }, null, 2),
    'src/server.js': [
      "const express = require('express');",
      "const { requireAuth } = require('./middleware/auth');",
      "const healthRouter = require('./routes/health');",
      "const usersRouter = require('./routes/users');",
      "const sessionsRouter = require('./routes/sessions');",
      '',
      'const app = express();',
      'app.use(express.json());',
      '',
      "app.use('/health', healthRouter);",
      "app.use('/users', requireAuth, usersRouter);",
      "app.use('/sessions', sessionsRouter);",
      '',
      `const PORT = process.env.PORT || ${port};`,
      'app.listen(PORT, () => console.log(`' + projectName + ' listening on ${PORT}`));',
      '',
      'module.exports = app;',
      '',
    ].join('\n'),
    'src/middleware/auth.js': [
      '// Simple API-key auth. Epoch 2 refactors this to JWT with refresh tokens.',
      "const API_KEYS = new Set(['dev-key-123']);",
      '',
      'function requireAuth(req, res, next) {',
      "  const key = req.header('x-api-key');",
      '  if (!key || !API_KEYS.has(key)) {',
      "    return res.status(401).json({ error: 'Unauthorized' });",
      '  }',
      "  req.user = { id: 'u_demo', key };",
      '  next();',
      '}',
      '',
      'module.exports = { requireAuth };',
      '',
    ].join('\n'),
    'src/routes/health.js': [
      "const { Router } = require('express');",
      '',
      'const router = Router();',
      "router.get('/', (req, res) => res.json({ status: 'ok' }));",
      '',
      'module.exports = router;',
      '',
    ].join('\n'),
    'src/routes/users.js': [
      "const { Router } = require('express');",
      '',
      'const router = Router();',
      "const users = [{ id: 'u_demo', name: 'Demo User' }];",
      '',
      "router.get('/', (req, res) => res.json(users));",
      "router.get('/:id', (req, res) => {",
      '  const user = users.find((u) => u.id === req.params.id);',
      "  if (!user) return res.status(404).json({ error: 'Not found' });",
      '  res.json(user);',
      '});',
      '',
      'module.exports = router;',
      '',
    ].join('\n'),
    'src/routes/sessions.js': [
      "const { Router } = require('express');",
      '',
      'const router = Router();',
      "router.post('/', (req, res) => {",
      '  const { apiKey } = req.body || {};',
      "  if (apiKey !== 'dev-key-123') return res.status(401).json({ error: 'Invalid credentials' });",
      "  res.status(201).json({ token: 'dev-key-123' });",
      '});',
      '',
      'module.exports = router;',
      '',
    ].join('\n'),
  };

  const epochs: ProgressionEpochMutation[] = [
    {
      id: 'epoch-1',
      label: 'Epoch 1 — Anadir endpoint de subida de avatares',
      prompt: [
        'Epoch 1 (Mutacion). El proyecto es una API Express funcional (CommonJS) con endpoints /health, /users y /sessions y un middleware de auth.',
        'Anade un endpoint para subir avatares: POST /users/:id/avatar que acepte un body JSON { avatarUrl } y lo asocie al usuario correspondiente.',
        'Reutiliza el middleware de auth existente. NO rompas los endpoints actuales. Manten el estilo del codigo (CommonJS, routers de Express).',
        'Usa herramientas MCP de filesystem para leer el codigo existente y escribir los cambios.',
      ].join('\n'),
    },
    {
      id: 'epoch-2',
      label: 'Epoch 2 — Refactor del Auth a JWT con refresh tokens',
      prompt: [
        'Epoch 2 (Mutacion / Refactor). Refactoriza el middleware de auth (src/middleware/auth.js) para usar JWT con access tokens y refresh tokens.',
        '- requireAuth debe verificar el access token via cabecera Authorization: Bearer <jwt>.',
        '- Anade la utilidad/endpoint para emitir y rotar refresh tokens.',
        '- Criterio de aceptacion (extremo a extremo): el login debe seguir funcionando. Si cambias COMO se VERIFICAN los tokens, actualiza tambien COMO se EMITEN: el endpoint de login/sesiones debe emitir un JWT valido, para que un cliente pueda autenticarse y acceder a las rutas protegidas despues del cambio.',
        'CRITICO: NO rompas el endpoint de subida de avatares anadido en la Epoch 1 ni los demas endpoints. No cambies dependencias, firmas o contratos que no necesites para el JWT.',
        'Usa herramientas MCP de filesystem para leer el codigo existente y escribir los cambios.',
      ].join('\n'),
    },
  ];

  return {
    variables: { projectName, port },
    prompt: [
      'Performance Frontier Progression case (Brownfield Development).',
      `Una API Express viva llamada "${projectName}" evoluciona en dos epochs de mutacion sobre el mismo codigo, sin reiniciar el proyecto.`,
      'Epoch 1 anade un endpoint de avatares; Epoch 2 refactoriza el auth a JWT con refresh tokens sin romper lo anterior.',
    ].join('\n'),
    initialFiles,
    epochs,
  };
}

export interface FlowAssemblerIntentMutation {
  prompt: string;
  variables: {
    userIntent: string;
    baseIntent: string;
    mutation: string;
  };
}

export function mutateFlowAssemblerIntent(seed: number): FlowAssemblerIntentMutation {
  const rng = createSeededRng(seed);
  const baseIntent = FLOW_ASSEMBLER_BASE_INTENTS[seed % FLOW_ASSEMBLER_BASE_INTENTS.length];
  const mutation = rng.pick(FLOW_ASSEMBLER_MUTATIONS);
  const userIntent = [
    baseIntent,
    mutation,
  ].join(' ');

  return {
    prompt: userIntent,
    variables: {
      userIntent,
      baseIntent,
      mutation,
    },
  };
}
