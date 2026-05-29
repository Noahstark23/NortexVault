---
fecha: 2026-05-29
tipo: leccion
proyecto: kalshi-bot
numero: 10
estado: redactada-pendiente-commit-repo
target: KALSHI_BOT_CONTEXT.md v1.6
commit-relacionado: 21fe6fd
tags:
  - leccion
  - kalshi-bot
  - ws-zombie
  - regresion-leccion-7
  - final
---

# Lección 10 FINAL — WS zombie: silencio aplicativo con TCP vivo, regresión silenciosa de Lección 7

> Lesson redactada con causa cerrada y fix validado en producción. Lista para mergear al `KALSHI_BOT_CONTEXT.md` v1.6. Reemplaza el stub [[leccion-10-ws-zombie-pendiente-discovery]].

---

## Estado de causa raíz: VALIDADA — silencio aplicativo de feed externo con TCP vivo, sin detector de aplicación en V1

A diferencia de Lección 9 (causa raíz pendiente), esta lección tiene causa cerrada con evidencia de código + 7h de validación en producción del fix.

---

## Texto canónico para `KALSHI_BOT_CONTEXT.md` v1.6

### Lección 10 (Mayo 28-29, 2026): WS zombie — silencio aplicativo con TCP vivo, regresión parcial de Lección 7

**Contexto:** Día 28-may, status check revela `last_error="WS zombie: connected but no messages for 1475s"` con timestamp 08:59:59 UTC. Investigación con queries empíricas revela **blackout escalonado de ~3h** (05:00-09:00 UTC) en `orderbook_events`. Caída progresiva: 13k → 6k → 7k → 454 → 9 eventos/hora. Recovery súbito a las 09:00 con burst de catch-up. `ws_connected=True` durante todo el blackout. `bot_runs.crash_reason=None`, sin reinicios.

**Causa raíz técnica (validada por discovery read-only del código):**

1. **No hay detección de silencio aplicativo con TCP vivo.** El loop `async for raw in ws:` en `kalshi_ws.py` espera indefinidamente. El ping/pong configurado (`ping_interval=20`, `ping_timeout=10`) verifica conectividad TCP pero NO silencio de mensajes de aplicación. Si Kalshi mantiene el TCP vivo (responde pings) pero deja de enviar `orderbook_events`, el loop queda bloqueado en `recv()` para siempre.

2. **El zombie detector existía pero NO actuaba.** `_check_ws_health` en `data_capture.py` solo seteaba `BotState.record_error("WS zombie: ...")` y nada más. Sin llamada a `force_reconnect`, sin alerta Telegram, sin escritura a `risk_events`. **Era un dashboard sin actuador.**

3. **`last_error` sticky sin TTL.** Un error de hace 7h queda colgado en `/status`, puede enmascarar uno nuevo. Sin auto-clear ni stickiness explícita.

4. **Dos señales `ws_connected` inconsistentes:**
   - **Señal A** (`BotState.ws_connected`): se setea True al entrar al contexto `websockets.connect`, solo cambia a False en `finally`. **Refleja estado TCP puro.** Mintió durante todo el blackout.
   - **Señal B** (`/status`): calcula `ws_connected` evaluando si `last_ws_message` <60s. Esta SÍ validaba por mensaje pero es passive metric. **Ningún componente activo del bot la lee.**
   - El `/health` que Coolify lee usa la Señal A con threshold 300s. **Mirando Coolify health, el operador veía verde durante el blackout.**

**Causa raíz arquitectónica (validada):**

**El bot tiene múltiples capas que deberían haber actuado y ninguna actuó:**
- **Watchdog** (`watchdog.py`): ciego al WS por diseño. Solo monitorea `BotState.capture_running`. El bucle REST de `market_snapshots` mantuvo la flag en True durante el blackout.
- **`BotState.ws_connected`**: trampa estructural. Reflejaba estado TCP, no de mensajes.
- **`/status` endpoint**: dashboard sin actuador. Nadie lo consume.
- **Detector zombie**: marca `last_error`, nada más.

