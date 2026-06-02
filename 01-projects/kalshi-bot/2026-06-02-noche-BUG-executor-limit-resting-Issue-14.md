---
fecha: 2026-06-02
tipo: bug-aislado
proyecto: kalshi-bot
componente: executor.py (heredado, NO tocar)
severidad: ALTA-bloqueante-antes-TRADING_ENABLED
estado: AISLADO-no-arreglado-Issue-14
issue: '#14'
tags:
  - bug
  - executor
  - kalshi-bot
  - 2026-06-02
  - aislado
  - pre-trading-enabled
---

# 🐛 BUG aislado — executor.py `limit + resting` Issue #14

> Bug latente descubierto durante el diseño del Motor REST. **El `executor.py` heredado usa `limit + resting fallback` que crea pata sola direccional si la segunda falla.** Aislado en Issue #14, NO arreglado en esta sesión (no es del scope Motor REST), pero documentado como bloqueante absoluto antes de cualquier `TRADING_ENABLED=true`.

## El bug en una frase

**`executor.py` ejecuta órdenes de arbitraje con `time_in_force` por defecto (`good_till_canceled` implícito), lo que significa que si una pata se llena y la otra no, la posición direccional queda VIVA en el book esperando llenarse — exposición direccional silenciosa con capital real.**

## El escenario que esto produciría

Asumir Motor 1 activado (V2 o REST) con `TRADING_ENABLED=true`:

1. Detecta arb: `yes_ask 45c` + `no_ask 50c` = 95c (edge 5c)
2. Emite pata `yes` 45c con `executor.place_order(...)` → se llena
3. Emite pata `no` 50c con `executor.place_order(...)` → mercado se movió, `no_ask` ahora 53c
4. La orden `no` 50c **queda en el book como bid esperando** (resting limit)
5. El bot reporta "arb capturado, pata 1 llena, pata 2 pending"
6. La pata 2 nunca se llena al precio
7. **Posición `yes` 45c queda direccional, sin cobertura**
8. Si "yes" gana → ganás
9. Si "yes" pierde → perdés capital

**No es arbitraje — es apuesta direccional encubierta.** Y peor: si el bot acumula esto, podrías terminar con N posiciones direccionales activas creyendo que estás arbitrando.

## Cómo se descubrió

