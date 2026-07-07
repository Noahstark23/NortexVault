---
tipo: sesion
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-06
tags:
  - kalshi
  - motor-rest
  - shadow-mode
  - fantasma-atribucion
  - v2-rechazado-otra-vez
  - pre-flight-encendido
  - error-data-capture
  - mundial-2026
  - sesion-conmigo
  - 2026-06-06
estado: bloque-cerrado-con-cabo-abierto
frente: "Shadow listo para encendido + nuevo error en V1 _on_orderbook_delta pendiente diagnóstico"
deadline: 2026-06-11 (Mundial)
---

# Sesión 2026-06-06 — Verificación + fantasmas enterrados + shadow listo + ⚠️ nuevo error en V1

## TL;DR
Día de **disciplina de verificación pura**, sin escribir código de producción nuevo. El reporte de estado afirmó un bloqueante para reactivar el Motor REST (orderbook_snapshot code 8); verificación contra código y logs lo enterró como falso positivo en todas sus puntas. Un brief de Gemini intentó resucitar V2 con un plan de validación 72h — rechazado por contradecir frontalmente la decisión arquitectónica que el análisis de datos cerró. Listos para encender el shadow del Motor REST con pre-flight completo (backup consistente vía SQLite API + baseline de V1 capturado). **⚠️ Aparece error nuevo en V1 (`_on_orderbook_delta:172 Error procesando orderbook_delta` a las 21:56:20) — cabo abierto a investigar antes del encendido.**

---

## El estado del bot al inicio del día (reporte productivo)

- Contenedor running (healthy). Último despliegue commit `c10420c`, rama `main`, 05-jun 19:26.
- Todos los motores apagados: `MOTOR_1`, `MOTOR_2`, `MOTOR_3`, `MOTOR_REST_ENABLED`, `TRADING_ENABLED` = false.
- Capital configurado: `ACTIVE_CAPITAL_USD = 300.00`.
- Métricas DB: market_snapshots=261,241; orderbook_events=9,550,149; bot_runs=47; edge_windows=0; trades=0; risk_events=0.
- Actividad observada: ciclos REST normales (KXUCL-27-ARS, KXMLB-26-COL), snapshots 50/50 sin fallos parciales.
- **El reporte señaló un "bloqueante" pendiente:** *"el canal WebSocket de orderbook (orderbook_snapshot) era rechazado por Kalshi con error 'Unknown channel name' (code 8) — sigue pendiente de resolver en el código antes de reactivar el motor REST para detección real."*

---

## 👻 La falsa alarma del orderbook_snapshot — enterrada en todas sus puntas

### Verificación 1 — código en `main`

Claude Code grep sobre `src/strategies/motor_rest_arb/` confirmó:
- `engine.py` línea 36/47-48: `ws.on("ticker", self.on_ticker)` — solo ticker
- `trigger.py`: lee solo `yes_bid_dollars`, `yes_ask_dollars`, `*_size_fp`
- **CERO menciones de orderbook en todo el módulo del Motor REST**

→ El Motor REST en `main` es **ticker-only puro**. El diseño Gate 0 está fielmente implementado.

### Verificación 2 — origen real del code 8

La única suscripción a canales de orderbook en el repo es `data_capture.py:525` → `channels=["orderbook_delta", "ticker"]`. Nadie suscribe a `orderbook_snapshot` como canal — `orderbook_snapshot` es un **tipo de mensaje, no un canal**.

`orderbook_snapshot` aparece como handler en:
- `orderbook_manager_v2.py` (V2, archivado/dormant)
- `orderbook_manager.py`, `orderbook.py` (Motor 1 / V2)
- `data_capture.py` (`ws.on("orderbook_snapshot", ...)` — handler del snapshot inicial de V1)

→ El error code 8 salió del **script `inspect_ws.py`** antes del fix de PR #16, suscribiéndose a `orderbook_snapshot` como canal (nombre que Kalshi no reconoce). **NO de ningún componente productivo.**

### Verificación 3 — cabo abierto cerrado con `zgrep`

Claude Code grepeó `code 8`, `Unknown channel`, rechazos de suscripción sobre TODOS los logs productivos (`bot_*.log` de hoy + `.gz` históricos):

```
Resultado: vacío, rc:0, sin una sola línea.
```

