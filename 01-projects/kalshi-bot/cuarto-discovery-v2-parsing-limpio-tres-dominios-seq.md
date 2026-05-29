---
fecha: 2026-05-30
tipo: discovery-tecnico
proyecto: kalshi-bot
componente: OrderbookManagerV2
metodologia: cross-check log + código fuente read-only
tags:
  - discovery
  - kalshi-bot
  - v2
  - parsing
  - sequence-domains
---

# Cuarto discovery V2 — parsing limpio + 3 dominios de seq + gap=artefacto

> Cruce de evidencia del log preservado del attempt #2 contra el código fuente real de V2 (read-only). Tres correcciones importantes a los hallazgos del 29-may: el gap seq=40 NO era señal independiente, hay 3 dominios de seq coexistiendo, y aunque el parsing está limpio **V2 NO está exculpado**.

## Lo que el cuarto discovery probó (corrige tercer discovery del 29-may)

### Hallazgo #1 — El "gap seq=40" era ARTEFACTO, no señal independiente

**Lo que dije el 29-may (incorrecto):** "El error coincidió con un gap de sequence. Dos señales correlacionadas: qty<0 en ATL y mensaje WS faltante."

**Corrección con código (verbatim de `orderbook_manager_v2.py:159-174`):**
```python
160  if sid in self._last_seq_by_sid:
161      expected_seq = self._last_seq_by_sid[sid] + 1
162      if new_seq != expected_seq:
163          await self._start_recovery(sid) ...
168          raise SidGapError(...)
...
173      self._apply_delta_msg(raw_msg)   # May raise OrderbookDesyncError
174  self._last_seq_by_sid[sid] = new_seq  # Only reached if apply succeeded
```

**Secuencia real:**
1. Llega delta seq=40, en orden (pasa el gap check de la línea 162: 40 == expected).
2. `_apply_delta_msg` (línea 173) lanza `OrderbookDesyncError` (qty=-3108).
3. **La línea 174 nunca se ejecuta** → `_last_seq_by_sid` se queda en 39.
4. Llega siguiente mensaje seq=41. expected = 39+1 = 40. 41 != 40 → `SidGapError "expected 40, got 41"`.

**Conclusión:** el seq=40 NO se perdió. **seq=40 ES el delta que causó el qty<0.** El "gap" es puro efecto colateral de que `OrderbookDesyncError` aborta `handle_message` antes de avanzar el contador.

**Esto refuta:** mi hipótesis del 29-may de "el seq=40 faltante podría haber reducido el bucket antes" y elimina message-loss/out-of-order como causa. **No hubo pérdida previa. El delta entró en orden.**

### Hallazgo #2 — "El bucket estaba en 1114 al momento del delta" también era overreach

**Lo que dije el 29-may (incorrecto):** "No hubo deltas previos aplicados a este ticker entre snapshot y error → estado del bucket al momento del delta = exactamente el del snapshot."

**Corrección:** `_apply_delta_msg` (líneas 358-390) **no loggea los deltas aplicados** — solo loggea el resumen del snapshot y los errores. Que mi grep del ticker muestre solo "snapshot → error" **no prueba que no hubo deltas intermedios**; prueba que los deltas exitosos no se loggean.

Entre seq=2 y seq=40 hubo 37 mensajes en el sid. **El valor del bucket justo antes de seq=40 es un punto ciego.**

Por lo tanto la inferencia "delta = -4222 = -3108 - 1114" del 29-may **no está establecida** — asume un estado que el log no respalda.

### Hallazgo #3 — Los 3 dominios de seq coexistentes

Auditando el log + código identifiqué **3 dominios distintos** de sequence:

| Dominio | Origen | Uso | Ejemplo |
|---|---|---|---|
| **Batch snapshot index** | Asignado por V2 al procesar lote inicial | Solo para ordenar el batch | KXMLB-26-ATL = seq=2 (segundo del lote) |
| **Sid global del WS** | Contador per-Sid del feed WS | Gap detection per-Sid (`_last_seq_by_sid`) | seq=40 → 41 = gap |
| **Per-delta seq** | `raw_msg["seq"]` directo del WS | Pasado a `state.apply_delta` como metadata | El crash usa este |