**Esto es regresión PARCIAL de Lección 7** (post-blackout de 11h del 13-14 may). La decisión derivada de Lección 7 decía:
- "`ws_connected` refleja estado real validado por heartbeat" → implementado en Señal B (`/status`), pero no en Señal A (`BotState.ws_connected`)
- "N fallos consecutivos ≥5 → Telegram obligatorio" → implementado solo en el path de reconexión por `ConnectionClosed`/`Exception`. Con TCP vivo, `consecutive_failures` nunca incrementa.

**La defensa de Lección 7 dejó un hueco exacto del tamaño de este incidente.**

**Causa de la degradación escalonada (probablemente externa, NO se descarta interna):**

Discovery refutó en código las 4 hipótesis internas (resubscribe parcial, rate limiting WS, backpressure dispatcher, reconexiones con menos tickers). **El código del bot no tiene mecanismo interno que produzca degradación gradual de throughput.** Esto es consistente con causa externa (Kalshi reduciendo entrega progresivamente).

**PERO:** "REST estable durante blackout WS" NO discrimina causa externa vs starvation interna sin saber arquitectura. La query REST por minuto se evaluó como NO probatoria sin verificar primero si REST y WS comparten event loop / path de escritura. **Por ese motivo NO se firma "causa externa" como conclusión cerrada** — se trata como hipótesis dominante consistente con la evidencia, no como verdad probada.

**Decisiones derivadas:**

1. **Detección de silencio aplicativo es obligatoria cuando se tiene un loop sin timeout.** El ping/pong de la librería WS protege la conexión TCP, no la entrega de mensajes. Cualquier loop `async for ws:` que dependa solo de eso para integridad es estructuralmente vulnerable.

2. **Métricas calculadas que nadie consume son anti-patrón.** `/status` mostraba la Señal B correcta, pero ningún componente activo la leía. Una métrica sin actuador es un dashboard, no una defensa.

3. **Defensas de lecciones anteriores deben validarse cuando se agrega código nuevo.** Lección 7 estableció "ws_connected reflejado por heartbeat" pero la Señal A (que es la que más componentes leen) no se actualizó. Las refactorizaciones posteriores rompieron silenciosamente la defensa.

4. **`last_error` debe tener TTL o stickiness explícita.** Un campo sin política de expiración termina sirviendo a quien lo escribe, no a quien lo lee.

5. **Atribución externa requiere refutar hipótesis internas con discovery arquitectónico, no solo de mecanismos.** El discovery refutó las 4 hipótesis internas conocidas. Para firmar "es Kalshi" hace falta también verificar que el REST y el WS están acoplados (comparten loop/path). Sin eso, "REST estable" no prueba externa, solo prueba "no es starvation que afecte ambos".

**Anti-patrones confirmados:**

- **"Dashboard sin actuador"** — métricas que se calculan pero nadie consume. `/status` tenía `ws_connected` message-based correcto pero ningún componente del bot lo usaba para tomar decisiones.
- **"Defensa de lección previa que regresó silenciosamente"** — Lección 7 implementada incompleta (Señal A no se actualizó), refactor posterior dejó intacta la trampa.
- **"Decoupling que oculta fallas"** — capa REST siguió trabajando, hizo parecer al bot sano (`/health` de Coolify verde durante el blackout).
- **"Atribución externa por eliminación de hipótesis internas"** — descartar 4 hipótesis internas conocidas NO prueba causa externa, solo prueba que no es ninguna de esas 4.

**Lo que sí funcionó (preservar):**

1. **Operador humano detectó el incidente al revisar `/status` el día siguiente.** Sin esa revisión rutinaria, el zombie habría quedado oculto indefinidamente.
2. **Backup vía `market_snapshots` (REST polling) mantuvo cobertura horaria.** Mitigación parcial — no perdimos datos completamente, perdimos resolución de deltas.
3. **`bot_runs.crash_reason=None`** — el bot no crasheó, lo cual permitió el discovery posterior sin perder contexto.
4. **Comparación con baseline 11 días desambiguó "Mundo 1 vs Mundo 2".** Las queries permitieron decidir si V1 seguía degradado o ya estaba sano.

