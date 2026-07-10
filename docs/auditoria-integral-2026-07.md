# Auditoría integral de Fluxor IDE — Julio 2026

**Fecha:** 2026-07-01 (rev. 2 mismo día: añade la auditoría del frontend `../heliox-ide-web` / helioxide.com, el workstream de release engineering y la migración de docs a Nextra) · **Alcance:** diseño, contenido, herramientas adjuntas, desktop, DevOps, seguridad, marketing, escalabilidad, repercusión y modelo de partners · **Método:** cada afirmación sobre Fluxor está anclada a un fichero del repo o a un comando ejecutado durante la auditoría (Anexo A). Las afirmaciones de mercado citan fuentes externas.

> **Veredicto en una frase:** Fluxor tiene ingeniería de nivel "ganador de categoría" atrapada dentro de un producto que, a efectos del mundo exterior, **no existe**: el repo público lleva sin push desde el 12 de abril, tiene 1 estrella, 0 releases, sin instaladores firmados, una web viva (helioxide.com) cuyos botones de descarga no descargan nada, y sin una sola captura de pantalla en el README. El plan de acción no es "mejorar el producto hasta que brille": es **shippear el brillo que ya existe**, blindar la confianza (firma, CSP, cadena de suministro del market) y construir la máquina de distribución que convierta tres fosos técnicos reales en una comunidad.

---

## 0. Resumen ejecutivo

### Scorecard

| Área | Nota | Estado dominante |
|---|---|---|
| 1. Diseño (UI/UX/design system) | **8/10** | Sistema de tokens coherente, a11y real; fugas menores (fuentes CDN, sin command palette) |
| 2. Contenido (docs, README, market) | **6.5/10** | Estrategia escrita de calidad consultora; README desactualizado y **sin una sola imagen del producto**; cero docs de usuario |
| 3. Herramientas adjuntas (PF, MCP, SDK, attachables) | **8.5/10** | La Performance Frontier ejecuta de verdad y la conformance TS↔JVM es única en el mercado; serve/triggers/RAG/checkpoints ya construidos |
| 4. Desktop (Electron, empaquetado) | **6/10** | Fundamentos de seguridad Electron correctos; **sin firma, sin notarización, sin auto-update, sin CSP** |
| 5. DevOps (CI/CD, calidad) | **4/10** | 873 tests verdes y 0 errores de lint **en local**; la CI solo publica on-tag — no hay ni un workflow que ejecute tests |
| 6. Seguridad | **5/10** | serve con auth ✓, Electron flags ✓; abiertos: RCE vía MCP tool-provider, inyección de prompts del market, PIN del bridge sobre HTTP |
| 7. Marketing y comunidad | **2/10** | Posicionamiento escrito excelente y web viva en helioxide.com (Vercel); pero 1 star, 0 releases, botones de descarga muertos en el front y dominio canónico inconsistente (heliox.dev vs helioxide.com) |
| 8. Escalabilidad | **6.5/10** | 69k LOC modulares y sanas; single-user por diseño, bus-factor = 1 |

### Los tres hallazgos que dominan todo lo demás

1. **El producto no existe públicamente.** `gh repo view` (2026-07-01): último push **2026-04-12**, 1 estrella, 1 fork, `latestRelease: null`. En local hay 18 commits en `feat/dev` sin mergear y **125 ficheros sin commitear** (+3.664/−11.470 líneas de la limpieza de código muerto). Casi 3 meses del mejor trabajo del proyecto (Performance Frontier verificada, conformance cross-runtime, serve, triggers, RAG) viven **solo en un SSD externo**. Esto es a la vez el mayor riesgo operativo (pérdida de trabajo) y la explicación completa de la nota de marketing.
2. **La cadena de confianza de la distribución está incompleta.** Sin firma de código ni notarización (`forge.config.ts` no tiene `osxSign`/`osxNotarize`), macOS Gatekeeper bloqueará el .dmg y Windows SmartScreen asustará al 90 % de los que lo intenten. Sin auto-update (cero usos de `autoUpdater`/`update-electron-app` en `src/main`). Sin CSP en `index.html` (confirmado también por `.backlog/ARCH-005`). Un IDE que ejecuta agentes con acceso a disco no puede pedir confianza sin esto.
3. **La ventaja competitiva es real y está verificada — pero caduca.** Los tres fosos del análisis competitivo ([docs/competitive-analysis/04](competitive-analysis/04-fosos-defensibles.md)) existen en el código y funcionan (13/13 tests reales ejecutados por la PF, conformance byte-idéntica probada por vitest **y** `mvn test`). Pero el mercado corre: Dify y Langflow superan las 100k estrellas, Flowise fue adquirida por Workday, y OpenAI/Google ya venden builders visuales. La ventana para plantar la bandera de "flows portables verificados" se mide en trimestres, no en años.

### La tesis del plan

El orden correcto es **Ship → Trust → Tell → Scale**: (0) publicar lo que hay, (1) hacerlo confiable e instalable en 2 clics, (2) contarlo con la calidad visual que el propio producto predica, (3) escalar comunidad y partners sobre el foso del formato portable. Saltarse un paso invalida los siguientes: no se puede hacer marketing de un instalador que Gatekeeper bloquea.

---

## 1. Diseño (UI / UX / design system)

### Lo que está bien (y es raro verlo tan bien en un alpha)

