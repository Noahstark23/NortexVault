---
fecha: 2026-05-29
tipo: sesion-conmigo
proyecto: kalshi-bot
ia: Claude + Claude Code + Gemini (CTO)
modelo: multi-agent workflow
duracion: marathón de codificación + validación + discovery
tags:
  - sesion-conmigo
  - kalshi-bot
  - fix-v1
  - leccion-10
  - discovery-v2
  - cierre-de-frente
---

# 29-may — Fix V1 watchdog mergeado + validado 7h + tercer discovery V2

> Jornada de cierre del frente WS V1 + apertura de nuevo espacio para V2. Trabajé de noche (el bot validó solo durante 7h mientras dormía), retomé fresco a la mañana, ejecuté el tercer discovery V2 y refuté H1 con evidencia del log.

## Contexto al inicio
- Frente WS V1: ticket capturado el 28-may, discovery pendiente
- Frente V2: causa raíz NO RESUELTA en Lección 9 (SHA 3a4b384 ya en main)
- Frente Lección 10: stub esperando llenarse post-discovery

## Decisiones / conclusiones del día

### 1. Lección 9 confirmada en repo (verificación final)
Sigo preguntando por el SHA. Ya está. Verifiqué que el texto committeado en `KALSHI_BOT_CONTEXT.md` líneas 463-602 (commit `3a4b384`) es **idéntico** al borrador, con 3 diferencias cosméticas — y en 2 de ellas la versión committeada tiene MÁS detalle:

| Punto | Borrador | Repo (3a4b384) |
|---|---|---|
| "Lo que funcionó" #2 | "Capa adversarial aplicando…" | "Capa adversarial **(Claude Project)** aplicando…" |
| "Lo que funcionó" #4 | "…de \"ciego\" a \"con evidencia completa\"" | "…de \"ciego\" **(como attempt #1)** a \"con evidencia completa\"" |
| Próximo paso (última frase) | "…lo hace respondible…" | "…es suficiente para responderlo…" |

Sobrescribir = downgrade. **No tocar.** La versión committeada es la canónica.

Esto es la propia Lección 9 en acción: verificar contra la realidad antes de actuar.

### 2. Discovery V1 read-only completado (28-may noche)
Gemini ejecutó el brief del 28-may. Las 5 preguntas respondieron con código verbatim:

**Hallazgos firmes (causa del WS zombie):**
- No hay `asyncio.wait_for` con timeout en el loop `async for ws:` → silencio aplicativo no detectable
- Ping/pong (20s/10s) detecta muerte TCP pero NO silencio de mensajes con TCP vivo
- El zombie detector solo setea `last_error`, sin acción
- Las 4 hipótesis de degradación escalonada **refutadas en el código del bot**: suscripciones todo-o-nada, sin rate-limit WS, sin backpressure visible, reconexiones replayan todos los tickers
- Defensa de Lección 7 (`consecutive_failures ≥5 → Telegram`) **NO cubre este caso** porque con TCP vivo nunca incrementa el contador
- `ws_connected` tiene 2 señales contradictorias: TCP-based (mintió) vs message-based (sí validaba pero nadie la consume)

**Conclusión inicial de Claude Code:** "causa externa" (Kalshi reduciendo entrega).

### 3. Capa adversarial frenó la atribución externa (yo)
Misma trampa del 25-may: "REST estable durante blackout WS → causa externa" es **atribución sin validar**. Identifiqué que el test depende de un supuesto arquitectónico (REST y WS comparten event loop). Sin verificarlo, "REST estable" no prueba externa, solo prueba "no es starvation compartida".

Esto frenó el saltar al fix. Buen patrón aplicado.

### 4. Reorden de discovery (orden epistémicamente correcto: B)
- ❌ Query REST minuto a minuto primero (su resultado dependía del supuesto no validado)
- ✅ Lectura de arquitectura primero (¿REST y WS comparten loop/path?)
- ✅ Query REST después, **con interpretación correcta del resultado**
- ✅ Auditoría 18-may en paralelo (no depende de nada arquitectónico)

### 5. Auditoría 18-may completada
```
24 horas, sin gap. Total ≈ 217.000 eventos.
Mínimos: 2.835 (04h), 3.088 (05h), 3.311 (06h)
8 horas <5.5k/h, pero NUNCA cae a 2 dígitos
```

**Veredicto: NO fue blackout encubierto.** El 18-may fue día tranquilo con throughput bajo (probablemente actividad de mercado real), no falla técnica oculta.

Confirma que la varianza diaria normal del feed es enorme (2.8k-35k/h). Refuerza que **detector de tasa con threshold absoluto generaría falsos positivos constantes** — necesita baseline por hora del día.