**Línea clave de hoy (bot_2026-06-06.log, 17:25:23):**
```
src.clients.kalshi_ws:_send_subscribe:303 |
  Subscribed: channels=['orderbook_delta', 'ticker'] markets=63
... Subscription confirmada: {'channel': 'orderbook_delta', 'sid': 1}
... Subscription confirmada: {'channel': 'ticker', 'sid': 2}
```

V1 usa `orderbook_delta` (canal correcto, aceptado por Kalshi). **El code 8 era exclusivamente del script.**

### Veredicto

**El "bloqueante para reactivar el Motor REST" es FALSO POSITIVO en todas sus puntas:**
- Motor REST en main = ticker-only, no usa ningún canal de orderbook ✅
- code 8 nunca ocurrió en producción ✅
- V1 usa `orderbook_delta` correctamente, 22h+ de WS estable ✅
- Captura sana confirmada: `orderbook_events` creció 9,550,149 → 9,550,243 durante la propia verificación ✅

### 📌 Dato accionable que sale del fantasma

> **El nombre de canal correcto de orderbook es `orderbook_delta`, NO `orderbook_snapshot`.**
> El Motor REST es ticker-only y no lo necesita, pero si algún día (improbable) necesitara profundidad más allá del BBO, ese es el canal. **Vale guardarlo en contexto — es el tipo de detalle (nombre verificado contra la realidad) que cuesta caro re-descubrir meses después.**

---

## 🧠 El check de ego — momento de calibración

> *"me estas diciendo que ya terminamos creamos un bot de trading se me sube el ego en linkedin o que jaja?"*

Respuesta honesta de la capa adversarial:

**Lo construido, sin inflar:** infraestructura de producción, captura de 9.5M de eventos, arquitectura decidida por análisis propio, ejecutor con máquina de 4 estados validado contra API real, disciplina de gates en cada paso. Es ingeniería real y la mayoría de los "trading bots" no llegan ni a la mitad de ese rigor.

**Lo que el ego de LinkedIn necesita escuchar:**
- **Nunca ejecutó un trade con capital.** Ni uno. `TRADING_ENABLED=false` desde día uno.
- El executor **nunca completó un arb real de dos patas** — las pruebas demo fueron órdenes sueltas.
- **Cero data de PnL.** `trades=0`. La estrategia "debería" capturar ~73% según teoría/backtest, no resultados.
- El régimen del Mundial — el evento para el que se construyó — **ni siquiera se midió todavía**. Es una hipótesis (curva de dilatación NBA como proxy).

**Conclusión calibrada:** "Construiste la máquina, la probaste en banco, está lista para su primera prueba real (grabar el Mundial en shadow). Es un hito de ingeniería enorme. **NO es todavía un resultado de trading.**"

**El post de LinkedIn correcto NO es "construí un trading bot" — es lo que escribas DESPUÉS del Mundial con la data del shadow atrás:** *"Corrí mi bot en shadow durante el Mundial 2026 y acá está lo que la data mostró."* Eso tiene evidencia. El otro es una afirmación.

**Riesgo concreto del ego:** "ya casi terminamos, es un éxito" es exactamente el estado mental que afloja los gates. A 5 días del Mundial, con un executor que nunca tocó plata, el momento de máxima confianza es el de máximo riesgo de saltarse un paso. **No está todo probado — está todo construido y validado en banco.**

---

## 🇦🇷⚽ Discovery de mercados de fútbol — Flashscore vs Kalshi

### La pregunta del día

> *"igual hay amistosos de futbol si quedan 5 dias para el mundial imagina que de la nada nos perdamos el mejor evento cada 4 años"*

Buen instinto: usar los amistosos como **ensayo general** de los gates de carga, no esperar al 11 para descubrir problemas.

### Verificación contra Kalshi (read-only)

**Mercados de fútbol abiertos AHORA en Kalshi:**
- `KXINTLFRIENDLYGAME` (International Friendly Game) — 150 mercados abiertos
- `KXINTLFRIENDLYTOTAL` (International Friendly Total) — 128 mercados abiertos
- `KXSOCCERPLAYCRON` (Cristiano Ronaldo world cup) — 1 mercado

**Pero todos para partidos del 9-jun (26JUN09):** Hungría vs Kazajistán, Rusia vs Trinidad y Tobago, Bielorrusia vs Burkina Faso, etc.