- **Design system real, no aspiracional.** `src/renderer/index.css` define la paleta completa como tokens (`--color-hx-*`), tipografías con fallbacks accesibles (Atkinson Hyperlegible), y un acento por proveedor de CLI (`--cli-accent`) inyectado en runtime. Existe además `ide-design-tokens.json` (178 KB) como fuente de tokens.
- **A11y como sistema, no como parche:** `:focus-visible` global, escala tipográfica mínima forzada por CSS (WCAG 1.4.4/1.4.12), `prefers-reduced-motion` como principio en README, axe-core como dependencia de verificación. El editor de design systems y la BrandIdentityCard con preview en vivo son diferenciadores de producto, no solo features.
- **Identidad clara:** dark-only como decisión de marca (documentada en README y defendida en el análisis competitivo — "no romper el minimalismo cognitivo"). Canvas espacial tipo Figma con snap guides, z-order gestionado, mental graph. Es la única herramienta de la categoría cuyo *propio* UI podría ganar un premio de diseño.

### Brechas

| Brecha | Evidencia | Impacto |
|---|---|---|
| Fuentes cargadas desde Google Fonts CDN | `index.html` (preconnect + stylesheet a fonts.googleapis.com) | La app rompe tipográficamente sin red; telemetría a Google desde un IDE local (mala óptica de privacidad); flash de fuentes |
| Sin command palette | `.backlog/ARCH-001-command-palette.md` pendiente | El propio AGENTS.md predica "command-palette actions" como alternativa a paneles; es la feature de DX más esperada de un IDE |
| Sin i18n de la UI | UI solo en inglés | Barrera para el objetivo de "millones de usuarios"; el español es el segundo mercado dev natural del proyecto |
| Accesibilidad no auditada end-to-end en la app | axe se usa en la PF (para código generado), no contra el propio IDE | Riesgo de incoherencia: "valida a11y de tus agentes" con un IDE no auditado |

**Recomendación clave:** self-hostear todas las fuentes vía `@fontsource-*` (Doto ya lo está — el patrón existe), y correr el propio `design-verifier` de la PF contra el IDE. *Dogfooding literal: que Fluxor se audite con Fluxor.*

---

## 2. Contenido (README, docs, market)

### Lo que está bien

- **`docs/competitive-analysis/` es oro.** Siete documentos anclados a código, con regla de honestidad explícita ("un análisis que se cree su propio marketing es inútil"), battle cards, taglines y roadmap priorizado. Es mejor material de posicionamiento del que tienen la mayoría de startups con equipo de marketing.
- **El market como contenido:** 12 flows + 9 roles + 25 mods + 7 steps (`market/inventory.json`), human-authored por regla (README `Contributing`), con `market-integrity.test.ts` verificando la coherencia inventario↔ficheros.
- **README técnicamente completo:** arquitectura con diagrama, atajos, estructura, principios de diseño, créditos.

### Brechas

| Brecha | Evidencia | Impacto |
|---|---|---|
| **Cero imágenes del producto** | README: única imagen = logo. Ni una captura del canvas, ni un GIF | **Fatal para un producto "visual-first".** El 80 % de la decisión de probar un tool visual se toma viendo un GIF de 10 segundos |
| README desactualizado (abril) y en contradicción con la realidad | Dice "tests failing" (hoy: 873/873 verdes), "lint needs migration" (hoy: flat-config migrada, 0 errores) | Está **infravendiéndose**: describe un proyecto peor del que es |
| Docs estratégicos ya desfasados respecto al código (¡en 4 días!) | `05-brechas-y-roadmap.md` (27-jun) lista RAG/triggers/serving como "ausentes"; el 1-jul existen `src/main/harness-engine/retriever.ts`, `src/main/triggers/`, `src/main/serve/` | La velocidad supera a la documentación; sin un ritual de sincronización, los docs pierden su valor de "anclado a código" |
| Documentación de usuario embrionaria y desconectada | Existen 5 páginas MDX seed en `../heliox-ide-web/src/content/docs/` (getting-started, core-concepts, architecture, api-reference, contributing), congeladas desde abril y servidas por un pipeline MDX artesanal | Sin docs vivas no hay adopción autónoma; el plan las migra a **Nextra** y las conecta al ciclo de releases (acción 2.5) |
| Sin ficheros de comunidad | `.github/` solo contiene `copilot-instructions.md` y `release.yml`. No hay CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, issue templates | GitHub degrada la visibilidad del repo y nadie sabe cómo contribuir o reportar vulnerabilidades |

**Recomendación clave:** el README nuevo debe abrir con un GIF del canvas orquestando agentes + la frase de posicionamiento ya escrita en [06-posicionamiento](competitive-analysis/06-posicionamiento-mensajes.md). El contenido ya está redactado; solo hay que ensamblarlo y grabarlo.

---

## 3. Herramientas adjuntas (attachables, MCP, SDK, Performance Frontier, Bridge)

Esta es el área más fuerte del proyecto y la base de todo el valor de partners.

### Inventario verificado

