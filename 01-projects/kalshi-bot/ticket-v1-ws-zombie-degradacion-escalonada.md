---
fecha: 2026-05-28
tipo: ticket
severidad: alta
urgencia: post-mortem
proyecto: kalshi-bot
componente: V1-WS-feed
estado: investigacion-pendiente
relacion: leccion-7
tags:
  - ticket
  - bug
  - kalshi-bot
  - v1
  - ws-zombie
---

# TICKET V1-CRÍTICO — WS feed degradación escalonada ~3h (28-may)

**Severidad:** Alta (post-mortem — incidente cerrado, V1 sano al cierre)
**Urgencia:** No urgente (V1 sano ahora, sin capital, motores OFF)
**Estado:** Investigación pendiente (discovery read-only no iniciado)
**Detectado:** 2026-05-28, vía `last_error = "WS zombie: no messages for 1475s"` @ 08:59:59 UTC

## Resumen

WS feed (`orderbook_events`) sufrió **degradación escalonada de ~3 horas** mientras `ws_connected=True` todo el tiempo. El detector zombie solo capturó los últimos ~24 min de un incidente mucho más largo. Recovery a las 09:00 UTC, completo en términos prácticos (slots 13-16 UTC del 28 dentro de la mediana del baseline de 11 días).

## Evidencia — throughput `orderbook_events` por hora (28-may UTC)

```
04h: 13.470  (OK)
05h:  6.275  (caída -50%)
06h:  7.018  (degradado)
07h:    454  (blackout -98%)
08h:      9  (blackout total)
09h:  7.576  (recovery, burst de catch-up: 115/309/79/238/116 por minuto)
10h+: 7k-13k (normalizado)
```

## Confirmado NO valle de mercado

Comparación 05-08 UTC × 4 días:

| Día | 05h | 06h | 07h | 08h |
|---|---|---|---|---|
| 25-may | 12.306 | 25.556 | 14.484 | 9.328 |
| 26-may | 14.277 | 16.967 | 20.834 | 15.626 |
| 27-may | 26.711 | 18.424 | 22.053 | 14.735 |
| **28-may** | **6.275** | **7.018** | **454** | **9** |

**Refutada empíricamente** la hipótesis de curva diaria / valle de mercado US-Eastern. Los tres días previos tuvieron 12k-27k/h en esa franja. Solo el 28 colapsó.

## Forma de la curva: ESCALONADA, no binaria

Caída progresiva 13k → 6k → 7k → 454 → 9, no un cliff. Sugiere **degradación acumulativa**, no muerte súbita de conexión. Esta es la firma clave que el discovery tiene que explicar.

## Veredicto del estado actual (Mundo 1)

Mediana del baseline de 11 días (05-17 → 05-27) vs slots de hoy:

| Hora UTC | Baseline media | Min–Max | Hoy 28-may | Posición |
|---|---|---|---|---|
| 13 | ~14.197 | 5.196–21.922 | 9.968 | dentro del rango (p≈25-30) |
| 14 | ~13.024 | 5.686–23.052 | 13.337 | mediana exacta |
| 15 | ~16.107 | 4.832–24.751 | 13.361 | levemente bajo, dentro del rango |
| 16 | ~14.585 | 5.730–29.043 | 5.967 parcial (~17k extrapolado) | alineado |

**V1 está sano AHORA.** Incidente cerrado, no quedó degradación persistente.

## Preguntas abiertas para discovery (`kalshi_ws.py` + `monitoring/`)

1. **¿Qué reanudó el feed a las 09:00?** Hipótesis a contrastar: (a) reconexión natural Kalshi, (b) detector forzó algo no instrumentado, (c) TCP nunca murió y Kalshi resumió desde el lado del feed.

2. **¿Por qué la caída es escalonada y no binaria?** Hipótesis a contrastar:
   - Resubscribe parcial progresivo (tickers cayéndose uno a uno)
   - Rate limiting creciente del lado Kalshi
   - Memory leak / backpressure acumulándose en dispatcher
   - Reconexiones repetidas con menos tickers cada vez

3. **¿Por qué el detector setea `last_error` pero NO escala a `risk_events`, NO alerta Telegram, NO fuerza reconexión?** Regresión de defensa de Lección 7.

4. **¿Por qué el detector subdetecta?** Capturó 24min de un incidente de 3h. Threshold mal calibrado o chequea el canal equivocado.

5. **¿El 18-may tuvo un microblackout no detectado?** Slots 13h=5.196, 15h=4.832 — anómalamente bajos vs baseline. Investigar si fue incidente silencioso o día genuinamente tranquilo. **NO asumir que fue normal.**

## Diagnóstico de las capas que fallaron (preliminar, validar en discovery)

**Watchdog ciego al WS (`watchdog.py`):**
`CaptureWatchdog` monitorea solo `BotState.capture_running`. El bucle REST de `market_snapshots` siguió ejecutándose y manteniendo la flag en True. El watchdog asumió que todo el sistema estaba sano. **Es ciego al WebSocket por diseño actual.**