**Veredicto:** El código NO comete el error obvio de mezclar dominios. **El seq que computa el `OrderbookDesyncError` se calcula desde aritmética del bucket, NO desde el seq.** El seq solo se usa para el `SidGapError` separado.

Pero hay **amplificación de blast radius** real: un único `qty<0` en un ticker dispara `_start_recovery(sid)` que marca **38 tickers stale** y pide WS recovery snapshot completo. **El blast radius es 38x más grande que la falla real.**

### Hallazgo #4 — Sesgo de atribución externa hardcodeado en el código

El mensaje del error en `orderbook.py:65` dice literal:
```
"new_qty < 0 indicates feed-level corruption"
```

Y la excepción se llama:
```
KXMLB-26-ATL at 10c: delta produces qty=-3108 < 0 (feed corruption)
```

**Sesgo:** el código **pre-juzga causa externa**. `qty<0` indica desync — que puede ser interno o externo. El código asume externo y pone la etiqueta `(feed corruption)` en el mensaje del error.

Esto es **el mismo anti-patrón de atribución externa de Lección 9, hardcodeado en la excepción.** Cualquier diagnóstico futuro que lea ese log se va a contaminar con la palabra "feed corruption" antes de pensar.

## Comparación lado a lado del parsing (snapshot vs delta)

### Pipeline Snapshot

**`_apply_snapshot_msg`:**
```python
yes_raw = msg.get("yes_dollars_fp") or msg.get("yes") or []
yes_levels = _parse_fp_levels(yes_raw, ticker, "yes")
self._books[ticker].apply_snapshot({"seq": seq, "yes": yes_levels, ...})
```

**`_parse_fp_levels`:**
```python
for lvl in raw_levels:
    price_cents = parse_price_to_cents(lvl[0])    # "0.1000" → 10
    size = parse_size(lvl[1])                       # "1114.07" → 1114
    if size == 0: continue                          # ← FILTRO A
    result.append([price_cents, size])
```

**`apply_snapshot` (orderbook.py):**
```python
new_yes_bids: dict[int, int] = {}
for lvl in yes_levels:
    price, size = _parse_level(lvl, "yes bids")
    if size > 0:                                    # ← FILTRO B (redundante)
        new_yes_bids[price] = size
```

### Pipeline Delta

**`_apply_delta_msg`:**
```python
price_raw = msg.get("price_dollars") or msg.get("price")
delta_raw = msg.get("delta_fp") or msg.get("delta")
side = msg.get("side")
price_cents = parse_price_to_cents(price_raw)       # MISMA función
delta_size = parse_size(delta_raw)                  # MISMA función
# ← NO HAY filtro "if delta_size == 0: continue"
state.apply_delta({"side": side, "price": price_cents, "delta": delta_size, "seq": seq})
```

**`apply_delta` (orderbook.py):**
```python
book = self._yes_bids if side == "yes" else self._no_bids
new_size = book.get(price, 0) + delta_size          # ← cómputo crítico
if new_size < 0:
    raise OrderbookDesyncError(...)
```

### Tabla comparativa

| Punto | Snapshot | Delta | ¿Idéntico? |
|---|---|---|---|
| Conversión precio→cents | `parse_price_to_cents()` | `parse_price_to_cents()` | ✅ Misma función |
| Conversión size→int | `parse_size()` | `parse_size()` | ✅ Misma función |
| Filtro `size==0` | **SÍ** (dos veces) | **NO** | ⚠️ ASIMETRÍA |
| Side handling | Procesa yes/no separados | Procesa side del msg | ✅ Consistente |
| Routing destino | `yes_bids` y `no_bids` | `yes_bids` o `no_bids` | ✅ Solo bids ambos |
| Validación rango precio | Implícita | Explícita (0-100) | ⚠️ Compatible |

