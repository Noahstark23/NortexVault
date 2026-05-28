---
fecha: 2026-05-28
tipo: sesion-conmigo
proyecto: kalshi-bot
ia: Claude + Gemini (CTO) + Claude Code + capa de queries en VPS
modelo: multi-agent + investigación empírica
tags:
  - sesion-conmigo
  - kalshi-bot
  - leccion-9
  - ws-zombie
  - tres-frentes
---

# 28-may — Lección 9 corregida + descubrimiento WS zombie V1

> Día post-attempt #2 V2. Lección 9 reescrita completa para reflejar causa raíz NO RESUELTA. Descubrimiento concurrente: V1 tuvo blackout escalonado de 3h hoy en la madrugada UTC. Tres frentes abiertos al cierre.

## Contexto al inicio del día
- Attempt #2 V2 falló ayer (27-may 15:36→15:48, 12 min, rollback ejecutado) — ver [[incidente-v2-attempt-2-2026-05-27]]
- Logs preservados con stack traces (logging fix funcionó)
- Lección 9 del 26-may quedó obsoleta: asumía size=0 como causa, attempt #2 lo refutó

## Decisiones / conclusiones del día

### 1. Lección 9 reescrita completa (CRÍTICO)
**Diferencia central con el borrador del 26-may:** la versión vieja concluía "encontramos la causa vía discovery" (size=0). La versión nueva concluye **"creímos haberla encontrado dos veces y nos equivocamos las dos veces, pero el sistema de contención nos protegió en ambas"**.

Marcada explícitamente: **causa raíz NO RESUELTA al cierre de esta entrada.**

Estructura final:
- Contexto Attempt #1 (25-may) + Attempt #2 (27-may)
- Tabla "Diagnóstico afirmó vs. realidad mostró"
- 3 causas técnicas identificadas, **2 de 3 NO eran la causa**, 1 (logging fix) sí cumplió
- Causa raíz arquitectónica validada: bot NO crashea ante state corruption
- 5 decisiones derivadas (incluyendo "diagnóstico no validado = hipótesis, no causa")
- 4 anti-patrones (incluyendo "urgencia de sprint en proyecto solo-founder es fantasma")
- Sección "Lo que sí funcionó (preservar)" con 4 patrones

Versión guardada en [[leccion-9-FINAL-causa-raiz-pendiente]].

### 2. Commit Lección 9 al repo
- **SHA: `3a4b384`**
- En `main`, pusheado
- `KALSHI_BOT_CONTEXT.md` actualizado a v1.5
- Confirmación: la versión obsoleta NO se subió. La que está en el repo es la corregida.

### 3. Lección 9 obsoleta marcada como tal
Archivo previo [[leccion-9-canonica-kalshi-bot-context-md]] marcado explícitamente como **OBSOLETO**. Se mantiene como **historia del razonamiento** (ejemplo concreto del anti-patrón "confianza prematura en un fix no validado en producción"), pero **NO usar como referencia técnica**.

### 4. Status check post-rollback (24h)
- V1 healthy, run #32 activo, `crash_reason=None`, uptime 24h
- 38 tickers tracked, 0 reinicios
- **PERO:** `last_error="WS zombie: connected but no messages for 1475s"` con timestamp 08:59:59 UTC

### 5. Investigación del zombie — proceso de 5 queries con corrección de hipótesis

**Query 1 (Gemini propuesta):** `orderbook_events` entre 08:35-09:05 UTC.
- Resultado: 24 minutos completamente vacíos (08:36-08:59), recovery a 09:00 con burst
- **Veredicto inicial:** zombie REAL de ~24 min, no falso positivo
- **`market_snapshots` (REST polling) ocultó el blackout** — por eso parecía sano en cobertura horaria

**Query 2 (barrido 24h):** distribución horaria completa.
- Resultado: caída ESCALONADA desde 05:00 UTC, no zombie de 24 min sino degradación de ~3h
- **Claude Code propuso veredicto "blackout escalonado 3-4h"** — yo intervine para frenar conclusión sin validar

**Query 3 (comparación 4 días, hipótesis de valle de mercado US-Eastern):**
- Mi hipótesis: 05-08 UTC = madrugada ET, baja actividad deportiva natural
- Resultado: días 25/26/27 tuvieron 12k-27k/h en esa franja
- **Refutada empíricamente la hipótesis de curva diaria.** Era degradación técnica.

**Query 4 (verificación de Mundo 1 vs Mundo 2):**
- ¿V1 sigue degradado o se recuperó?
- Comparación 13-16 UTC × 12 días
- Resultado: slots de hoy DENTRO de la mediana del baseline
- **Veredicto: Mundo 1.** V1 sano ahora. Incidente cerrado.

**Query 5 (cierre estadístico):**
- Confirmado: hoy en mediana, no en piso
- Pero baseline tiene varianza 4.832-24.751 en misma hora → detector de throughput-drop necesita baseline por-hora, no umbral absoluto
- Dato adicional: 18-may con 4.832 a las 15h — posible microblackout silencioso

### 6. Patrón confirmado dos veces hoy: sesgo a la hipótesis disponible
- Claude Code subestimó primero ("falso positivo"), luego sobre-estimó ("blackout 3-4h")
- Yo propuse hipótesis benigna del valle de mercado, refutada por query
- **La capa humana desambiguó dos veces ejecutando queries de control**

Este patrón refuerza una decisión derivada de Lección 9: **"diagnóstico no validado contra datos = hipótesis, no causa"**.

### 7. Tres frentes abiertos al cierre del día