**La trampa de `BotState.ws_connected` (`kalshi_ws.py`):**
El atributo se establece en True al entrar al contexto de `websockets.connect` y solo cambia a False en el `finally` si el contexto se rompe. El socket nunca arrojó excepción de desconexión TCP ni timeout a nivel de protocolo (Kalshi seguía respondiendo a pings de bajo nivel, o el `async for raw in ws:` se quedó colgado sin liberar). El `finally` nunca se ejecutó. Para el runner interno, la conexión seguía "viva".

**Inacción en `/status` (`health.py`):**
El endpoint calcula pasivamente `ws_connected` evaluando si `last_ws_message` ocurrió hace menos de 60 segundos. Ayer esa métrica computó como False y `last_error` se pobló. **Pero ningún componente activo del bot lee o reacciona al estado expuesto en el servidor de salud.** Es un dashboard puramente informativo para el ojo humano.

## Self-healing fortuito (no es self-healing del bot)

El feed retomó a las 09:00 por su cuenta. Hipótesis más probable: reconexión natural por keepalive de Kalshi o reseteo de red del proxy de Kalshi que forzó el flush acumulado.

**Conclusión:** no hubo self-healing del bot, estuvimos desprotegidos. El recovery fue azar del lado del feed.

## `last_error` sticky (deuda secundaria)

`last_error` no tiene TTL de auto-clear. Un error de hace 7h queda colgado en `/status`, puede enmascarar uno nuevo si el operador no lee el timestamp.

## Decoupling de capas (dato diagnóstico clave)

`market_snapshots` (probablemente vía REST/polling) siguió activo durante el blackout del WS. Eso explica por qué el bot "parecía sano" mirando solo cobertura horaria.

**Cualquier estrategia que dependa del WS feed (todas las basadas en deltas) habría operado a ciegas durante 24 min — o más realísticamente, durante 3 horas considerando la degradación escalonada.**

## Relación con Lección 7

Esto es **regresión parcial** de la defensa post-blackout de 11h (mayo 13-14). La decisión derivada de Lección 7 decía:
- "`ws_connected` refleja estado real validado por heartbeat"
- "N fallos consecutivos ≥5 → Telegram obligatorio"

**Ninguna de las dos se cumplió hoy.** Verificar si la defensa se implementó incompleta o regresó.

Esta lección, cuando se cierre el discovery, será **Lección 10**, separada de la 9 (que es V2). Son frentes técnicos distintos. Ver [[leccion-10-ws-zombie-pendiente-discovery]].

## NO incluir todavía en el ticket

**Detector de throughput-drop:** buena idea en concepto, pero requiere baseline por-hora (la varianza histórica es 4.832-24.751 en la misma franja). Un threshold absoluto generaría falsos positivos constantes (e.g., el 18-may con 4.832 a las 15h). **Es diseño, no spec.** Diferir hasta entender la curva real del feed.

## Logs disponibles para el discovery

- Producción: logs de Coolify del container, persistidos mientras el container viva
- Archivo derivado del rollback V2 attempt #2 (no aplica a este ticket pero sí al frente V2)
- `bot_runs` table tiene `id=32` actual con `crash_reason=None` y `started_at=2026-05-27 15:48:58 UTC`
- DB `orderbook_events` y `market_snapshots` accesibles para queries adicionales

## Orden de operaciones (cuando se retome, descansado)

1. Discovery read-only de `src/clients/kalshi_ws.py` — buscar loop de `recv()` y manejo de timeouts/keepalive. Probablemente falta `asyncio.wait_for(...)` con timeout que propague TimeoutError al supervisor, o keepalive (ping/pong) no está configurado.
2. Discovery read-only de `src/monitoring/` — entender el detector de zombie: por qué solo setea `last_error` y no fuerza reconexión ni inserta en `risk_events`.
3. Buscar si hay supervisor/watchdog que debería detectar `last_error` y actuar — y si existe, por qué no actuó.
4. Investigar 18-may: query por hora del día completo para detectar si hubo otro blackout silencioso.
5. Diseñar fix (NO antes de cerrar 1-4).
6. Validar fix offline.
7. Desplegar en otra ventana con calma.

## Restricciones operativas

- ❌ NO tocar producción hoy
- ❌ NO leer código de concurrencia/async cansado
- ❌ NO redactar el fix antes de cerrar discovery
- ❌ NO escribir Lección 10 antes del discovery (ver [[leccion-10-ws-zombie-pendiente-discovery]])
- ✅ El ticket está capturado, evidencia preservada, mañana se sigue con cabeza fresca

## Links
- [[sesion-2026-05-28-leccion-9-corregida-y-ws-zombie]] — sesión donde se detectó
- [[leccion-10-ws-zombie-pendiente-discovery]] — Lesson stub (post-discovery)
- [[leccion-9-FINAL-causa-raiz-pendiente]] — Lección 9 (incidente distinto, V2)
- [[kalshi-bot]] — proyecto raíz
- Lección 7 (referencia, en `KALSHI_BOT_CONTEXT.md`): WS muerto silenciosamente con bot "healthy" — 11h de blackout — patrón que reaparece parcialmente aquí