- **Sistema de attachables** (roles arriba, mods abajo, flows a la derecha de cada ventana): compositional, con validación de compatibilidad pendiente (`.backlog/ARCH-021`).
- **Performance Frontier + Arena:** el roadmap completo de 5 fases está **implementado y validado en vivo** (`docs/cutting-edge-roadmap.md`, STATUS 2026-06-24): sandbox que ejecuta vitest real, design-verifier con axe-core, api-verifier que bootea Express, bench con IC 95 % (Student-t), juez con calibración bajo fallos conocidos (0 overrules), y **conformance TS↔Java byte-idéntica incluyendo tool-calling** (19 tests TS + 50 Java verdes).
- **Runtime de producción temprano:** `fluxor serve` con Bearer auth y bind loopback por defecto (`src/main/serve/serve-flow.ts`), triggers cron + webhook con guard de solapamiento (`src/main/triggers/`), RAG local con vector store + ingesta + step `retriever` (`src/main/harness-engine/knowledge/`), checkpoints + replay (`checkpoints.ts`, `replay.ts`).
- **MCP en ambas direcciones:** cliente stdio/HTTP/SSE (`mcp-adapter.ts`), directorio curado (`src/main/market/mcp-directory.ts`), y telemetría `missingCapabilitiesRequested` como product-discovery de qué conectores faltan.
- **SDKs:** Java (`sdk/java`, con suite de conformance) y Python embrionario (`sdk/python` con provider/executor/flow_import — aún sin la suite de conformance completa).
- **Bridge móvil:** QR + PIN de 6 dígitos con expiración (`src/main/bridge/auth.ts`).

### Brechas

1. **El SDK Python no está en la matriz de conformance.** Es el movimiento P2-6 del roadmap competitivo ("abre el universo LangChain") y ya está empezado; sin la suite de `sdk/conformance/` pasando en Python, no es publicable como foso.
2. **El default del retriever es un stub de hashing** (documentado honestamente en `retriever.ts`): sin proveedor de embeddings real configurado out-of-the-box, el RAG "existe" pero no es útil para un usuario nuevo.
3. **Los nuevos motores no tienen UI de primera clase.** Serve/triggers/RAG se manejan por CLI/config; el diferencial de Fluxor es el canvas — estos deben ser ventanas/attachables.
4. **Las herramientas heredan la confianza del market sin verificación criptográfica** (ver §6).

---

## 4. Desktop (Electron, empaquetado, distribución)

### Lo que está bien

- **Higiene de seguridad Electron correcta:** `contextIsolation: true`, `nodeIntegration: false` en `src/main/index.ts:90-133`; ventanas headless del browser-toolset con `sandbox: true` y test que lo verifica (`browser-controller.test.ts:527`).
- **Stack moderno:** Electron 41, React 19, Tailwind 4, Vite 8, TS 5 — sin deuda de versiones.
- **Makers para las 4 plataformas** (Squirrel, DMG, DEB, RPM) + publisher GitHub configurado.

### Brechas (esta es la lista que bloquea TODO el marketing)

| # | Brecha | Evidencia | Consecuencia |
|---|---|---|---|
| D1 | **Sin firma de código ni notarización** | `forge.config.ts` sin `osxSign`/`osxNotarize`/signing Windows | macOS: "app dañada, muévela a la papelera". Windows: SmartScreen. Muerte del funnel de instalación |
| D2 | **Sin auto-update** | 0 usos de `autoUpdater`/`update-electron-app` | Cada bug shippeado es permanente en las máquinas de los usuarios |
| D3 | **Sin CSP** | `index.html` sin meta CSP (confirmado por `.backlog/ARCH-005`) | Un IDE que renderiza markdown de agentes y contenido de market sin CSP es XSS→RCE en potencia |
| D4 | Playwright browsers embebidos como `extraResource` | `forge.config.ts:17-24` | Instaladores potencialmente >500 MB; debería ser descarga bajo demanda al activar el snapshot engine |
| D5 | Sin crash reporting ni telemetría opt-in | Sin Sentry/crashReporter en `src/main` | Imposible saber cuántos usuarios hay ni por qué se les rompe. "Millones de usuarios" no se puede ni medir |
| D6 | Fuentes remotas (repite §1) | `index.html` | App visualmente rota offline |

---

## 5. DevOps (CI/CD, calidad)

### Lo que está bien — en local

- **`npm test`: 65 ficheros, 873 tests, 100 % verdes en 7,7 s** (ejecutado en esta auditoría). Es una suite rápida y seria (fake clocks, sin red, conformance cross-runtime).
- **`npm run lint`: 0 errores**, 242 warnings (mayoría `no-explicit-any` y `preserve-caught-error` — deuda menor y acotada).
- **E2E:** 14 suites Playwright activas; última ejecución completa conocida (27-jun): 348 pass / ~13 fail / 4 flaky en 21 min, con varias suites fallonas eliminadas después en la limpieza de código muerto.

### Brechas

| # | Brecha | Evidencia |
|---|---|---|
| O1 | **No existe CI de integración.** El único workflow (`.github/workflows/release.yml`) publica on-tag; nunca se ha disparado (0 releases). **Ningún push ejecuta tests/lint/build** | `.github/workflows/` |
| O2 | 125 ficheros sin commitear, 18 commits sin push | `git status`, `git log main..feat/dev` |
| O3 | `npm install` en release.yml en vez de `npm ci` — builds no reproducibles | `release.yml:24` |
| O4 | Sin Dependabot/Renovate, sin CodeQL/audit en CI (hay `overrides` de seguridad manuales en `package.json`, buena señal, pero es un proceso manual) | `.github/`, `package.json:64-72` |
| O5 | Artefactos de log en la raíz del repo (`e2e-*.log`, ~800 KB, `atoms-history.log`) | `ls` raíz |
| O6 | E2E no corren en CI (necesitan xvfb/runner con display) — el "snapshot-verified" del pitch no se auto-aplica | — |

**Recomendación clave:** un `ci.yml` de 40 líneas (push/PR → `npm ci && npm run lint && npm test` en las 3 plataformas + `npm run make` como smoke de empaquetado) convierte "confía en mí" en "míralo tú mismo" — y es requisito para aceptar PRs de terceros con seguridad.

