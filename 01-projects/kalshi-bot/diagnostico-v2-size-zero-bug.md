---
fecha: 2026-05-25
tipo: diagnostico
proyecto: kalshi-bot
componente: OrderbookManagerV2
severidad: alta
estado: causa-raiz-validada
tags:
  - diagnostico
  - bug
  - kalshi-bot
  - v2
  - orderbook
---

# Diagnóstico técnico — OrderbookManagerV2 qty<0 (incidente 25-mayo-2026)

> Causa raíz validada por discovery empírico. Tres bugs identificados, uno primario, dos contribuyentes. Hipótesis "feed corruption" refutada.

## Resumen ejecutivo
V2 activado a 16:50 UTC produjo 87 errores `delta produces qty<0` en 27 min repartidos en 12 ráfagas, sobre ≥24 tickers distintos, magnitudes -15 a -6247. Rollback ejecutado a 17:18 UTC en ~6 min.

Discovery posterior identificó tres bugs:
1. **(Primario)** Inconsistencia silenciosa en convención `size=0` entre dos capas del mismo dominio.
2. **(Contribuyente)** Orden invertido en `_apply_delta_msg` que convierte error puntual en cascada.
3. **(Observabilidad)** Stack traces silenciados por config del dispatcher.

## Bug #1 (primario) — Inconsistencia de convención `size=0`

**Localización:**
- `_parse_fp_levels` en `orderbook_manager_v2.py`
- `OrderbookState.apply_snapshot` en `orderbook.py`

**Descripción:**
```python
# _parse_fp_levels NO filtra size=0
result.append([price_cents, 0])  # pasa el chequeo, entra a la lista

# OrderbookState.apply_snapshot SÍ filtra size=0
if size > 0: new_yes_bids[price] = size  # descarta el level
```

**Consecuencia operativa:**
Kalshi envía un snapshot WS con `[price, 0]` (legítimo: "este level está vacío en este momento"). V2 lo procesa así:
1. `_parse_fp_levels` devuelve `[price_cents, 0]`
2. `apply_snapshot` descarta el level silenciosamente
3. V2 queda con state sin entry para ese price
4. Un delta posterior con `delta=-X` sobre ese price hace `book.get(P, 0) + (-X) = -X < 0`
5. `OrderbookDesyncError` se dispara

**Por qué patrón observado encaja:**
- Errores en tickers fresh sin historial previo → primer delta sobre price perdido
- Magnitudes reflejan `delta_size` del feed (no acumulado corrupto) → -6247 es un delta real grande
- Distribución amplia entre tickers → no es específico a un sid, es de wire format
- Cero `SidGapError`, cero `_start_recovery` previos → no es problema de secuencia ni de recovery
- Cero reconnects WS durante el incidente → no es transitorio de conectividad

## Bug #2 (contribuyente) — Orden invertido en `_apply_delta_msg`

**Localización:**
- `_apply_delta_msg` en `orderbook_manager_v2.py`

**Descripción:**
```python
# Patrón actual (INCORRECTO):
self._last_seq_by_sid[sid] = new_seq    # se actualiza ANTES
state.apply_delta(...)                    # ...si esto lanza, ya quedó avanzada la seq

# Patrón correcto:
state.apply_delta(...)                    # primero el work
self._last_seq_by_sid[sid] = new_seq    # solo si fue exitoso
```

**Consecuencia:**
Cuando `apply_delta` lanza `OrderbookDesyncError` por el Bug #1, `_last_seq_by_sid[sid]` ya quedó avanzada. El siguiente delta llega con seq esperada y se procesa como si nada hubiera pasado, propagando el state corrupto y produciendo más errores en cascada. Convierte 1 error puntual en una ráfaga.

## Bug #3 (observabilidad) — Stack traces silenciados

**Localización:**
- `_dispatch` en `kalshi_ws.py`

**Descripción:**
```python
results = await asyncio.gather(*handlers, return_exceptions=True)
for r in results:
    if isinstance(r, Exception):
        logger.exception("handler error")  # sin exc_info=r, sin traceback
```

`return_exceptions=True` captura las excepciones en `results` en vez de propagarlas. `logger.exception` necesita exception activa en el contexto (`sys.exc_info()`) para producir traceback — pero aquí ya está capturada en la variable, no activa.

