---
fecha: 2026-05-27
tipo: post-mortem
proyecto: kalshi-bot
componente: OrderbookManagerV2
incidente: attempt-2
estado: rolledback-causa-raiz-pendiente
duracion: 12 min
errores: 4 ERROR + 1 CRITICAL
tags:
  - post-mortem
  - kalshi-bot
  - v2
  - rollback
  - attempt-2
---

# Post-mortem — V2 attempt #2 (27-may, 15:36→15:48 UTC)

> Segunda activación de OrderbookManagerV2. Falló en 12 minutos. Refutó empíricamente la hipótesis H1 (size=0) que era la base del fix Opción A. **Causa raíz QUEDA ABIERTA.**

## TL;DR
Con el fix `ed7b7ac` aplicado (size=0 filter + seq order swap + dispatcher logging), V2 reactivado en producción. **El bug del 25-may reapareció estructuralmente** con el fix activo. Rollback ejecutado en ~4 min. Esta vez SÍ hubo stack traces completos (logging fix funcionó) — esa es la única pieza del fix que cumplió su propósito.

## Cronología
- **15:36 UTC** — Flag `USE_ORDERBOOK_MANAGER_V2: false → true` + redeploy
- **15:36 +Xs** — Container con V2 levantado
- **T+2.7s del primer snapshot** — Primer error: `KXMLB-26-ATL at 10c: delta produces qty=-3108 < 0`
- **T+~3min** — Gap CRITICAL: 38 tickers stale
- **T+~5min** — Server error de Kalshi: `code 15 "Action required"`
- **15:48 UTC** — Rollback completado. Run #31 cerrado en `bot_runs` con `crash_reason=None` (apagado limpio por env var, no crash)

**Total: ~12 min, 4 ERROR + 1 CRITICAL.**

## Lo que sí funcionó (preservar)
**Dispatcher logging fix (la única pieza del fix Opción A que cumplió):**
- `logger.opt(exception=r).error(...)` produjo **stack traces completos** durante el incidente
- Esto es lo opuesto al attempt #1 (25-may) donde los 87 errores tuvieron `NoneType: None` y perdimos toda la evidencia
- Logs preservados a `data/rollback_v2_attempt2_20260527_154809.log` (949 KB)
- Esta evidencia es la base del próximo discovery

## Lo que NO funcionó (refutado empíricamente)
**Bug fix size=0 filter — H1 refutada o incompleta:**
- El fix `_parse_fp_levels` filtraba size=0 antes de `apply_snapshot`
- Pasó 4 tests, revisión sobria del diff, inspección de paths de excepción
- **Y el bug reapareció igual** — `KXMLB-26-ATL at 10c: qty=-3108` a T+2.7s

**Bug fix seq order swap — contribuyente, no causa:**
- El swap evitó que un error puntual se convirtiera en cascada
- Pero el primer error a T+2.7s ocurrió igual
- Contribuye a contener, no resuelve el origen

## Lo que la realidad mostró vs lo que cada diagnóstico afirmó

| Diagnóstico | Afirmó | Refutado por |
|---|---|---|
| Post-attempt #1 (v1) | "Feed corruption de Kalshi, causa externa" | Segundo discovery encontró bug interno (size=0) |
| Discovery dirigido (26-may) | "H1: size=0 filter es la causa, fix de ~5 líneas" | Attempt #2: el fix se aplicó y el bug reapareció |
| Estado actual | Causa raíz desconocida | Pendiente tercer discovery con stack traces del attempt #2 |

## La pregunta abierta — primera línea del próximo discovery
**¿Tenía `KXMLB-26-ATL` price 10c con `size>0` en el snapshot WS inicial?**

- Si SÍ → H1 (size=0) completamente refutada, bug es otro
- Si NO → H1 está confirmada pero hay un path donde el filter no se aplica (¿race con delta procesando antes que snapshot termine? ¿buffer interno?)

Logs preservados con stack traces tienen la respuesta. Esto es el insumo del tercer discovery.