| Frente | Estado | Próximo paso |
|---|---|---|
| **V2 causa raíz** | Pendiente tercer discovery | Logs preservados del attempt #2, foco en `KXMLB-26-ATL at 10c` |
| **V1 WS zombie** | Ticket capturado, sin discovery | Read-only `kalshi_ws.py` + `monitoring/` con 5 preguntas |
| **Lección 10** | Stub creado | Llenar post-discovery del frente #2 |

### 8. Decisión disciplinada: parar HOY
- Llevo varios días intensos (3 días seguidos en el frente V2)
- Discovery de código async/concurrencia cansado = leer mal
- V1 sano ahora, sin capital, sin urgencia
- **No tocar código hoy.** Mañana con cabeza fresca.

## Diagnóstico de las capas que fallaron en V1 zombie (preliminar)

Sin tocar código pero leyendo lo que ya proveyó Claude Code en sesiones previas:

**Watchdog (`watchdog.py`):** Ciego al WS por diseño. Solo monitorea `BotState.capture_running`. El bucle REST mantuvo la flag en True durante el blackout.

**`BotState.ws_connected` (`kalshi_ws.py`):** Trampa estructural. Se setea True al entrar al contexto `websockets.connect`, solo cambia a False en `finally` si el contexto se rompe. El socket TCP nunca arrojó excepción durante el blackout → flag siguió mintiendo.

**`/status` (`health.py`):** Calcula passive metric `ws_connected` evaluando `last_ws_message` <60s. Ayer esa métrica computó False y `last_error` se pobló. **Pero ningún componente activo del bot lee o reacciona al estado expuesto.** Es dashboard, no actuador.

**Regresión de Lección 7:** La defensa post-blackout de 11h (mayo 13-14) decía: "`ws_connected` refleja estado real validado por heartbeat" y "N fallos consecutivos ≥5 → Telegram obligatorio". **Ninguna se cumplió hoy.**

## Workflow capa por capa observado

| Capa | Rol del día |
|---|---|
| **Capa adversarial (yo, Claude)** | Frené dos veces conclusiones sin validar (blackout 3-4h, valle de mercado). Insistí en queries de control. Marqué Lección 9 obsoleta como tal. |
| **Claude Code** | Ejecutó queries en VPS, generó análisis estadístico, propuso veredictos provisionales que validaron tras corrección |
| **Gemini (CTO)** | Propuso queries iniciales, identificó "Mundo 1 vs Mundo 2" como decisión arquitectónica |
| **Yo (Noel)** | Decidí qué queries ejecutar, sostuve disciplina de "no tocar código cansado", marqué cierre del día |

## Cuidado personal observado
Gemini explícitamente notó: *"Llevás dos días intensos. Estás operando bien — las queries de control son exactamente lo que hay que hacer. Pero si la query de cierre te pone en Mundo 2, vas a sentir la tentación de meterte a arreglar el WS en caliente. No lo hagas hoy si estás cansado."*

**Decisión registrada:** parar hoy, V1 sano, Lección 9 cerrada, ticket V1 capturado, discovery mañana.

## Próximos pasos en orden

1. ✅ Lección 9 al repo (SHA 3a4b384)
2. ✅ Esqueleto del ticket V1 capturado → [[ticket-v1-ws-zombie-degradacion-escalonada]]
3. ✅ Stub de Lección 10 con estructura → [[leccion-10-ws-zombie-pendiente-discovery]]
4. ✅ Sesión guardada al vault
5. ⏳ **Mañana:** Discovery read-only `kalshi_ws.py` + `monitoring/` con 5 preguntas del ticket
6. ⏳ **Cuando aplique:** Tercer discovery del attempt #2 V2 con stack traces preservados
7. ⏳ Llenar Lección 10 post-discovery V1
8. ⏳ Diseñar fix WS zombie, validar offline, desplegar en ventana propia
9. ⏳ Reabrir frente V2 cuando esté el discovery del primer error (`KXMLB-26-ATL at 10c`)

## Artefactos creados/actualizados hoy

**Nuevos:**
- [[incidente-v2-attempt-2-2026-05-27]] — post-mortem del attempt #2
- [[leccion-9-FINAL-causa-raiz-pendiente]] — versión final committeada (SHA 3a4b384)
- [[ticket-v1-ws-zombie-degradacion-escalonada]] — ticket del incidente V1
- [[leccion-10-ws-zombie-pendiente-discovery]] — stub para post-discovery

**Marcados obsoletos:**
- [[leccion-9-canonica-kalshi-bot-context-md]] — concluía erróneamente "size=0 era causa"; reemplazado por la versión final

**Pendientes de actualizar:**
- [[kalshi-bot]] — nota raíz del proyecto
- `_notebooklm/proyecto-kalshi-bot.md` — versión consolidada para NotebookLM

## Links
- [[incidente-v2-attempt-2-2026-05-27]]
- [[leccion-9-FINAL-causa-raiz-pendiente]]
- [[ticket-v1-ws-zombie-degradacion-escalonada]]
- [[leccion-10-ws-zombie-pendiente-discovery]]
- [[sesion-2026-05-27-segunda-ventana-v2-preflight]] — sesión anterior (pre-attempt #2)
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — attempt #1
- [[kalshi-bot]]

## Observación de cierre

Tres lecciones reforzadas en el día sin que se planeara así:

1. **"Causa raíz no validada = hipótesis"** (Lección 9 corregida — el size=0 era un bug real pero NO la causa)
2. **"Saltar a hipótesis disponible sin query de control"** (yo lo hice con valle de mercado; Code lo hizo con blackout 3-4h)
3. **"Defensa de lección previa que regresa silenciosamente"** (Lección 7 implementada incompleta; emergerá como Lección 10)

Las tres comparten estructura: **conclusión cómoda > evidencia que la valida**. La función de la capa humana es ejecutar la query / inspección / validación que desambigua. Hoy se hizo bien — porque me obligué a parar antes de cada conclusión.
