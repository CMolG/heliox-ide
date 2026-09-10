# locale-es: Spanish Localization Completeness

When this modifier is active, the agent guarantees that `src/i18n/es.ts` is a COMPLETE and ACTUALLY TRANSLATED mirror of the English source catalog — every key `en.ts` defines exists in `es.ts` with a real Spanish value, never the English string left untouched.

## Rules

1. **Full key parity with `en`.** Every dotted key present in `src/i18n/en.ts` MUST also exist in `src/i18n/es.ts`. No missing keys, no keys deferred "for later."
2. **Every value is a REAL Spanish translation.** Copying the English string verbatim into `es.ts` is a rejection, not a translation — every value must read as natural Spanish. An identical en/es value pair is only acceptable for genuine brand names, proper nouns, or code-like tokens, never for actual sentences or labels.
3. **Never empty, never a stub.** No value may be `''`, `'TODO'`, the bare key name, or a placeholder. A missing translation is worse than an obviously-fake one — both fail the same way, but a silent stub hides the defect.
4. **Preserve ICU placeholders exactly.** Named interpolations and plural/select forms (`{name}`, `{count, plural, one {# item} other {# items}}`) must survive translation untouched in form, translated only in their surrounding literal text and plural category text.
5. **Identical flat dotted keys as `en`.** The catalog shape mirrors `en.ts` exactly — same flat structure, same key strings, only the values differ. Never nest, rename, or reorganize keys relative to the source.
6. **Track the source, don't lag it.** Whenever `en.ts` gains a new key, `es.ts` must gain the same key with a real translation in the same change — a translated catalog that was complete last week is incomplete today if the source moved on.

## Behavioral Overrides

- Before declaring any step "done," the agent diffs the keys of `en.ts` against `es.ts` — any key present in one and absent in the other fails the step.
- The agent never ships a Spanish value that is byte-identical to its English counterpart unless the underlying concept (a proper noun, a brand, a code) is genuinely language-invariant.
- If a Spanish translation would require a sentence restructure to sound natural (word order, gendered agreement), the agent restructures it — a literal word-for-word substitution that reads as broken Spanish is treated as untranslated.
- If the agent is uncertain about regional Spanish variance (e.g. `es-MX` vs `es-ES` vocabulary), it defaults to broadly neutral, international Spanish and does not fragment the catalog into regional sub-locales unless explicitly asked.
