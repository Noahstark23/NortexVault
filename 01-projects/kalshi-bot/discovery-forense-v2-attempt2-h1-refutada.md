---
fecha: 2026-05-29
tipo: forense
proyecto: kalshi-bot
componente: OrderbookManagerV2
log-analizado: data/rollback_v2_attempt2_20260527_154809.log
tags:
  - forense
  - kalshi-bot
  - v2
  - h1-refutada
  - discovery
---

# Discovery forense V2 attempt #2 — H1 (size=0) REFUTADA empíricamente

> Tercer discovery sobre los logs preservados del attempt #2. Pregunta única respondida con evidencia verbatim del log. **Hipótesis dominante post-Lección 9 (H1 size=0 filter) queda REFUTADA.** Nuevo espacio de hipótesis abierto.

## La pregunta única
**¿El price 10c de KXMLB-26-ATL —el primer error del attempt #2— tenía size>0 en el snapshot WS inicial?**

## Respuesta: SÍ, size > 0 en AMBOS lados

- **YES side, 10c:** `1114.07` (fixed-point string del feed; ~1114 cents)
- **NO side, 10c:** `500.00` (~500 cents)

**H1 (filtro de ceros) queda REFUTADA como causa de este error específico.** El bucket 10c NO tenía size cero ni en YES ni en NO al momento del snapshot. El delta llegó a un bucket con **estado válido**.

## Evidencia verbatim del log

### Snapshot inicial (líneas 7703-7704)

**Resumen del V2 manager:**
```
2026-05-27 15:36:57.502 | INFO | src.strategies.motor_1_arbitrage.orderbook_manager_v2:_apply_snapshot_msg:343 |
V2 snapshot: ticker=KXMLB-26-ATL seq=2 num_yes=34 num_no=74
sample_yes=[['0.0010','1607903.00'],['0.0040','44444.00'],['0.0100','31848.91']]
sample_no=[['0.0010','2000.00'],['0.0100','4838704.35'],['0.0200','4330.00']]
```

**Payload raw — bucket 10c extraído del payload:**
```
yes_dollars_fp ... ['0.1000', '1114.07'] ...
no_dollars_fp  ... ['0.1000',  '500.00'] ...
```

### Error registrado (línea 7815)
```
2026-05-27 15:37:00.228 | ERROR | src.clients.kalshi_ws:_dispatch:320 |
Handler exception en orderbook_delta:
KXMLB-26-ATL at 10c: delta produces qty=-3108 < 0 (feed corruption)
```

### Re-raise (línea 7841)
```
src.strategies.motor_1_arbitrage.orderbook.OrderbookDesyncError:
KXMLB-26-ATL at 10c: delta produces qty=-3108 < 0 (feed corruption)
```

## Triggering delta — AMBIGUO

El log NO captura el delta crudo. Solo captura el RESULTADO computado (`qty=-3108`). El call stack confirma que el manager pasó `apply_delta({"side": side, "price": price_cents, "delta": delta_size, "seq": seq})` pero los valores no se loggean.

**Inferencia matemática:**
- Si el delta cayó en lado YES: `delta = -3108 - 1114 = -4222`
- Si el delta cayó en lado NO: `delta = -3108 - 500 = -3608`

**No puedo decidir entre las dos sin un log adicional o acceso al stream WS original.**

## Hallazgos extra (no pedidos pero relevantes)

### No hubo deltas previos aplicados a este ticker entre snapshot y error
El timeline filtrado del ticker muestra solo `snapshot → error`, **sin deltas intermedios loggeados**. El estado del bucket 10c al momento del delta era exactamente el del snapshot.

### El error coincidió con un gap de sequence
2ms después del DesyncError, el log registra:
```
CRITICAL _start_recovery:258 - Sid 1 gap detected.
Marking 38 tickers stale, requesting WS recovery snapshot
ERROR Sid 1 gap: expected seq=40, got 41
```

**Dos señales correlacionadas:**
- `qty<0` en ATL
- Mensaje WS faltante (seq=40 nunca llegó)

### Sequence aritmética
- Snapshot del ticker: `seq=2` (línea 7703)
- Gap detectado: `expected seq=40, got 41`
- **Entre seq=2 y seq=39 pasaron 37 deltas exitosos en algún ticker** (posiblemente no en ATL — el log no los loggea individualmente)