---

## 6. Seguridad (transversal, condiciona partners y premios)

Estado verificado de la deuda conocida:

| Ítem | Estado | Evidencia |
|---|---|---|
| Auth del serve | ✅ **CERRADO** | Bearer token obligatorio, loopback por defecto (`serve-flow.ts` cabecera "Security") |
| Flags Electron | ✅ Correctos | §4 |
| **RCE vía tool-provider MCP** | ✅ **CERRADO** (2026-07-02) | `mcp-command-policy.ts`: gate en la frontera de spawn — match de prefijo contra el directorio curado, aprobaciones exactas persistidas, `FLUXOR_MCP_ALLOW_ALL` como escape de dev; IPC approve/revoke. Pendiente follow-up: allowlist equivalente para MCP HTTP/SSE (SSRF) |
| **Inyección vía .md del market** | 🟡 MITIGADO en autenticidad | La *autenticidad* la cubre el root-of-trust (fila siguiente); el riesgo *semántico* (prompt malicioso firmado) sigue siendo inherente al modelo de market curado por humanos |
| **PIN del bridge sobre HTTP** | 🟡 **MITIGADO** (2026-07-02) | Token de pairing one-time (TTL 120 s) en fragment de URL (nunca llega a logs), intercambio por POST body, lockout 5/60 s, `timingSafeEqual`, WS token en subprotocolo, endpoint `/bridge/qr` sin auth eliminado. Residual: HTTP plano en LAN hasta TLS/PAKE (threat model en `SECURITY.md`) |
| **Sin root-of-trust del market** | 🟡 IMPLEMENTADO en bootstrap | `market-trust.ts` (ed25519, manifest sha256, fail-closed empaquetado) + `scripts/market-sign.ts`. Inerte hasta que el maintainer genere la clave (`--gen-key`) y publique el pubkey en `TRUSTED_MARKET_KEYS` |
| CSP | ✅ **CERRADO** (2026-07-02) | Inyectada vía `onHeadersReceived` solo en app empaquetada; webview de previews exento por partición de sesión propia; Monaco auto-hosteado (cargaba del CDN — habría roto bajo CSP) |

**Por qué esto es estratégico y no solo técnico:** el pitch de Fluxor es *confianza verificada* ("demuestras que tus agentes funcionan"). Un marketplace de prompts/tools sin firma, con un adaptador que spawnea comandos de config, es la contradicción exacta de ese pitch — y será lo primero que un evaluador serio (o un post de HN) encuentre. La seguridad aquí **es** marketing.

**Paquete mínimo "trust-ready":** (1) allowlist + confirmación explícita de usuario para cualquier `command` de MCP no incluido en el directorio curado; (2) firma de items del market (sigstore/minisign) + verificación en `market-loader.ts`; (3) HTTPS o secure pairing (SRP/PAKE) para el bridge; (4) meta CSP estricta; (5) `SECURITY.md` con política de divulgación.

---

## 7. Marketing y comunidad

### La asimetría más grande del proyecto

Se ha escrito un análisis competitivo de calidad profesional ([docs/competitive-analysis/](competitive-analysis/)) con taglines listas, battle cards por competidor y mensajes por audiencia… y simultáneamente:

- **1 estrella, 1 fork** (`gh repo view`, 2026-07-01)
- **0 releases publicadas** (`latestRelease: null`)
- **Último push: 2026-04-12** — GitHub muestra un proyecto muerto justo cuando más vivo está
- **heliox.dev no resuelve** (curl sin respuesta) pese a estar impreso como homepage en `forge.config.ts:35` — mientras que **la web real sí existe y está viva en helioxide.com** (Vercel, HTTP 200), construida en `../heliox-ide-web`
- **Descripción del repo genérica** ("Agentic IDE with flows, roles and mods.") sin topics/tags
- Ni un post, demo, vídeo o screenshot público

### El frontend (helioxide.com / `../heliox-ide-web`): existe, pero está desconectado del producto

Auditado en esta revisión (Next.js 16 + Tailwind 4 + framer-motion; landing con Hero, Features, Comparison, Architecture, SnapshotDemo y showcases del canvas; deploy en Vercel):

| Hallazgo | Evidencia | Impacto |
|---|---|---|
| **Los botones de descarga no descargan nada** | `src/components/Download.tsx`: tres `<button>` sin `href`/`onClick` | El único CTA de conversión del sitio es un placeholder; todo tráfico que llegue hoy se pierde |
| SEO canónico apunta al dominio equivocado | `src/app/layout.tsx:30`: `metadataBase: new URL('https://heliox.dev')`; ídem `sitemap.ts` | Canónicas/OG/sitemap envenenados: Google indexa contra un dominio que no resuelve |
| Repo privado y congelado | `gh repo view CMolG/heliox-ide-web`: `isPrivate: true`, push 2026-04-12 | El escaparate de un proyecto open source no es open source, y lleva 3 meses sin actualizarse (la web describe el producto de abril, no el de julio) |
| Iconos emoji en la sección de descargas | `Download.tsx`: 🍎 🪟 🐧 | Contradice la regla propia "No emoji as icons" (README/AGENTS.md del IDE) |
| Docs con pipeline artesanal | `src/lib/docs.ts` + `DocsShell`/`DocsSidebar` + `next-mdx-remote`, 5 MDX | Sin búsqueda, sin i18n, sin versionado; mantenimiento manual — justo lo que **Nextra** da gratis |
| Sin CI propia | `.github/workflows/` inexistente en el repo web | Sin lint/build check antes del deploy de Vercel |

