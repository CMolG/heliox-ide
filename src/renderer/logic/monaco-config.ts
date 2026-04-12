/**
 * monaco-config.ts — Renderer UI
 *
 * Architecture note:
 * This file follows the explanatory style used across the codebase:
 * explicit intent, clear boundaries, and behavior-preserving structure.
 */
// src/renderer/logic/monaco-config.ts — Monaco Editor language mapping & theme for Heliox IDE

// ─── Extension → Monaco Language ID ──────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  // TypeScript / JavaScript
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',

  // Web
  html: 'html', htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  svg: 'xml',
  xml: 'xml',

  // Data / Config
  json: 'json', jsonc: 'json', json5: 'json',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  env: 'ini',

  // Markdown / Text
  md: 'markdown', mdx: 'markdown',
  txt: 'plaintext',
  log: 'plaintext',

  // Python
  py: 'python', pyw: 'python', pyi: 'python',

  // Rust
  rs: 'rust',

  // Go
  go: 'go',

  // Java / JVM
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  scala: 'scala',
  groovy: 'groovy',

  // C / C++
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',

  // C#
  cs: 'csharp',

  // Shell
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',

  // Ruby
  rb: 'ruby', rake: 'ruby', gemspec: 'ruby',

  // PHP
  php: 'php',

  // Swift
  swift: 'swift',

  // SQL
  sql: 'sql',

  // Docker / DevOps
  dockerfile: 'dockerfile',

  // GraphQL
  graphql: 'graphql', gql: 'graphql',

  // Lua
  lua: 'lua',

  // R
  r: 'r',

  // Perl
  pl: 'perl', pm: 'perl',
};

// Special filenames that override extension-based detection
const FILENAME_TO_LANGUAGE: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  Rakefile: 'ruby',
  Gemfile: 'ruby',
  '.gitignore': 'ini',
  '.gitattributes': 'ini',
  '.editorconfig': 'ini',
  '.env': 'ini',
  '.env.local': 'ini',
  '.env.development': 'ini',
  '.env.production': 'ini',
  '.prettierrc': 'json',
  '.eslintrc': 'json',
  '.babelrc': 'json',
  'tsconfig.json': 'json',
  'package.json': 'json',
  'package-lock.json': 'json',
};

/**
 * Detect Monaco language ID from a filename or path.
 */
export function detectLanguage(filenameOrPath: string): string {
  const filename = filenameOrPath.split('/').pop() ?? filenameOrPath;

  // Check special filenames first
  if (FILENAME_TO_LANGUAGE[filename]) {
    return FILENAME_TO_LANGUAGE[filename];
  }

  // Extract extension
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() ?? '' : '';
  return EXT_TO_LANGUAGE[ext] ?? 'plaintext';
}

// ─── Monaco Diagnostics / Linting Configuration ──────────────────

/**
 * Configure Monaco's built-in diagnostics for TypeScript, JavaScript, and JSON.
 * Enables lint-like hints (unused variables, implicit any, etc.) without
 * requiring an external ESLint integration.
 *
 * Call once per Monaco instance (idempotent — safe to call on every editor mount).
 */
export function configureLinting(monaco: MonacoInstance): void {
  // ── TypeScript diagnostics ─────────────────────────────────────
  const tsDefaults = monaco.languages.typescript.typescriptDefaults;
  tsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  });
  tsDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: true,
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noImplicitAny: false,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    skipLibCheck: true,
    forceConsistentCasingInFileNames: true,
  });

  // ── JavaScript diagnostics (same options, JS-specific defaults) ─
  const jsDefaults = monaco.languages.typescript.javascriptDefaults;
  jsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  });
  jsDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowJs: true,
    checkJs: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    allowSyntheticDefaultImports: true,
  });

  // ── JSON diagnostics ───────────────────────────────────────────
  monaco.languages.json?.jsonDefaults?.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    trailingCommas: 'warning',
  });
}

