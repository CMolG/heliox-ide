# ONGOING — ejecución del backlog de producto de Fluxor (handoff para reanudar)

> **Última actualización:** 2026-07-23 (tarde) · **Rama:** `feat/sdk-sandbox-y-mods` (**53 commits** ahead de `origin/main`, **NUNCA pusheado** — protocolo: commits sí, push solo con OK explícito del humano). Árbol limpio salvo este fichero.
> **Repos:** trabajo en el satélite `heliox-ide` (Apache-2.0). El motor cerrado `@javadaba/daba-engine` vive en el Core `../javadaba-web/packages/daba-engine` (resuelto por `npm link`).

---

## TL;DR — dónde estamos y qué sigue

Ejecutando el backlog de producto (`docs/superpowers/backlog/`). Orden **reordenado** (decisión humana): **features primero (#6, #5) → limpieza al final (#7, #4)**.

- **#5 backlog-bento: CÓDIGO COMPLETO (F1–F5)**, producto probado. Faltan solo 3 pulidos e2e finos (abajo).
- **#6 fases (Capa 1): F2 + F3 COMPLETAS — Tasks 1–16 de 30.** ← **retomar en la Task 17 (F4).**
- **#4 e2e y #7 limpieza:** al final. #4 refinada (sin regresión). #7-F3 espera decisiones humanas.

**Reanudar por:** **#6 Task 17** (F4: `fluxor-flow.ts` export/import round-trip de `phases`) en `docs/superpowers/plans/2026-07-22-flow-phases-capa1.md:2042`. F4 = Tasks 17–25 (formato + conformance + downgrade Java/Python), F5 = Tasks 26–30 (PF A/B + decisión Capa 2).

---

## Progreso por tarea

### ✅ #1 / #2 / #3 — completadas antes de esta sesión (context-modes, chats→steps, rebranding).

### 🟡 Task 14 daba-engine (stream SEPARADO del backlog) — Step 1 commiteado
- `4861434d` = Task 14 Step 1 (barrido parcial). **Pendiente para cerrarla** (bitácora `docs/superpowers/backlog/2026-07-17-daba-engine-registro-privado.md`, sección «Actualización 2026-07-21»):
  - Step 1 resto: migrar guías/`DottedBackground`/`centerViewportOn` al motor (diferido «Task 12-bis»).
  - **Step 2 = ACCIÓN DEL HUMANO:** publicar `@javadaba/daba-engine` al **registro npm privado** (GitHub Packages, token `write:packages`) **o** vendorizar el tarball 0.2.0. Sin esto, `npm install` en limpio falla por `@javadaba/daba-engine@^0.1.0` no publicado.
  - Step 3 (e2e 14/14) entrelazado con #4. Step 4 commits. Task 15 docs.

### ✅ #5 backlog-bento — F1–F5 CÓDIGO COMPLETO
Reemplaza el kanban por el diseño bento (pila 1:1) + schema v2 + 3 lanzadores + ciclo de estados + watcher.
- **Commits:** F1 `a6eee72f`→`d06e04c0`; cutover+UI `2e861210`→`f39239ce`; lanzadores `8f5ec992`→`b55308e1`; estados `43cce3b5`→`3cff1d29`; limpieza+e2e `7cefc138`→`7b3b1969`.
- **Gates verdes:** `tsc --noEmit` = 0; **`npx vitest run` = 1770 passed**; invariantes Gate 2 (un solo `insertPipelineAssembly`, cero `runAgent` vivo). e2e: **cero regresión no-backlog** + bloque "Backlog Widget" pasa.
- **Fuente de verdad:** spec F0 `docs/superpowers/specs/2026-07-21-backlog-schema-v2-f0.md`; plan `docs/superpowers/plans/2026-07-22-backlog-bento.md`; referencia visual congelada `docs/superpowers/specs/2026-07-08-backlog-bento-reference.tsx`.
- **Nota:** el cutover (F2·T1) adelantó el borrado del quinteto kanban de F5 a F2 (el campo Zustand `backlogCards` es de una sola forma). Tipos v2 promovidos: `BacklogCard`=v2, `LegacyBacklogCard`=v1 (`src/types/market.ts`).

**Residuos e2e pendientes de #5** (specs que F5 escribió sin poder correr; el FEATURE está unit-probado):
1. **3 tests de `e2e/backlog-dnd.spec.ts` › Multi-select** (meta/shift+click) fallan (~12s): la interacción modifier-click no registra la selección en e2e. Hipótesis: la animación `hover:-translate-y-1` de la tarjeta la vuelve "inestable" para el auto-click de Playwright, o el click cae en un hijo. Ya arreglé el strict-mode de fuga de ventanas (`beforeEach` que resetea a 1 ventana — commit `7b3b1969`; con eso Keyboard-reorder/Order/Batch ya pasan). **Cubierto por unit tests de `BacklogPile`.** Fix: revisar el target/estabilidad del click (p.ej. `force`, o esperar fin de animación).
2. **1 test `desktop.spec.ts › Backlog Widget › autoflow launcher` = `test.fixme`** (commit `5c0d5d7f`): NO es bug — el meta-agente vía `window.fluxorAPI.assemblePipeline` es inmutable por **contextBridge** (`contextIsolation:true`, `preload:492`), no se puede mockear en e2e sin backend real. Lanzador cubierto por 21 unit tests. **Follow-up:** variante mockless usando el lanzador de **épica** (mapper `epicToPipelineAssembly` puro, sin IPC del meta-agente).
3. **2 tests `e2e/mental-connections.spec.ts` (Click/Drag-to-connect)** fallan: gestos de handle timing-sensibles (los que el CI evita explícitamente). **Alta confianza: flakiness preexistente, NO regresión de #5** (#5 no toca el canvas mental; la lógica de edges programática pasa). Para confirmar 100%: correr `e2e/mental-connections.spec.ts` en el commit pre-#5 `4861434d`.

### 🟡 #6 flow-phases-superstates (Capa 1) — **F2 + F3 COMPLETAS (Tasks 1–16 / 30)**  ← RETOMAR EN TASK 17
Formaliza la **fase** como superestado (agrupador de steps con gate de salida + reanudación). 30 tasks.
- **Spec F1 (aprobada):** `docs/superpowers/specs/2026-07-21-agentic-phase-model.md`. **Plan (aprobado, 30 tasks):** `docs/superpowers/plans/2026-07-22-flow-phases-capa1.md`. Task doc: `docs/superpowers/backlog/2026-07-08-flow-phases-superstates.md`.
- **LÍNEAS ROJAS (rechazar en review):** `src/main/harness-engine/loop-plan.ts` **byte-idéntico**; Capa 2 **NO-GO** (nada de exit-conditions/skip/retry-de-bloque/rollback/timeout); `onError` solo `'halt'`; `replay.ts` cero diff. El gate de salida vive en `executor.ts` reusando `guardrails.ts`.
- Estructura del plan: F2 (tipos+canvas+compilador, Tasks 1–9) ✅ · F3 (runtime gate+checkpoint marker+resume, Tasks 10–16) ✅ · F4 (formato+conformance+downgrade Java/Python, Tasks 17–25) ⬜ · F5 (PF A/B + decisión Capa 2, Tasks 26–30) ⬜.

**Hecho (commits `7cbf01b0` → `177e20aa`, 8 commits):**
- **F2:** `AgenticPhase` + `AgenticFlow.phases`; `PhaseNodeData`/`PhaseGraphNode` (union `CanvasGraphNode` ampliada); `findOwningPhase`; validación de membresía en el compilador (id único, no-vacía, ids resolubles, subgrafo conexo por BFS no dirigido, disjunta, `onError==='halt'`, dedup de stepIds, interacción con `includeIds`); `addPhaseNode`/`updatePhaseData`; `removeMentalNode` disuelve la fase (re-parenta, no borra); `PhaseNode.tsx` + CSS + registro en el canvas.
- **F3:** `PhaseBoundaryMarker` + `Checkpoint.phaseBoundary` (+ columna `phase_boundary TEXT` en `SqliteCheckpointStore`); `findPhaseStartCheckpoint` (resume-from-phase-start SIN tocar `replay.ts`); `CheckpointRecord.phaseBoundary` (IPC); `validateFlow` re-valida fases defensivamente; `buildPhaseRuntimeState` (cuenta INSTANCIAS del `ExecutionPlan` ya expandido) + snapshot `before` perezoso; gate de salida evaluado **una sola vez** en la última instancia + marcador `start`/`end` en el checkpoint.

**Gates verdes:** `npx tsc --noEmit` = 0 · **`npx vitest run` = 1819 passed** (baseline pre-#6 era 1770; +49) · `git diff` de `loop-plan.ts` y `replay.ts` = **VACÍO** (línea roja 2 sostenida) · `loop-plan.test.ts`/`replay.test.ts`/`guardrails.test.ts` sin tocar (línea roja 4).

**3 desviaciones del plan (bugs reales del plan, corregidos + tests):**
1. **Cascada de borrado de Frame no transitiva.** `addStepNode` nunca mete el step en `frame.data.childIds`, así que la cascada depende del escaneo de `parentId`; al meter una fase entre medias, borrar el frame borraba la fase y dejaba sus steps huérfanos con `parentId` colgando. `removeMentalNode` ahora desciende hasta punto fijo (sin fases converge en la 1ª pasada ⇒ conjunto idéntico).
2. **`MentalGraphCanvas` no mapeaba el tipo `phase`.** El plan solo registraba `nodeTypes`; un `PhaseGraphNode` caía al `default` y se dibujaba como tarjeta mental. Añadida rama con `parentId`/`extent:'parent'` y `zIndex` 1 (entre frame 0 y step 2).
3. **Orden de nodos para React Flow.** `addPhaseNode` hacía `append`, dejando la fase DESPUÉS de los steps que parenta (React Flow resuelve `parentId` posicionalmente). Ahora se inserta justo tras su frame. Test de invariante añadido.

- **Task 16 Step 4 (e2e diferencial): ✅ PASA — cero fallos nuevos.** Medido de verdad, no estimado: suite completa en HEAD (320 tests, 19,5 min) = 64 failed / 248 passed / 1 flaky / 7 skipped. Los 64 fallos viven en SOLO 3 ficheros. Luego se corrieron esos 3 ficheros en el commit pre-#6 `7b3b1969` (233 tests, 17,1 min) = 63 failed. El delta era un único test, `desktop.spec.ts:1239 › Window Aesthetics › single-click on window surface focuses…`, **confirmado flake**: falla en el 1er run completo, **pasa** en un 2º run completo del mismo fichero, y pasa aislado (3,5 s); su modo de fallo es `locator.click` timeout porque el widget HUD auto-chat intercepta el puntero — solapamiento de layout, no lógica. Con él excluido los conjuntos de fallos son **idénticos elemento a elemento** (59 desktop + 3 backlog-dnd + 1 mental-map), no solo iguales en número.

**BASELINE e2e REAL = 63** (no «~62»), medido en `7b3b1969` sobre `desktop.spec.ts` + `backlog-dnd.spec.ts` + `mental-map.spec.ts`; el resto de specs están en verde. Desglose: **59** `desktop.spec.ts` (spec-rot de #2 chats→steps: Attachable Lifecycle, Marketplace, Navigator, Quick Tour, Flow independence), **3** `backlog-dnd.spec.ts` (residuos multi-select de #5), **1** `mental-map.spec.ts:318`. Flaky recurrente en ambos runs: `desktop.spec.ts:1332` (ctrl+scroll zoom). `mental-connections.spec.ts` pasó en ambos runs ⇒ **queda confirmado que sus 2 fallos eran flakiness, no regresión de #5** (residuo 3 de #5, cerrado).
  - **`mental-map.spec.ts:318` diagnosticado (para #4):** no es un bug de producto. Asserta `pendingStepFocusId === newestId`, pero `StepConfigCore.tsx:260-266` consume y limpia ese one-shot al montar; las dos asserts previas (`selectedIds`, `showInspector`) sí pasan. Es una carrera contra su propio consumidor — el arreglo es asertar el efecto (foco en el textarea), no la señal.

### ✅ Observabilidad de crashes (fuera del backlog, 2026-07-23) — commit `99a0965c`
La app crasheó el 2026-07-23 ~10:17 y **no dejó NADA**: `Crashpad/` vacío, sin `.ips`, sin log. Diagnóstico: `crashReporter.start()` (en `index.ts`) solo captura crashes **nativos**; una excepción JS no capturada en main, una promesa rechazada o un renderer muerto se imprimían al terminal de `npm start` y morían con él.
- **`src/main/fatal-log.ts` (nuevo):** `installFatalHandlers()` con 4 listeners que escriben a `<userData>/fluxor.log`. **Sin cambiar la semántica de crash:** `uncaughtException` usa `prependListener` (el handler propio de Electron sigue corriendo después), `unhandledRejection` re-lanza (cualquier listener suprime el `--unhandled-rejections=throw` por defecto de Node), y `render-process-gone`/`child-process-gone` son puramente observacionales.
- **`logger.ts`:** nuevo `log.fatal()` que escribe SIEMPRE a disco (a diferencia de `log.error()`, que prefiere la consola y solo cae a fichero si la consola falla) + getter `log.filePath`.
- El arranque ahora imprime las dos rutas: `[crash-reporter] local dumps: …/Crashpad` y `[crash-reporter] fatal log: …/fluxor.log`. Verificado arrancando la app.
- **Nota del sistema:** en el momento del crash el volumen de arranque estaba a **3,5 GB libres** (bajo el umbral de 3 GB de macOS) y un proceso `node` había escrito 2,1 GB en 26 min. No es prueba de causa, pero es un sospechoso razonable de un fallo de escritura SQLite. Ahora hay 9,2 GB libres.

### ⏸️ #4 deuda-e2e-suite-legacy — REFINADA, la ÚLTIMA
`docs/superpowers/backlog/2026-07-18-deuda-e2e-suite-legacy.md` (Estado 🟡 PARCIAL, F1 hecho). **Hallazgo clave:** el baseline real es **~62 fallos** (no 26 — infra-contado), y **NO hay regresión daba-engine** (511da44f ≡ HEAD, verificado). Son **spec-rot de #2 (chats→steps)** — tests contra `spawnChatWindow`/`'chat'`/`RightFlowAttachment` retirados. Gran parte la reescriben **#5-F5** y **#7**. Por eso va al final.

### ⬜ #7 limpieza-vestigios — F1/F2 listas, F3 espera decisiones humanas
`docs/superpowers/backlog/2026-07-21-limpieza-vestigios-post-migraciones.md`. F1 (borrado categoría A) + F2 (reubicar `chat/CodeBlock`+`FileContextBuilder`) listas. **F3 bloqueada por 5 decisiones humanas** (runAgent/agent-manager; Scorecard/TimeTravel panels; program.md; migración 004; campos vestigiales de DesktopWindow).

---

## Entorno e2e — cómo reanudar los tests (IMPORTANTE)

El entorno está listo AHORA (ABI 145). Pero ojo con esto:

1. **better-sqlite3 debe estar en ABI 145 (Electron 41), no 137 (node sistema).** Verificar:
   `node -e "try{process.dlopen({exports:{}},require('path').resolve('node_modules/better-sqlite3/build/Release/better_sqlite3.node'));console.log('137 MAL')}catch(e){console.log(e.message.includes('145')?'145 OK':'?')}"`
   Si está en 137, reconstruir (⚠️ `electron-rebuild -f -w` NO funciona con npm 11; usar node-gyp):
   `cd node_modules/better-sqlite3 && npx node-gyp rebuild --target=41.2.0 --arch=arm64 --dist-url=https://electronjs.org/headers`
   **Cualquier `npm install`/`npm rebuild` lo revierte a 137 → rehacer.**
2. **El main de e2e debe reconstruirse tras tocar `src/main` o `src/preload`** (carga el dev server :5173 vía `MAIN_WINDOW_VITE_DEV_SERVER_URL`; `electron-forge package` construye el de PRODUCCIÓN que NO sirve):
   `npx vite build --config vite.main.e2e.config.ts --outDir .vite/build && npx vite build --config vite.preload.e2e.config.ts --outDir .vite/build`
3. **Correr e2e:** `npx playwright test [specs]` (macOS necesita display real / Bash SIN sandbox — el global-setup arranca el vite renderer en :5173).
4. **Gate e2e = DIFERENCIAL** contra **baseline 63** (medido 2026-07-23 en `7b3b1969`, desglose en #6 arriba): cero fallos NUEVOS. NO intentar "suite completa verde" hasta que #4 cierre.
   **Método que funcionó** (repetirlo, es barato): correr la suite completa en HEAD → ver en qué POCOS ficheros caen los fallos → correr SOLO esos ficheros en el commit base → `comm` de los dos conjuntos de `spec.ts:línea:col`. Comparar números no basta: hay ~2 tests con flakiness ambiental (`desktop:1332`, `desktop:1239`) que mueven el total ±1 entre runs. Ante un fallo "nuevo", re-correr su fichero completo antes de dar por hecho que es regresión.
5. **`yaml`:** side-loadeado en `node_modules/yaml@2.9.0`; `package.json` lo declara pero el **lockfile no** (porque `npm install` falla por el registro npm privado — Task 14 Step 2). Al resolver el registro, correr un `npm install` limpio para fijar el lock. Unit tests (vitest, node 137) van bien igualmente.
6. **Matar la app de dev antes de correr e2e** (`pkill -f "electron-forge start"`) — comparte el `userData` y el puerto del renderer.
7. **Verificado 2026-07-23:** ABI 145 OK, main+preload de e2e reconstruidos tras F3 (toca `src/main/index.ts`, `logger.ts`, `fatal-log.ts`, `executor.ts`, `checkpoints.ts`). Suite completa = **320 tests**.

**Comandos base:** unit `npx vitest run` · tipos `npx tsc --noEmit` · lint `npm run lint`.

---

## Bloqueantes del humano (tus TODOs)
1. **Publicar el registro npm privado** de `@javadaba/daba-engine` (Task 14 Step 2) — desbloquea el lockfile de `yaml` y `npm install` limpio.
2. **Las 5 decisiones de #7-F3** (listadas en su task doc) — para poder ejecutar #7-F3.
3. (Opcional) ¿Cuándo hacer `git push`? Nada pusheado aún (44 commits en `feat/sdk-sandbox-y-mods`).

## Aprendizajes clave (2026-07-23)
- **Los planes traen bugs que solo aparecen al ejecutar.** Los 3 de F2 (arriba) no eran ambigüedades del plan sino afirmaciones falsas suyas: registrar `nodeTypes` no basta para que un nodo se pinte, y `append` rompe el parentesco posicional de React Flow. Ejecutar el gate de cada task (no solo `tsc`) es lo que los cazó.
- **Un `crashReporter` no es observabilidad de crashes.** Solo cubre lo nativo; en Electron la mayoría de muertes reales son JS. Ver la sección de observabilidad arriba.

## Aprendizajes clave de la sesión anterior
- **contextBridge inmutable:** en e2e no se pueden monkey-patchear métodos de `window.fluxorAPI` (contextIsolation). Para mockear, manejar el store directo vía `__DESKTOP_STORE__` (como hace `new-features.spec.ts`), no la API.
- **Los subagentes cazaron varios bugs de los planes** (contradicciones de tipos, gaps de ficheros, profundidad de imports, contradicciones internas del plan) y pararon a preguntar — funcionó bien. Repetir el patrón en #6.
- Cola/protocolo del backlog: `docs/superpowers/backlog/README.md` (tabla actualizada al reorden 2026-07-22).
</content>
