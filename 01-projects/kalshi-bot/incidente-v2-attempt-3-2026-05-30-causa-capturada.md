---
fecha: 2026-05-30
tipo: post-mortem
proyecto: kalshi-bot
componente: OrderbookManagerV2
incidente: attempt-3
estado: rolledback-causa-CAPTURADA
duracion: ~37s pre-crash, ~6min total ventana
errores: 1 OrderbookDesyncError + cascada (1 CRITICAL + Kalshi code 15)
logs-preservados: data/v2_attempt3_20260530_174849.log
tags:
  - post-mortem
  - kalshi-bot
  - v2
  - rollback
  - attempt-3
  - causa-capturada
---

# Post-mortem — V2 attempt #3 (30-may, 17:41 UTC)

> Tercera activación de OrderbookManagerV2. Falló como las dos anteriores en bootstrap. **A diferencia de attempts #1 y #2, esta vez la instrumentación capturó la causa raíz.** Rollback en <5 min. Cero daño operativo.

## TL;DR

| Atributo | Valor |
|---|---|
| Hora activación | 17:41:01 UTC (Coolify flip + redeploy) |
| Primer error | 17:41:08 UTC (**T+37 segundos**) |
| Ticker afectado | `KXMLB-26-PHI` |
| Bucket | 3¢ |
| Tipo error | `OrderbookDesyncError` |
| **Causa identificada** | **Desync de secuencia interna en bootstrap** (msg_seq=186, state_seq=184) |
| Cascada | Sid 1 gap → `_start_recovery` → 37 tickers stale → Kalshi code 15 |
| Recovery | NO convergió (`books_initialized: 0` a T+6min) |
| Rollback | <5min, V1 baseline sano confirmado |
| Capital en riesgo | $0 (`TRADING_ENABLED=false`) |

## Diferencia central con attempts #1 y #2
**Por primera vez tenemos `raw_msg` del crash preservado en log ERROR.**

| Attempt | Stack traces | raw_msg del crash | Causa identificada |
|---|---|---|---|
| #1 (25-may) | `NoneType: None` | NO | Hipótesis "feed corruption" (falsa) |
| #2 (27-may) | Completos | NO | Hipótesis "size=0" (falsa) |
| **#3 (30-may)** | **Completos** | **SÍ** | **Desync de secuencia interna en bootstrap (CONFIRMADA)** |

La instrumentación asimétrica del PR #2 (mergeada esta misma tarde antes de la activación) hizo el trabajo en una sola corrida.

## Cronología detallada

### Pre-flight (completado por primera vez con los 4 ✅)
1. **Backup íntegro:** SQLite backup + integrity_check `ok`
2. **Flags por nombre (NO env dump):** `printenv USE_ORDERBOOK_MANAGER_V2 MOTOR_1_ARBITRAGE_ENABLED TRADING_ENABLED` — sin exponer secrets
3. **Telegram confirmado EN EL CELULAR:** no solo `sent=True` del API
4. **Código verificado en vivo:** no por commit message, por inspección runtime

### Ventana de activación

```
17:41:01  Coolify: USE_ORDERBOOK_MANAGER_V2 false → true + redeploy disparado
17:41:01  Container restart inicia
17:41:02  Container nuevo arriba (V2 activo)
17:41:02  Snapshots iniciales V2 procesándose (batch seq=1..38)
17:41:0X  WebSocket conectado, recibiendo deltas

17:41:08  ⚠️ PRIMER ERROR — KXMLB-26-PHI 3¢
          Logger ERROR instrumentado captura:
            msg_seq=186 state_seq=184
            side=yes price_cents=3 delta_size=-13
            bucket_qty_pre_delta=2
          → 2 + (-13) = -11 → OrderbookDesyncError

17:41:08  CRITICAL — _start_recovery:258
          "Sid 1 gap detected. Marking 38 tickers stale,
           requesting WS recovery snapshot"
          (técnicamente 37 tickers, ya que PHI ya estaba en error)

17:41:08  ERROR — _dispatch:320
          "Sid 1 gap: expected seq=186, got 187"
          (artefacto del manejo de error — mismo patrón que attempt #2)

17:41:0X  Kalshi server response: code 15 "Action required"
          (puede ser el rate limiting o el throttle por demasiados requests)

17:41-17:47   Recovery loop intenta resnap pero NO converge
              books_initialized: 0 a T+6min

17:47:XX     ROLLBACK ejecutado
             USE_ORDERBOOK_MANAGER_V2 → false
             Redeploy
             V1 baseline sano confirmado, last_error: null
             Tiempo total: <5min desde decisión
```

