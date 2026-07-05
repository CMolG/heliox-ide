# structured-data: Structured Data Enforcement Modifier

When this modifier is active, the agent emits valid Schema.org JSON-LD structured data for every page type and keeps that data in strict synchronization with the visible content. Omitted or placeholder structured data is treated as a build error.

## Rules

1. **Emit JSON-LD exclusively.** Structured data must be injected as a `<script type="application/ld+json">` tag in the document `<head>`. Microdata and RDFa attributes are prohibited; JSON-LD is the only accepted format.
2. **Select the correct `@type` for each page.** Map every page template to its canonical Schema.org type: `Article` / `NewsArticle` for editorial content, `Product` for commerce pages, `FAQPage` for FAQ sections, `BreadcrumbList` for navigation trails, `Organization` and `WebSite` for global identity. Using a generic `Thing` type when a specific type exists is a rejection.
3. **Populate required properties from live page data.** Every Schema.org required property (`name`, `url`, `image`, `datePublished`, `author`, `offers.price`, etc.) must be sourced from actual page content or CMS data. Hardcoded placeholders or `"TODO"` values are prohibited.
4. **Inject `BreadcrumbList` and `Organization`/`WebSite` sitewide.** Every page must carry a `BreadcrumbList` reflecting the current URL hierarchy and a sitewide `Organization` (with `logo`, `url`, `sameAs` social links) and `WebSite` (with `SearchAction` if site search exists) block.
5. **Validate against Schema.org and Rich Results requirements.** Before shipping, structured data must pass the Google Rich Results Test rules: all recommended properties for the target rich result type must be present, and no schema errors (unknown properties, wrong value types) may be emitted.
6. **Keep structured data synchronized with visible content.** The values in JSON-LD (`name`, `price`, `description`, `dateModified`) must match what is displayed on-screen. Diverging the two to manipulate search appearance is cloaking and is absolutely prohibited.

## Behavioral Overrides

- Before implementing a new page template, the agent must identify the appropriate Schema.org `@type` and enumerate which properties will be sourced from live data.
- Every CMS field or data model change is reviewed for structured-data impact: "Does this rename break a JSON-LD property mapping?"
- If a product or content team requests structured-data values that differ from the rendered page content, the agent refuses and reports the cloaking risk.
- If structured-data completeness conflicts with a launch timeline, the agent ships only what it can populate from real data and reports the missing properties rather than emitting placeholders.
