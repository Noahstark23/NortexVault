---
fecha: 2026-05-29
tipo: implementacion-validada
proyecto: kalshi-bot
componente: V1-watchdog-WS
commit: 21fe6fd
estado: mergeado-validado-7h-produccion
tags:
  - fix
  - kalshi-bot
  - v1
  - watchdog
  - validado-en-produccion
---

# Fix V1 watchdog — implementado + mergeado + validado 7h en producción

> Commit `21fe6fd` mergeado a main, deploy disparado en Coolify, **7h 14min de operación sin un solo hueco ni falso positivo del watchdog**. Frente WS CERRADO LIMPIO.

## Resumen del fix

Tres cambios que se cierran sobre los 3 bugs firmes identificados en el discovery del 28-may:

| Bug identificado en discovery | Cambio del fix |
|---|---|
| 1. No hay detección de silencio aplicativo con TCP vivo | Watchdog corre cada 300s, threshold 300s → si supera, incrementa contador zombie |
| 2. El zombie detector solo seteaba `last_error`, no actuaba | Ahora dispara `force_reconnect()` + alerta Telegram si persiste (threshold=2) |
| 3. `last_error` sticky sin TTL ocultaba histórico | `LAST_ERROR_TTL_SEC = 900.0` + `current_error()` que expira/limpia |

## Verificación contra 6 puntos de control (todos ✅)

| # | Control | Resultado | Evidencia |
|---|---|---|---|
| 1 | `force_reconnect()` cierra socket SIN tocar `_running` | ✅ | Cuerpo: solo `if self._ws ... state == OPEN: await self._ws.close()`. Cero asignaciones a `_running` |
| 2 | `run()` interpreta cierre como reconexión, no shutdown | ✅ | `run()` no cambió; shutdown sigue gateado por `_running` (break línea 175). Probado vivo con `test_force_reconnect_actually_reconnects` |
| 3 | Escalación Telegram tras N detecciones | ✅ | `if self._ws_zombie_count >= WS_ZOMBIE_ALERT_THRESHOLD (2): await alert_error(...)`. Gateado, no spammea |
| 4 | TTL en `last_error` | ✅ | `LAST_ERROR_TTL_SEC = 900.0` + `current_error()` expira/limpia + `/status` usa `current_error()` |
| 5 | NO se coló el detector de tasa | ✅ | Nada de throughput/rate. Solo `force_reconnect` + wiring + TTL + tests |
| 6 | Watchdog llama `force_reconnect()` cuando silence > 300s | ✅ | Antes: solo `record_error`. Ahora: `>300s` → incrementa contador, `record_error`, `await self.ws.force_reconnect()`, alerta si persiste |

## Tests
- Unit tests: watchdog/health
- **Integración real contra socket** — 2 tests nuevos
- Suite verde salvo 2 fallos pre-existentes de `test_runner.py` (ajenos al cambio)
- No hay CI configurado en el repo

## Notas honestas pre-merge (no blockers)
1. **PR incluyó cambio doc-only en `KALSHI_BOT_CONTEXT.md`** (commit `e1fe047`, bump header "Mayo 28" + "Lección 10 PENDIENTE"). Acepté.
2. **Latencia de detección:** watchdog corre cada 5 min, threshold 300s. **Peor caso: zombie detectado en ~10 min, alerta Telegram en ~15 min** (2 detecciones). Comportamiento esperado del diseño actual, no bug. Si se quiere más agresivo: ajustar `SNAPSHOT_INTERVAL_SEC` o threshold en otra sesión.

## Validación post-deploy

### Ronda 1 — T+4-5 min (06:13:34 → 06:18:01 UTC, 29-may)
```
06:13 →  73 events (parcial primer minuto)
06:14 → 213
06:15 → 146
06:16 → 220
06:17 → 224
06:18 →   4 (parcial)
TOTAL: 880 eventos / 4.5 min ≈ 195/min ≈ 11.700/h
```
Throughput sostenido **dentro del rango sano del baseline 11 días** (5k-25k/h, mediana ~10-13k/h). Bot recibiendo deltas a tasa normal.