### Resultado del gate parcial corrido sobre Hungría vs Kazajistán

- WS conectó OK
- Suscripción al canal `ticker` sobre soccer aceptada por Kalshi (`type: subscribed`)
- **Cadencia del ticker: 0 ticks en 30s** — el script lo diagnosticó: *"Subscription confirmed but NO market data after 30s. Markets may be truly inactive right now."*
- Parser de size: **no evaluable** sin ticks
- Conteo de mercados con volumen > 0: **0** (los partidos no han empezado)

### La pantalla de Flashscore destapó la contradicción

Flashscore mostraba partidos EN VIVO el 6-jun: Portugal-Chile, Albania-Luxemburgo, Rumanía-Gales, Gibraltar-Islas Caimán, EE.UU.-Alemania, etc.

**Posibilidad (a):** Kalshi no tiene mercados de los partidos que se juegan hoy (solo de los del 9-jun).
**Posibilidad (b):** El discovery filtró mal y se perdió los mercados de hoy.

### Resolución

**(a) confirmado.** Kalshi solo tiene amistosos del 9-jun en su catálogo abierto. Flashscore muestra TODO el fútbol mundial; Kalshi solo lo que decidió ofrecer. **Ver partidos vivos en Flashscore no sirve — lo que importa es qué tiene Kalshi.**

### Veredicto del gate

- ✅ **Validado hoy:** descubrimiento de mercados de fútbol funciona, WS conecta y se suscribe al canal `ticker` sobre soccer correctamente. **Metodología de medición lista.**
- ⏳ **Pendiente (bloqueado por entorno, no por código):** shape real del ticker con datos, parser de size con valores reales, cadencia con ticks reales.
- 📅 **Ventana natural:** 9-jun, cuando los amistosos se jueguen. Buen volumen esperable (Rusia, Hungría, etc.).

**Lección de la pantalla:** *"Verificar contra la fuente que importa (Kalshi), no contra la que tenés a mano (Flashscore)."*

---

## 🚫 Brief de Gemini para reactivar V2 — RECHAZADO

### El brief que llegó

Gemini propuso un **"Brief de Validación: 72h OrderbookManagerV2"** con pre-flight, criterios numéricos, triggers de rollback, SLA — estructura impecable. Pero el contenido:

- Pedía `USE_ORDERBOOK_MANAGER_V2=true`
- Certificar 72h de estabilidad de V2 en shadow
- Vocabulario: `SidGapError`, `books_initialized`, `sids_recovering`, "habilitar la conexión del detector"

### Lo que la capa adversarial vio

**El brief contradice frontalmente la decisión arquitectónica del 02-jun:**
- V2 está **archivado oficial**, no "pendiente de validar"
- Decisión tomada por análisis de 7.9M filas: la liquidez DILATA el edge ~800×, REST puro alcanza con 73% de captura
- El Motor REST ticker-only "mata la clase entera de bugs de V2" (esto fue decisión consciente, no oversight)

**Tres posibilidades de origen del brief:**
1. **(a) Cambio de idea con razón real** — pero no hay dato nuevo que invalide la curva de dilatación
2. **(b) Confusión entre frentes** — el brief usa vocabulario de V2 (SidGapError, books_initialized, sids_recovering) que el Motor REST NO tiene (no usa seq, no mantiene book, no hay recovery)
3. **(c) Ansiedad de 5 días buscando "hacer algo"** — el "imaginá que de la nada da un problema" canalizado en cambios preventivos

**Riesgo operativo concreto subestimado:** `USE_ORDERBOOK_MANAGER_V2=true` + redeploy reinicia la captura sana de V1 a 5 días del Mundial — el componente que falló 3 veces vs la data irreemplazable que alimenta el análisis. **Resucitar V2 ahora es invitar al problema que se temía.**

### Veredicto

**No mandar el brief. Lo que el Mundial necesita validar NO es V2 — es el Motor REST sobre fútbol**, y esos gates son read-only con `inspect_ws.py` + `bench_rest_rtt.py`. No requieren reactivar nada de V2.

> *"El brief de 72h de V2 resuelve un problema que ya no tenés. El brief que necesitás es de gates read-only del Motor REST sobre amistosos. Son cosas completamente distintas."*

---

## ✅ Decisión confirmada: ticker-only se mantiene

Pregunta de diseño explícita: ¿el Motor REST necesita profundidad más allá del top-of-book?