Durante el diseño del Motor REST (PR #13), al evaluar si reusar `executor.py` para la ejecución FOK:

**Pregunta:** ¿el `executor.py` actual cubre la ejecución de 2 patas con cero exposición?

**Verificación:**
- `executor.py` usa `KalshiRestClient.place_order(type="limit", price=...)` — **SIN `time_in_force` explícito**
- Default de la API Kalshi para `limit` sin TIF: `good_till_canceled` (resting)
- Esto significa que la orden no FOK es **NO-atómica con la otra pata**

**Confirmación cruzada (Gate 0.5):**
- Kalshi soporta `time_in_force: "fill_or_kill"` nativo
- `executor.py` NO lo usa
- El bug es **falta de uso de FOK**, no falta de API

## Por qué NO se arregla en esta sesión

**Scope discipline:**
1. Estamos en diseño del Motor REST, no en fix del executor
2. Motor REST va a usar su propio ejecutor FOK (decisión arquitectónica Gate 0.5)
3. Arreglar `executor.py` ahora = mezcla de scopes (motor 1 V2/legacy + motor REST nuevo)
4. **El bug es independiente del Motor REST** — afecta cualquier código que use `executor.place_order` para órdenes de arb

**Disciplina aplicada:** aislar primero, arreglar en su propio ticket cuando aplique.

## Issue #14 — el ticket

**Título:** "Bug: executor.py uses limit with implicit GTC, creating directional exposure on partial fills"

**Estado:** Open, sin asignar

**Severidad:** ALTA (bloqueante absoluto antes de `TRADING_ENABLED=true`)

**Doc asociado:** `docs/bug_executor_limit_resting.md`

**Impacto si NO se arregla:**
- Bloqueante absoluto para activar trading en V2 (si alguna vez se desarchiva)
- NO afecta Motor REST (que usa su propio ejecutor FOK nativo)
- NO afecta operación V1 actual (V1 no opera trades, es data capture)

## El fix conceptual (para cuando se arregle)

**Opción A (recomendada — alineada con Gate 0.5):**
- Agregar parámetro `time_in_force` a `KalshiRestClient.place_order`
- `executor.py` llama con `time_in_force="fill_or_kill"` para órdenes de arb
- FOK nativo de Kalshi cancela ambas patas si una no se llena al precio

**Opción B (más conservadora):**
- IOC en ambas patas (`time_in_force="immediate_or_cancel"`)
- Acepta llenos parciales pero cancela el resto inmediatamente
- Riesgo: llena parcial parcial → exposición direccional pequeña

**Opción C (compleja, NO recomendada):**
- Mantener `limit + resting` actual
- Agregar lógica de rollback: si pata 2 falla, cancelar pata 1 + revertir
- Riesgo del rollback: vendés la pata 1 a peor precio → pérdida garantizada

**Decisión coherente con Motor REST:** Opción A. FOK nativo en ambas patas. Validado por Gate 0.5.

## Por qué este bug es importante NOMBRAR ahora

### 1. Resignifica el "executor.py existente"

**Antes de descubrirlo:** "Motor REST reusa `executor.py` que ya está implementado y probado."

**Después:** "Motor REST NO puede reusar `executor.py` actual — implementaría el mismo bug. Motor REST necesita su propio ejecutor FOK desde cero."

**Eso aumenta el scope de implementación del Motor REST**, pero es trabajo necesario, no opcional.

### 2. Bloquea Motor 1 (V2/legacy) si alguna vez se desarchiva

**Si en el futuro se decide retomar V2:**
- B1+A2 archivado podría implementarse
- Pero `TRADING_ENABLED=true` sigue bloqueado por este bug
- El fix del executor es prerequisito de activación de trading en CUALQUIER motor que use el ejecutor heredado

### 3. Demuestra que el bot tiene deuda técnica latente en path crítico

**Lección operacional:** auditar `executor.py` no era parte del scope inicial pero al evaluarlo apareció el bug. Sugiere que otras partes del código de trading (no probadas en producción, porque `TRADING_ENABLED=false` permanente) pueden tener bugs similares.

**Cuando llegue el momento de activar trading**, se necesita auditoría más amplia de path de ejecución, no solo del fix puntual.

## Restricciones operativas mientras Issue #14 está abierto

- ❌ `TRADING_ENABLED=true` NO se activa en NINGÚN escenario hasta arreglar Issue #14
- ✅ Modo SHADOW del Motor REST OK (no llama executor para órdenes reales)
- ✅ V1 data capture sigue operando normal (no usa executor)
- ✅ V2 dormant sigue inafectado (flag false)

## Relación con la decisión FOK del Motor REST

**El bug motivó indirectamente la decisión del Gate 0.5:**

| Pregunta | Respuesta |
|---|---|
| ¿Motor REST debería reusar executor.py? | NO — tiene el bug latente |
| ¿FOK ambas patas es realmente necesario? | SÍ — el bug demuestra el riesgo de no FOK |
| ¿Es Kalshi FOK nativo confiable? | SÍ — Gate 0.5 lo confirmó |

**Sin descubrir el bug, el Motor REST podría haber heredado el mismo problema reusando `executor.py`.**

**El gate de "revisar antes de reusar" funcionó otra vez.**

## Patrón meta (refuerza Lección 11 candidato)

**"Componente heredado que NO probaste en producción puede tener bugs silenciosos que solo aparecen al evaluarlo para un nuevo uso."**

`executor.py` existe desde hace tiempo. Nunca se ejercitó en producción porque `TRADING_ENABLED=false` permanente. Confiar en "ya está implementado y testeado" sin auditar era el riesgo. **Auditar antes de reusar atajó.**

## Estado al cierre del 02-jun noche

- ✅ Bug AISLADO en Issue #14
- ✅ Doc `docs/bug_executor_limit_resting.md`
- ✅ Branch separada (PR #15 con el doc del bug)
- ❌ NO arreglado (scope discipline)
- 🔒 `executor.py` NO se toca
- 🔒 `TRADING_ENABLED=false` permanente hasta arreglar
- 📋 Catalogado como bloqueante absoluto pre-activación

## Por qué este descubrimiento es genuinamente valioso

**Sin el gate de "revisar antes de reusar":**
- Motor REST habría reusado `executor.py`
- Habría implementado el bug latente
- Habría operado en shadow sin notar el problema (no ejecuta órdenes reales)
- Al activar trading → primera ejecución de arb → pata sola direccional → pérdida silenciosa con capital real

**Con el gate funcionando:**
- Bug detectado antes de cualquier código de producción del Motor REST
- Motor REST diseñado con FOK nativo desde el inicio
- Issue #14 documentado para futura fase de fix del executor
- Cero capital en riesgo en ningún momento

**Cuarto bug del path de trading descubierto antes de que costara dinero.** (Junto con los 3 attempts V2 que se rolledback antes de activar TRADING_ENABLED.)

## Links
- [[2026-06-02-noche-GATES-0-y-0-5-CERRADOS-shape-ticker-y-FOK]] — Gate 0.5 que confirmó FOK como solución
- [[2026-06-02-noche-DISENO-motor-REST-PR-13-revision-adversarial]] — diseño Motor REST que descubrió el bug
- [[2026-06-02-noche-sesion-gates-cerrados-cierre-disciplinado]] — sesión
- [[fix-v2-opcion-a-implementado-commits]] — bug pattern similar (logging fix que cumplió mientras otros no)
- [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]] — patrón meta de proceso
- [[kalshi-bot]]
