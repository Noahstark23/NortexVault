# Proyecto: kalshi-bot

> Fuente consolidada para NotebookLM. Standalone — sin wikilinks no resueltos.
> Última actualización: 2026-05-26 (T+13h post-rollback, fix Opción A entregado y mergeable).

## Resumen ejecutivo
Bot automatizado de trading en Kalshi (mercado de eventos). Roadmap por fases:
- **Fase 1** — Data capture only (V1, operando estable 13h+ post-rollback).
- **Fase 2** — Motor 1 arbitraje intra-Kalshi (requiere V2 = OrderbookManagerV2 sano. Bug del 25-may corregido en commits `ed7b7ac` + `b9abaa0`, fix mergeable, segunda ventana de activación pendiente con revisión sobria del diff).
- **Fase 3** — `TRADING_ENABLED=true` (sin tocar hasta Fase 2 cerrada con confianza).

Estado actual: V1 capturando 39 markets multi-deporte (KXMLB MLB + KXUCL Champions League + KXNHL hockey) vía REST + WS, **13h+ estable post-rollback (289K events en último ciclo, 4.59M acumulados, 0 errores)**. V2 dormant detrás de flag `USE_ORDERBOOK_MANAGER_V2=false` tras incidente — fix entregado, no re-activado todavía por aplicación disciplinada de Lección 9.

## Motivación
Construir un flujo de ingreso independiente y escalable. Si funciona, deja de depender de un solo canal de ingresos. Aprendizaje aplicable a otros mercados (Polymarket, futuros, opciones).

## Arquitectura por capas

### Path V1 (data capture, operando)
- `_take_snapshots` cada ~5 min vía REST API de Kalshi
- Escribe a `orderbook_events` (SQLite, ~250 MB/día = 90 GB/año proyectado)
- Lee solo `_top_bid` — superficie reducida, robusto
- Sin state in-memory persistente (procesa y escribe a DB)
- Bus de mensajes WS también activo pero solo para `data_capture._on_orderbook_snapshot` que persiste a DB

### Path V2 (Motor 1, dormant)
- `OrderbookManagerV2` mantiene state in-memory de los 40 books vía WS deltas
- Recibe `orderbook_snapshot` inicial al suscribirse + deltas continuos
- Requerido para Motor 1 (arbitraje intra-mercado en milisegundos)
- Único archivo: `src/strategies/motor_1_arbitrage/orderbook_manager_v2.py`
- Confirmado RAM-only — NO escribe a DB

### Flags operacionales
- `USE_ORDERBOOK_MANAGER_V2` — controla si V2 se carga (lazy import dentro de `if`). Actualmente `false`.
- `MOTOR_1_ARBITRAGE_ENABLED` — controla si V2 ejecuta lógica de arbitraje (no solo data capture). Actualmente `false`.
- `TRADING_ENABLED` — controla si se ejecutan trades reales. Actualmente `false`. NO tocar hasta Fase 3.

## Incidente 25-mayo-2026: activación V2 fallida

### Cronología (UTC)
- 16:50 — Flip `USE_ORDERBOOK_MANAGER_V2: false → true`, redeploy
- 16:51:36 — Container nuevo levantado
- 16:52:09 — Log `OrderbookManagerV2 registered (data-capture only, no Motor 1)`
- 16:52:33 — Ráfaga 1: 19 errores `delta produces qty<0` en 179ms
- 16:56:57 — 1 error nuevo (no aislado)
- 16:57:16 — Ráfaga 2: ≥8 errores nuevos, magnitudes hasta -6247
- 17:14 — Decisión de rollback (línea defensiva pre-establecida disparada)
- 17:18:17 — Container V1 levantado, V2 dormant confirmado

**Total: 87 errores en 27 min, 12 ráfagas, ≥24 tickers afectados. Rollback en ~6 min.**

### Causa raíz validada (3 bugs)

**Bug primario — Inconsistencia de convención `size=0`:**
`_parse_fp_levels` en V2 no filtra levels con `size=0`. `OrderbookState.apply_snapshot` sí los filtra silenciosamente. Cuando Kalshi envía snapshot con `[price, 0]` (legítimo: "este level está vacío ahora"), V2 lo pierde sin warning. Delta posterior con `delta=-X` sobre ese price hace `book.get(P, 0) + (-X) = -X < 0` → `OrderbookDesyncError`.

**Bug contribuyente — Orden invertido en `_apply_delta_msg`:**
`_last_seq_by_sid[sid] = new_seq` se ejecuta ANTES de `state.apply_delta(...)`. Si apply falla, la seq ya quedó avanzada → siguiente delta se procesa como normal → cascada de errores.