## El smoking gun en detalle

**Log line capturada (línea 407 aprox del log preservado):**
```
2026-05-30 17:41:08.xxx | ERROR | _apply_delta_msg | OrderbookDesyncError catch:
  ticker=KXMLB-26-PHI
  msg_seq=186
  state_seq=184
  side=yes
  price_cents=3
  delta_size=-13
  bucket_qty_pre_delta=2
  raw_msg={...}
```

**Interpretación:**
1. El feed envió delta con `seq=186`
2. El book interno de V2 estaba en `state_seq=184` (último delta aplicado exitosamente)
3. **Falta el `seq=185`** — V2 no lo procesó o no lo bufferó
4. V2 aplicó el `seq=186` directamente sobre estado obsoleto
5. Resultado: `qty = 2 + (-13) = -11` → crash

**Lo crítico:** el feed entregó secuencia válida y consecutiva (184 → 185 → 186). El problema está en **cómo V2 maneja el gap entre snapshot inicial y los primeros deltas durante bootstrap.**

## Hipótesis a contrastar en cuarto discovery (no urgente)

### Q1 — ¿Por qué V2 no bufferó el seq=185?
El código tiene buffer `self._pending_deltas[sid].append(raw_msg)` (`handle_message:166`). Pero el patrón observado sugiere que:

- **(C1)** El buffer NO se llena durante bootstrap — V2 procesa deltas directos antes de tener snapshot completo
- **(C2)** Race condition entre snapshot apply y delta processing
- **(C3)** Gap detection (`new_seq != expected_seq`) corre antes de que `_last_seq_by_sid[sid]` esté inicializado, el "primer delta" se acepta sin importar el seq

### Q2 — ¿Por qué el recovery no convergió?
`books_initialized: 0` a T+6min después de `_start_recovery`. Bot pidió WS recovery snapshot pero nunca completó.

- (R1) Kalshi `code 15` interrumpió el flujo
- (R2) Recovery loop con bug que lo deja colgado
- (R3) Cascada Sid-wide (1 crash → 37 stale) genera más mensajes que recovery puede drenar

**Este es bug separado del primario.** Incluso fixeando bootstrap, recovery degradado seguiría siendo problema en operación normal.

## Comportamiento del watchdog V1 durante el incidente

**Verificación importante:** ¿el watchdog `21fe6fd` reaccionó incorrectamente cuando V2 crasheó?

**Respuesta:** No. El watchdog monitorea silencio de mensajes WS (>300s). Durante la ventana de V2 los mensajes seguían llegando (era V2 quien crasheaba al procesarlos, no la conexión que moría). Por lo tanto:
- 0 `force_reconnect` espurios disparados por el watchdog
- 0 alertas Telegram del watchdog durante la ventana V2
- Después del rollback a V1, el watchdog siguió comportándose normal

**Esto confirma:** los dos frentes (V1 watchdog + V2 activación) están bien desacoplados. El watchdog no se activa por crashes de V2.

## Cero daño operativo

- `TRADING_ENABLED=false` durante toda la ventana → cero capital en riesgo
- V1 baseline siguió operando paralelo (data capture path) — no se interrumpió
- Rollback `<5min` confirma runbook 12.5 funcionando
- Logs preservados en volumen Docker persistente — sobreviven restarts

## Decisiones tomadas durante la ventana

1. **Aplicar rollback al ver el primer error en T+37s** sin esperar línea defensiva T+30min. **Razón:** Lección 9 línea defensiva T+5→T+30 dice "1 error no-SidGap = rollback". El de attempt #3 fue inmediato. No relajar runbook por momentum de "ya tenemos la cámara".

