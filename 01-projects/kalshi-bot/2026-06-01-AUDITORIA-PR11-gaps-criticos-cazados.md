---
fecha: 2026-06-01
tipo: auditoria-tecnica
proyecto: kalshi-bot
componente: OrderbookManagerV2 PR #11 (Part B)
severidad: CRITICA
estado: PR-CONGELADO-2-gaps-bloqueantes
tags:
  - auditoria
  - kalshi-bot
  - v2
  - part-b
  - 2026-06-01
  - gaps-bloqueantes
---

# 🚨 Auditoría PR #11 — Dos gaps críticos que habrían matado la cuarta ventana

> Sin esta auditoría, PR #11 se habría mergeado como "Part B lista" y V2 se habría activado en la cuarta ventana. **El supervisor de recovery nunca habría corrido en runtime.** La cuarta ventana habría reproducido el attempt #3 exacto: crash en bootstrap, recovery sin convergencia, V2 colgado. Habrías quemado 2-3h de supervisión para descubrir que el fix no estaba enchufado.

## TL;DR

PR #11 implementa lógica correcta y testeada (timeout, retry, evicción, code 15) con **23/23 tests verdes**. PERO la auditoría destapó:

| Gap | Severidad | Descripción |
|---|---|---|
| **(b)** | 🚨 CRÍTICO | `_recovery_supervisor()` definido pero NUNCA SE LANZA en `data_capture.py`. Si activás V2, el supervisor no corre. |
| **(c)** | ⚠️ ALTO | Reintegración 00:00 UTC sólo existe en **docstring**. Ningún código limpia `_evicted` en runtime. Tickers evictados quedan inutilizados hasta restart manual. |

**PR #11 CONGELADO. NO mergear. V2 no es activable hasta cerrar ambos gaps.**

## Cómo se cazaron los gaps

### Verificación previa que hice antes de aprobar

Cuando Claude Code reportó "Part B implementada, tests 23/23 verdes", pedí 4 verificaciones adicionales:

1. ¿Circuit breaker del code 15 funciona y limpia recoveries antes de desconectar?
2. ¿El supervisor corre como `asyncio.Task` separada? ¿Qué pasa si muere por excepción?
3. ¿Cómo se reintegra un ticker evictado a las 00:00 UTC? ¿Automático o requiere restart?
4. ¿Los tests cubren todos los escenarios (timeout, retry, cap, code 15)?

**Sin esas 4 verificaciones, los gaps no se habrían visto.** Tests verdes ≠ implementación enchufada al runtime.

### Hallazgo (a) — code 15 ✅ funciona correctamente

`handle_message` detecta el `code 15` y dispara `_handle_code15()`:
```python
self._recovering.clear()
self._pending_snapshot_requests.clear()
self._recovery_deadlines.clear()
self._recovery_retries.clear()
await self._ws.force_reconnect()  # cierra socket; run() reconecta + re-firma RSA-PSS
```

**Orden correcto:** limpia los 4 dicts de recovery ANTES del force_reconnect. ✅

### Hallazgo (b) — 🚨 CRÍTICO: Supervisor NO se lanza

**Grep exhaustivo del repo:**
> `_recovery_supervisor` solo aparece en su `def`. **El wiring de V2** (`data_capture.py:486-494`) registra handlers (`ws.on(...)`) pero **NUNCA hace `asyncio.create_task(self._v2_manager._recovery_supervisor())`**.

**Implicación:** PR #11 escribió toda la máquina de estados, los 23 tests pasan en aislamiento sobre `_check_recovery_timeouts` (el cuerpo de un tick), **pero el loop que lo orquesta no está conectado**. Activar V2 sin el supervisor corriendo = exactamente el escenario del attempt #3 (recovery huérfano permanente).

**Segundo problema descubierto en el mismo gap:** aunque se lanzara, no hay supervisión anti-zombie. Los otros supervisores (ws_task, snap_task) están en `asyncio.wait(FIRST_COMPLETED)` que detecta su muerte (`data_capture.py:514-526`); el supervisor de recovery no está integrado a ese patrón. Si la task muriera silenciosamente, quedaría zombie sin que nadie se entere.