### `parse_price_to_cents`

```python
def parse_price_to_cents(value: object) -> int | None:
    if value is None: return None
    if isinstance(value, int):   return value
    if isinstance(value, str):   return int(round(float(value) * 100))
    if isinstance(value, float): return int(round(value * 100))
    return None
```

**Outputs para "0.10" / "0.1000":**
- `"0.1000"` (str) → `int(round(0.1 * 100))` = `int(round(10.0))` = **10**
- `"0.10"` (str) → **10**
- `0.10` (float) → `int(round(10.0000000000002))` = **10** (round absorbe el float drift)
- `10` (int directo) → **10**

**No hay mismatch de rounding entre tipos.** El `round` elimina problemas de coma flotante para precios en centésimas.

### `parse_size`

```python
def parse_size(value: object) -> int | None:
    if value is None: return None
    if isinstance(value, int):           return value
    if isinstance(value, (str, float)):  return int(round(float(value)))
    return None
```

**Para ATL bucket 10c:**
- `"1114.07"` → `int(round(1114.07))` = **1114**. Pérdida de precisión: 0.07 unidades.
- `"500.00"` → **500**. Exacto.

**Drift potencial:** `±1` por delta acumulado por el rounding. **NO explica un swing de -3108.**

## Hallazgo asimetría — filtro size=0 (pero NO aplica al caso ATL)

**Escenario que el filtro asimétrico permite (problema real, pero NO el del crash de ATL):**
1. Snapshot tenía `[10c, 0]` en algún bucket → filtrado → bucket 10c no existe en `_yes_bids`
2. Delta `{price=10, delta=+50, side=yes}` → `book.get(10, 0) + 50 = 50` → `book[10] = 50` ✓
3. Delta `{price=10, delta=-30, side=yes}` → `book.get(10, 0) + (-30) = -30` → **CRASH**

**Pero el snapshot ATL NO tiene 0 en 10c** — tiene 1114.07 (yes) y 500.00 (no). El filtro no descartó 10c. **Este escenario no aplica al caso ATL.**

Sí queda como **bug latente de menor severidad** para tickets futuros.

## Aritmética del error -3108

Si `side=yes`: `1114 + delta_size = -3108` → `delta_size = -4222`. Un sell de 4222 contratos sobre bucket de 1114.
Si `side=no`: `500 + delta_size = -3108` → `delta_size = -3608`. Un sell de 3608 sobre bucket de 500.

**Ambos escenarios:** delta mucho mayor en magnitud que el bucket. **Esto no es rounding, no es filtro de ceros, no es side-confusion.**

## Tres hipótesis residuales VIVAS (post-cuarto discovery)

Después del cuarto discovery, **NO se prueba que el bug sea externo.** Quedan 3 hipótesis vivas:

### (A) Feed corruption real
Kalshi mandó un `delta_fp` genuinamente mayor al qty disponible. Cancelaciones agregadas o ejecuciones batch que aplican retroactivamente.

### (B) Snapshot inicial parcial
El bucket real en el exchange al momento del snapshot era distinto al que V2 cargó. El snapshot ATL mostró YES=1114, pero el bucket "real" podría haber sido 5336 — y V2 solo capturó parte. Si hubo timing issue donde el snapshot capturó un punto intermedio entre operaciones, V2 queda con estado divergente desde t=0.

### (C) Bug en aplicación de deltas en ventana 2.7s no logueada
Entre snapshot (15:36:57.502) y error (15:37:00.228) hay 2.7 segundos. V2 procesó deltas en esa ventana **que no están logueados** (`_apply_delta_msg` solo loggea errores, no aplicaciones exitosas). Si un delta de esa ventana dejó el bucket en estado divergente — por bug en `apply_delta` o por un edge case del feed que V2 mal-procesó — el siguiente delta crashea.

## Lo que el log NO permite afirmar (sin instrumentación)

