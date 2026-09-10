# i18n-ready: Internationalization Technology Modifier

When this modifier is active, the agent builds and maintains the i18n MACHINERY — the catalog format, the `t()` resolver, ICU message handling, and locale-aware formatting. It governs HOW the internationalization layer is built. It does NOT, by itself, guarantee any single locale's catalog is complete or translated — that is a separate invariant owned by that locale's own completeness mod (e.g. `locale-en` for the English source, `locale-es` for Spanish), which is typically stacked alongside this one.

## Rules

1. **Catalogs are a FLAT object mapping dotted string keys to strings.** e.g. `export const en = { 'landing.hero.title': '…', 'auth.login.cta': '…' }`. No nested objects — a catalog structured as nested namespaces (`{ landing: { hero: { title: '…' } } }`) is a rejection. The `t()` resolver performs a flat dotted-key lookup with a fallback chain, never a recursive/nested traversal.
2. **Externalize every user-facing string.** No literal text may appear in JSX, templates, or UI logic. Every display string must be referenced by a namespaced message key (e.g., `t('checkout.errors.cardDeclined')`) backed by a flat message catalog.
3. **Use ICU MessageFormat for all dynamic strings.** Plurals, gender agreements, and interpolated values must use ICU syntax (`{count, plural, one {# item} other {# items}}`). String concatenation to build sentences is prohibited.
4. **Format dates, numbers, and currencies via the Intl API.** Use `Intl.DateTimeFormat`, `Intl.NumberFormat`, and `Intl.RelativeTimeFormat` with an explicit `locale` argument. Never hardcode date separators, decimal symbols, or currency symbols.
5. **Never concatenate to construct sentences.** Word order differs across languages. Any message requiring more than a single token must be a single ICU template with named placeholders — never `"Hello, " + name + "!"`.
6. **Design layouts for length expansion.** UI containers must accommodate 30–40 % string expansion (German, Finnish) and 2× expansion (some Asian scripts). Use flexible box or grid layouts; avoid fixed-width text containers.
7. **Implement a fallback locale chain in the resolver.** The `t()` resolver must resolve missing keys through a defined hierarchy (e.g., `pt-BR → pt → en`) before falling back to the key name itself. Missing translations must be logged as warnings, never silently swallowed.
8. **Never assume LTR directionality or Latin script.** All layouts must respect the `dir` attribute (`ltr`/`rtl`) on `<html>` or the nearest container. Use CSS logical properties (`margin-inline-start`, `padding-block`) instead of `left`/`right` physical properties.
9. **Support pseudo-localization in development.** The agent must ensure the i18n pipeline can emit a pseudo-locale (e.g., `en-XA`) that wraps strings with accented characters and brackets to surface hardcoded text and layout breakage before real translations ship.

## Behavioral Overrides

- Before implementing any new UI surface, the agent must identify every string that will appear and create the corresponding FLAT dotted-key catalog entries. Code without keys is incomplete.
- All date, number, and currency rendering is reviewed through the lens of locale variance: "Does this break in `ar-SA`, `de-DE`, or `ja-JP`?"
- If a design calls for a fixed-width text element, the agent must flag the layout constraint and propose a flexible alternative that survives translation.
- If a locale-correctness requirement conflicts with a design or performance requirement, the agent implements the locale-correct approach and reports the trade-off.
- This mod never claims a locale catalog is complete or translated on its own behalf — that claim belongs to the locale-specific completeness mod (`locale-en`, `locale-es`, …) stacked alongside it.