### Hallazgo (c) — ⚠️ Reintegración inexistente

**Lo que el código tiene:** `_evict_ticker()` agrega tickers a `_evicted`. Nada los saca.

**Lo que el docstring promete:** "El discovery diario (00:00 UTC) limpia `_recovering` y vuelve a meter el ticker al ciclo normal."

**Lo que el código realmente tiene:**
- No existe tarea/scheduler 00:00 UTC en el repo (grep confirmó)
- Ningún código limpia `_evicted` en runtime
- `_evicted.add()` existe; **no hay `_evicted.discard()` ni `.clear()` en ningún lado**
- Las únicas referencias a 00:00 UTC son del `risk/manager.py` para stop-loss (no relacionadas)

**Implicación práctica:** un ticker evictado queda evictado hasta restart físico del contenedor. Bajo volatilidad, podrías terminar con la mitad de los mercados evictados y ningún mecanismo automático para recuperarlos.

### Hallazgo (d) — Tests ✅ 23/23 pero con matiz crítico

Tests presentes y verdes:
- `test_recovery_timeout_triggers_retry` ✅
- `test_recovery_exhausts_retries_then_evicts` ✅
- `test_bootstrap_buffer_overflow_evicts_immediately` ✅
- `test_code15_aborts_recovery_and_forces_reconnect` ✅

**MATIZ CRÍTICO:** los tests testean `_check_recovery_timeouts` (el cuerpo de un tick), **NO** el loop `_recovery_supervisor` corriendo como task. Por eso los tests verdes no detectaron el gap (b). **Es el caso perfecto del anti-patrón de Lección 9:** *"tests verdes ≠ funciona en producción"*. Los tests cubren la lógica; el wiring que la activa quedó afuera.

## Las 3 discrepancias entre el brief y el código (Claude Code TENÍA RAZÓN)

Durante la auditoría, Claude Code defendió 3 puntos donde su implementación divergía del brief que mandé. **En los 3 tenía razón:**

### Discrepancia 1 — Cap de RAM: `_bootstrap_buffer[ticker]` NO `_pending_deltas[ticker]`

**Brief decía:** chequear `len(self._pending_deltas[ticker]) > 1000`.

**Code implementó:** chequear `len(self._bootstrap_buffer[ticker]) > 1000`.

**Por qué Code tenía razón:**
- `_pending_deltas` se indexa por `sid` (int), `_bootstrap_buffer` por `ticker` (str). Mi brief decía `_pending_deltas["KXMLB-26-PHI"]` — indexar dict de ints con string = `KeyError`.
- Conceptualmente: el incidente del attempt #3 fue en bootstrap, donde crece `_bootstrap_buffer[ticker]`, no en recovery.
- **El cap va donde crece la cola peligrosa.**

### Discrepancia 2 — Guarda None-safe (LA MÁS IMPORTANTE)

**Brief decía:** `if self._books.get(ticker) is None: return` al inicio de `handle_message`.

**Code implementó:** `if ticker in self._evicted: return` (set explícito).

**Por qué Code tenía razón:**
- `_books.get(ticker) is None` se cumple en DOS casos indistinguibles:
  - Ticker evictado (querés descartar)
  - **Ticker NUEVO nunca visto** (NO querés descartar — su primer delta debe encolar)
- Mi brief habría descartado el primer mensaje de TODO ticker nuevo → **ningún ticker se inicializaría jamás → bootstrap roto.**
- Code distinguió los dos casos con un set explícito `_evicted`.

**Esto habría sido un bug catastrófico.** Code lo evitó al defender su implementación contra el brief con bugs.

### Discrepancia 3 — Tick del supervisor: 1s vs 5s

**Brief decía:** tick cada 5 segundos.

**Code implementó:** tick cada 1 segundo.