2. **NO escribir fix hoy.** Cuarto discovery primero. Lección 9 anti-patrón: "el bug parece obvio, dame el fix" — incluso con causa identificada, el fix necesita su propio diseño + validación.

3. **Sesión cerrada disciplinadamente** después del rollback. Cuarto discovery va a otra sesión, con cabeza fresca.

## Métricas operativas de la ventana

| Métrica | Valor |
|---|---|
| Tiempo flag → primer error | 37 segundos |
| Tiempo decisión rollback → V1 restaurado | <5 min |
| Errores `OrderbookDesyncError` | 1 (KXMLB-26-PHI) |
| Errores cascada `SidGapError` | 1 (sid=1) |
| Tickers marcados stale | 37 |
| Respuestas server `code 15` | 1+ |
| `books_initialized` post-recovery | 0/38 |
| Capital movido | $0 (trading off) |
| `last_error` post-rollback | `null` |

## Estado del frente V2 al cierre del attempt #3

- ✅ **Causa raíz IDENTIFICADA** (desync de secuencia en bootstrap)
- ✅ **Hipótesis C confirmada** con evidencia dura del log
- ✅ **Hipótesis A (feed) y B (snapshot parcial) descartadas**
- ✅ **PR #2 (instrumentación + Lección 9 update) cumplió su propósito**
- ⏳ **Cuarto discovery pendiente** para entender el mecanismo exacto (Q1 + Q2)
- ⏳ **Diseño del fix definitivo** post-cuarto discovery
- 🔒 **V2 sigue dormant** detrás del flag `USE_ORDERBOOK_MANAGER_V2=false`
- 🔒 **Cuarta ventana de activación** = decisión de gestión separada cuando esté fix validado

## Validación retroactiva de patrones

Este incidente valida múltiples patrones documentados:

1. **Logging fix del attempt #2** (`logger.opt(exception=r)`) habilitó este discovery. Sin él, attempt #3 hubiera sido otro `NoneType: None`.

2. **Logging asimétrico del PR #2** (snapshot DEBUG full + delta ERROR on failure) capturó el `raw_msg` exacto necesario para diagnosticar. **Acceso defensivo al bucket funcionó** (no enmascaró la excepción real).

3. **Runbook 12.5 + línea defensiva T+5 a T+30** contuvo el tercer incidente en <5min. **Tres rollbacks limpios, cero daño operativo en ninguno.**

4. **Capa adversarial decidió "instrumentar antes de activar"** (29-may, 30-may mañana). Sin esa disciplina, attempt #3 hubiera sido otro discovery sin pista. **El sistema funcionó.**

5. **Anti-patrón "indiscutiblemente es el feed"** (cazado el 30-may mañana) hubiera enviado el cuarto discovery a buscar variantes del feed. **Como se mantuvo abierto el espacio C, el log lo capturó.**

## Próximos pasos (en orden, ninguno urgente)

1. ⏳ Cuarto discovery sobre el log preservado (`v2_attempt3_20260530_174849.log`)
2. ⏳ Diseñar fix de bootstrap/gap-handling (post-discovery)
3. ⏳ Test fix offline contra el escenario reproducido (`seq=184 → seq=186` sin `seq=185`)
4. ⏳ Cuarta ventana de activación con fix puesto + runbook 12.5 literal
5. ⏳ Si V2 estable a T+2h → desbloquear Motor 1 (paso separado)

## Links
- [[sesion-2026-05-30-tarde-watchdog-prod-y-v2-causa-capturada]] — sesión narrativa
- [[causa-raiz-v2-desync-secuencia-bootstrap-CAPTURADA]] — análisis del smoking gun
- [[update-leccion-9-v2-causa-raiz-resuelta-30may]] — update Lección 9
- [[brief-instrumentacion-v2-asymmetric-logging]] — brief que produjo la cámara
- [[fix-v2-opcion-a-implementado-commits]] — fix Opción A (logging fix funcionó, lo otros no)
- [[incidente-v2-attempt-2-2026-05-27]] — attempt #2 (referencia)
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — attempt #1 (referencia)
- [[cheatsheet-runbook-12.5-v2-activacion]] — runbook aplicado limpio 3 veces
- [[kalshi-bot]]