/**
 * Monaco instance type — minimal subset needed for linting configuration.
 * Avoids importing the full Monaco types which are only available at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MonacoInstance = any;

// ─── Extension → Color (for tree icons) ──────────────────────────

const EXT_COLORS: Record<string, string> = {
  ts: '#3178C6', tsx: '#3178C6', mts: '#3178C6', cts: '#3178C6',
  js: '#F7DF1E', jsx: '#F7DF1E', mjs: '#F7DF1E', cjs: '#F7DF1E',
  json: '#6D8086', jsonc: '#6D8086',
  md: '#519ABA', mdx: '#519ABA',
  css: '#CE679A', scss: '#CE679A', less: '#CE679A',
  html: '#E34C26', htm: '#E34C26',
  py: '#3776AB', pyw: '#3776AB',
  rs: '#DEA584',
  go: '#00ADD8',
  java: '#B07219',
  kt: '#A97BFF', kts: '#A97BFF',
  rb: '#CC342D',
  php: '#4F5D95',
  swift: '#F05138',
  c: '#555555', h: '#555555',
  cpp: '#F34B7D', cc: '#F34B7D', cxx: '#F34B7D',
  cs: '#178600',
  sh: '#89E051', bash: '#89E051', zsh: '#89E051',
  yaml: '#CB171E', yml: '#CB171E',
  toml: '#9C4221',
  sql: '#E38C00',
  svg: '#FFB13B',
  xml: '#FFB13B',
  lua: '#000080',
  r: '#276DC3',
  graphql: '#E10098', gql: '#E10098',
};

export function getExtensionColor(filenameOrPath: string): string {
  const filename = filenameOrPath.split('/').pop() ?? filenameOrPath;
  const ext = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() ?? '' : '';
  return EXT_COLORS[ext] ?? '#525252';
}

// ─── Heliox Dark Theme for Monaco ────────────────────────────────

export const HELIOX_MONACO_THEME = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: '', foreground: 'A9B7C6', background: '2B2B2B' },
    { token: 'comment', foreground: '808080', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'CC7832' },
    { token: 'string', foreground: '6A8759' },
    { token: 'number', foreground: '6897BB' },
    { token: 'type', foreground: 'FFC66D' },
    { token: 'function', foreground: 'FFC66D' },
    { token: 'variable', foreground: 'A9B7C6' },
    { token: 'constant', foreground: '9876AA' },
    { token: 'operator', foreground: 'A9B7C6' },
    { token: 'delimiter', foreground: 'A9B7C6' },
    { token: 'tag', foreground: 'E8BF6A' },
    { token: 'attribute.name', foreground: 'BABABA' },
    { token: 'attribute.value', foreground: '6A8759' },
    { token: 'regexp', foreground: '6A8759' },
  ],
  colors: {
    'editor.background': '#2B2B2B',
    'editor.foreground': '#A9B7C6',
    'editor.lineHighlightBackground': '#323232',
    'editor.selectionBackground': '#214283',
    'editor.inactiveSelectionBackground': '#214283aa',
    'editorCursor.foreground': '#BBBBBB',
    'editorLineNumber.foreground': '#606366',
    'editorLineNumber.activeForeground': '#A4A3A3',
    'editor.selectionHighlightBackground': '#21428340',
    'editorIndentGuide.background': '#3B3B3B',
    'editorIndentGuide.activeBackground': '#505050',
    'editorWidget.background': '#3C3F41',
    'editorWidget.border': '#515151',
    'editorSuggestWidget.background': '#3C3F41',
    'editorSuggestWidget.border': '#515151',
    'editorSuggestWidget.selectedBackground': '#2E436E',
    'editorHoverWidget.background': '#3C3F41',
    'editorHoverWidget.border': '#515151',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#5A5A5A80',
    'scrollbarSlider.hoverBackground': '#6B6B6B',
    'scrollbarSlider.activeBackground': '#7C7C7C',
  },
};