**Consecuencia:**
Durante 27 minutos del incidente, ningún stack trace quedó persistido. Los logs solo decían "delta produces qty=-XXXX < 0 (feed corruption)" sin contexto de dónde se lanzó ni qué función lo originó. Diagnóstico empírico tuvo que reconstruir el path manualmente desde el código.

## Hipótesis evaluadas y refutadas

### H_refutada_1 — "Feed corruption de Kalshi"
**Argumento original (Claude Code primera pasada):** Kalshi envía deltas inconsistentes con sus propios snapshots. V2 hace lo correcto al rechazarlos. Bug exógeno.

**Por qué se mantuvo plausible inicialmente:**
- Deltas duplicados con magnitudes idénticas en 4–9ms (interpretable como retransmisión del feed)
- Tickers fallando en primer delta sin historial
- Cero gap detection (no había `SidGapError`)

**Por qué se refutó:**
- Discovery del wire format mostró que `_parse_fp_levels` no filtra `size=0` mientras `apply_snapshot` sí — explica los mismos síntomas sin necesidad de "feed corrupto"
- Hipótesis "feed miente" requiere que Kalshi sea estructuralmente inconsistente afectando a todos sus traders algorítmicos — extraordinario, sin evidencia extraordinaria
- Hipótesis "V2 lee mal edge case" es parsimoniosa y reproduce el patrón

### H_refutada_2 — "Duplicación de dispatch"
**Argumento:** Mismo mensaje WS llega 2 veces a `handle_message`, V2 lo procesa duplicado, sumas duplicadas producen negativos.

**Por qué se refutó:**
- `_handlers` es dict de listas, `gather` itera una vez por mensaje
- Cada wiring `ws.on(...)` aparece exactamente una vez en código
- Cero paths de retry/reinject identificados
- Los deltas duplicados en log vienen del feed (Kalshi retransmite), no del dispatcher

### H_refutada_3 — "Drain de buffer sin filtrar por seq"
**Argumento:** `_buffers[ticker].clear()` se llama en `on_ws_snapshot` sin filtrar por seq → deltas pre-snapshot todavía en buffer se aplican y producen qty<0.

**Por qué se refutó:**
- En el bootstrap inicial los buffers están vacíos, no hay deltas viejos en buffer
- No explica la ráfaga 2 a T+5min cuando buffers ya deberían estar drenados
- Discovery no encontró `_buffers[ticker].clear()` ciego con esa semántica

## Hallazgo colateral (no central)
**Sesgo de superficie en comparación V1 vs V2:**
La "estabilidad de V1" (9h+ sin error) no es evidencia de parsing correcto. V1 solo lee `_top_bid` (top level); V2 itera todos los levels. La ausencia de error en V1 puede deberse a superficie reducida, no a corrección. Anular este argumento en futuras discusiones.

## Lo que NO se pudo validar (sin ventana de re-activación)
- Captura de raw payload WS del snapshot que causó cada ráfaga. Sin ese dato H1 (parsing) es la hipótesis más probable pero no probada al 100%.
- Pendiente: logging del raw snapshot WS en INFO+DEBUG antes del próximo flip (incluido en brief de Opción A).

## Validación pendiente del fix (post-implementación Opción A)
- Test unitario: snapshot con `[price=N, 0]` seguido de delta sobre price=N no produce qty<0
- Test unitario: `OrderbookDesyncError` deja `_last_seq_by_sid[sid]` intacto (no avanzado)
- Test de regresión: magnitudes observadas (-6247, -4887) procesadas sin corromper state
- Test: dispatch que lanza excepción produce stack trace completo en log

## Decisión derivada
Opción A — fix puntual (5–8 líneas) + observability fix + 4 tests. Ver [[decision-2026-05-25-fix-opcion-a]].

## Causa raíz consolidada (una frase)
**OrderbookManagerV2 perdió silenciosamente entries `size=0` durante snapshot parsing, dejando state divergente del feed, y la combinación con el orden invertido `seq/apply` convirtió el error puntual en cascada propagada por 27 minutos, mientras el dispatcher silenciaba los stack traces que habrían acortado el diagnóstico.**

## Links
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — chronology
- [[leccion-9-runbook-literal-vs-interpretacion]] — lección operativa
- [[decision-2026-05-25-fix-opcion-a]] — fix plan
- [[kalshi-bot]] — proyecto raíz
- Runbook 12.5 — KALSHI_BOT_CONTEXT.md (repo)