| Criterio | Esperado | Observado | Status |
|---|---|---|---|
| `capture_running` | true | True | ✅ |
| `ws_connected` | true | True | ✅ |
| `tracked_markets` | 38 | 38 | ✅ |
| `last_error` | null | None | ✅ |
| `force_reconnect` count | 0 | 0 | ✅ |
| `ws.zombie` detección | 0 | 0 | ✅ |
| Throughput OBE | ≥5k/h | ~12k/h proyectado | ✅ |
| Container deployado | commit 21fe6fd | confirmado | ✅ |

### Ronda 2 — T+7h 14min (06:13:34 → 13:28:17 UTC)

**Throughput hora por hora:**
```
06h (parcial 06:13-06:59): 11.954
07h:                       22.965
08h:                        6.831  ← valle natural
09h:                       37.410  ← pico
10h:                       56.440  ← pico
11h:                       10.985
12h:                       11.031
13h (parcial 13:00-13:28):  6.909

TOTAL POSTDEPLOY: 161.169 eventos en 7h 14min
RANGO: 06:13:34 → 13:28:17 UTC
MINUTOS CONTINUOS CON DATA: 435 de 435 (06:14 → 13:28)
MINUTOS_MISSING: 0   ✓
```

### Hallazgos críticos de la validación

1. **CERO huecos.** 435 minutos consecutivos con al menos 1 evento. **Lo opuesto exacto del incidente del 28-may** (24 min seguidos en 0). El feed está sano y continuo.

2. **Hora 08h con 6.831 eventos — el mismo número que destruyó el 28-may.** Hoy fue valle normal seguido de 37k (09h) y 56k (10h). **Misma cifra, significados opuestos** — y ahora lo sabemos porque tenemos el baseline de varianza. Madurez del sistema de monitoreo, no suerte.

3. **Picos de 37k-56k/h** — dentro del envelope del baseline 12 días. NO es anómalo, es feed activo.

4. **Continuidad total:** ni siquiera la hora 08h con 6.831 produjo un gap de 60+ segundos.

### Veredicto Ronda 2

| Criterio | Esperado | Observado | Status |
|---|---|---|---|
| `/status`: `capture_running` | true | True | ✅ |
| `/status`: `ws_connected` | true | True | ✅ |
| `/status`: `tracked_markets` | 38 | 38 | ✅ |
| `/status`: `last_error` | null | None | ✅ |
| `recent_risk_events` | [] | [] | ✅ |
| grep `force_reconnect` | 0 | 0 | ✅ |
| grep `ws.zombie` | 0 | 0 | ✅ |
| Throughput OBE | sin caída anómala | 161k / 7h sin gaps | ✅ |
| Container estable | sin restart | 1 conexión WS sostenida 7h+ | ✅ |

## Por qué esta validación es DIFERENTE a las dos de V2

| Atributo | V2 attempt #1 y #2 | V1 watchdog fix |
|---|---|---|
| Tests pre-merge | Verde | Verde |
| Validación en producción | T+5min (insuficiente) | **7h 14min** |
| Confirmación de "no falla por la razón que arreglamos" | NO (bug volvió) | **SÍ (cero force_reconnect espurios, cero zombie)** |
| Cobertura del baseline | Limitada | **Multi-hora con valles y picos** |

**Esta validación es real — no "tests verdes" como en V2, sino 7 horas de comportamiento real observado en producción.** Diferencia central con los dos intentos V2 que es exactamente la decisión derivada #1 de Lección 9: *"un diagnóstico no validado contra producción es una hipótesis, no una causa raíz."*

## Estado del frente WS V1 al cierre
**CERRADO LIMPIO.** No se toca más en esta vuelta.

Trabajo pendiente catalogado como mejora (no bloqueante):
- Latencia de detección actual: ~10-15 min worst case. Aceptable, mejora posible si se reduce `SNAPSHOT_INTERVAL_SEC` o threshold.
- Fase 2 del watchdog (detector de tasa con baseline por hora): diseño pendiente, NO urgente porque Fase 1 da auto-recuperación.

## Links
- [[sesion-2026-05-29-fix-v1-mergeado-y-tercer-discovery-v2]] — sesión donde se cerró
- [[ticket-v1-ws-zombie-degradacion-escalonada]] — ticket que originó el fix
- [[leccion-10-FINAL-ws-zombie-con-fix-validado]] — lección final basada en este cierre
- [[leccion-10-ws-zombie-pendiente-discovery]] — stub previo (ahora superado)
- [[sesion-2026-05-28-leccion-9-corregida-y-ws-zombie]] — descubrimiento del incidente
- [[kalshi-bot]]