### 6. PR del fix V1 mergeado (commit 21fe6fd)
Tras review de 6 puntos de control (todos ✅) — ver [[fix-v1-watchdog-21fe6fd-validado-produccion]] — el PR se mergeó a main. Coolify disparó deploy.

Cambios:
- `force_reconnect()` cierra socket sin tocar `_running`
- Watchdog dispara `force_reconnect` cuando silence > 300s (antes solo `record_error`)
- Telegram alert tras 2 detecciones (threshold gateado)
- TTL en `last_error` (900s)
- 4 tests nuevos incluyendo integración real contra socket

### 7. Validación post-deploy 7h 14min — TODO VERDE

**Ronda 1 (T+5min):** throughput ~12k/h proyectado, criterios verdes
**Ronda 2 (T+7h 14min):**
- 161.169 eventos sin gaps
- 435/435 minutos con data
- 0 force_reconnect espurios
- 0 zombie detections
- Hora 08h = 6.831 eventos (mismo valor que destruyó el 28-may) → **valle natural seguido de pico 09h 37k y 10h 56k**

**Frente WS V1 CERRADO LIMPIO.** Esta vez la validación es real — 7h de comportamiento observado, no "tests verdes" como en V2.

### 8. Lección 10 redactada con causa cerrada
Stub previo [[leccion-10-ws-zombie-pendiente-discovery]] superado por [[leccion-10-FINAL-ws-zombie-con-fix-validado]].

Pendiente: mergear al `KALSHI_BOT_CONTEXT.md` v1.6 (commit administrativo). El contenido está listo.

### 9. Decisión consciente: avanzar con tercer discovery V2
Gemini me hizo la pregunta de control honesta: "¿cómo estás de cabeza?" Yo respondí que estaba arrancando el día fresco (no cerrando una sesión maratón). 7h de validación del watchdog fueron mientras dormía. Café, teanina, 8h de sueño.

**Estado óptimo para trabajo de cabeza.** Discovery de logs es exactamente lo que hace falta cuando no se quiere saltar a conclusiones.

### 10. Tercer discovery V2 ejecutado — H1 REFUTADA empíricamente
Brief surgical a Claude Code: una pregunta única binaria.

> ¿El price 10c de KXMLB-26-ATL tenía size>0 en el snapshot WS inicial?

**Resultado del forense:**
- Líneas 7703-7704 del log preservado
- **YES side, 10c: 1114.07** (~1114 cents)
- **NO side, 10c: 500.00** (~500 cents)
- **size > 0 en AMBOS lados.**
- **H1 (size=0 filter) REFUTADA como causa de este error específico.**

El bucket tenía estado válido. El filtro no era el problema. El fix Opción A `ed7b7ac` arregló 3 bugs reales pero **NO el primario.**

### 11. Hallazgos extra del forense
- **No hubo deltas previos al ticker** entre snapshot (line 7703) y error (line 7815) → estado del bucket al momento del delta = exactamente el del snapshot
- **Error correlacionado temporalmente con gap de sequence:** 2ms después, `Sid 1 gap detected. expected seq=40, got 41`
- Entre seq=2 y seq=39 pasaron 37 deltas exitosos en algún ticker (no necesariamente ATL)
- **Triggering delta side AMBIGUO** — el log no captura el delta crudo, solo el resultado `qty=-3108`

### 12. Decisión: pivot del espacio de hipótesis V2
Ver [[decision-2026-05-29-v2-pivot-nuevo-espacio-hipotesis]].

**Abandonar variantes de size=0.** Buscar en:
- **H2** — Dispatcher / aplicación de deltas defectuosa
- **H3** — Ordenamiento de mensajes / out-of-order (gap seq=40 es señal fuerte)
- **H4** — Interpretación del snapshot inicial (¿shape de parseo de `yes_dollars_fp`?)

NO tocar producción. NO escribir fix. Próximo discovery sobre `_apply_delta_msg` y deltas entre seq=2-39 cuando se retome el frente.

## Workflow capa por capa observado

| Capa | Rol del día |
|---|---|
| **Claude (yo, adversarial)** | Frené atribución externa de Claude Code en V1, reordené discovery a (B) epistémicamente correcto, sostuve disciplina de discovery antes de fix V2 |
| **Claude Code** | Discovery V1 con código verbatim, implementación fix V1 con 4 tests, validación post-deploy en 2 rondas, forense V2 surgical sin saltar a conclusiones |
| **Gemini (CTO)** | Estructura del plan A/B/C de pacing, validación de la pregunta del forense, observaciones sobre cuidado personal |
| **Yo (Noel)** | Decisión de mergear el PR, decisión de avanzar al tercer discovery con cabeza fresca, decisión de pivot del espacio de hipótesis V2 |

## Tres frentes al cierre