### Respuesta estructural de Claude Code (NO, con 3 razones)

1. **El arb binario solo necesita el top-of-book.** La condición es `yes_ask + no_ask < 100` post-comisión. Se computa con el mejor ask de cada lado — exactamente lo que el ticker trae. Niveles más profundos NO cambian si hay arb, solo cuánto volumen.

2. **El sizing ya está acotado por debajo del primer nivel.** `MOTOR_REST_MIN_DEPTH` y `count` del `ArbLeg` se calculan del size del top-of-book. A escala de $300 / ¼ Kelly / cap 5%, el sizing real es **pocos contratos**, muy por debajo de lo que barrería varios niveles.

3. **La verdad de profundidad para ejecutar ya viene por REST, no por WS.** Diseño §4: ticker = campana (detección); GET REST del orderbook al disparar = verdad para confirmar y ejecutar. Si alguna vez se necesitara más profundidad para sizing, vendría del REST en el momento de ejecutar, no de suscribir `orderbook_delta` por WS. **Mantiene la línea ticker-only del feed intacta.**

### Único escenario donde reconsiderar

Si la estrategia evolucionara a barrer niveles agresivamente (órdenes grandes que consumen 3-4 niveles para capturar un arb gordo). Pero a este capital + con FOK (que **no barre** — llena al precio o cancela), no aplica. Si capital escala 10x → decisión de diseño explícita (profundidad vía GET REST de ejecución, no vía WS orderbook_delta).

**Decisión:** ticker-only se mantiene. `orderbook_delta` NO entra al Motor REST.

---

## 🚀 Plan de encendido del shadow — con pre-flight completo

### El plan ligero de Gemini (rechazado)

Gemini propuso: configurar flag → redeploy → "monitorear logs 10 minutos buscando mensajes de arbitraje detectado". **Tres agujeros que la disciplina de la saga no permite:**

1. **Sin pre-flight ni rollback.** El riesgo no es financiero (shadow no ejecuta) pero SÍ operativo: reiniciar V1 sana a 5 días del Mundial. Si Motor REST tira excepción al arranque que afecta a V1 o silenciosamente no se engancha al ticker — `Container healthy ≠ service running`.
2. **"Buscá mensajes de arbitraje detectado"** es criterio equivocado. Un arb es esporádico; puede no haber en 10 min sin que el motor esté roto. Necesitamos señal de **"motor vivo procesando ticks"** independiente del arb.
3. **PR #22 (fix sensor) NO es bloqueante para shadow.** El shadow no llama `execute()`, no usa el sensor. Atar el encendido del shadow a un fix que el shadow no usa = redeploy de más sin sentido.

### El plan correcto

**Pre-flight (T-0):**
1. **Backup consistente de la DB** vía SQLite API (`Connection.backup()`), NO `cp` crudo (puede capturar páginas inconsistentes con WAL/journal pendiente). Con `PRAGMA integrity_check`.
2. **Baseline de V1 capturado ANTES** y guardado FUERA del container (`/app/data/` no `/tmp/`): `capture_running`, `ws_connected`, `tracked_markets`, `last_error`, conteo de `orderbook_events`, `market_snapshots`.
3. **TRADING_ENABLED=false confirmado por nombre** (printenv VAR, NO env dump).
4. **Señal de "shadow vivo" definida ANTES:** `Motor REST registered (SHADOW...)` al arranque + `REST Engine Heartbeat: N...` con N creciendo. NO "arbitraje detectado".

**Activación (T+0):**
5. Coolify → `MOTOR_REST_ENABLED=True`. `TRADING_ENABLED=false` y `USE_ORDERBOOK_MANAGER_V2=false` intactos.
6. Redeploy.

**Verificación post-deploy:**
7. Confirmar mensaje de arranque del Motor REST en logs.
8. Confirmar heartbeat creciendo (señal de vida).
9. **Criterio de éxito real:** `edge_windows` crece cuando hay arb + V1 sano vs baseline (`orderbook_events` sigue creciendo, captura no degradada).
10. **Criterio de rollback (SLA <5min):** si V1 degradado (captura cae, errores nuevos) o Motor REST en loop de excepciones → `MOTOR_REST_ENABLED=False` + redeploy → baseline.

### Decisión sobre PR #22