La lectura estratégica: **la mitad del funnel ya está construida** (una landing visualmente alineada con la marca, con showcases del canvas hechos a mano) — lo que falta no es diseño sino **cableado**: releases reales detrás de los botones, dominio canónico único y docs vivas. Eso es exactamente el workstream release→web del plan (§9).

El mercado, mientras tanto, está en su pico de atención: Dify y Langflow >100k estrellas, Flowise adquirida por Workday (ago-2025), OpenAI/Google/Microsoft con builders visuales propios, y 120+ herramientas compitiendo — es decir, **hay una audiencia masiva buscando exactamente esta categoría** y una ventana de diferenciación real (nadie tiene portabilidad verificada ni benchmark que ejecute).

### Lo que falta (todo es ejecutable, nada es caro)

1. **Activos visuales:** GIF hero de 15 s (canvas + attachables + run verificado), vídeo demo de 90 s, 6-8 capturas. El producto es fotogénico por diseño — es la categoría donde el demo visual más convierte.
2. **Web mínima:** landing de una página en heliox.dev (registrar el dominio o cambiar el impreso en forge.config), con el instalador, el GIF, la frase de posicionamiento y un quickstart de 5 min.
3. **Cadencia pública:** push semanal, release mensual etiquetada con changelog, y un hilo/post por feature-foso (la conformance byte-idéntica es un post de HN por sí sola; la PF que ejecuta vitest/axe/Express de verdad, otro).
4. **Comunidad receptora:** CONTRIBUTING.md, good-first-issues desde `.backlog` (66 tarjetas ya escritas — es un backlog público listo), Discord/Discussions.
5. **Verificación de marca:** búsqueda de trademark "Heliox" (colisiones: término médico conocido y productos homónimos) **antes** de invertir en la marca.

---

## 8. Escalabilidad, repercusión potencial y rentabilidad de partners

### Escalabilidad técnica

- **Código:** 312 ficheros TS / 69k LOC con separación limpia main/renderer/sdk/snapshot-engine; stores Zustand modularizados; SQLite con migraciones. Escala bien a equipos de 3-10 contributors.
- **Producto:** hoy single-user desktop. La ruta a escala ya está construida en embrión: `fluxor serve` (flows como servicio), triggers (producción), SDKs (runtime sin IDE). Falta: colaboración multi-usuario (correctamente priorizada como P2 en el análisis) y cualquier forma de uso sin instalación.
- **Riesgo dominante: bus-factor = 1.** Un solo autor, una sola máquina, trabajo sin push. La escalabilidad empieza por eliminar ese punto único de fallo.

### Repercusión potencial (honesta)

La categoría es enorme y validada (ver §7). La posición de Fluxor es única y defendible con evidencia en código. Pero seamos aritméticamente honestos con "millones de usuarios": **ningún IDE desktop de nicho llega a millones solo con instaladores**. Langflow con >100k estrellas tiene cientos de miles de usuarios activos, no millones. Los caminos reales a 7 cifras son:

1. **Que el formato gane, no (solo) la app.** `FluxorFlowExport` + conformance multi-runtime es la jugada "Terraform/WASM de agentes": si flows Fluxor corren en TS, JVM **y Python**, cualquier equipo puede adoptar el formato sin adoptar el IDE. Los estándares alcanzan millones; las apps, decenas de miles.
2. **Superficie web sin instalación:** un playground (canvas de solo-lectura + run de flows de ejemplo en servidor) convierte cada link compartido en un usuario potencial sin pasar por Gatekeeper.
3. **Insertarse en ecosistemas existentes:** servidor MCP oficial "run-fluxor-flow" (cada cliente MCP del mundo se vuelve usuario indirecto), y más adelante extensión VS Code que consuma flows.

### Rentabilidad de partners (Apache-2.0 lo permite todo)

La licencia Apache 2.0 es la correcta para adopción y partners (permisiva, con patent grant). Modelos ordenados por encaje con los fosos:

| Modelo | Qué se vende | Por qué Fluxor puede y otros no |
|---|---|---|
| **1. Marketplace certificado "Fluxor Verified"** | Rev-share (70/30) sobre flows/roles/mods de partners, **certificados por la Performance Frontier** — cada item se publica con su benchmark ejecutado, IC estadístico y badge | Nadie más puede certificar con *ejecución real* (vitest/axe/HTTP) en vez de opinión de LLM. El `market-integrity` + firma (§6) son el prerequisito técnico |
| **2. Open-core cloud** | Fluxor Cloud: colaboración multi-usuario, RBAC, observabilidad hosted, Arena-as-a-Service (benchmarks bajo demanda), registry privado de flows | El desktop queda 100 % libre (adopción); lo cloud es lo que las empresas ya esperan pagar |
| **3. Serving informado por benchmark** | Partnership con plataformas de deploy (Fly/Railway/Vercel): "despliega la config ganadora de tu Arena en un clic", con rev-share de infra | Combinación Arena→deploy que el análisis competitivo ya identificó como irrepetible ([05](competitive-analysis/05-brechas-y-roadmap.md)) |
| **4. Directorio MCP patrocinado** | Placement curado de servers MCP de vendors, priorizado por la telemetría real `missingCapabilitiesRequested` | El directorio ya existe (`mcp-directory.ts`) y la telemetría de demanda también — es inventario publicitario honesto |
| **5. Enterprise support + certificación** | SLA, formación "Fluxor Certified Engineer", auditorías de flows | Estándar COSS; viable cuando haya tracción |

