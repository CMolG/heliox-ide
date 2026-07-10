# Campaña PF: Context Modes (blind vs feedback)

> **Estado: 🟡 tooling listo — la campaña NO se ha ejecutado.** Requiere GO explícito del usuario: correrla consume tokens reales de LLM (4 runs de suites `team-work`/`progression`, output-heavy). Ver plan: [`../superpowers/plans/2026-07-10-flow-context-modes.md`](superpowers/plans/2026-07-10-flow-context-modes.md) (Task P) y spec: [`../superpowers/specs/2026-07-10-rosetta-context-manifest.md`](superpowers/specs/2026-07-10-rosetta-context-manifest.md).

## Objetivo

Medir el efecto real de `contextMode: 'feedback'` (manifest Rosetta + bloque `<flow_awareness>` + briefings prompt-driven entre steps) frente a `'blind'` (comportamiento de hoy, sin cambios) sobre las **mismas** suites, seed y modelo — criterio de aceptación 4 del backlog ([`../superpowers/backlog/2026-07-08-flow-context-modes-blind-vs-feedback.md`](superpowers/backlog/2026-07-08-flow-context-modes-blind-vs-feedback.md), fase F5) y las tres dimensiones que ahí se piden: **puntuación del judge, coste en tokens, wall-time**.

## Suites elegidas

| Suite | Por qué |
|---|---|
| `team-work` | 3 agentes secuenciales con handoffs explícitos (planner → designer → developer). Es el caso donde la consciencia de flow — topología, fichero de contexto asignado, briefings prometidos — debería importar más: cada step depende literalmente de lo que el anterior promete entregarle. |
| `progression` | 2 épocas sobre el mismo VFS no destruido. Mide si el modo feedback ayuda a no regresar trabajo previo, más allá de lo que ya captura el judge de regresión (`regressionScore`) hoy. |

`flow-assembler` queda deliberadamente fuera: no ejecuta un `AgenticFlow` (usa `assemblePipeline` directamente), así que `--context-mode` es un no-op ahí — `pf:run`/`pf:bench` avisan de esto en vez de callar (Step P1).

## Diseño del experimento

- **Misma seed, mismo modelo, ambos modos.** Por cada suite: una corrida en `blind` y una en `feedback`, con idéntico `--seed` e idéntico `--model`. `pf:compare` empareja por (suite, seed, modelo) — si cualquiera de los tres difiere entre las dos corridas de una suite, no habrá pareja que comparar (queda como "unpaired" en el reporte, no se descarta en silencio).
- **Modelo:** el default del PF, `mimo/mimo-v2.5-pro` (override con `--model=` si se quiere repetir la campaña sobre otro modelo — en ese caso usar la MISMA seed, y `pf:compare` seguirá emparejando correctamente porque el modelo también forma parte de la clave de agrupación).
- **Seed sugerida:** `7` (arbitraria y fija — lo único que importa es que blind y feedback de una misma suite compartan la MISMA seed).
- **Métricas comparadas** (por suite+modelo, blind → feedback, Δ%): puntuación final del judge (`finalScore`), tokens totales (`telemetry.totalTokens`), wall-time (`telemetry.latencyMs`, suma de latencias LLM por step — ver `telemetry/collector.ts`).

## Checklist de ejecución (pendiente de GO del usuario)

- [ ] Confirmar GO del usuario — las 4 corridas consumen tokens reales de LLM (`team-work`/`progression` son suites output-heavy: 3 steps secuenciales y 2 épocas respectivamente).
- [ ] `npm run pf:run -- --suite=team-work --context-mode=blind --seed=7`
- [ ] `npm run pf:run -- --suite=team-work --context-mode=feedback --seed=7`
- [ ] `npm run pf:run -- --suite=progression --context-mode=blind --seed=7`
- [ ] `npm run pf:run -- --suite=progression --context-mode=feedback --seed=7`
- [ ] `npm run pf:compare -- --seed=7 --suites=team-work,progression`
- [ ] Revisar la sección "Resultados" de este documento (la escribe el comando anterior) y decidir: ¿`feedback` pasa a ser el modo recomendado por defecto, queda opt-in documentado, o se descarta por el sobrecoste de tokens sin mejora de puntuación que lo justifique? Esa conclusión también es un resultado publicable (ver spec, decisión de refinement 4).

## Comando exacto (tras las 4 corridas de arriba)

```
npm run pf:compare -- --seed=7 --suites=team-work,progression
```

`pf:compare` imprime la tabla en stdout Y la escribe en la sección "Resultados" de abajo (reemplaza solo esa sección; el resto de este documento queda intacto — puede re-ejecutarse tantas veces como se repita la campaña).

## Resultados

_(placeholder — se rellena ejecutando `npm run pf:compare -- --seed=7 --suites=team-work,progression` tras completar el checklist de arriba)_
