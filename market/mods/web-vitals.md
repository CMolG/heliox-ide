# web-vitals: Core Web Vitals Budget Modifier

When this modifier is active, the agent holds every rendering decision to Core Web Vitals budgets. LCP, INP, and CLS are non-negotiable constraints, not post-launch aspirations. Any markup, resource, or script pattern that threatens a budget is redesigned before it ships.

## Rules

1. **Meet the LCP budget (≤ 2.5 s).** The Largest Contentful Paint element (hero image, above-the-fold heading) must be discovered immediately: use `<link rel="preload" as="image">` or `fetchpriority="high"` on the LCP resource. No render-blocking `<script>` or `<link rel="stylesheet">` may appear before the LCP element in the critical path.
2. **Eliminate Cumulative Layout Shift (CLS ≤ 0.1).** Every `<img>`, `<video>`, `<iframe>`, and ad slot must carry explicit `width` and `height` attributes or an `aspect-ratio` CSS rule so the browser reserves space before the resource loads. Dynamically injected content (banners, cookie notices, lazy components) must never push existing content down.
3. **Keep Interaction to Next Paint within budget (INP ≤ 200 ms).** Event handlers for clicks, keypresses, and pointer events must complete their synchronous work in under 50 ms. Expensive operations (data processing, DOM measurement, heavy state updates) must be deferred with `scheduler.postTask`, `requestIdleCallback`, or moved to a Web Worker.
4. **Lazy-load all offscreen assets.** Images and iframes below the fold must use `loading="lazy"`. Third-party embeds (maps, videos, social widgets) must be replaced with a lightweight facade that loads the full embed only on user interaction.
5. **Code-split at the route level and tree-shake aggressively.** Each route bundle must contain only the code needed for that route. Dynamic `import()` is the required mechanism for feature modules not needed on first paint. Barrel files that re-export entire libraries are prohibited.
6. **Ship minimal critical CSS inline; defer the rest.** Styles required for above-the-fold rendering must be inlined in `<style>` in `<head>`. All remaining CSS must be loaded with `<link rel="stylesheet" media="print" onload="this.media='all'">` or an equivalent non-blocking pattern.

## Behavioral Overrides

- Before adding any third-party script or embed, the agent must estimate its LCP and INP impact and propose a facade or delayed-load strategy.
- Every new image, font, or media asset is reviewed through the CLS lens: "Does the browser know how much space this takes before it loads?"
- This modifier governs **front-end rendering metrics** (LCP, INP, CLS). It does **not** govern algorithmic complexity or server-side throughput — those are the domain of `extreme-performance`. The two mods stack cleanly with zero conflict.
- If a design or third-party integration cannot meet a Core Web Vitals budget, the agent flags the violation, quantifies the regression, and proposes an alternative before implementing the feature.
- In a text-only authoring environment (no binary asset pipeline), the LCP/hero visual must be an **inline SVG or a CSS-rendered graphic the agent actually writes** — never an `<img>` pointing to a binary path (`.webp`/`.png`/`.jpg`) that is not produced, which renders as a broken image and fails LCP outright. The CLS discipline (explicit `width`/`height` or `aspect-ratio` on the reserving container) still applies to the inline SVG.
