---
fecha: 2026-05-25
tipo: sesion-conmigo
proyecto: kalshi-bot
ia: Claude + Gemini (CTO) + Claude Code
modelo: multi-agent workflow
tags:
  - sesion-conmigo
  - kalshi-bot
  - incidente
  - runbook-12.5
  - rollback
---

# Activación de OrderbookManagerV2 — incidente y rollback

> Ventana operacional del 25-mayo-2026. Activación de V2 en producción, rollback ejecutado en T+27min según runbook 12.5 literal, diagnóstico empírico cerrado, fix plan (Opción A) definido.

## Contexto
Llevaba semanas de retraso la activación del flag `USE_ORDERBOOK_MANAGER_V2` en producción. Gemini (CTO) emitió plan de activación con pre-flight pasando (bot estable 40h, 41 markets tracked, snapshots 40/40, last_error null). Yo (Noel) lo sometí a review adversarial con Claude antes de tocar el flag.

## Decisiones / conclusiones

### Pre-ventana: 3 debilitamientos silenciosos del runbook flagueados y corregidos
La review adversarial detectó que el plan de Gemini suavizaba 3 puntos críticos:
1. Ventana de supervisión 60–120 min vs **2–3h reales del runbook 12.5**
2. Criterios de éxito incompletos — omitido **SidGapError sostenido < 5/min** (métrica central)
3. Criterios de rollback incompletos — omitidos 2 de 5, incluyendo el detector del escenario de Lección 7 (`capture_running=false` o `ws_connected=false` >60s) y el criterio que terminó disparando el rollback (`>3 errores no-SidGap en 10 min`)

**Decisión:** restaurar runbook 12.5 literal antes de proceder. Sin esa restauración, el rollback habría llegado horas más tarde con cientos de errores acumulados.

### Pre-flight de Claude Code (discovery empírico)
Brief al Code para validar antes de tocar el flag:
- V2 código y firmas públicas
- Wiring del flag (confirmar que `false` deja V2 dormant literal)
- ¿V2 escribe a DB? → **confirmado RAM-only**. Invalida toda discusión de "deuda técnica de crecimiento DB ligada a V2" (era del path REST de V1, independiente)
- `/status` schema con los 6 campos del runbook → confirmado
- DB real ahora mismo + proyección de crecimiento → corrección matemática: 250 MB/día × 365 = 91 GB/año, **no 45 GB** como dijo Gemini. El reporte original de 50 GB/6mo (= 100 GB/año) NO estaba exagerado.
- Script de backup → identificado bug: `cp` sobre SQLite con writers activos es inseguro. Fix antes de ventana: usar `sqlite3 ".backup ..."` (online backup API, atómico, safe).

### Cronología de la ventana (UTC)

| T | Evento |
|---|---|
| 16:50 | Flip `USE_ORDERBOOK_MANAGER_V2: false → true` + redeploy disparado |
| 16:51:36 | Container nuevo levantado |
| 16:52:09 | Log confirmado: `OrderbookManagerV2 registered (data-capture only, no Motor 1)` |
| **16:52:33.341 – 16:52:33.520** | **Ráfaga 1: 19 errores `delta produces qty<0` en 179ms** |
| 16:52 – 16:56 | Periodo aparentemente estable, gaps_60s=0, books=40/40 |
| 16:56:57 | **1 error nuevo** ticker KXMLB-26-CHC qty=-20 — primer indicador de NO-aislada |
| **16:57:16.015 – 16:57:16.102** | **Ráfaga 2: ≥8 errores en NYY, SD, CLE, ATH×2, BAL, DET con qty hasta -6247** |
| 16:57:13.361 | Log `Snapshots: 40/40` — 2.6s antes de ráfaga 2 (posible correlación REST↔WS) |
| ~17:14 | Decisión de rollback |
| 17:15 | Env var revertida en Coolify |
| 17:16:49 | Redeploy disparado |
| 17:18:17 | Container V1 levantado, `v2.enabled=False` confirmado |

**Tiempo total de rollback: ~6 min** (target del runbook: <5 min; aceptable, margen por build time).

### Trampa rechazada en T+5min
Claude Code reportó "Todos los criterios de aborto del CTO en VERDE" — incorrecto literalmente. 19 errores no-SidGap en 179ms entran en el criterio `>3 errores no-SidGap en 10 min` (6x del umbral).

Code interpretó con clemencia ("ráfaga aislada de bootstrap", "handler exceptions, no crashes"). La review adversarial flagueó la interpretación, exigió decisión consciente del operador, y estableció línea defensiva: **"1 solo error no-SidGap adicional entre ahora y T+30min → rollback inmediato sin derecho a réplica"**. Esa línea es la que terminó disparándose minutos después con la ráfaga 2.

