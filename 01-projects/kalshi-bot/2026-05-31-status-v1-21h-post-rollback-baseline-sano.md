---
fecha: 2026-05-31
hora-check: 15:11 UTC
tipo: status-check
proyecto: kalshi-bot
componente: V1-baseline
estado: SANO-baseline-validado
tags:
  - status
  - kalshi-bot
  - v1
  - 2026-05-31
  - validacion-rollback
---

# Status V1 (31-may 15:11 UTC) — 21.3h continuas sin errores post-rollback

> Check de baseline V1 tras el rollback del attempt #3 (30-may 17:54 UTC). **Validación retroactiva de la decisión de rollback.** El bot lleva 21.3 horas continuas e ininterrumpidas sin un solo error, ni siquiera transitorio.

## TL;DR

**El bot está sano y estable en baseline V1.** Pas decisión de rollback de ayer quedó validada por 21.3 horas de operación limpia.

## Estado snapshot (`/status` lectura del 31-may 15:11 UTC)

### Uptime y errores
| Métrica | Valor | Significado |
|---|---|---|
| Uptime continuo | **~21.3 horas** | Sin restarts, sin reconexiones forzadas |
| `last_error` | `None` | Sin errores transitorios en 21.3h |
| `last_error_at` | `None` | Confirmación adicional |
| `recent_risk_events` | `[]` | Cero eventos de riesgo |

### Conectividad y captura
| Métrica | Valor |
|---|---|
| `ws_connected` | `True` |
| `last_ws_message` | hace ~18 segundos (mensajes fluyendo ahora) |
| `capture_running` | `True` |
| `tracked_markets` | **37** (vs 38 antes del attempt #3 — 1 ticker probable cierre natural) |

### Trading y motores (correctamente apagados)
| Flag | Valor |
|---|---|
| `trading_enabled` | `false` |
| `motor_1_arbitrage` | `false` |
| `motor_2_sportsbook` | `false` |
| `motor_3_clv` | `false` |
| `is_paused` | `false` |
| `pause_reason` | `null` (deshabilitado por config, NO por stop-loss) |

### Trading state
| Métrica | Valor |
|---|---|
| Trades today | 0 |
| Trades week | 0 |
| `pnl` | 0 |
| Capital activo | $300 (configurado, no movido) |

### V2 confirmado desactivado
| Métrica | Valor |
|---|---|
| `orderbook_manager_v2.enabled` | `false` |
| Verificación config.py:70 | Confirmado, V2 no se instancia |

## Validación retroactiva de la decisión de rollback

**Compara con el run de V2 (attempt #3):**
- Attempt #3: 37 segundos hasta primer error
- V2 attempt #2: 12 minutos hasta crash
- V1 baseline post-rollback: **21.3 horas SIN un solo error**

**El contraste es estructural, no estadístico.** V2 falla en bootstrap consistentemente (`T+2.7s`, `T+37s`). V1 corre indefinidamente. La diferencia no es ruido — es que V2 tiene el bug de ventana ciega de bootstrap (ver [[2026-05-31-cuarto-discovery-v2-Q1-a-Q4-desde-codigo]]) que aún no está fixeado.

**El rollback fue la decisión correcta operacionalmente:** sin capital en riesgo, sin urgencia, sin razón para mantener V2 activo con bug confirmado.

## Lo que el log NO mostró (también informativo)

`tail` de logs no devolvió líneas nuevas → consistente con **bot en modo data-capture silencioso, sin errores que loguear**.

**Esto es lo que queremos.** En V1, el bot:
- Captura snapshots REST periódicos
- Mantiene WS conectado
- Escribe a SQLite
- Solo loggea ante eventos (errores, reconexiones, alertas)

Silencio en `tail` = operación normal. NO es preocupante.

## Lo único accionable conceptual (no del runtime)

El **único pendiente** mencionable es el bug de fondo de V2 (causa identificada, fix pendiente), pero ese es trabajo de desarrollo, **NO un problema del bot que está corriendo ahora**.

Para el runtime actual: nada accionable, nada preocupante.

## Comparación de uptimes (V1 vs V2 attempts)

```
V2 attempt #1 (25-may): rollback a ~25 min  (87 errores totales)
V2 attempt #2 (27-may): rollback a ~12 min  (4 ERROR + 1 CRITICAL)
V2 attempt #3 (30-may): rollback a ~6 min   (1 OrderbookDesyncError + cascada)
V1 baseline (post-30-may): 21.3h y sigue   (0 errores)
```

**V1 lleva más tiempo corriendo limpio que la suma de las 3 ventanas V2 combinadas.**

## Significado para la disciplina

La decisión de rollback del 30-may a T+37s sin esperar línea defensiva T+30min se validó **retroactivamente** por esta operación limpia. Si hubiera "esperado a ver si se estabilizaba":
- Errores acumulados habrían crecido
- Recovery no convergió → V2 hubiera quedado colgado
- Posiblemente hubiera requerido reinicio forzado del container
- Riesgo de pérdida de captura de datos REST también

**Rollback rápido + V1 sano = 21h de captura sin pérdida.** Esa es la métrica que importa.

## Próximas verificaciones (recomendadas, sin urgencia)

- **Diaria:** `/status` check rápido para confirmar baseline (5 seg)
- **Semanal:** comparar throughput acumulado vs baseline histórico
- **Cuando se retome V2:** este número (21.3h sin errores) es **la línea base contra la que comparar** cualquier mejora futura de V2

## Lo que NO se hace porque V1 está sano

❌ NO se toca configuración
❌ NO se hacen experimentos
❌ NO se activa V2 sin Part A aclarada + Part B implementada
❌ NO hay urgencia operativa

✅ V1 sigue corriendo
✅ Cuando se quiera trabajar en V2: con disciplina, en sesión separada

## Links
- [[incidente-v2-attempt-3-2026-05-30-causa-capturada]] — rollback que generó este baseline
- [[2026-05-31-sesion-31may-cuarto-discovery-correccion-y-misterio-part-a]] — sesión donde se hizo este check
- [[fix-v1-watchdog-21fe6fd-validado-produccion]] — watchdog que protege este baseline
- [[2026-05-31-cuarto-discovery-v2-Q1-a-Q4-desde-codigo]] — bug de V2 que esta corrida valida indirectamente
- [[kalshi-bot]]
