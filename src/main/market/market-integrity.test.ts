import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { CODE_MODS } from './code-mods';
import { CODE_ROLES } from './code-roles';
import { clearMarketModCache, getMarketDir, getMarketMod, getMarketMods, getMarketRole, getMarketRoles } from './market-loader';
import { listDiscoverableMods, listDiscoverableRoles } from '../meta-agent/pipeline-generator';
import { createPerformanceCase } from '../performance-frontier/procedural/case-factory';
import type { PFSuite } from '../performance-frontier/types';
import type { MarketDomain, MarketInventory } from '../../types/market';

const MARKET_DIR = getMarketDir();
const DOC_FILES = new Set(['AGENTS.md', 'CLAUDE.md']);
const ALL_SUITES: PFSuite[] = [
  'architecture',
  'analysis',
  'team-work',
  'flow-assembler',
  'development',
  'business-knowledge',
  'design',
  'progression',
  'from-scratch',
];

function readInventory(): MarketInventory {
  return JSON.parse(readFileSync(join(MARKET_DIR, 'inventory.json'), 'utf-8'));
}

function mdResourceNames(category: string): string[] {
  return readdirSync(join(MARKET_DIR, category))
    .filter((file) => file.endsWith('.md') && !DOC_FILES.has(file))
    .map((file) => file.replace(/\.md$/, ''));
}

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, acc);
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

