---
fecha: 2026-05-30
tipo: causa-raiz-validada
proyecto: kalshi-bot
componente: OrderbookManagerV2
hipotesis-confirmada: C (gap/recovery handling en bootstrap)
hipotesis-descartadas: [A (feed corruption), B (snapshot inicial parcial)]
nivel-evidencia: log capturado en vivo durante crash
tags:
  - causa-raiz
  - kalshi-bot
  - v2
  - smoking-gun
  - bootstrap
  - secuencia
---

# 🎯 CAUSA RAÍZ V2 CAPTURADA — Desync de secuencia en bootstrap

> El smoking gun del attempt #3 (30-may, 17:41 UTC). Cuatro discoveries persiguiendo esta pregunta. La instrumentación asimétrica del PR #2 (mergeada esta tarde antes de la activación) la capturó en una sola corrida.

## La línea que lo cambió todo

```
msg_seq=186 state_seq=184 side=yes price_cents=3 delta_size=-13 bucket_qty_pre_delta=2
```

**Lectura:**
- El book interno de V2 está en **seq=184**
- Llega un delta con **seq=186**
- **Falta el seq=185** (gap de 1)
- V2 lo aplica igual: `bucket_qty=2 + delta=-13 = -11` → `OrderbookDesyncError`

**No es feed corruption.** Es V2 aplicando deltas adelantados sobre estado desincronizado durante bootstrap.

## Por qué esto cierra Lección 9

Hipótesis del tercer discovery (29-may):
- **(A)** Feed corruption real
- **(B)** Snapshot inicial parcial (sync issue snapshot vs stream)
- **(C)** Bug de V2 en aplicación de deltas en ventana no logueada

El smoking gun **confirma C** y **descarta A y B:**

| Hipótesis | Estado tras attempt #3 |
|---|---|
| (A) Feed corruption | ❌ DESCARTADA — el feed entregó secuencia válida (184→185→186); V2 saltó el 185 |
| (B) Snapshot inicial parcial | ❌ DESCARTADA — el bug está en cómo V2 procesa el GAP, no en el snapshot |
| (C) Bug de V2 en gap/recovery | ✅ **CONFIRMADA** con evidencia dura |

## Anti-patrón documentado en `orderbook.py:65` resulta ser EXACTAMENTE EL CASO

Hace 4 días documentamos que `orderbook.py:65` decía:
```
"new_qty < 0 indicates feed-level corruption"
```

Y notamos: *"El código pre-juzga causa externa. qty<0 indica desync, que puede ser interno o externo; el código asume externo."*

**Hoy se prueba que la asunción está mal.** El `qty<0` del attempt #3 es desync INTERNO (V2 saltó seq=185), no externo. El sesgo hardcodeado encubrió la causa real durante 5 días.

**Acción derivada:** eliminar o cambiar el texto `"(feed corruption)"` del mensaje del error en el fix definitivo. Etiquetar la causa antes de diagnosticarla es exactamente el anti-patrón de Lección 9.

## La pregunta abierta para el cuarto discovery

**Si el feed entregó 184 → 185 → 186 correctamente, ¿por qué V2 procesó 184 y luego 186, saltando el 185?**

Dos sub-preguntas:

### Q1 — ¿Por qué V2 no bufferó el seq=185?
El código tiene buffer (`self._pending_deltas[sid].append(raw_msg)` en `handle_message:166`). Pero el bug del attempt #3 sugiere que ese buffer NO se llena durante bootstrap, o se vacía mal antes de que el snapshot inicial esté completo.

**Hipótesis a contrastar:**
- (C1) V2 recibe deltas antes de que el snapshot inicial termine de aplicarse, los aplica directo sin buffering durante bootstrap
- (C2) El buffer existe pero hay race condition entre snapshot apply y delta processing
- (C3) El gap detection (`new_seq != expected_seq`) corre antes de que `_last_seq_by_sid[sid]` esté inicializado para ese sid, y el "primer delta" se acepta sin importar el seq

### Q2 — ¿Por qué el recovery no convergió?
El log muestra `books_initialized: 0` a T+6min después del `_start_recovery`. El bot pidió WS recovery snapshot pero nunca completó. Posible:
- Kalshi devolvió `code 15 "Action required"` interrumpiendo el flujo
- El recovery loop tiene un bug que lo deja colgado
- La cascada (1 ticker crashea → 37 stale) crea más mensajes de los que recovery puede drenar

Esto es **bug separado del primario** — incluso si arreglamos el bootstrap, el recovery degradado podría seguir siendo problema durante operación normal.

## Evidencia preservada

**Archivo:** `data/v2_attempt3_20260530_174849.log` (29 KB, 390 líneas)