**Secuencia realista de ingresos:** (año 1) sponsors GitHub + directorio MCP patrocinado → (año 1-2) marketplace certificado → (año 2+) cloud. Intentar monetizar antes de las 5k estrellas mataría la adopción.

### Premios y reconocimiento — objetivos concretos

El producto tiene el perfil exacto para: **Show HN** (la conformance byte-idéntica y la PF son historias técnicas de portada), **Product Hunt** (visual, demo-able; objetivo Golden Kitty de dev tools), **GitHub Accelerator** (open source + modelo de negocio claro), charlas en **AI Engineer Summit / conferencias JS** (el benchmark que ejecuta es una talk), y los showcases de **Electron**. Requisito común de todos: instalable en 2 clics + demo visual + repo vivo. Es decir: Fases 0-2 del plan.

---

## 9. Plan de acción — "Operación Máximo Esplendor"

> Regla de oro heredada del análisis competitivo y confirmada por esta auditoría: **cada semana de esfuerzo debe o (a) hacer instalable/confiable lo que ya existe, o (b) ensanchar un foso. Nada más.**

> **Estado de ejecución (2026-07-02):** implementado en código por 6 subagentes Sonnet orquestados con quality gate (commits `021069fc`, `10f18845`, `94849757` en el IDE; `96f6cc6`, `07eba28` en la web): **0.1, 0.2, 0.4–0.8, 1.1–1.5, 1.6 (mitigado, TLS pendiente), 1.7–1.11 y 2.5**. Gate final: tsc limpio, 914/914 tests, lint 0 errores, build:bridge + bridge e2e 8/8, lint+build web verdes. **Bloqueado en acciones humanas:** 0.3 (tag + primera release), push de ambos repos, secrets de firma (1.1), clave del market (1.5), repo web público (0.8), trademark (0.7), y todos los entregables de media/lanzamiento (0.5-GIF, 2.1–2.4).

### Fase 0 — "Que exista" (semanas 1-2) · coste: bajo · impacto: existencial

| # | Acción | Criterio de éxito |
|---|---|---|
| 0.1 | Commitear la limpieza pendiente (125 ficheros), push de `feat/dev`, merge a `main`, push | `git status` limpio; GitHub refleja julio 2026 |
| 0.2 | Sacar logs de la raíz (`e2e-*.log` → `.gitignore`), limpiar artefactos | Raíz del repo presentable |
| 0.3 | Tag `v0.2.0-alpha` → primera release con instaladores (aunque sin firmar, marcada pre-release) | `latestRelease` ≠ null |
| 0.4 | `ci.yml`: push/PR → `npm ci`, lint, `npm test` en ubuntu/macos/windows | Badge verde en README |
| 0.5 | Actualizar README: estado real (tests verdes, lint migrado), **GIF hero + 4 capturas**, badges | README no se infravende |
| 0.6 | Ficheros de comunidad: CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md, templates de issue; 10 good-first-issues desde `.backlog` | Pestaña Community de GitHub completa |
| 0.7 | **Unificar el dominio canónico en helioxide.com**: corregir `metadataBase` y `sitemap.ts` del front (hoy: heliox.dev), homepage del maker deb en `forge.config.ts:35`, y fijar www vs apex de forma coherente (hoy Vercel redirige apex→www); descripción + topics del repo; búsqueda de trademark "Heliox" | Un único dominio en todo el código, metadatos y SEO |
| 0.8 | Repo web: hacer público `heliox-ide-web` (el escaparate de un proyecto open source debe serlo — y habilita contribuciones a docs) y retomar cadencia de push (congelado desde el 12-abr); añadir CI mínima (lint+build) previa al deploy de Vercel | Web repo público, verde y actualizado |

### Fase 1 — "Que sea confiable" (mes 1-2) · el paquete trust-ready

| # | Acción | Criterio de éxito |
|---|---|---|
| 1.1 | Firma + notarización macOS y firma Windows en release.yml (secrets + `osxSign`/`osxNotarize`) | Instalación sin warnings en macOS/Windows vírgenes |
| 1.2 | Auto-update (`update-electron-app` + releases GitHub) | Update silencioso entre dos releases de prueba |
| 1.3 | CSP estricta en index.html + fuentes self-hosted (@fontsource) | App íntegra offline; ARCH-005 cerrado |
| 1.4 | Seguridad MCP: allowlist + consentimiento explícito para `command` fuera del directorio curado | Ningún spawn sin gesto de usuario |
| 1.5 | Firma de items del market (minisign/sigstore) + verificación en `market-loader` | Item sin firma = no carga (con override explícito dev) |
| 1.6 | Bridge: pairing seguro (HTTPS local o PAKE) | PIN nunca viaja en claro |
| 1.7 | Playwright browsers como descarga bajo demanda | Instalador < 150 MB |
| 1.8 | Crash reporting + telemetría **opt-in** (contador de instalaciones/DAU anónimo) | Dashboard con nº real de usuarios |
| 1.9 | E2E en CI (xvfb) aunque sea suite reducida smoke | El pitch "snapshot-verified" se auto-aplica |
| 1.10 | **Release engineering formal (preparación de versiones GitHub + ejecutables):** semver + conventional commits; CHANGELOG.md generado por release; matriz de artefactos por plataforma y arquitectura con naming estable (`Fluxor-IDE-vX.Y.Z-{os}-{arch}.{ext}`: dmg arm64 + x64, exe/Squirrel x64, deb/rpm x64) firmados según 1.1; `SHA256SUMS` publicado como asset de cada release; flujo draft-release → checklist de QA (instalar en máquina virgen por SO) → publish; canales `alpha`/`beta` (prerelease) → `stable`; `npm ci` en release.yml | Release reproducible, verificable por checksum, instalable en máquina virgen en las 3 plataformas |
| 1.11 | **Conectar las releases al frontend (helioxide.com):** `Download.tsx` deja de ser placeholder — datos de la GitHub Releases API resueltos en build/ISR con revalidación (sin rate-limit en cliente), detección de SO+arquitectura del visitante, botón principal con enlace directo al asset correcto mostrando versión, tamaño y SHA256; página `/download` con la matriz completa de plataformas, checksums e instrucciones (incluida la nota Gatekeeper mientras 1.1 no esté desplegado); fallback a la página de releases de GitHub; sustituir los emoji 🍎🪟🐧 por SVG (regla del propio proyecto); badge de versión en el Hero | Click en helioxide.com → el instalador correcto descargándose; la web muestra siempre la última versión sin tocar código |