| Frente | Estado | Próximo paso |
|---|---|---|
| **V1 WS zombie** | ✅ **CERRADO LIMPIO** — fix validado 7h en producción | Mergear Lección 10 al `KALSHI_BOT_CONTEXT.md` v1.6 |
| **V2 causa raíz** | 🔄 **H1 refutada, pivot a H2/H3/H4** | Próximo discovery (no urgente, cuando se retome) sobre dispatcher/ordering/parsing |
| **Lección 10** | ✅ Redactada con causa cerrada | Commit administrativo al repo |

## Métricas de calidad del workflow hoy

**Hipótesis que la capa adversarial frenó:**
- "REST estable → causa externa" (Claude Code lo concluyó inicialmente — frené por dependencia de supuesto arquitectónico)
- "Activar V2 hoy porque el fix está aplicado" (no surgió, el discovery ya estaba en agenda)

**Hipótesis que la capa adversarial sostuvo contra presión:**
- "Discovery antes que fix" (presionado solo por momentum, no por urgencia operativa)
- "Validación 7h antes de declarar cerrado" (no por T+30min como en V2)

**Errores propios que la capa adversarial capturó en mí mismo:**
- Mi query original usaba columna `ts` inexistente (real es `captured_at`)
- Mi razonamiento "REST estable → externa" tenía agujero arquitectónico
- Mi inclinación a "seguir avanzando" identificada por Gemini como posible inercia

## Observación de cierre del día

Tres patrones reforzados sin proponérselo:

1. **"Validación en producción ≠ tests verdes"** (Lección 9 decisión #1, aplicada en práctica con 7h del watchdog)
2. **"Atribución externa requiere refutar hipótesis internas con discovery arquitectónico"** (Lección 10 decisión #5, descubierta DURANTE el discovery V1)
3. **"Logs preservados de incidentes pasados son insumo de validación que evita repetir incidentes futuros"** (el forense V2 refutó H1 sin necesidad de re-activar V2)

Y un patrón meta: **trabajo de cabeza fresca > trabajo maratónico cansado.** El discovery surgical del log V2 que respondió la pregunta binaria salió en una sola pasada porque arranqué descansado. El día 25, 26, 27 (cuando todo se mezclaba), los discoveries eran ruidosos.

## Artefactos creados/actualizados hoy

**Nuevos:**
- [[fix-v1-watchdog-21fe6fd-validado-produccion]] — fix V1 con validación 7h
- [[leccion-10-FINAL-ws-zombie-con-fix-validado]] — Lección 10 redactada
- [[discovery-forense-v2-attempt2-h1-refutada]] — forense V2 con H1 refutada
- [[decision-2026-05-29-v2-pivot-nuevo-espacio-hipotesis]] — pivot del frente V2

**A actualizar:**
- [[kalshi-bot]] — nota raíz del proyecto
- `_notebooklm/proyecto-kalshi-bot.md` — versión consolidada para NotebookLM

**Pendiente administrativo:**
- Commit Lección 10 al `KALSHI_BOT_CONTEXT.md` v1.6 (contenido listo, solo falta merge)

## Próximos pasos (no urgentes, cuando se retome)

1. ⏳ Commit administrativo Lección 10 al repo
2. ⏳ Próximo discovery V2: H2/H3/H4 contra logs preservados (NO tocar prod, NO escribir fix)
3. ⏳ Fase 2 watchdog V1 (detector de tasa con baseline por hora) — diseño cuando aplique
4. ⏳ Unificación de las dos señales `ws_connected` en V1
5. ⏳ Test de causa externa vs starvation interna (cuestión técnica abierta)

## Estado real consolidado al cierre

- **V1 sano y endurecido.** Fix watchdog validado en producción 7h.
- **V2 dormant con H1 refutada.** Hipótesis nueva, sin fix válido.
- **Lección 9 cerrada en repo** (causa V2 pendiente prominente).
- **Lección 10 lista para commit** (causa V1 cerrada, fix validado).
- **Sin capital en riesgo** (`TRADING_ENABLED=false`).
- **Sin urgencia operativa.**

Cierre limpio del día. Frente V1 efectivamente terminado por ahora. Frente V2 con espacio de hipótesis acotado y direccional.

## Links
- [[fix-v1-watchdog-21fe6fd-validado-produccion]]
- [[leccion-10-FINAL-ws-zombie-con-fix-validado]]
- [[discovery-forense-v2-attempt2-h1-refutada]]
- [[decision-2026-05-29-v2-pivot-nuevo-espacio-hipotesis]]
- [[sesion-2026-05-28-leccion-9-corregida-y-ws-zombie]] — sesión anterior
- [[ticket-v1-ws-zombie-degradacion-escalonada]] — ticket cerrado por el fix
- [[leccion-9-FINAL-causa-raiz-pendiente]] — sigue abierta, ahora con H1 refutada
- [[kalshi-bot]]