**Mergear en el MISMO redeploy** que el encendido del shadow (un solo reinicio, no dos). Antes: confirmar que la branch `fix/fok-kill-409-sensor` (HEAD `58ecc24`) tiene **solo el fix del 409→KILL + error_code**, nada más colado.

### Decisión sobre HEARTBEAT_EVERY

**NO tocarlo.** Encender el motor con su config normal. *"Una cosa a la vez — no metas un cambio de comportamiento del heartbeat en el mismo momento que encendés el motor por primera vez."*

---

## ✅ Pre-flight ejecutado (read-only, todo en orden)

### (a) Backup consistente vía SQLite API

```
BACKUP_CREATED:   /app/data/trades.db.bak-20260606-220348
INTEGRITY_CHECK:  ok ✅
SIZE_BYTES:       1,203,744,768 (~1.12 GB)
Método:           Python Connection.backup() (NO cp crudo)
Nota:             tardó ~45-50s — la captura está escribiendo activamente
                  (soccer mercados abiertos), .backup() reinicia el copy-loop
                  cuando la fuente se modifica a mitad — completó limpio
```

**El binario `sqlite3` CLI no está instalado en el container** (`sh: 4: sqlite3: not found`); por eso vía Python.

### (b) Baseline en volumen persistente

`/app/data/baseline_counts.txt` (sobrevive el redeploy):

```
baseline 20260606-220610 | orderbook_events=9,597,454 | edge_windows=0 | market_snapshots=264,104
```

**Tabla de baseline para comparar post-redeploy:**

| Métrica | Valor (2026-06-06 22:06:10) |
|---|---|
| orderbook_events | 9,597,454 |
| edge_windows | 0 |
| market_snapshots | 264,104 |
| capture_running | YES (snapshot 21:53:22, 50/50) |
| ws_connected | YES (17:25:23 SUCCESS) |
| tracked_markets | 63 (channels: `orderbook_delta`, `ticker`) |

**Detalle operativo:** `localhost:8080/status` no se usó — no hay endpoint de status confirmado en ese puerto. Números directo de DB + logs (fuente de verdad).

---

## ⚠️ CABO ABIERTO — error nuevo en V1 a las 21:56:20

### El hallazgo

A diferencia de las verificaciones anteriores (limpias), **apareció un `last_error` reciente en producción**:

```
2026-06-06 21:56:20 | ERROR | src.strategies.data_capture:_on_orderbook_delta:172 |
Error procesando orderbook_delta
```

### Por qué es relevante

1. **Es de hoy, hace minutos** — no es deuda histórica conocida.
2. **Está en el handler `_on_orderbook_delta` de V1/data_capture** — el camino de ingestión de profundidad del orderbook, **justo el que validamos antes** como sano.
3. **Coincide en el tiempo con la actividad de fútbol en vivo** que estuvimos midiendo (Flashscore mostraba Portugal-Chile, EE.UU.-Alemania, etc.).
4. **No tengo el traceback completo** en esta línea — puede ser puntual (mensaje malformado) o sistemático.

### Por qué hay que mirarlo ANTES de encender el shadow

- No es bloqueante para backup/baseline (ambos quedaron bien)
- **PERO:** si el error se repite, podría haber gaps en la captura de `orderbook_delta` — y la data de V1 es la que alimenta el análisis y va a capturar el Mundial.
- Encender el shadow con un error nuevo activo en V1 = mezclar problemas: si después el shadow muestra anomalías, no sabremos si fue por el encendido o por el error pre-existente.

### Pregunta pendiente para próximo turno

**¿Cuántas veces apareció ese `Error procesando orderbook_delta` hoy? ¿Cuál es el traceback completo? ¿Es puntual o sistemático?**

Read-only. Comando: contar ocurrencias del error en `bot_2026-06-06.log` y extraer traceback completo.

**Hasta no resolver eso, NO encender el shadow.** La disciplina dice: no apilás cambios sobre un sistema que tiene un error activo no diagnosticado.

---

## Estado al cierre del 06-jun