### Fase 2 — "Que se conozca" (mes 2-4) · lanzamiento

| # | Acción | Criterio de éxito |
|---|---|---|
| 2.1 | Refresco de la landing en **helioxide.com** (ya existe, congelada desde abril): GIF hero real del canvas de julio, posicionamiento de [06](competitive-analysis/06-posicionamiento-mensajes.md), sección de descargas ya conectada (1.11), quickstart de 5 min | Time-to-first-flow < 10 min medido |
| 2.2 | Vídeo demo 90 s + serie de 3 posts técnicos: (a) "un benchmark que ejecuta de verdad", (b) "flows byte-idénticos TS↔JVM", (c) "agentes que no pueden romper tu UI" | Publicados y enlazados desde README |
| 2.3 | **Show HN** con el post (a) o (b) — son historias de mérito técnico, no de producto | Front page o feedback accionable |
| 2.4 | Product Hunt con el vídeo | Top-5 del día; material para Golden Kitty |
| 2.5 | **Docs de usuario sobre Nextra 4** en helioxide.com/docs: migrar el pipeline artesanal del front (`src/lib/docs.ts` + `DocsShell`/`DocsSidebar` + `next-mdx-remote`) a `nextra` + `nextra-theme-docs` (compatible App Router/Next 16), conservando las 5 MDX seed como base; sidebar por `_meta`, búsqueda integrada (Pagefind) sin coste de mantenimiento, tema oscuro alineado con los tokens `hx-*`, base i18n en/es, redirects 301 desde las URLs `/docs/[slug]` actuales; contenido objetivo: instalar, primer flow, market, Performance Frontier, serve/triggers/RAG | Cada feature con página; búsqueda operativa; URLs antiguas redirigen; docs actualizables por PR de la comunidad (0.8) |
| 2.6 | UI de primera clase para serve/triggers/RAG en el canvas (ensancha el diferencial visual) | Demo end-to-end sin tocar CLI |
| 2.7 | Cadencia: release mensual + changelog + post | 3 releases consecutivas |

### Fase 3 — "Que escale y monetice" (mes 4-12) · fosos y partners

| # | Acción | Criterio de éxito |
|---|---|---|
| 3.1 | **SDK Python a paridad de conformance** (la suite `sdk/conformance/` completa en 3 runtimes) | `pytest` verde con los mismos golden files; post "un flow, tres runtimes" |
| 3.2 | Playground web (canvas read-only + flows de ejemplo servidos) | Usuarios sin instalación; link compartible por flow |
| 3.3 | Servidor MCP oficial "fluxor-flows" (ejecutar flows exportados desde cualquier cliente MCP) | Listado en directorios MCP |
| 3.4 | Programa de partners v1: marketplace con firma + badge "Fluxor Verified" (PF adjunta al item) + rev-share | 5 partners fundadores publicando items certificados |
| 3.5 | Directorio MCP patrocinado (inventario según `missingCapabilitiesRequested`) | Primer ingreso recurrente |
| 3.6 | Exportar trazas a Langfuse/LangSmith (integrar, no construir — P2-8 del análisis) | Observabilidad de producción sin plataforma propia |
| 3.7 | Candidaturas: GitHub Accelerator, charlas (AI Engineer Summit), showcase Electron | 1 aceptación |
| 3.8 | Gobernanza: 2º maintainer, CODEOWNERS, roadmap público | Bus-factor ≥ 2 |

### Workstream transversal — la cadena release → web (versiones, ejecutables y su conexión al frontend)

La preparación de las versiones de GitHub, los ejecutables y su conexión a helioxide.com no son tres tareas: son **un único pipeline** que debe funcionar de punta a punta sin intervención manual. Estado objetivo:

```
tag vX.Y.Z (semver + changelog generado)
  → CI release.yml: npm ci → make por plataforma
      · macOS: dmg arm64 + x64, firmado + notarizado (1.1)
      · Windows: Squirrel .exe firmado (1.1)
      · Linux: .deb + .rpm
  → GitHub Release: instaladores + SHA256SUMS + RELEASES (Squirrel) + notas
  → auto-update: update.electronjs.org sirve la actualización a las apps
      instaladas (1.2 — requiere repo público con releases)
  → helioxide.com: /download revalida contra la Releases API (ISR) y muestra
      el botón correcto por SO/arch con versión y checksum (1.11)
  → docs Nextra versionadas con la release (2.5) + changelog público (2.7)
```