**Fix implementado y validado (commit `21fe6fd`, mergeado 29-may):**

1. **`force_reconnect()`**: cierra socket sin tocar `_running`. Loop exterior interpreta como reconexión, no shutdown. Probado con test de integración real.
2. **Watchdog dispara `force_reconnect()` cuando silence > 300s.** Antes: solo `record_error`. Ahora: incrementa contador zombie + `record_error` + `force_reconnect` + alerta Telegram si persiste (threshold=2 detecciones).
3. **`LAST_ERROR_TTL_SEC = 900.0`** + `current_error()` que expira/limpia. `/status` ahora usa `current_error()`.

**Validación en producción:**
- 7h 14min sin un solo hueco (435/435 minutos con data)
- Cero `force_reconnect` espurios
- Cero detecciones zombie
- Throughput dentro del baseline sano (5k-56k/h, varianza diaria normal)
- Hora 08h hoy: 6.831 eventos (mismo valor que destruyó el 28-may) → **valle natural seguido de pico 09h (37k) y 10h (56k)**. Misma cifra, significados opuestos — discriminados ahora por el sistema de monitoreo, no por suerte.

**Pendiente (no bloqueante):**
- Latencia de detección: ~10-15 min worst case (watchdog corre cada 5 min, threshold 300s, alerta tras 2 detecciones). Aceptable para Fase 1; mejorable ajustando intervalos.
- Fase 2 del watchdog: detector de tasa con baseline por hora. NO urgente porque Fase 1 da auto-recuperación.
- Unificación de las dos señales `ws_connected` (consolidar Señal A a comportamiento de Señal B).
- Test de causa externa vs starvation interna con query REST + lectura de handlers (sigue abierta como cuestión técnica para futura referencia).

---

## Header del archivo a actualizar (v1.6)

```markdown
**Versión:** 1.6
**Última actualización:** Mayo 29, 2026

**Cambios v1.5 → v1.6 (2026-05-29):**
- **Lección 10 NUEVA:** WS zombie — silencio aplicativo con TCP vivo, regresión parcial
  de Lección 7. Fix `21fe6fd` validado 7h en producción.
- Fix V1 watchdog mergeado: `force_reconnect()` + watchdog reactor + alerta Telegram
  + TTL en `last_error`.
- Sección 11: deuda técnica viva — V2 sigue no apto para producción (H1 size=0 refutada
  en tercer discovery, ver nota al final de Lección 9).
- Sección 12.5 sin cambios.
```

---

## Diferencia con el stub previo

El stub [[leccion-10-ws-zombie-pendiente-discovery]] enumeraba hipótesis y preguntas. **Esta versión final tiene causa validada por discovery de código + fix implementado + validación en producción.**

El stub queda como **historia del razonamiento** — útil para ver cómo se evolucionó desde "tengo un síntoma" hasta "tengo causa cerrada y fix validado".

## Lo que NO incluye esta lección

- **Detector de tasa con baseline por hora** (Fase 2 del watchdog) — diseño pendiente, NO en esta lección.
- **Discriminación definitiva causa externa vs starvation interna** — sigue abierta como cuestión técnica. Documentada como decisión derivada #5.

## Links
- [[fix-v1-watchdog-21fe6fd-validado-produccion]] — implementación + validación
- [[ticket-v1-ws-zombie-degradacion-escalonada]] — ticket original
- [[sesion-2026-05-28-leccion-9-corregida-y-ws-zombie]] — descubrimiento
- [[sesion-2026-05-29-fix-v1-mergeado-y-tercer-discovery-v2]] — sesión de cierre
- [[leccion-10-ws-zombie-pendiente-discovery]] — stub original (historia)
- [[leccion-9-FINAL-causa-raiz-pendiente]] — lección hermana (V2, causa abierta)
- [[kalshi-bot]]
- Lección 7 en `KALSHI_BOT_CONTEXT.md` (precedente que regresó parcialmente)