- El delta crudo que disparó qty=-3108 **NO está logueado**
- El estado del bucket pre-seq=40 es **punto ciego**
- Si el delta_fp era válido o no — **incapturable con logs actuales**
- Si hubo message reordering en el transporte WS — **incapturable**

**Conclusión:** la pregunta central — *¿por qué un delta en orden (seq=40) llevó el bucket 10c a negativo?* — **NO es respondible con este log.** Con la evidencia física actual, llegamos al límite.

## Anti-patrón cazado en TIEMPO REAL (importante)

Tras el cuarto discovery, Claude Code (y Gemini) concluyeron prematuramente:
> *"El bot ha quedado exculpado."*
> *"El qty=-3108 es indiscutiblemente un síntoma de un dato de entrada."*
> *"El bug es un fantasma del feed."*

**"Indiscutiblemente" es exactamente la palabra que Lección 9 enseña a desconfiar.**

El propio discovery, dos párrafos antes de esa conclusión, listaba las 3 hipótesis residuales — **2 de las 3 NO son "el feed mintió" (B y C)**. El discovery probó *parsing limpio*, no *V2 limpio*.

**Esto es atribución externa redux** — el mismo salto del 25-may, más sofisticado pero mismo patrón. Lo cacé y lo corregí en el chat. Lección 9 funcionando en tiempo real.

## Veredicto consolidado del cuarto discovery

| Pregunta | Respuesta |
|---|---|
| ¿Origen del derived-seq? | `raw_msg["seq"]` directo del WS, no derivado |
| ¿Variable de instancia? | `self._last_seq_by_sid[sid]` se actualiza solo si apply tuvo éxito |
| ¿Es el Sid? | Sí, tracked per-Sid, pero el seq viene del feed |
| ¿Colisión de dominios? | Código NO comete ese error en el DesyncError. Pero amplifica vía cascada Sid-wide. |
| ¿Lógica de DesyncError cae por seq mal calculado? | No. Cae por aritmética de qty del bucket. Independiente del seq. |
| ¿Parsing tiene mismatch? | NO. Mismas funciones, mismo rounding. Filtro size=0 asimétrico pero no aplica al caso ATL. |
| ¿Bug obvio fixeable sin instrumentar? | No. Necesitas raw_msg del delta corrupto. |
| ¿V2 está exculpado? | **NO.** Parsing limpio ≠ V2 limpio. Hipótesis B y C siguen vivas. |
| ¿Causa raíz cerrada? | **NO.** Causas A/B/C necesitan instrumentación para desambiguar. |

## Próximo paso necesario (no se ejecuta sin tu autorización)

**Instrumentación asimétrica** — capturar raw_msg en ambos paths para desambiguar A/B/C:
- Snapshot: log DEBUG con raw_msg completo (sin truncar a 3 levels como el log INFO actual)
- Delta: try/except + log ERROR con raw_msg + bucket state cuando se levanta `OrderbookDesyncError`

Ver [[brief-instrumentacion-v2-asymmetric-logging]] y [[decision-2026-05-30-branch-separada-v2-instrumentacion-asimetrica]].

## Links
- [[sesion-2026-05-30-cuarto-discovery-v2-instrumentacion-plan]] — sesión
- [[discovery-forense-v2-attempt2-h1-refutada]] — tercer discovery (esta corrección lo refina)
- [[update-leccion-9-29may-tercer-discovery-cerrado]] — update a Lección 9
- [[decision-2026-05-30-branch-separada-v2-instrumentacion-asimetrica]] — decisión derivada
- [[brief-instrumentacion-v2-asymmetric-logging]] — brief operativo
- [[leccion-9-FINAL-causa-raiz-pendiente]] — lección que esto actualiza
- [[diagnostico-v2-size-zero-bug]] — H1 original (refutada hace 1 día)
- [[incidente-v2-attempt-2-2026-05-27]] — incidente que generó el log
- [[kalshi-bot]]