## Causa raíz arquitectónica (esta SÍ validada)
**El bot NO crashea ante estos errores.**
- `bot_runs.crash_reason=None` para el run de V2 attempt #2
- 12 min de errores, cero crash, apagado limpio por flag
- Esto es Lección 7 aplicada a **estado mutable in-memory** (no solo a conexión WS)
- V2 introdujo el primer componente con state mutable en producción
- El sistema NO distingue entre "handler independiente que falló" (tolerable) y "state machine que se corrompió" (no tolerable)
- Los errores se tratan como recoverable y el bot sigue "vivo" con estado degradado

**Esta lección estructural es la más sólida del incidente.** Está documentada en Lección 9 corregida (decisión derivada #2).

## Hipótesis para el tercer discovery (a contrastar con evidencia)

1. **H1 parcial:** size=0 sigue siendo bug parcial pero hay un path no cubierto (race entre snapshot completion y deltas en queue)
2. **H2 nueva:** V2 aplica deltas correctamente sobre estado válido, pero el snapshot inicial está mal-parseado para algún edge case que no son levels con size=0
3. **H3 nueva:** Hay un wire format del feed (formato compacto, deltas multi-level, fields opcionales) que V2 no maneja
4. **H4 nueva:** Race condition entre `_apply_snapshot_msg` y `_apply_delta_msg` cuando el delta llega antes de que snapshot esté fully applied al state

## Acciones derivadas (orden estricto)
- [ ] Discovery del primer error con stack trace completo (logs preservados)
- [ ] Inspeccionar `_apply_snapshot_msg` con la pregunta: ¿qué hace V2 cuando `KXMLB-26-ATL` snapshot llega? ¿es race-free? ¿cómo maneja deltas en queue mientras snapshot está aplicándose?
- [ ] NO proponer fix hasta que la causa raíz esté validada empíricamente

## Línea defensiva validada (otra vez)
- Runbook 12.5 + adición Lección 9 (T+5 a T+30, 1 error no-SidGap = rollback) funcionó
- Rollback en ~4 min (target del runbook <5 min, ✓)
- V1 intacto, cero daño operativo
- **El sistema de contención es sólido aunque V2 no lo sea**

## Workflow capa por capa observado
- **Capa Claude (adversarial):** insistió pre-flight literal, sostuvo el runbook
- **Capa Claude Code:** ejecutó rollback en tiempo, preservó logs sin perderlos
- **Yo (operador):** aplicó runbook sin relajar, tomó decisión de rollback
- **Anti-patrón ausente esta vez:** ningún agente intentó "esperá a ver si se estabiliza" — el aprendizaje del attempt #1 quedó internalizado

## Métrica de "éxito" del rollback
**No solo "no daño" sino "diagnóstico habilitado":** logs preservados con stack traces es lo que el attempt #1 no produjo. El próximo discovery arranca con evidencia, no con hipótesis. **Esto convierte el attempt #2 fallido en attempt productivo** — generó la evidencia que faltaba.

## Links
- [[sesion-2026-05-27-segunda-ventana-v2-preflight]] — pre-flight de esta activación
- [[sesion-2026-05-28-leccion-9-corregida-y-ws-zombie]] — sesión donde se procesó este attempt
- [[diagnostico-v2-size-zero-bug]] — diagnóstico previo (H1) — AHORA refutado o incompleto
- [[fix-v2-opcion-a-implementado-commits]] — fixes aplicados, solo el logging cumplió
- [[leccion-9-FINAL-causa-raiz-pendiente]] — lección corregida (cubre ambos attempts)
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — attempt #1
- [[kalshi-bot]] — proyecto raíz

## Logs preservados (para el discovery)
- Producción: `data/rollback_v2_attempt2_20260527_154809.log` (949 KB)
- Telegram: send_alert returned True durante el rollback (canal funcional)
- DB tracking: `bot_runs` row id=31 con `crash_reason=None`, inicio 15:36 UTC, fin 15:48 UTC

## Estado al cierre
- V2 dormant detrás del flag `USE_ORDERBOOK_MANAGER_V2=false`
- V1 corriendo en Fase 1 (data capture only)
- Causa raíz V2 NO RESUELTA — pendiente tercer discovery con logs nuevos
- `MOTOR_1_ARBITRAGE_ENABLED=false`, `TRADING_ENABLED=false`
- Cero capital en riesgo, sin urgencia operativa