**Por qué Code tenía razón:**
- Timeout de snapshot configurado en 10s.
- Tick de 5s → peor caso detección a 14.9s (50% de slop sobre el timeout).
- Tick de 1s → peor caso detección a 10.99s (~10% slop).
- Para prediction markets de baja latencia, 1s es la granularidad correcta.

## Resumen ejecutivo del estado de PR #11

| Aspecto | Estado |
|---|---|
| Lógica de la state machine (timeout/retry/evicción/code 15) | ✅ Correcta |
| Tests del cuerpo de un tick (`_check_recovery_timeouts`) | ✅ 23/23 verdes |
| Discrepancias con el brief teórico | ✅ Code estaba bien, brief tenía 2 bugs |
| **(b) Supervisor wireado al runtime** | 🚨 NO — no se lanza |
| **(b) Supervisor con supervisión anti-zombie** | 🚨 NO — sin patrón fail-loud |
| **(c) Reintegración de evictados implementada** | 🚨 NO — solo en docstring |
| Tests del loop como task corriendo | 🚨 NO incluidos |
| **Mergeable como está** | 🚨 NO |
| **Activable V2 con este PR mergeado** | 🚨 GARANTÍA de fallo idéntico al attempt #3 |

## Lecciones operacionales reforzadas

1. **Tests verdes en aislamiento NO PRUEBAN que el wiring esté completo.** Los 23/23 tests no detectaron que el supervisor no estaba enchufado al runtime. El test del wiring requiere test de integración del runner.

2. **"Docstring" ≠ "implementado".** Cualquier feature mencionada en docstring que no tiene código que la ejecute es deuda silenciosa. Auditar contra grep, no contra promesas.

3. **El gate de revisión funciona mejor cuando hace preguntas concretas, no "está OK".** Las 4 preguntas específicas que pedí (cómo detecta code 15, cómo arranca el supervisor, cómo se reintegra, cubren los tests) destaparon ambos gaps. Una review genérica "diff parece bien" no los habría visto.

4. **Capa de ejecución que defiende su código vs brief defectuoso = sistema sano.** Claude Code mantuvo las 3 discrepancias contra mi brief con bugs. Habría sido un desastre si hubiera "obedecido" literalmente.

## Acciones derivadas (orden estricto)

1. ✅ PR #11 mergeable bloqueado hasta cerrar (b) y (c)
2. ✅ Documentar gaps como bloqueantes en `docs/part_b_gaps_pendientes.md` (PR #12)
3. ⏳ Diseñar el cierre de (b) con anti-zombie correcto (ver [[2026-06-01-diseno-B1-A2-archivado-fortress-de-V2]])
4. ⏳ Diseñar el cierre de (c) con cooldown determinista (ver [[2026-06-01-diseno-B1-A2-archivado-fortress-de-V2]])
5. ⏳ NO implementar hasta diseños aprobados en turnos separados
6. ⏳ Después: **PIVOT** estratégico hizo que esos diseños queden archivados — ver [[2026-06-01-PIVOT-opcion-2-rest-hibrido]]

## Links
- [[2026-06-01-sesion-01jun-auditoria-pr11-pivot-opcion-2]] — sesión
- [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]] — el patrón meta que produjo los gaps
- [[2026-06-01-diseno-B1-A2-archivado-fortress-de-V2]] — los diseños que cerraban los gaps (archivados tras pivot)
- [[2026-06-01-PIVOT-opcion-2-rest-hibrido]] — el pivot estratégico que esto disparó
- [[2026-06-01-benchmark-rest-spec-criterio-decision]] — benchmark que decide V2 vs Opción 2
- [[2026-05-31-cuarto-discovery-v2-Q1-a-Q4-desde-codigo]] — discovery del 31-may que identificó Q3 (recovery sin convergencia)
- [[causa-raiz-v2-desync-secuencia-bootstrap-CAPTURADA]] — diagnóstico del 30-may (sigue válido, framing refinado)
- [[kalshi-bot]]