### Verificado y cerrado
- ✅ Falsa alarma orderbook_snapshot code 8 — fantasma enterrado en todas sus puntas
- ✅ V1 usa `orderbook_delta` correctamente — confirmado contra logs productivos
- ✅ Motor REST en main es ticker-only puro — confirmado contra código
- ✅ V2 NO se reactiva — brief de Gemini rechazado, decisión arquitectónica del 02-jun se mantiene
- ✅ Decisión de ticker-only blindada con razón estructural completa
- ✅ Mercados de fútbol en Kalshi mapeados: 278 amistosos abiertos para el 9-jun
- ✅ Gate parcial sobre Hungría-Kazajistán: metodología validada, sin ticks (mercado pre-evento)
- ✅ Backup consistente de DB (1.12 GB, integrity ok)
- ✅ Baseline de V1 capturado para comparar post-redeploy

### Listo para encender (con condición)
- 🟡 Shadow del Motor REST: pre-flight completo, plan claro
- 🟡 PR #22: branch `fix/fok-kill-409-sensor` (HEAD `58ecc24`) lista para mergear en el mismo redeploy
- 🟡 Pre-flight con backup + baseline + criterio de éxito + rollback claro

### ⚠️ Cabo abierto bloqueante (próximo turno)
- 🔴 **Error nuevo en V1 `_on_orderbook_delta:172` a las 21:56:20** — necesita conteo + traceback antes de encender el shadow
- 📅 Gates de carga reales: 9-jun (amistosos en vivo) o 11-jun (Mundial)

---

## Aprendizajes del día

- **"Verificar afirmaciones hasta el fondo, incluidas las propias."** El reporte afirmó un bloqueante; la verificación lo desmontó. El propio Claude Code marcó un condicional ("si apareciera en producción sería de V1") — dejarlo en "si" es dejar la pregunta a medio responder. Cerrarlo con `zgrep` lo enterró del todo.
- **Flashscore ≠ Kalshi.** Ver fútbol vivo en el mundo no significa tener mercado tradeable. La fuente que importa para el bot es la API de Kalshi, no el mundo real.
- **El brief estructuralmente impecable puede ser conceptualmente contradictorio.** El de V2 tenía pre-flight, criterios, SLA — todo bien escrito — pero pedía resucitar el componente que el análisis de datos había archivado. **La estructura no convalida el contenido.**
- **Ticker-only no es shortcut — es una decisión arquitectónica con 3 razones estructurales.** Mantenerla bajo la presión de "5 días al Mundial, hagamos algo" es la disciplina que separa el proyecto del problema.
- **El ego de LinkedIn es el síntoma; el riesgo es saltarse gates.** "Ya casi terminamos" → "activemos capital para el Mundial" sería exactamente el error que la saga enseñó a evitar.
- **`cp` crudo de SQLite con escrituras activas captura estado a medias.** Backup vía API SQLite (`Connection.backup()`) es transaccionalmente coherente. El binario `sqlite3` CLI no está en el container — usar Python.
- **No apilás cambios sobre un sistema con error activo no diagnosticado.** El error en `_on_orderbook_delta` a las 21:56:20 hay que entenderlo antes de encender el shadow — incluso si parece menor.

---

## Para el próximo turno (orden estricto)

1. **Diagnosticar el error de V1 (`_on_orderbook_delta:172 Error procesando orderbook_delta`).**
   - Contar ocurrencias en `bot_2026-06-06.log`.
   - Extraer traceback completo.
   - Decidir: puntual (mensaje malformado, ignorable) o sistemático (gaps de captura, bloqueante).
2. **Si el error es puntual / no afecta integridad de V1:**
   - Confirmar branch `fix/fok-kill-409-sensor` limpia
   - Mergear PR #22 a main
   - Encender shadow con plan de pre-flight completo (un solo redeploy)
   - Verificar señales de vida + V1 sano vs baseline
3. **Si el error es sistemático:**
   - Diagnosticar y arreglar primero
   - NO encender shadow sobre V1 con problemas activos
4. **Día 9-jun:** correr gates de carga reales sobre amistosos en vivo con `inspect_ws.py` + `bench_rest_rtt.py`.

---

## Links
- [[kalshi-bot]]
- [[2026-06-05-sesion-FOKExecutor-sensor-validado-API-viva]] — sesión inmediatamente previa (cerró el sensor)
- [[2026-06-03-sesion-V2-archivado-motor-REST-construido]] — infra Motor REST construida
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — la decisión arquitectónica que el brief de Gemini intentó revertir
- [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]] — el dato que cerró el ticker-only
- [[2026-06-02-noche-BUG-executor-limit-resting-Issue-14]] — el bug que motivó el FOK
