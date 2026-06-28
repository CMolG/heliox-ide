# seo-meta: SEO Document-Head Enforcement Modifier

When this modifier is active, the agent enforces a complete, semantically correct document head and content structure on every page. Every route that renders HTML must satisfy the full checklist before it is considered done.

## Rules

1. **Write a unique, descriptive `<title>` and `<meta name="description">` per page.** Titles must be 50–60 characters, front-load the primary keyword, and not duplicate across routes. Descriptions must be 120–160 characters and serve as a human-readable summary, not a keyword list.
2. **Declare exactly one canonical URL.** Every page must carry `<link rel="canonical" href="<absolute-url>">` pointing to the preferred indexable URL. Pagination, filter variants, and trailing-slash duplicates must all canonicalize to a single authoritative URL.
3. **Emit Open Graph and Twitter Card meta tags with absolute image URLs.** Required OG tags: `og:title`, `og:description`, `og:url`, `og:image` (absolute HTTPS URL, minimum 1200×630 px). Required Twitter tags: `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`. Relative image paths are rejected.
4. **Enforce exactly one `<h1>` per page and a logical heading hierarchy.** The `<h1>` must match or closely echo the `<title>`. Heading levels must not skip (`<h1>` → `<h3>` without `<h2>` is a violation). Decorative text styled to look like headings must use `<p>` or `<span>`, not heading elements.
5. **Respect robots directives and sitemap membership.** Pages that must not be indexed must carry `<meta name="robots" content="noindex,nofollow">` and be excluded from `sitemap.xml`. Indexable pages must appear in the sitemap with accurate `<lastmod>` and `<changefreq>` values.
6. **Add `hreflang` annotations for every localized variant.** When a page exists in multiple locales, every variant must declare the full set of `<link rel="alternate" hreflang="<lang>" href="<absolute-url>">` tags, including `hreflang="x-default"`.
7. **Use semantic landmark elements throughout the document body.** Every page must include `<header>`, `<main>`, `<nav>`, and `<footer>` landmarks. Content must not live inside generic `<div>` wrappers when a semantic element exists.

## Behavioral Overrides

- Before scaffolding any new route or page component, the agent must define the `<title>`, canonical URL, and OG image source. A page without these is not a page.
- Every redirect, URL restructure, or slug change is reviewed for canonical and sitemap impact before implementation.
- If a design places multiple `<h1>` elements on a page for visual reasons, the agent rejects the pattern and proposes an alternative using CSS typography, reporting the SEO conflict.
- If a feature ships under a noindex route temporarily, the agent must create a tracked follow-up to promote it to indexable status and add it to the sitemap.
