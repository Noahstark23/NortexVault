---
fecha: 2026-05-27
tipo: runbook-cheatsheet
proyecto: kalshi-bot
referencia: KALSHI_BOT_CONTEXT.md §12.5
version: 1.1 (incluye adiciones Lección 9)
tags:
  - runbook
  - cheatsheet
  - operativo
  - kalshi-bot
  - reusable
---

# Cheat-sheet operativo — Activación V2 (Runbook 12.5)

> Documento de referencia para ventanas de activación de `OrderbookManagerV2`. Extraído del runbook 12.5 + 2 adiciones empíricas validadas por Lección 9. **Mantener abierto en otro monitor durante toda la ventana.**

---

## 1. PRE-FLIGHT CHECKLIST (antes de tocar Coolify)

- [ ] Bot healthy en `/status` por >1h: `capture_running=true`, `ws_connected=true`, `tracked_markets>=35`, `last_error=null`
- [ ] Bloque de 2-3h continuas confirmadas para supervisión activa
- [ ] Telegram receiver verificado: enviar mensaje manual y confirmar que llega al cliente (no solo que la API devolvió 200)
- [ ] Backup de SQLite manual ejecutado con `.backup` (NO `cp`), integrity_check OK
- [ ] Lección 9 mergeada al `KALSHI_BOT_CONTEXT.md` v1.5 (no activar con documentación desincronizada)

### Comandos pre-flight (ejecutar en Coolify terminal)

**Backup + integrity check:**
```bash
docker exec kalshi-bot sqlite3 /app/data/trades.db \
  ".backup /app/data/trades_backup_$(date +%Y%m%d_%H%M%S).db"

docker exec kalshi-bot sqlite3 /app/data/trades_backup_*.db \
  "PRAGMA integrity_check;"
# Debe retornar 'ok'
```

**Telegram test (usa send_alert, NO alert_info):**
```bash
docker exec kalshi-bot python3 -c "
import asyncio
from src.monitoring.telegram_alerts import send_alert
asyncio.run(send_alert('[PRE-FLIGHT] Test conectividad - V2 Activation'))
"
# send_alert returned: True == API OK
# CONFIRMAR RECEPCIÓN EN CLIENTE antes de proseguir
```

**Status local:**
```bash
docker exec kalshi-bot curl -s http://localhost:8080/status | python -m json.tool
# Verificar: capture_running, ws_connected, tracked_markets, last_error
```

---

## 2. ACTIVACIÓN

1. Coolify → Configuration → Environment Variables
2. Setear `USE_ORDERBOOK_MANAGER_V2=true`
3. **VERIFICAR ANTES DE SAVE:** `MOTOR_1_ARBITRAGE_ENABLED=false` y `TRADING_ENABLED=false`
4. Save changes
5. Redeploy (~2 min build time)
6. Abrir logs en vivo y esperar el mensaje exacto:
   ```
   OrderbookManagerV2 registered (data-capture only, no Motor 1)
   ```

---

## 3. GREP PATTERNS (copia y pega durante monitoreo)

```bash
grep "OrderbookManagerV2"
grep "SidGapError"
grep "recovery"
grep -i "error\|critical\|exception"
grep "Snapshots:"
grep "qty.*-"          # detecta qty negativas (bug del 25-may)
grep "V2 snapshot:"    # log INFO del raw snapshot logging (fix ed7b7ac)
```

---

## 4. CRITERIOS DE ÉXITO (todos en T+2h)

- [ ] Cero ERROR nuevos relacionados a orderbook/manager/V2
- [ ] Rate de `SidGapError` sostenido < 5/min (mediana, ignorar picos puntuales)
- [ ] `data_capture._take_snapshots` completando N/N cada ~5 min (donde N = tracked_markets)
- [ ] `/status` muestra `books_initialized` subiendo hacia N (= tracked_markets)
- [ ] `sids_recovering=0` o tendencia a bajar
- [ ] `gaps_last_60s=0` o muy bajo

---

## 5. CRITERIOS DE ROLLBACK INMEDIATO (cualquiera dispara)