**Bug de observabilidad — Stack traces silenciados:**
`kalshi_ws._dispatch` usa `gather(return_exceptions=True)` + `logger.exception` sin `exc_info` explícito. 27 minutos sin tracebacks persistidos.

### Hipótesis refutadas durante diagnóstico
1. "Feed corruption de Kalshi miente" — refutada. Era inferencia cómoda. Hipótesis parsimoniosa es V2 procesando edge case del wire format.
2. "Duplicación de dispatch" — refutada. `_handlers` es dict de listas, sin paths de reinject.
3. "Drain de buffer sin filtrar por seq" — refutada. Buffers vacíos en bootstrap; no encontrado `clear()` ciego.

## Decisión arquitectónica (Opción A)

Tres opciones evaluadas, escogida A:

**A — Fix puntual (5–8 líneas + 4 tests):**
1. Filtrar `size==0` en `_parse_fp_levels` (no en apply_snapshot). Mantener invariante "size > 0" en OrderbookState puro.
2. Invertir orden en `_apply_delta_msg`: `state.apply_delta()` antes de `_last_seq_by_sid[sid] = new_seq`.
3. Mantener comportamiento estricto ante delta sobre price ausente: `OrderbookDesyncError`.
4. Observability: `exc_info=r` en `_dispatch`; logging raw snapshot WS (INFO resumen + DEBUG completo).
5. Tests: 4 nuevos (filtrado size=0, seq no avanza tras error, regresión con magnitudes -6247/-4887, stack trace en log).

**B — Rediseño con cross-validation REST↔WS:** descartada. Realista ~800–1500 líneas + 1–2 semanas + nuevos vectores. Cross-validation no soluciona bug de parsing, solo lo detecta tarde.

**C — Continuar V1 indefinido:** descartada por ahora. Bloquea Motor 1 sin razón técnica suficiente (bug está identificado y es contenido).

## Lección 9 — runbook literal vs interpretación clemente

La activación validó empíricamente la disciplina del runbook literal. Tres momentos:
1. Pre-ventana: el plan del CTO (Gemini) suavizó 3 puntos críticos (ventana de supervisión, criterios de éxito y rollback). La review adversarial los restauró.
2. T+5min: Claude Code reportó "criterios en verde" con 19 errores no-SidGap (>6x umbral). Interpretación clemente refutada por el operador humano.
3. T+25min: línea defensiva (1 error adicional = rollback) disparada. Rollback en 6 min.

**Anti-patrones confirmados:**
- "Softening del runbook a mitad de incidente"
- "Es el feed/sistema externo el que falla" sin discovery del propio código primero
- "Es ráfaga aislada de bootstrap" como interpretación post-hoc para evitar rollback
- "Retrasar incrementa la deuda del roadmap" como presión retórica sin sustento técnico

**Decisión derivada:** los criterios numéricos del runbook se aplican literalmente. Las interpretaciones clementes se documentan como excepciones conscientes con razones explícitas, no como default silencioso de las capas operacionales.

## Multi-agent workflow validado
- **Gemini (CTO):** propone plan con framing optimista — punto de partida, no verdad
- **Claude:** review adversarial restaura el runbook literal — capa de disciplina
- **Claude Code:** ejecuta + reporta — capa operacional, tiende a interpretación clemente de criterios numéricos
- **Yo (Noel):** sostengo el runbook literal y tomo decisiones — única capa que aplica el contrato

La decisión pertenece al operador del runbook (humano), no a los agentes que asisten.

## Métricas y telemetría

### Pre-flip V1 baseline (40h healthy antes de ventana)
- `capture_running=true`, `ws_connected=true`, `tracked_markets=41`
- `last_error=null`, snapshots 40/40 cada 5 min
- `orderbook_events`/min: ~117

### Durante V2 activo (27 min)
- `books_initialized=40/40`, `sids_recovering=0`, `gaps_last_60s=0`
- WS y capture sin regresión
- `orderbook_events`/min: 108 (-7%, bootstrap esperable)
- **87 errores `delta produces qty<0` en 12 ráfagas**

### Post-rollback V1 (13h+ estable a 2026-05-26 18:13 UTC)
- Sin errores `delta produces qty<0`
- 289,986 events en último ciclo, 4,590,874 acumulados
- Tasa sostenida: ~6.2 events/s
- 39 markets tracked (mix multi-deporte ahora: MLB + UCL + NHL)
- DB growth: ~250 MB/día confirmado (= 90 GB/año proyectado)