describe('market integrity guardrails', () => {
  // Guardrail 1: the /market is the single source of truth — inventory and the
  // backing .md files must never drift apart.
  for (const category of ['mods', 'roles', 'flows', 'steps'] as const) {
    it(`keeps the ${category} inventory and .md files in sync (no orphans either way)`, () => {
      const inventory = readInventory();
      const inventoryNames = new Set((inventory[category] ?? []).map((entry) => entry.name));
      const fileNames = new Set(mdResourceNames(category));

      for (const name of inventoryNames) {
        expect(fileNames, `inventory "${name}" has no market/${category}/${name}.md`).toContain(name);
      }
      for (const name of fileNames) {
        expect(inventoryNames, `market/${category}/${name}.md is missing an inventory entry`).toContain(name);
      }
    });
  }

  // Guardrail 2: the Meta-Agent discovery catalog is sourced from the market plus
  // the small set of runtime code mods — nothing hard-coded or drifting.
  it('derives the discovery mod catalog from the market + code mods only', () => {
    clearMarketModCache();
    const expected = new Set([
      ...CODE_MODS.map((mod) => mod.id),
      ...getMarketMods().map((mod) => mod.id),
    ]);
    const actual = new Set(listDiscoverableMods().map((mod) => mod.id));
    expect(actual).toEqual(expected);
  });

  it('derives the discovery role catalog from the market + code roles only', () => {
    clearMarketModCache();
    const expected = new Set([
      ...CODE_ROLES.map((role) => role.id),
      ...getMarketRoles().map((role) => role.id),
    ]);
    const actual = new Set(listDiscoverableRoles().map((role) => role.id));
    expect(actual).toEqual(expected);
  });

  // Guardrail 3: every mod attached to a PF step must be a registered resource
  // (market or code mod). Catches re-introduced hard-coded mods and id typos.
  it('attaches only registered (market or code) mods to every PF step', () => {
    const registered = new Set([
      ...CODE_MODS.map((mod) => mod.id),
      ...getMarketMods().map((mod) => mod.id),
    ]);

    for (const suite of ALL_SUITES) {
      const testCase = createPerformanceCase({ suite, seed: 1 });
      const flows = [testCase.flow, ...(testCase.epochs ?? []).map((epoch) => epoch.flow)];
      for (const flow of flows) {
        for (const step of Object.values(flow.stepsRecord)) {
          for (const mod of step.mods) {
            expect(registered, `${suite} step "${step.id}" uses unregistered mod "${mod.id}"`).toContain(mod.id);
          }
        }
      }
    }
  });

  // Guardrail 4: the harness engine (src/main) must not reach back into the
  // renderer store internals — the layer violation we just removed must stay gone.
  it('forbids src/main from importing renderer store internals', () => {
    // Match only real import/require statements, not comment mentions.
    const importRe = /(?:from|import|require)\s*\(?\s*['"][^'"]*renderer\/store\/predefined/;
    const offenders = collectFiles(join(process.cwd(), 'src', 'main'))
      .filter((file) => importRe.test(readFileSync(file, 'utf-8')))
      .map((file) => file.replace(`${process.cwd()}/`, ''));
    expect(offenders).toEqual([]);
  });
});

describe('market loader', () => {
  it('loads market mods as injectable pre_process guardrails', () => {
    const tdd = getMarketMod('test-driven');
    expect(tdd.type).toBe('pre_process');
    expect(String(tdd.config?.inject)).toContain('TDD');
    expect(getMarketMods().map((mod) => mod.id)).toEqual(
      expect.arrayContaining([
        'test-driven',
        'a11y-enforcer',
        'output-budget',
        'regression-sentinel',
        'spec-adherence',
        'systematic-debug',
        'self-review',
      ]),
    );
  });

  it('throws a clear error for an unregistered mod', () => {
    expect(() => getMarketMod('does-not-exist')).toThrow(/not registered/);
  });

  it('loads market roles as AgenticRoles with their .md persona as systemPrompt', () => {
    const fe = getMarketRole('frontend-engineer');
    expect(fe.id).toBe('frontend-engineer');
    expect(fe.systemPrompt.toLowerCase()).toContain('frontend');
    expect(getMarketRoles().map((role) => role.id)).toEqual(
      expect.arrayContaining(['frontend-engineer', 'security-researcher', 'qa-engineer']),
    );
    expect(() => getMarketRole('nope')).toThrow(/not registered/);
  });
});

describe('design-system feature removal (now only a mod exclusive group)', () => {
  it('keeps design-systems out of the market data layer', () => {
    expect(existsSync(join(MARKET_DIR, 'design-systems'))).toBe(false);
    const inventory = readInventory() as unknown as Record<string, unknown>;
    expect(inventory.designSystems).toBeUndefined();
  });

  it('forbids the removed design-system feature symbols from reappearing in src', () => {
    // 'design-system' (singular) is allowed only as a mod exclusiveGroup value;
    // these feature symbols/categories must never come back.
    const forbidden = [
      'MarketDesignSystem',
      'designSystemId',
      'assignDesignSystem',
      'removeDesignSystem',
      'DesignSystemEditor',
      `'design-systems'`,
      `"design-systems"`,
    ];
    const offenders: string[] = [];
    for (const file of collectFiles(join(process.cwd(), 'src'))) {
      if (file.endsWith('market-integrity.test.ts')) continue; // this guardrail names the symbols
      const content = readFileSync(file, 'utf-8');
      const hit = forbidden.find((symbol) => content.includes(symbol));
      if (hit) offenders.push(`${file.replace(`${process.cwd()}/`, '')} → ${hit}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('exclusive-group mods (design systems as mutually-exclusive mods)', () => {
  it('auto-derives mutual incompatibility within an exclusive group', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fluxor-market-'));
    mkdirSync(join(tmp, 'mods'), { recursive: true });
    writeFileSync(join(tmp, 'mods', 'ds-alpha.md'), '# alpha design system', 'utf-8');
    writeFileSync(join(tmp, 'mods', 'ds-beta.md'), '# beta design system', 'utf-8');
    writeFileSync(
      join(tmp, 'inventory.json'),
      JSON.stringify({
        mods: [
          { name: 'ds-alpha', description: 'Alpha DS', tags: [], exclusiveGroup: 'design-system' },
          { name: 'ds-beta', description: 'Beta DS', tags: [], exclusiveGroup: 'design-system' },
          { name: 'plain-mod', description: 'Plain', tags: [] },
        ],
      }),
      'utf-8',
    );

    const previous = process.env.FLUXOR_MARKET_DIR;
    process.env.FLUXOR_MARKET_DIR = tmp;
    clearMarketModCache();
    try {
      const alpha = getMarketMod('ds-alpha');
      const beta = getMarketMod('ds-beta');
      const plain = getMarketMod('plain-mod');

      expect(alpha.config?.exclusiveGroup).toBe('design-system');
      expect(alpha.config?.incompatibleWith).toEqual(['ds-beta']);
      expect(beta.config?.incompatibleWith).toEqual(['ds-alpha']);
      // A mod with no exclusive group keeps no derived incompatibilities.
      expect(plain.config?.incompatibleWith).toBeUndefined();
      expect(plain.config?.exclusiveGroup).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.FLUXOR_MARKET_DIR;
      else process.env.FLUXOR_MARKET_DIR = previous;
      clearMarketModCache();
    }
  });

  it('symmetrizes a manually-authored asymmetric incompatibleWith list (A lists B, B never lists back)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fluxor-market-'));
    mkdirSync(join(tmp, 'mods'), { recursive: true });
    writeFileSync(join(tmp, 'mods', 'mod-a.md'), '# mod a', 'utf-8');
    writeFileSync(join(tmp, 'mods', 'mod-b.md'), '# mod b', 'utf-8');
    writeFileSync(
      join(tmp, 'inventory.json'),
      JSON.stringify({
        mods: [
          { name: 'mod-a', description: 'Mod A', tags: [], incompatibleWith: ['mod-b'] },
          { name: 'mod-b', description: 'Mod B', tags: [] },
        ],
      }),
      'utf-8',
    );

    const previous = process.env.FLUXOR_MARKET_DIR;
    process.env.FLUXOR_MARKET_DIR = tmp;
    clearMarketModCache();
    try {
      const a = getMarketMod('mod-a');
      const b = getMarketMod('mod-b');

      expect(a.config?.incompatibleWith).toEqual(['mod-b']);
      // "mod-b" never declared the pairing itself — the loader must symmetrize it.
      expect(b.config?.incompatibleWith).toEqual(['mod-a']);
    } finally {
      if (previous === undefined) delete process.env.FLUXOR_MARKET_DIR;
      else process.env.FLUXOR_MARKET_DIR = previous;
      clearMarketModCache();
    }
  });
});

// ─── Market inventory data guardrails (real /market data, not a tmp fixture) ──
//
// NOTE: these guardrails check content the parallel market-data work is still
// authoring (role `domains` in particular). They are EXPECTED to be red until
// that inventory work lands — that is not a bug in the guardrail. Do not
// skip, dilute, or weaken these assertions to make them pass early.

const VALID_DOMAINS: ReadonlySet<MarketDomain> = new Set([
  'frontend', 'backend', 'web', 'data', 'infra', 'universal',
]);
const VALID_ATTACH_TOOLS = new Set(['web-browser']);
const VALID_BLOCK_TOOLS = new Set(['list_directory', 'read_file', 'write_file']);

describe('market inventory data guardrails (mods + roles)', () => {
  it('keeps every manually-declared incompatibleWith edge symmetric and pointing at a real mod', () => {
    const mods = readInventory().mods ?? [];
    const byName = new Map(mods.map((mod) => [mod.name, mod]));

    for (const mod of mods) {
      for (const target of mod.incompatibleWith ?? []) {
        const targetMod = byName.get(target);
        expect(
          targetMod,
          `"${mod.name}" declares incompatibleWith "${target}", which does not exist in market/mods`,
        ).toBeDefined();

        const listedBack = (targetMod?.incompatibleWith ?? []).includes(mod.name);
        const sharesGroup = Boolean(mod.exclusiveGroup) && mod.exclusiveGroup === targetMod?.exclusiveGroup;
        expect(
          listedBack || sharesGroup,
          `"${mod.name}" -> "${target}" is one-directional — add "${mod.name}" to ${target}'s incompatibleWith (or share an exclusiveGroup)`,
        ).toBe(true);
      }
    }
  });

  it('declares a non-empty, valid `domains` list for every mod and role', () => {
    const inventory = readInventory();
    const entries: Array<{ kind: string; name: string; domains?: MarketDomain[] }> = [
      ...(inventory.mods ?? []).map((mod) => ({ kind: 'mod', name: mod.name, domains: mod.domains })),
      ...(inventory.roles ?? []).map((role) => ({ kind: 'role', name: role.name, domains: role.domains })),
    ];

    for (const entry of entries) {
      expect(entry.domains, `${entry.kind} "${entry.name}" is missing "domains"`).toBeDefined();
      expect(
        entry.domains?.length ?? 0,
        `${entry.kind} "${entry.name}" declares an empty "domains" list`,
      ).toBeGreaterThan(0);
      for (const domain of entry.domains ?? []) {
        expect(VALID_DOMAINS.has(domain), `${entry.kind} "${entry.name}" declares unknown domain "${domain}"`).toBe(true);
      }
    }
  });

  it('declares only known runtime.attachTools / runtime.blockTools values for every mod', () => {
    const mods = readInventory().mods ?? [];

    for (const mod of mods) {
      for (const toolset of mod.runtime?.attachTools ?? []) {
        expect(
          VALID_ATTACH_TOOLS.has(toolset),
          `mod "${mod.name}" runtime.attachTools names unknown toolset "${toolset}"`,
        ).toBe(true);
      }
      for (const toolName of mod.runtime?.blockTools ?? []) {
        expect(
          VALID_BLOCK_TOOLS.has(toolName),
          `mod "${mod.name}" runtime.blockTools names unknown tool "${toolName}"`,
        ).toBe(true);
      }
    }
  });
});
