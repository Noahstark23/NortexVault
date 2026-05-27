---
fecha: 2026-05-27
tipo: ejecucion-runbook
proyecto: kalshi-bot
referencia: runbook-12.5-pre-flight
estado: completo-pendiente-confirmacion-cliente
hora-ejecucion: 14:58 UTC
tags:
  - pre-flight
  - kalshi-bot
  - segunda-ventana
---

# Pre-flight checklist 2026-05-27 14:58 UTC — Segunda ventana V2

> Ejecución del pre-flight del runbook 12.5 antes de la segunda ventana de activación de V2. Ejecutado vía Claude Code en container Coolify.

## Resultado consolidado

| Gate | Estado | Detalle |
|---|---|---|
| Backup SQLite + integrity_check | ✅ | 619 MB persistidos, `('ok',)` |
| Telegram API funcional | ✅ | `send_alert returned: True` |
| **Recepción Telegram en cliente** | ⏳ | **GATE BLOQUEANTE — pendiente confirmación de Noel** |
| WS conectado y capturando | ✅ | `ws_connected=True`, 38 markets |
| Trading & motores OFF | ✅ | 3 motors False, `trading_enabled=False` |
| V2 actualmente OFF | ✅ | `orderbook_manager_v2.enabled=False` |
| Lección 9 mergeada al repo | ⏳ | SHA pendiente confirmación |

## Detalle por paso

### ✅ Paso 1 — Backup SQLite + integrity_check

```bash
docker exec kalshi-bot sqlite3 /app/data/trades.db \
  ".backup /app/data/trades_backup_$(date +%Y%m%d_%H%M%S).db"
```

**Resultado:**
```
Source:  data/trades.db
Dest:    data/trades_backup_20260527_145602.db
Size:    649,498,624 bytes (619.4 MB)
Time:    6.39 s
```

**Integrity check:**
```bash
docker exec kalshi-bot sqlite3 /app/data/trades_backup_*.db \
  "PRAGMA integrity_check;"
```

**Resultado:** `('ok',)` — backup íntegro persistido en `/app/data/trades_backup_20260527_145602.db` dentro del container.

### ⚠️→✅ Paso 2 — Test Telegram (con desviación documentada)

**Desviación importante del cheatsheet original:**
- Cheatsheet decía: `alert_info(...)`
- Esa función **NO EXISTE** en `src/monitoring/telegram_alerts.py`
- Funciones disponibles en el módulo real:
  ```python
  ['alert_error', 'alert_orderbook_anomaly', 'alert_risk_event',
   'alert_shutdown', 'alert_startup', 'send_alert']
  ```

**Sustitución correcta:**
```python
send_alert(message: str, *, urgent: bool = False) -> bool
```
(API genérica del módulo real)

**Comando ejecutado:**
```bash
docker exec kalshi-bot python3 -c "
import asyncio
from src.monitoring.telegram_alerts import send_alert
asyncio.run(send_alert(
  '[PRE-FLIGHT 2026-05-27 14:56 UTC] Test de conectividad Telegram — V2 Activation. '
  'Si recibis esto, el canal funciona. Bot sigue en V1, sin trading.'
))
"
```

**Resultado del envío:** `send_alert returned: True` — Telegram API aceptó el request.

**⚠️ Gate pendiente:** confirmación de RECEPCIÓN en cliente. El bot solo sabe que la API respondió 200, NO si llegó al teléfono del usuario.

### ✅ Paso 3 — Endpoint /status (puerto 8080 local)

```bash
docker exec kalshi-bot curl -s http://localhost:8080/status | python -m json.tool
```

**Output filtrado:**
```
bot.capture_running                          = True
bot.ws_connected                             = True
bot.last_ws_message                          = 2026-05-27T14:58:27 UTC (live)
bot.tracked_markets                          = 38
config.trading_enabled                       = False
config.motors_enabled.motor_1_arbitrage      = False
config.motors_enabled.motor_2_sportsbook     = False
config.motors_enabled.motor_3_clv            = False
orderbook_manager_v2.enabled                 = False
```

**Lectura:**
- WS vivo y capturando
- 38 mercados trackeados (vs 39 ayer, vs 40 hace 3 días — tendencia documentada)
- Todos los motores y trading OFF (consistente con post-rollback)
- V2 OFF (lo que vamos a flippear)

## Drift documentado del cheatsheet (actualización pendiente)

**Update al cheatsheet master:** sustituir referencia a `alert_info` por `send_alert`. Ya aplicado en [[cheatsheet-runbook-12.5-v2-activacion]] de esta sesión.

**Origen del drift:** probablemente el cheatsheet se redactó asumiendo API stdlib-like (info/warn/error como métodos), pero el proyecto factorizó sus alerts por severidad/tipo (`alert_error`, `alert_orderbook_anomaly`, etc.) y dejó `send_alert` como genérico. Worth notar para futuros runbooks.

**Acción derivada:** revisar otros comandos del cheatsheet que referencien APIs del proyecto antes de la próxima ventana. Drift menor pero acumulable.

## Comparación con pre-flight del 25-may (primera ventana)

| Item | 25-may | 27-may |
|---|---|---|
| Backup | `cp` (inseguro con writers) → corregido in-flight a `.backup` | `.backup` desde el inicio ✓ |
| Telegram test | No ejecutado pre-flight | Ejecutado ✓ |
| /status verificado | Ejecutado | Ejecutado ✓ |
| Documentación pre-vuelo | Plan de Gemini ad-hoc | Cheatsheet operativo formal ([[cheatsheet-runbook-12.5-v2-activacion]]) |
| Lección 9 incorporada | N/A (aún no existía) | ✓ Adiciones 5.bis + log preservation |

**Lección operacional:** el pre-flight evolucionó en dos ventanas de "ad-hoc con corrección in-flight" a "checklist literal con cheatsheet versionado". Eso es lo que la disciplina del runbook produce cuando se aplica iteración tras iteración.

## Próximos pasos al cierre de este pre-flight

1. ⏳ **Noel confirma recepción Telegram en cliente** (gate bloqueante)
2. ⏳ **Noel confirma SHA de Lección 9 en main** (gate bloqueante)
3. Cuando ambos ✅ → Web Agent ejecuta secuencia de flip en Coolify
4. Monitoreo de 2-3h aplicando runbook + adiciones Lección 9

## Tickets derivados (no bloqueantes)

1. **Update cheatsheet master:** sustituir `alert_info` por `send_alert` (ya aplicado en archivo local, falta sync al repo)
2. **Audit del cheatsheet:** verificar otros comandos que referencian APIs del proyecto
3. **Ticker count drift:** investigar por qué se perdió 1 ticker más (40→39→38) en 3 días sin reemplazo. Confirmar empíricamente que market selector rota mercados nuevos
4. **DB en 647 MB:** crecimiento consistente con ~250 MB/día observado. Política de retención + VACUUM mensual sigue pendiente

## Links
- [[decision-2026-05-27-activar-v2-segunda-ventana]] — decisión que motiva este pre-flight
- [[cheatsheet-runbook-12.5-v2-activacion]] — runbook que se está siguiendo
- [[sesion-2026-05-27-segunda-ventana-v2-preflight]] — sesión completa
- [[fix-v2-opcion-a-implementado-commits]] — fix que se está validando
- [[kalshi-bot]]