**Contenido:**
- `raw_msg` pre-corrupción (capturado por el `logger.error` del PR #2)
- Cadena completa del error: desync → SidGapError → `_start_recovery` → Kalshi code 15
- `/status` antes y después del rollback
- Sequence trace del sid=1 desde activación hasta crash

**Persistencia:** volumen Docker persistente, sobrevive restarts. Disponible para el cuarto discovery cuando se retome.

## Cadena de eventos (attempt #3, T+0 a T+rollback)

```
17:41:01.x  USE_ORDERBOOK_MANAGER_V2: false → true (Coolify flip)
17:41:01.y  Container restart
17:41:0X.x  Bot online, snapshots iniciales V2 procesándose
            (seq=1..38 del batch snapshot index)
17:41:08.x  PRIMER ERROR — KXMLB-26-PHI 3¢:
            msg_seq=186 state_seq=184 → qty=-11
            T+37 segundos desde activación
17:41:08.y  Sid 1 gap detected (expected 186, got 187)
            → _start_recovery
            → 37 tickers stale
            → WS recovery snapshot requested
17:41:0X.z  Kalshi: code 15 "Action required"
17:47:XX    books_initialized: 0 (T+6min)
            Recovery no converge
17:47:XX+ε  Rollback ejecutado <5min
            USE_ORDERBOOK_MANAGER_V2 → false
            V1 baseline sano confirmado
```

## Comparación los 3 attempts

| Atributo | Attempt #1 (25-may) | Attempt #2 (27-may) | Attempt #3 (30-may) |
|---|---|---|---|
| Duración pre-crash | ~5 min | ~12 min | **~37 segundos** |
| Stack traces | `NoneType: None` (perdidos) | Completos (logging fix funcionó) | **Completos + `raw_msg`** |
| Causa identificada | Atribuida a feed (falso) | Atribuida a size=0 (falso) | **Desync interno (confirmado)** |
| Hipótesis activa post-rollback | "feed corruption" → segundo discovery | H1 size=0 → fix Opción A | **H1/H2 descartadas, C confirmada** |
| Resultado neto | Rollback limpio | Rollback limpio + logging fix valida | **Rollback limpio + CAUSA CAPTURADA** |

**Tendencia:** cada attempt crashea más rápido, pero captura más información. La instrumentación asimétrica del PR #2 fue decisiva.

## Implicaciones para el fix

**Lo que NO hay que hacer:**
- ❌ Fix de "feed corruption" — no es el problema
- ❌ Más variantes del filtro size=0 — refutado tres veces ya
- ❌ Tocar el path de delta normal — no es donde está el bug

**Lo que SÍ hay que diseñar (post-cuarto discovery):**
- Manejo de gap durante bootstrap: ¿buffering hasta tener snapshot inicial completo?
- Estado inicializado correctamente antes de aceptar deltas
- Recovery loop que efectivamente converja (Q2 abierta)

**Anti-patrón a evitar (Lección 9 #5):**
> *"Un diagnóstico no validado contra producción es una hipótesis, no una causa raíz."*

Esta vez la causa SE VALIDÓ contra producción (con instrumentación). El fix derivado tiene que validarse de la misma forma en una eventual cuarta ventana.

## Decisiones derivadas inmediatas

1. **NO escribir fix hoy.** Cuarto discovery primero, en otra sesión.
2. **PR #2 puede mergearse** — la instrumentación cumplió su propósito (capturó la evidencia). Update Lección 9 también puede mergear.
3. **Tercera causa raíz capturada en 30-may, NO en activación apurada.** Validación retroactiva de la disciplina de Lección 9.
4. **Lección 9 needs UPDATE** — pasa de "causa NO RESUELTA" a "C confirmada, A y B descartadas". Ver [[update-leccion-9-v2-causa-raiz-resuelta-30may]].

## Links
- [[sesion-2026-05-30-tarde-watchdog-prod-y-v2-causa-capturada]] — sesión narrativa
- [[incidente-v2-attempt-3-2026-05-30-causa-capturada]] — post-mortem técnico extendido
- [[update-leccion-9-v2-causa-raiz-resuelta-30may]] — texto del próximo update a Lección 9
- [[leccion-9-FINAL-causa-raiz-pendiente]] — lección a actualizar (ahora con causa CAPTURADA)
- [[brief-instrumentacion-v2-asymmetric-logging]] — brief que produjo la cámara
- [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]] — discovery del 30-may mañana (estableció A/B/C)
- [[discovery-forense-v2-attempt2-h1-refutada]] — tercer discovery del 29-may (refutó H1)
- [[incidente-v2-attempt-2-2026-05-27]] — incidente previo
- [[kalshi-bot]]
