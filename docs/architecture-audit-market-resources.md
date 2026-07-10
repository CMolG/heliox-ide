# Architecture Audit — Prebuilt Resources & the `/market` Source of Truth

**Date:** 2026-06-24
**Trigger:** While adding new Mods we discovered the harness engine was hard-coding prebuilt resources in TypeScript instead of consuming them from the `/market` folder.

## The architectural law

`/market` is the **single source of truth** for prebuilt resources: `flows`, `roles`, `mods`, and `design-systems`. Each resource is a `.md` (its system-injection / spec) plus a registry entry in `market/inventory.json`. Everything else — the marketplace UI and the agentic engine — must **consume** from the market, never redefine prebuilt resources in code.

## Inherited flaws found

| # | Flaw | Severity | Status |
|---|------|----------|--------|
| 1 | Mods hard-coded in `src/renderer/store/predefined/mods.ts`, bypassing the market | High | **Fixed** |
| 2 | Discovery catalog (`MOD_CATALOG` in `pipeline-generator.ts`) hard-coded from a single TS mod | High | **Fixed** |
| 3 | Layer violation: `src/main/**` (engine) imported from `src/renderer/store/predefined` | High | **Fixed** |
| 4 | Market drift: `auto-refiner.md` and `auto-saas-cost-reducer.md` flows existed on disk with **no inventory entry** | Medium | **Fixed** |
| 5 | No automated enforcement — nothing stopped the codebase from drifting back into spaghetti | High | **Fixed (guardrails)** |
| 6 | `ConfidentExecutor` role defined in code, not in the market | Low | **Flagged** (see below) |

## What was fixed

- **Engine now consumes mods from the market.** New `src/main/market/market-loader.ts` reads `market/inventory.json` + `market/mods/*.md` and produces `AgenticMod`s. `getMarketMod(name)` / `getMarketMods()` are the engine's entry points.
- **New mods authored as market resources** (not code): `output-budget`, `regression-sentinel`, `spec-adherence`, `systematic-debug`, `self-review` — each a `.md` + an `inventory.json` entry. Two pre-existing market mods (`test-driven`, `a11y-enforcer`) were **reused** instead of duplicated.
- **Discovery catalog sourced from the market.** `MOD_CATALOG` is now `CODE_MODS ∪ getMarketMods()`; adding a market mod automatically makes it discoverable by the Meta-Agent.
- **Layer violation removed.** The two legitimate *code* resources moved out of the renderer store into the engine:
  - `src/main/market/code-mods.ts` → `AntiVerificationInterceptor` (needs runtime tool-blocking logic).
  - `src/main/market/code-roles.ts` → `ConfidentExecutor` (carries runtime model/temperature config).
  - `src/renderer/store/predefined/` was deleted.
- **Market drift fixed.** The two orphan flows are now registered in `inventory.json`.
- **PF suites attach mods by market id** (`case-factory.ts`): development→`test-driven`, business-knowledge→`spec-adherence`, design→`a11y-enforcer`+`output-budget`, progression→`regression-sentinel`, analysis→`systematic-debug`, team-work(dev)→`output-budget`+`a11y-enforcer`.

## Guardrails added — `src/main/market/market-integrity.test.ts`

These fail CI (`npm test`) if the architecture is violated again:

1. **Inventory ↔ `.md` sync** (mods, roles, flows): every inventory entry has a backing `.md`, and every `.md` has an inventory entry. *(This is what caught flaw #4.)*
2. **No catalog drift:** the discovery mod catalog equals `CODE_MODS ∪ market mods` exactly — no hidden hard-coded mods.
3. **PF steps use only registered mods:** every mod attached to any PF step resolves to a market mod or a code mod. Catches re-hardcoding and id typos.
4. **No layer violation:** no file under `src/main/**` imports from `renderer/store/predefined`.

## Remaining debt & recommendations

- **`ConfidentExecutor` (flaw #6)** stays a *code role* because it carries runtime config (model, temperature, token budget) that a market role `.md` does not capture. It is now correctly located in the engine layer. **Recommendation:** if we want it user-facing, split it into a `market/roles/confident-executor.md` (persona) + a thin code binding for the runtime params, and extend the loader with `getMarketRole()`. Low priority.
- **`team-work` bespoke inline roles** (`landing-content-planner`, etc.) live in `case-factory.ts`. These are **eval scaffolding**, not marketplace resources, so code is acceptable — but they could reference market roles for consistency.
- **Market path resolution:** the engine loader reads `<cwd>/market` (override `FLUXOR_MARKET_DIR`, falling back to the deprecated `HELIOX_MARKET_DIR` with a warning). This is correct for the dev/CLI/eval context where the PF engine runs. The packaged Electron app resolves the market via `appRoot` in `ipc-handlers.ts`; the two contexts are intentionally separate.
- **Future guardrail:** consider broadening guardrail #4 to forbid any `src/main → src/renderer` import, once confirmed there are no legitimate cross-imports.

---

## Round 2 — Steps category, design-system removal, exclusive-group mods

### Added: `steps` as a first-class market category
- New `market/steps/` with 5 atomic, reusable step templates (`scaffold-structure`, `write-failing-tests`, `implement-to-green`, `review-diff`, `refactor-safely`) + `AGENTS.md`/`CLAUDE.md`, registered in `inventory.json` under `steps`.
- Wired as a consumable category: `MarketStep` type, `MarketCategory`, `MARKET_PROMPT_CATEGORIES`, `LoadedPrompt.category`. Guardrail #1 now also enforces `steps` inventory↔`.md` sync.

### Design systems are now *only* a mod exclusive group
- A design system is **not** a separate market category. It is a Mod with `exclusiveGroup: 'design-system'`; the loader auto-derives mutual incompatibility so two design systems can never stack. Documented in `market/mods/AGENTS.md`.
- **Removed the entire legacy design-system feature at the root** (it was contaminating the codebase): deleted the 5 dedicated files (`AttachableDesignSystem`, `DesignSystemMicroPreview`, `BrandIdentityCard`, `DesignSystemEditorApp`, `design-system-preview`); removed `MarketDesignSystem*` types and the `designSystems` inventory field; removed `'design-system'` from `AttachableType`, `'design-system-editor'` from `WindowType`/`DockAction`/tutorials, and `'design-systems'` from `PluginCategory`/`MarketCategory`/`MARKET_PROMPT_CATEGORIES`; stripped `designSystemId` and the assign/remove logic from the store, edge-adapter, session dock; removed `AiComposer.withDesignSystem` and the `designSystemPrompt` plumbing; deleted the dead `e2e/design-system-editor.spec.ts`.
- **Not touched:** the separate, live *design-guidelines* feature (`GuidelinePicker`, `designGuidelineId`, `useTheme`) — it is the IDE theming system, unrelated to the removed market attachable. Also left an incidental "design system tokens" mention inside an unrelated UI-engineer role prompt.

### New guardrails (extend `market-integrity.test.ts`)
5. **Design-system stays removed:** no `market/design-systems` folder, no `designSystems` inventory key, and the feature symbols (`MarketDesignSystem`, `designSystemId`, `assignDesignSystem`, `removeDesignSystem`, `DesignSystemEditor`, `'design-systems'`) must never reappear in `src/`.
6. **Exclusive-group exclusivity:** mods sharing an `exclusiveGroup` are auto-marked mutually incompatible (verified against a synthetic temp market).

**Verification:** `tsc` clean, 276 tests pass.