La prueba de aceptación del pipeline completo es una sola: **publicar `v0.3.0` tocando únicamente `git tag` y ver, sin ningún otro paso manual, (a) los 5 instaladores en GitHub, (b) la web ofreciendo la versión nueva, y (c) una instalación previa auto-actualizándose.** Hasta que esa frase sea cierta, el pipeline no está terminado.

Mapa de piezas por fase: 0.3 (primera release) → 0.7–0.8 (dominio canónico + repo web público) → 1.1–1.2 (firma + auto-update) → 1.10 (release engineering) → 1.11 (descargas conectadas) → 2.1 (landing refrescada) → 2.5 (docs Nextra) → 2.7 (cadencia mensual).

### KPIs por fase

| KPI | Fase 0 | Fase 2 | Fase 3 (mes 12) |
|---|---|---|---|
| GitHub stars | >10 | >1.000 | >10.000 |
| Releases firmadas | 1 (pre) | 3 | 12 (mensual) |
| Instalaciones/mes (telemetría opt-in) | — | >500 | >5.000 |
| Descargas/mes desde helioxide.com | — | >1.000 | >10.000 |
| Time-to-first-flow | — | <10 min | <5 min |
| Contributors externos | 0 | >5 | >25 |
| Items de market de terceros | 0 | — | >20 certificados |
| Runtimes en conformance | 2 | 2 | **3** |
| Ingresos | 0 | 0 | Primeros (sponsors + directorio) |

### Riesgos principales y mitigación

1. **Pérdida de trabajo local** (125 ficheros sin commit en un SSD) → mitigado en la acción 0.1, *hoy*.
2. **Incidente de seguridad temprano** (market/MCP) destruiría la marca "verificada" → Fase 1 completa **antes** del Show HN.
3. **Un grande copia la idea de flows portables** → la defensa es la velocidad del estándar: SDK Python + conformance pública + spec versionada (3.1) cuanto antes.
4. **Burnout de autor único** → 0.6 + 3.8 (comunidad y segundo maintainer) no son opcionales; son el plan de continuidad.
5. **Marca "Heliox" no registrable** → verificación en 0.7 antes de invertir en dominio/branding.

---

## Anexo A — Evidencia recogida (2026-07-01)

| Comprobación | Comando / fichero | Resultado |
|---|---|---|
| Tests unitarios | `npm test` | 65 ficheros, **873/873 verdes**, 7,7 s |
| Lint | `npm run lint` | **0 errores**, 242 warnings |
| E2E (última ejecución completa, 27-jun) | `e2e-final2.log` | 348 pass / ~13 fail / 4 flaky, 20,9 min |
| Estado GitHub | `gh repo view CMolG/heliox-ide` | público, Apache-2.0, 1 star, 1 fork, 0 releases, push 2026-04-12 |
| Working tree | `git status`, `git diff --stat` | 125 ficheros dirty; 107 changed: +3.664/−11.470 |
| Divergencia de ramas | `git log main..feat/dev` | 18 commits sin mergear |
| Firma/notarización | `forge.config.ts` | ausentes |
| Auto-update | grep `autoUpdater\|update-electron-app` en `src/main` | 0 resultados |
| CSP | `index.html` | sin meta CSP; fuentes desde Google CDN |
| Flags Electron | `src/main/index.ts:90-133` | contextIsolation ✓, nodeIntegration off ✓ |
| Serve auth | `src/main/serve/serve-flow.ts` | Bearer obligatorio, loopback default ✓ |
| RCE MCP | `src/main/harness-engine/mcp-adapter.ts:345-425` | spawn de `command` desde config, sin allowlist |
| Bridge PIN | `src/main/bridge/qr.ts:33` | PIN en URL sobre HTTP |
| Market | `market/inventory.json` | 12 flows, 9 roles, 25 mods, 7 steps |
| RAG/triggers/serve/checkpoints | `src/main/harness-engine/`, `src/main/triggers/`, `src/main/serve/` | existentes con tests |
| Tamaño del código | `find src -name '*.ts*'` | 312 ficheros, ~69.014 LOC |
| Backlog | `.backlog/` | 66 tarjetas ARCH-* |
| Dominio heliox.dev | `curl -sI https://heliox.dev` | sin respuesta |
| Dominio helioxide.com | `curl -sI https://helioxide.com` | **vivo**: 307 → www.helioxide.com, 200 (Vercel) |
| Repo web | `gh repo view CMolG/heliox-ide-web` | **privado**, push 2026-04-12, homepage heliox-ide-web.vercel.app |
| Descargas del front | `../heliox-ide-web/src/components/Download.tsx` | 3 botones sin `href`/`onClick` (placeholder); iconos emoji |
| SEO del front | `../heliox-ide-web/src/app/layout.tsx:30` | `metadataBase: https://heliox.dev` (dominio equivocado) |
| Docs del front | `../heliox-ide-web/src/content/docs/` | 5 MDX seed; pipeline artesanal `docs.ts` + `next-mdx-remote` (a migrar a Nextra) |
| CI del front | `../heliox-ide-web/.github/workflows/` | inexistente |
| Mercado 2026 | Ver fuentes en el informe de sesión | Dify/Langflow >100k stars; Flowise→Workday; OpenAI/Google/Microsoft en la categoría |

**Documentos hermanos:** [análisis competitivo](competitive-analysis/README.md) · [roadmap cutting-edge de la PF](cutting-edge-roadmap.md) (5/5 fases completadas) · [fosos defensibles](competitive-analysis/04-fosos-defensibles.md) · [posicionamiento](competitive-analysis/06-posicionamiento-mensajes.md)