## Fix Opción A entregado por Claude Code (mergeable)

**Commits:** `ed7b7ac` (cambios lógicos) + `b9abaa0` (correcciones de formato/tests vs brief).

**Archivos modificados:**
- `src/strategies/motor_1_arbitrage/orderbook_manager_v2.py`:
  - líneas 170-175: swap orden seq/apply en `handle_message`
  - líneas 343-348: logging INFO/DEBUG raw snapshot
  - líneas 415-416: filter `size=0` en `_parse_fp_levels`
- `src/clients/kalshi_ws.py` línea 320: `logger.opt(exception=r).error(...)` (compatible con Loguru)
- `tests/strategies/motor_1_arbitrage/test_v2_fixes.py`: 4 tests nuevos

**Suite completa: 282/282 ✓** sin regresiones.

**Una desviación técnica justificada:** el brief especificó `exc_info=r` (patrón stdlib logging). El stack del proyecto usa Loguru — `exc_info=` se ignora silentemente. Claude Code escaló y aplicó `logger.opt(exception=r).error(...)` (API equivalente correcta para Loguru). Test #4 valida que el wrapper recibe la excepción real. Aplicación correcta de la cláusula de escalación del brief.

## Decisión disciplinada (2026-05-26): no reactivar hoy

Tras 24h continuas operando el incidente, decisión explícita de **no abrir segunda ventana hoy** pese a tener el fix listo:
- Fatiga acumulada del operador viola espíritu del runbook 12.5 (2-3h supervisión activa)
- Fix no respiró (<2h desde commit), sin revisión sobria del diff
- V1 sano sin urgencia operativa (`TRADING_ENABLED=false`, 0 capital trabajando)

**Pendiente para próxima sesión (no requiere código):**
1. Confirmar que swap seq/apply en `handle_message:170-175` cubre también path de `_apply_snapshot_msg`
2. Verificar manualmente en Coolify que `logger.opt(exception=r)` produce el log esperado
3. Considerar Test #2b operativo (delta siguiente con seq correcta post-DesyncError se procesa OK)

Esta decisión es el primer test empírico de Lección 9 aplicada después de redactada: no relajar el runbook ni siquiera cuando es inconveniente — especialmente cuando es inconveniente.

## Deuda técnica catalogada

**Bloqueantes para segunda ventana de reactivación V2:**
- Revisión sobria del diff del fix (3 puntos arriba)
- Merge de Lección 9 al `KALSHI_BOT_CONTEXT.md` (header v1.5)
- Ventana de 2-3h libres confirmadas

**No bloqueantes (próximas ventanas):**
- Política de retención DB + VACUUM mensual vía cron (90 GB/año necesita límite)
- `runner.py:122` no setea `BotState.v2_manager` cuando Motor1=True+V2=True (bomba lenta para Fase 2)
- REST recovery storm potencial si V2 dispara `_start_recovery` para muchos tickers simultáneo

**No bloqueantes (post-Fase 2):**
- Cross-validation REST↔WS si Opción A insuficiente
- Reemplazo de SQLite por backend con mejor concurrencia si crecimiento DB lo justifica

## Métrica de éxito para la segunda ventana
No solo "no falla" sino **"no falla por la razón que arreglamos"**. Si vuelven a aparecer `qty<0` con magnitudes similares → H1 (bug `size=0`) no era el único bug, reabrir investigación con el raw snapshot logging que el fix ya instaló (cambio 2b).

## Próximos pasos (orden)
1. (próxima sesión) Mergear Lección 9 al `KALSHI_BOT_CONTEXT.md` v1.5
2. (próxima sesión) Mergear PR del fix a main si no lo está
3. (próxima sesión) Revisión sobria del diff (20 min, 3 puntos)
4. Si revisión limpia → agendar ventana V2 con 2-3h libres confirmadas
5. Segunda ventana V2 con runbook 12.5 literal otra vez
6. Si V2 estable a T+2h → desbloquear Motor 1 (paso separado, otra ventana)
7. Si Opción A falla → pivot a B con scope reajustado (invariantes internas, no cross-validation externa)

## Referencias clave
- Runbook 12.5 — en `KALSHI_BOT_CONTEXT.md` del repo (v1.5 con Lección 9 pendiente merge)
- Lección 7 — WS muerto silenciosamente con bot "healthy" (precedente del patrón "todo verde + bug oculto")
- Lección 8 — "deuda del roadmap" como retórica vs argumento técnico
- Lección 9 — runbook literal, atribución externa prematura, fix sin respirar (este incidente)
- Lección 9 — runbook literal vs interpretación clemente (este incidente)
