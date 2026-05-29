---
fecha: 2026-05-28
tipo: leccion
proyecto: kalshi-bot
numero: 10
estado: SUPERADO-ver-version-FINAL
reemplazado-por: leccion-10-FINAL-ws-zombie-con-fix-validado
tags:
  - leccion
  - kalshi-bot
  - ws-zombie
  - stub
  - superado
---

# ⚠️ STUB SUPERADO — Lección 10 borrador del 28-may

> **ESTE ARCHIVO ES STUB ORIGINAL. Versión FINAL en [[leccion-10-FINAL-ws-zombie-con-fix-validado]].**
>
> Se mantiene como **historia del razonamiento** — útil para ver cómo evolucionó desde "tengo un síntoma" hasta "tengo causa cerrada y fix validado en producción".
>
> Diferencia con la final: la final tiene causa raíz cerrada (silencio aplicativo con TCP vivo), fix `21fe6fd` implementado, **7h 14min de validación en producción**, y texto listo para mergear al `KALSHI_BOT_CONTEXT.md` v1.6.

---

## Stub original — preservado para referencia

> Lo que sigue es el stub redactado el 28-may, cuando aún no había discovery ni fix. Mantenido como historia del proceso.

## Lo que ya sabemos (preservar al cerrar la lección)

**Incidente:** 2026-05-28, WS feed (V1) degradación escalonada de ~3h (05:00→09:00 UTC). El detector zombie solo capturó los últimos ~24 min. Recovery por azar del lado del feed, no por self-healing del bot. V1 sano al cierre del día.

**Datos clave para el discovery:**
- Caída ESCALONADA, no binaria: 13k → 6k → 7k → 454 → 9 → recovery
- Recovery con burst de catch-up (115/309/79/238/116 eventos/min a las 09:00)
- `ws_connected=True` durante todo el blackout (la flag mintió)
- `market_snapshots` siguió activo vía REST/polling, ocultó el blackout en cobertura horaria
- Comparación 11 días confirmó: NO es valle de mercado, ES degradación técnica
- 18-may posible microblackout silencioso similar (4.832 a las 15h vs baseline 16.107)

## Por qué es una lección distinta a la 9

- Lección 9 = V2 attempts (dormant component, in-memory state)
- Lección 10 = V1 WS feed (running component, conexión externa)
- Diagnósticos distintos, capas distintas, fixes distintos
- Mezclarlas contaminaría ambas

## Estructura propuesta (para llenar post-discovery)

**Contexto:** (chronology del incidente del 28-may, ya capturada en [[ticket-v1-ws-zombie-degradacion-escalonada]])

**Causa raíz técnica (a validar):**
- Loop `recv()` en `kalshi_ws.py` sin timeout que propague excepción al supervisor
- O keepalive (ping/pong) no configurado, dependencia del lado Kalshi
- O reconexiones progresivas con resubscribe parcial (explica la curva escalonada)
- O backpressure / memory leak acumulándose en dispatcher

**Causa raíz arquitectónica (preliminar):**
Múltiples capas que deberían haber detectado o actuado, no lo hicieron:
- Watchdog ciego al WS por diseño (solo mira `capture_running`)
- `BotState.ws_connected` no se actualiza si TCP sigue vivo pero frames mueren
- `/status` calcula passive metric pero ningún componente activo la lee
- Detector zombie marca `last_error` pero no escala a `risk_events` ni alerta

**Decisiones derivadas (a confirmar):**
1. `ws_connected` debe validarse por heartbeat de mensajes, no por estado TCP
2. Detector zombie debe forzar reconexión y alertar Telegram (cumplir Lección 7)
3. `last_error` debe tener TTL de auto-clear o stickiness explícita
4. Watchdog debe monitorear ws_message_recent además de capture_running
5. Detector de throughput-drop con baseline por-hora (NO threshold absoluto) — diseño separado

**Anti-patrones a confirmar:**
- "Dashboard sin actuador" — métricas que se calculan pero nadie consume
- "Defensa de lección previa que regresó silenciosamente" — Lección 7 implementada incompleta o re-rota por refactor posterior
- "Decoupling que oculta fallas" — capa REST sigue trabajando, hace parecer sano

**Lo que sí funcionó:**
- Detector zombie SÍ marcó `last_error` (aunque tardío)
- V1 no crasheó, sigue capturando data parcial
- Backup vía `market_snapshots` mantuvo cobertura horaria
- Operador humano detectó el incidente al revisar `/status` el día siguiente

## Restricciones para el discovery

- Read-only sobre `kalshi_ws.py`, `monitoring/`, `health.py`, `watchdog.py`
- NO modificar código
- NO escribir tests todavía
- NO diseñar fix antes de cerrar las 5 preguntas del ticket
- Logs preservados en Coolify mientras container viva

## Próximos pasos (orden)

1. **Discovery read-only** (mañana o cuando esté descansado): seguir las 5 preguntas del [[ticket-v1-ws-zombie-degradacion-escalonada]]
2. **Validar hallazgos** contra logs preservados del incidente
3. **Investigar 18-may** (posible microblackout silencioso)
4. **Diseñar fix** post-discovery (probablemente: timeout en recv, alertas Telegram, watchdog WS, TTL en last_error)
5. **Cerrar Lección 10** con causa raíz validada
6. **Validar fix offline** + segunda ventana de despliegue con runbook propio
7. **Commit Lección 10 al `KALSHI_BOT_CONTEXT.md`** v1.6

## Links
- [[ticket-v1-ws-zombie-degradacion-escalonada]] — ticket con toda la evidencia
- [[sesion-2026-05-28-leccion-9-corregida-y-ws-zombie]] — sesión donde se detectó
- [[leccion-9-FINAL-causa-raiz-pendiente]] — incidente distinto (V2)
- [[kalshi-bot]]
- Lección 7 (en `KALSHI_BOT_CONTEXT.md`): defensa original que regresó parcialmente