- [ ] >3 errores **NO** relacionados a SidGapError en 10 min
- [ ] Rate de `SidGapError` sostenido >20/min por más de 5 min
- [ ] `tracked_markets` cae por debajo de 35
- [ ] `/status` devuelve `capture_running=false` o `ws_connected=false` por >60s
- [ ] Cualquier log CRITICAL o excepción nueva en el sistema

---

## 5.bis LÍNEA DEFENSIVA T+5 a T+30min (adición Lección 9)

- **Entre T+5 y T+30 post-activación: 1 solo error no-SidGap adicional → rollback inmediato.**
- Esto es MÁS estricto que el runbook base. Se aplica porque el incidente del 25-may probó que las ráfagas reaparecen en este window.
- **Justificación:** el incidente del 25-may tuvo ráfaga 1 a T+5min y ráfaga 2 a T+15min. Sin esta línea defensiva el rollback habría llegado horas más tarde con datos mucho peores.
- **No es opcional.** No "esperar a ver si se repite" — el segundo error confirma que no fue aislado.

---

## 6. PROCEDIMIENTO DE ROLLBACK (target end-to-end <5 min)

1. Coolify → Environment Variables → `USE_ORDERBOOK_MANAGER_V2=false`
2. Redeploy
3. Verificar en logs que NO aparezca el mensaje de registro de V2
4. Confirmar `/status` vuelve al baseline (`orderbook_manager_v2: {enabled: false}`)
5. **Cronómetro:** arrancar conteo desde la decisión de rollback. Target end-to-end < 5min

### PRE-DEBUG (antes de cualquier análisis post-rollback)

```bash
docker logs kalshi-bot --tail 1000 > /tmp/rollback_$(date +%Y%m%d_%H%M%S).log
```

Preservar logs en archivo antes de que el buffer de Coolify trunque. Aprendizaje del 25-may: durante incidente largo, los buffers pueden perder los primeros minutos que son los más importantes para diagnóstico.

---

## Notas operativas (Lección 9)

**Patrón a evitar:** "Interpretar criterios de runbook con discreción en mitad del incidente."
Si un criterio numérico se cumple → rollback. Las interpretaciones clementes ("ráfaga aislada de bootstrap", "errores capturados no crashes", "mensaje específico no genérico") son ad-hoc fuera del runbook y NO cuentan.

**Patrón a evitar:** "El feed/exchange tiene la culpa."
Atribución externa requiere refutar primero las hipótesis internas con discovery dirigido. Validar antes de creer.

**Quién decide:** el operador humano del runbook. Reports de agentes ("todos los criterios en VERDE") deben cross-checkearse contra el runbook literal antes de creer.

---

## Métrica de éxito específica (más allá del runbook base)

**No solo "no falla" sino "no falla por la razón que arreglamos".**

Si vuelven a aparecer errores `delta produces qty<0` con magnitudes similares al incidente del 25-may → H1 (bug `size=0` filter) NO era el único bug. Reabrir investigación con el raw snapshot logging que el fix `ed7b7ac` instaló (líneas 343-348 de `orderbook_manager_v2.py`).

---

## Drift conocido del cheat-sheet

**`alert_info` no existe.** El módulo `src/monitoring/telegram_alerts.py` expone:
- `send_alert(message, *, urgent=False) -> bool` (API genérica)
- `alert_error`, `alert_orderbook_anomaly`, `alert_risk_event`, `alert_shutdown`, `alert_startup`

Usar `send_alert` para tests de pre-flight, NO `alert_info`.

---

## Links
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — incidente que validó este runbook
- [[leccion-9-canonica-kalshi-bot-context-md]] — lección que generó las adiciones 5.bis y log preservation
- [[inspeccion-apply-snapshot-msg-paths-excepcion]] — validación técnica que sustenta confianza en el fix
- [[decision-2026-05-27-activar-v2-segunda-ventana]] — primera ventana donde se usa esta versión
- [[kalshi-bot]] — proyecto raíz
- Runbook 12.5 fuente: `KALSHI_BOT_CONTEXT.md` v1.5 del repo