## Veredicto sobre las hipótesis de causa raíz V2

Después de este forense, el espacio de hipótesis se reordena:

### REFUTADA
- **H1 (size=0 filter):** el bucket 10c tenía size válido en ambos lados. El filtro NO era el problema.

### NUEVAS hipótesis (a contrastar en próximas iteraciones)

**H2 — Dispatcher / aplicación de deltas defectuosa:**
- El delta llegó a estado válido y produjo qty<0 al aplicarse
- Magnitud aparentemente desproporcionada al bucket actual (delta de ~4222 sobre size de 1114)
- Posible bug en cómo V2 calcula el resultado de apply_delta

**H3 — Ordenamiento de mensajes / out-of-order:**
- El gap de seq=40 sugiere que llegó un delta out-of-order
- O se perdió otro previo que habría reducido el estado del bucket antes de este
- Si el delta -4222 era válido pero llegó "tarde" después de otros que ya redujeron el size → resultado negativo

**H4 — Interpretación del snapshot inicial:**
- Que 1114.07 y 500.00 sean los valores correctos depende del shape de parseo que se está asumiendo
- ¿`yes_dollars_fp` se interpreta como cents, dollars, o algo más?
- ¿El parseo correcto debería haber resultado en valores distintos en cents?

## Constraints cumplidos

- ✅ No propongo fixes, solo verifico estado
- ✅ No escribo código (grep/sed/python solo read-only)
- ✅ Cuando los datos son ambiguos (lado del delta), lo declaro explícitamente
- ✅ No asumo ni adivino

## Para cerrar la ambigüedad del side del delta

Necesitaría:
- (a) JSON crudo del mensaje WS del momento, NO preservado en este log
- (b) Reproducir con el manager V2 inyectando deltas conocidos y observando cuál genera qty=-3108 partiendo de los valores del snapshot

Ambos están fuera del alcance read-only de esta sesión.

## Implicación para la próxima iteración

La decisión derivada #1 de Lección 9 se aplica directamente:

> *"Un diagnóstico no validado contra producción es una hipótesis, no una causa raíz — sin importar cuánto rigor lo respalde."*

H1 pasó:
- 4 tests verdes
- Revisión sobria del diff
- Inspección de paths de excepción
- Validación arquitectónica de la atomicidad
- **Y aun así no era la causa.** Refutada por evidencia directa del log preservado.

**Para el cuarto intento de fix V2, validar contra el log preservado ANTES de implementar.** Cualquier hipótesis nueva (H2/H3/H4) debe explicar:
- ¿Por qué el bucket válido (1114 / 500) producía qty=-3108 con el delta?
- ¿Cómo se relaciona el gap de seq=40 con el error de qty<0?
- ¿Hay otros deltas en el log que también produjeron errores con buckets válidos?

## Estado del frente V2 al cierre

- ❌ Opción A (size=0 fix): **NO era el fix correcto.** El fix está merged pero no resuelve el bug primario.
- 🔄 **Pivot necesario:** del filtrado de snapshots al **dispatcher/ordering/parsing**
- 🔒 V2 sigue dormant detrás del flag `USE_ORDERBOOK_MANAGER_V2=false`
- 📦 Logs del attempt #2 siguen preservados para futuros discoveries
- ⏸ Próximas decisiones (Opción A2, B rediseño, o C continuar V1) dependen de discovery adicional sobre H2/H3/H4

## Links
- [[sesion-2026-05-29-fix-v1-mergeado-y-tercer-discovery-v2]] — sesión donde se hizo
- [[incidente-v2-attempt-2-2026-05-27]] — post-mortem del attempt #2
- [[decision-2026-05-29-v2-pivot-nuevo-espacio-hipotesis]] — decisión derivada
- [[leccion-9-FINAL-causa-raiz-pendiente]] — causa raíz que sigue abierta tras este discovery
- [[diagnostico-v2-size-zero-bug]] — diagnóstico H1 original (ahora refutado)
- [[fix-v2-opcion-a-implementado-commits]] — fix mergeado que no resuelve el bug
- [[kalshi-bot]]