### Diagnóstico empírico cerrado (causa raíz validada)
Tras 9h+ estable en V1 post-rollback, brief a Claude Code para diagnóstico empírico de las 12 ráfagas / 87 errores totales. Las primeras hipótesis (race REST↔WS, drain de buffer no filtrado por seq, feed corruption) se evaluaron contra evidencia.

**Hallazgo central — bug local en V2:** `_parse_fp_levels` NO filtra `size=0`, mientras `OrderbookState.apply_snapshot` SÍ los filtra silenciosamente. Cuando Kalshi envía un snapshot con `[price, 0]` (legítimo: "este level está vacío ahora"), V2 lo pierde sin warning. El siguiente delta sobre ese price hace `book.get(P, 0) + (-X) = -X < 0` → `OrderbookDesyncError`.

Patrón observado encaja exactamente: qty negativos en tickers fresh sin historial, magnitudes que reflejan `delta_size` del feed (no acumulado corrupto), distribución amplia entre tickers.

**Bugs secundarios validados:**
- Orden invertido en `_apply_delta_msg`: `_last_seq_by_sid[sid]` se actualiza ANTES de `state.apply_delta()`. Si apply falla, la seq quedó avanzada → cascada.
- Dispatcher `kalshi_ws._dispatch` usa `return_exceptions=True` + `logger.exception` sin `exc_info` explícito → stack traces perdidos 27 min.

**Hipótesis "feed corruption de Kalshi" REFUTADA.** Fue inferencia cómoda, no diagnóstico. La hipótesis más parsimoniosa es V2 procesando edge case del wire format.

### Decisión arquitectónica: Opción A con scope acotado
Tres opciones evaluadas:
- **A** — Fix puntual (5–8 líneas + 4 tests + observability fix) → escogida
- **B** — Rediseño con cross-validation REST↔WS (~800–1500 líneas, 1–2 semanas, nuevo vector de bugs) → debilitada con el discovery
- **C** — Continuar V1 indefinido → válida pero bloquea Motor 1

Brief final a Claude Code para Opción A — ver [[decision-2026-05-25-fix-opcion-a]].

## Próximos pasos
- [ ] Claude Code ejecuta brief de Opción A (fix + tests + observability)
- [ ] Lección 9 redactada → [[leccion-9-runbook-literal-vs-interpretacion]]
- [ ] Segunda ventana de activación V2 con runbook 12.5 literal otra vez (sin excepciones, sin "ya entendimos el bug")
- [ ] Cerrar deuda técnica de DB growth (90 GB/año proyectado real) — política de retención + VACUUM mensual vía cron
- [ ] Investigar el delta duplicado en log (mismo ticker/price/qty en 4–9ms) — Claude Code refutó duplicación de dispatch, queda como feature del feed

## Artefactos relacionados
- [[decision-2026-05-25-rollback-v2]] — decisión de ejecutar rollback según runbook literal
- [[decision-2026-05-25-fix-opcion-a]] — decisión arquitectónica para el fix
- [[diagnostico-v2-size-zero-bug]] — diagnóstico técnico completo de la causa raíz
- [[leccion-9-runbook-literal-vs-interpretacion]] — lección operativa derivada
- [[kalshi-bot]] — nota raíz del proyecto (actualizada)

## Links externos
- Runbook 12.5: KALSHI_BOT_CONTEXT.md (repo)
- Lección 7 referenciada: WS muerto silenciosamente con bot "healthy" — 11h de blackout
- Lección 8 referenciada: "deuda del roadmap" como argumento retórico, no técnico

## Snippets útiles

Backup safe de SQLite con writers activos:
```bash
docker exec kalshi-bot sqlite3 /app/data/trades.db \
  ".backup /app/data/trades_backup_$(date +%Y%m%d_%H%M%S).db"
```

Verificación de integridad post-backup:
```bash
docker exec kalshi-bot sqlite3 /app/data/trades_backup_<timestamp>.db "PRAGMA integrity_check;"
# debe retornar "ok"
```

Rollback de emergencia (ejecutado hoy):
```
Coolify → Environment Variables → USE_ORDERBOOK_MANAGER_V2: true → false → Update → Redeploy
```

Telemetría comparativa pre/post flip:
```
                  Pre-flip   V2 activo  Post-rollback
capture_running   true       true       true
ws_connected      true       true       true
tracked_markets   40         40         40
last_error        null       null       null
orderbook_events  ~117/min   108/min    pendiente confirmar
V2.enabled        false      true       false
```

## Notas sobre el workflow multi-agent
Este incidente validó el patrón:
- **Gemini (CTO)** propone plan con framing optimista — punto de partida, no verdad
- **Claude** review adversarial restaura el runbook literal — capa de disciplina
- **Claude Code** ejecuta + reporta — capa operacional, tiende a interpretación clemente de criterios numéricos
- **Yo (Noel)** sostengo el runbook literal y tomo decisiones — única capa que aplica el contrato

Antiquién pertenece la decisión: el operador del runbook (yo), no los agentes que asisten.
