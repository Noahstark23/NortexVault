# Proyecto: kalshi-bot

> Fuente consolidada para NotebookLM. Standalone — sin wikilinks no resueltos.
> Última actualización: 2026-05-30 noche (V1 cerrado + V2 CAUSA RAÍZ CAPTURADA).

## Resumen ejecutivo
Bot automatizado de trading en Kalshi (mercado de eventos). Roadmap por fases:
- **Fase 1** — Data capture only (V1). **Sano y endurecido.** Fix watchdog mergeado a producción (commit `b52a052`, branch `claude/nifty-darwin-2s7wm`) y validado 7h+ en producción. Cero force_reconnect espurios. Frente WS zombie del 28-may CERRADO LIMPIO.
- **Fase 2** — Motor 1 arbitraje intra-Kalshi (requiere V2 = OrderbookManagerV2 sano). **Tres activaciones fallidas + cuatro discoveries + tercera con CAUSA RAÍZ CAPTURADA.** PR #2 mergeado con instrumentación asimétrica. Attempt #3 (30-may 17:41 UTC) falló a T+37s en bootstrap pero **el `raw_msg` quedó preservado**: `msg_seq=186 state_seq=184 delta=-13 bucket=2` → V2 saltó el seq=185 → desync interno, **NO feed corruption**. Hipótesis C confirmada con evidencia dura. Hipótesis A (feed) y B (snapshot parcial) descartadas. Pendiente: cuarto discovery sobre log preservado + diseño del fix de bootstrap/gap-handling.
- **Fase 3** — `TRADING_ENABLED=true` (sin tocar hasta Fase 2 cerrada con confianza).

Estado al 30-may noche: V1 en prod sano. V2 dormant con causa raíz CONFIRMADA. Lección 9 en repo (SHA `3a4b384`) + update #1 mergeado en PR #2 + update #2 redactado pendiente commit. Lección 10 lista. Sin capital en riesgo. Sin urgencia operativa.

**El frente V2 pasó de "causa desconocida" a "causa identificada, fix pendiente".**

## Motivación
Construir un flujo de ingreso independiente y escalable. Si funciona, deja de depender de un solo canal de ingresos. Aprendizaje aplicable a otros mercados (Polymarket, futuros, opciones).

## Arquitectura por capas

### Path V1 (data capture, operando)
- `_take_snapshots` cada ~5 min vía REST API de Kalshi
- Escribe a `orderbook_events` (SQLite, ~250 MB/día = 90 GB/año proyectado)
- Lee solo `_top_bid` — superficie reducida, robusto
- Sin state in-memory persistente (procesa y escribe a DB)
- Bus de mensajes WS también activo pero solo para `data_capture._on_orderbook_snapshot` que persiste a DB

### Path V2 (Motor 1, dormant)
- `OrderbookManagerV2` mantiene state in-memory de los 40 books vía WS deltas
- Recibe `orderbook_snapshot` inicial al suscribirse + deltas continuos
- Requerido para Motor 1 (arbitraje intra-mercado en milisegundos)
- Único archivo: `src/strategies/motor_1_arbitrage/orderbook_manager_v2.py`
- Confirmado RAM-only — NO escribe a DB

### Flags operacionales
- `USE_ORDERBOOK_MANAGER_V2` — controla si V2 se carga (lazy import dentro de `if`). Actualmente `false`.
- `MOTOR_1_ARBITRAGE_ENABLED` — controla si V2 ejecuta lógica de arbitraje (no solo data capture). Actualmente `false`.
- `TRADING_ENABLED` — controla si se ejecutan trades reales. Actualmente `false`. NO tocar hasta Fase 3.

## Incidente 25-mayo-2026: activación V2 fallida

### Cronología (UTC)
- 16:50 — Flip `USE_ORDERBOOK_MANAGER_V2: false → true`, redeploy
- 16:51:36 — Container nuevo levantado
- 16:52:09 — Log `OrderbookManagerV2 registered (data-capture only, no Motor 1)`
- 16:52:33 — Ráfaga 1: 19 errores `delta produces qty<0` en 179ms
- 16:56:57 — 1 error nuevo (no aislado)
- 16:57:16 — Ráfaga 2: ≥8 errores nuevos, magnitudes hasta -6247
- 17:14 — Decisión de rollback (línea defensiva pre-establecida disparada)
- 17:18:17 — Container V1 levantado, V2 dormant confirmado

**Total: 87 errores en 27 min, 12 ráfagas, ≥24 tickers afectados. Rollback en ~6 min.**

### Causa raíz validada (3 bugs)

**Bug primario — Inconsistencia de convención `size=0`:**
`_parse_fp_levels` en V2 no filtra levels con `size=0`. `OrderbookState.apply_snapshot` sí los filtra silenciosamente. Cuando Kalshi envía snapshot con `[price, 0]` (legítimo: "este level está vacío ahora"), V2 lo pierde sin warning. Delta posterior con `delta=-X` sobre ese price hace `book.get(P, 0) + (-X) = -X < 0` → `OrderbookDesyncError`.

**Bug contribuyente — Orden invertido en `_apply_delta_msg`:**
`_last_seq_by_sid[sid] = new_seq` se ejecuta ANTES de `state.apply_delta(...)`. Si apply falla, la seq ya quedó avanzada → siguiente delta se procesa como normal → cascada de errores.

**Bug de observabilidad — Stack traces silenciados:**
`kalshi_ws._dispatch` usa `gather(return_exceptions=True)` + `logger.exception` sin `exc_info` explícito. 27 minutos sin tracebacks persistidos.

### Hipótesis refutadas durante diagnóstico
1. "Feed corruption de Kalshi miente" — refutada. Era inferencia cómoda. Hipótesis parsimoniosa es V2 procesando edge case del wire format.
2. "Duplicación de dispatch" — refutada. `_handlers` es dict de listas, sin paths de reinject.
3. "Drain de buffer sin filtrar por seq" — refutada. Buffers vacíos en bootstrap; no encontrado `clear()` ciego.

## Decisión arquitectónica (Opción A)

Tres opciones evaluadas, escogida A:

**A — Fix puntual (5–8 líneas + 4 tests):**
1. Filtrar `size==0` en `_parse_fp_levels` (no en apply_snapshot). Mantener invariante "size > 0" en OrderbookState puro.
2. Invertir orden en `_apply_delta_msg`: `state.apply_delta()` antes de `_last_seq_by_sid[sid] = new_seq`.
3. Mantener comportamiento estricto ante delta sobre price ausente: `OrderbookDesyncError`.
4. Observability: `exc_info=r` en `_dispatch`; logging raw snapshot WS (INFO resumen + DEBUG completo).
5. Tests: 4 nuevos (filtrado size=0, seq no avanza tras error, regresión con magnitudes -6247/-4887, stack trace en log).

**B — Rediseño con cross-validation REST↔WS:** descartada. Realista ~800–1500 líneas + 1–2 semanas + nuevos vectores. Cross-validation no soluciona bug de parsing, solo lo detecta tarde.

**C — Continuar V1 indefinido:** descartada por ahora. Bloquea Motor 1 sin razón técnica suficiente (bug está identificado y es contenido).

## Lección 9 — runbook literal vs interpretación clemente

La activación validó empíricamente la disciplina del runbook literal. Tres momentos:
1. Pre-ventana: el plan del CTO (Gemini) suavizó 3 puntos críticos (ventana de supervisión, criterios de éxito y rollback). La review adversarial los restauró.
2. T+5min: Claude Code reportó "criterios en verde" con 19 errores no-SidGap (>6x umbral). Interpretación clemente refutada por el operador humano.
3. T+25min: línea defensiva (1 error adicional = rollback) disparada. Rollback en 6 min.

**Anti-patrones confirmados:**
- "Softening del runbook a mitad de incidente"
- "Es el feed/sistema externo el que falla" sin discovery del propio código primero
- "Es ráfaga aislada de bootstrap" como interpretación post-hoc para evitar rollback
- "Retrasar incrementa la deuda del roadmap" como presión retórica sin sustento técnico

**Decisión derivada:** los criterios numéricos del runbook se aplican literalmente. Las interpretaciones clementes se documentan como excepciones conscientes con razones explícitas, no como default silencioso de las capas operacionales.

## Multi-agent workflow validado
- **Gemini (CTO):** propone plan con framing optimista — punto de partida, no verdad
- **Claude:** review adversarial restaura el runbook literal — capa de disciplina
- **Claude Code:** ejecuta + reporta — capa operacional, tiende a interpretación clemente de criterios numéricos
- **Yo (Noel):** sostengo el runbook literal y tomo decisiones — única capa que aplica el contrato

La decisión pertenece al operador del runbook (humano), no a los agentes que asisten.

## Métricas y telemetría

### Pre-flip V1 baseline (40h healthy antes de ventana)
- `capture_running=true`, `ws_connected=true`, `tracked_markets=41`
- `last_error=null`, snapshots 40/40 cada 5 min
- `orderbook_events`/min: ~117

### Durante V2 activo (27 min)
- `books_initialized=40/40`, `sids_recovering=0`, `gaps_last_60s=0`
- WS y capture sin regresión
- `orderbook_events`/min: 108 (-7%, bootstrap esperable)
- **87 errores `delta produces qty<0` en 12 ráfagas**

### Post-rollback V1 (13h+ estable a 2026-05-26 18:13 UTC)
- Sin errores `delta produces qty<0`
- 289,986 events en último ciclo, 4,590,874 acumulados
- Tasa sostenida: ~6.2 events/s
- 39 markets tracked (mix multi-deporte ahora: MLB + UCL + NHL)
- DB growth: ~250 MB/día confirmado (= 90 GB/año proyectado)

## Fix Opción A entregado por Claude Code (mergeable)

**Commits:** `ed7b7ac` (cambios lógicos) + `b9abaa0` (correcciones de formato/tests vs brief).

**Archivos modificados:**
- `src/strategies/motor_1_arbitrage/orderbook_manager_v2.py`:
  - líneas 170-175: swap orden seq/apply en `handle_message`
  - líneas 343-348: logging INFO/DEBUG raw snapshot
  - líneas 415-416: filter `size=0` en `_parse_fp_levels`
- `src/clients/kalshi_ws.py` línea 320: `logger.opt(exception=r).error(...)` (compatible con Loguru)
- `tests/strategies/motor_1_arbitrage/test_v2_fixes.py`: 4 tests nuevos

**Suite completa: 282/282 ✓** sin regresiones.

**Una desviación técnica justificada:** el brief especificó `exc_info=r` (patrón stdlib logging). El stack del proyecto usa Loguru — `exc_info=` se ignora silentemente. Claude Code escaló y aplicó `logger.opt(exception=r).error(...)` (API equivalente correcta para Loguru). Test #4 valida que el wrapper recibe la excepción real. Aplicación correcta de la cláusula de escalación del brief.

## Decisión disciplinada (2026-05-26): no reactivar hoy

Tras 24h continuas operando el incidente, decisión explícita de **no abrir segunda ventana hoy** pese a tener el fix listo:
- Fatiga acumulada del operador viola espíritu del runbook 12.5 (2-3h supervisión activa)
- Fix no respiró (<2h desde commit), sin revisión sobria del diff
- V1 sano sin urgencia operativa (`TRADING_ENABLED=false`, 0 capital trabajando)

**Pendiente para próxima sesión (no requiere código):**
1. Confirmar que swap seq/apply en `handle_message:170-175` cubre también path de `_apply_snapshot_msg`
2. Verificar manualmente en Coolify que `logger.opt(exception=r)` produce el log esperado
3. Considerar Test #2b operativo (delta siguiente con seq correcta post-DesyncError se procesa OK)

Esta decisión es el primer test empírico de Lección 9 aplicada después de redactada: no relajar el runbook ni siquiera cuando es inconveniente — especialmente cuando es inconveniente.

## Deuda técnica catalogada

**Bloqueantes para segunda ventana de reactivación V2:**
- Revisión sobria del diff del fix (3 puntos arriba)
- Merge de Lección 9 al `KALSHI_BOT_CONTEXT.md` (header v1.5)
- Ventana de 2-3h libres confirmadas

**No bloqueantes (próximas ventanas):**
- Política de retención DB + VACUUM mensual vía cron (90 GB/año necesita límite)
- `runner.py:122` no setea `BotState.v2_manager` cuando Motor1=True+V2=True (bomba lenta para Fase 2)
- REST recovery storm potencial si V2 dispara `_start_recovery` para muchos tickers simultáneo

**No bloqueantes (post-Fase 2):**
- Cross-validation REST↔WS si Opción A insuficiente
- Reemplazo de SQLite por backend con mejor concurrencia si crecimiento DB lo justifica

## Métrica de éxito para la segunda ventana
No solo "no falla" sino **"no falla por la razón que arreglamos"**. Si vuelven a aparecer `qty<0` con magnitudes similares → H1 (bug `size=0`) no era el único bug, reabrir investigación con el raw snapshot logging que el fix ya instaló (cambio 2b).

## V2 attempt #2 EJECUTADO y FALLIDO (27-may 15:36→15:48 UTC)

**Resultado:** rollback en ~12 min, 4 ERROR + 1 CRITICAL en 12 min, **H1 (size=0) REFUTADA empíricamente.**

**Lo que pasó:**
- 15:36 UTC: flag flippeado, V2 activo
- T+2.7s del primer snapshot: primer error `KXMLB-26-ATL at 10c: delta produces qty=-3108 < 0`
- T+3min: gap CRITICAL, 38 tickers stale
- T+5min: server error de Kalshi `code 15 "Action required"`
- 15:48 UTC: rollback completado, V2 dormant

**El bug reapareció CON EL FIX APLICADO.** Los tres fixes de Opción A:
1. ❌ size=0 filter — el bug volvió igual
2. ❌ seq order swap — contribuyente a contener pero no impidió el origen
3. ✅ Dispatcher logging fix — funcionó, produjo stack traces completos (vs `NoneType: None` del attempt #1). **Única pieza del fix que cumplió.**

**Logs preservados:** `data/rollback_v2_attempt2_20260527_154809.log` (949 KB)

**Causa raíz arquitectónica validada:** El bot NO crashea ante estos errores. `bot_runs.crash_reason=None` para el run #31 (V2 attempt #2). 12 min de errores, cero crash. Patrón estructural de Lección 7 ("el bot dice que está corriendo" ≠ "el bot está corriendo") aplicado a estado mutable in-memory.

**Pregunta abierta para tercer discovery:** ¿Tenía `KXMLB-26-ATL` price 10c con `size>0` en el snapshot WS inicial? Logs preservados con stack traces tienen la respuesta.

## Lección 9 — committeada en repo (SHA 3a4b384)

**Versión committeada al `KALSHI_BOT_CONTEXT.md` v1.5:**
- Título: "Lección 9 (Mayo 25-27, 2026): Dos activaciones fallidas de V2, dos diagnósticos prematuros, contención disciplinada en ambas"
- **Estado de causa raíz: NO RESUELTA al cierre de esta entrada** (prominente al inicio)
- Cubre AMBOS attempts (25 y 27-may)
- Tabla "Diagnóstico afirmó vs realidad mostró" — 3 diagnósticos fallidos consecutivos
- 5 decisiones derivadas, 4 anti-patrones, sección "Lo que sí funcionó"

**Diferencia central con el borrador anterior (26-may, OBSOLETO):**
- Borrador viejo: "encontramos la causa vía discovery" (size=0)
- Versión final: "creímos haberla encontrado dos veces y nos equivocamos las dos veces, pero el sistema de contención nos protegió en ambas"
- Tono crudo intencional para prevenir confirmation bias en tercer discovery

**Anti-patrones confirmados en esta Lección 9:**
1. Atribución externa sin discovery propio primero ("es el feed")
2. Confianza prematura en un fix no validado en producción ("size=0 era la causa")
3. Interpretar criterios de runbook con discreción en mitad de incidente
4. Urgencia de roadmap como motor de decisión técnica (en proyecto solo-founder sin capital trabajando)

## Incidente V1 — WS zombie / blackout escalonado (28-may)

Detectado al revisar `/status` el día post-rollback. `last_error="WS zombie: connected but no messages for 1475s"` con timestamp 08:59:59 UTC.

**Investigación con 5 queries empíricas:**
1. Confirmó zombie REAL de ~24 min (08:36-08:59)
2. Barrido 24h reveló blackout ESCALONADO de ~3h (05:00-09:00)
3. Comparación 4 días refutó hipótesis de valle de mercado US-Eastern
4. Comparación 13-16 UTC × 12 días confirmó: V1 sano AHORA (Mundo 1)
5. Detectó 18-may posible microblackout silencioso similar

**Throughput orderbook_events por hora 28-may UTC:**
```
04h: 13.470 (OK)
05h: 6.275 (caída -50%)
06h: 7.018 (degradado)
07h: 454 (blackout -98%)
08h: 9 (blackout total)
09h: 7.576 (recovery, burst 115/309/79/238/116/min)
10h+: normalizado
```

**Capas que fallaron:**
- **Watchdog:** ciego al WS por diseño, solo monitorea `capture_running` (REST mantuvo flag en True)
- **`BotState.ws_connected`:** se setea True al entrar al contexto, solo se limpia en `finally`. Socket TCP nunca arrojó excepción → flag mintió 3h
- **`/status`:** calcula passive metric, NINGÚN componente activo del bot la lee
- **Detector zombie:** sí marcó `last_error` pero NO escala a `risk_events`, NO alerta Telegram, NO fuerza reconexión

**Esto es regresión parcial de la defensa de Lección 7** (post-blackout de 11h del 13-14 may). Material para Lección 10 (post-discovery).

**Logs disponibles:** Coolify mantiene logs del container mientras viva. `bot_runs.crash_reason=None`, sin reinicios.

## Tres frentes abiertos al cierre

| Frente | Severidad | Bloqueante para | Próximo paso |
|---|---|---|---|
| V2 causa raíz | Alta (post-mortem) | Toda activación futura de Motor 1 | Tercer discovery con logs del attempt #2 |
| V1 WS zombie | Alta (post-mortem, no urgente) | Confiabilidad data capture | Discovery read-only de `kalshi_ws.py` + `monitoring/` |
| Lección 10 | Stub | Documentación arquitectónica | Llenar post-discovery V1 |

## Decisión disciplinada del 28-may: parar HOY

- Llevo 3+ días intensos en frente V2, y 1 día más con incidente V1
- Discovery de código async/concurrencia cansado = leer mal
- V1 sano ahora, sin capital, sin urgencia
- No tocar código hoy, retomar con cabeza fresca

## 29-may — Fix V1 mergeado + validado 7h + tercer discovery V2

### Fix V1 watchdog implementado (commit `21fe6fd`)
Tres cambios sobre los 3 bugs firmes del discovery:
1. **`force_reconnect()`** — cierra socket sin tocar `_running`. Loop exterior reconecta naturalmente.
2. **Watchdog reactor** — cuando silence > 300s: incrementa contador, `record_error`, `force_reconnect`, alerta Telegram tras 2 detecciones.
3. **`LAST_ERROR_TTL_SEC = 900.0`** — TTL con `current_error()` que expira/limpia.

Suite verde, 4 tests nuevos incluyendo integración real contra socket. PR mergeado a main, Coolify deploy.

### Validación 7h 14min en producción
```
TOTAL POSTDEPLOY: 161.169 eventos en 7h 14min
RANGO: 06:13:34 → 13:28:17 UTC
MINUTOS CONTINUOS CON DATA: 435 de 435
MINUTOS_MISSING: 0   ✓
```
- 0 `force_reconnect` espurios
- 0 zombie detecciones
- Throughput dentro del baseline sano (5k-56k/h)
- **Hora 08h: 6.831 eventos** (mismo valor que destruyó el 28-may) → **valle natural** seguido de pico 09h (37k) y 10h (56k). Misma cifra, significados opuestos.

**Frente WS V1 CERRADO LIMPIO.** Esta vez la validación es REAL — 7h de producción, no "tests verdes" como en V2.

### Tercer discovery V2 — H1 REFUTADA empíricamente
Forense surgical del log preservado `data/rollback_v2_attempt2_20260527_154809.log`:

**Pregunta:** ¿El price 10c de KXMLB-26-ATL tenía size>0 en el snapshot WS inicial?

**Respuesta del log (líneas 7703-7704):**
- YES side, 10c: `1114.07` (~1114 cents)
- NO side, 10c: `500.00` (~500 cents)
- **size > 0 en AMBOS lados**

**H1 (size=0 filter) REFUTADA como causa.** El bucket tenía estado válido. El delta llegó a un orderbook con valores legítimos y aun así produjo `qty=-3108`.

### Hallazgos extra del forense
- No hubo deltas previos al ticker entre snapshot y error
- Error coincidió con gap de sequence (`expected seq=40, got 41`) 2ms después
- Triggering delta side AMBIGUO — log no captura delta crudo, solo resultado
- Magnitud inferida del delta: ~-4222 (YES) o ~-3608 (NO)

### Pivot V2 — nuevo espacio de hipótesis
**Abandonar variantes de size=0.** Buscar en:
- **H2:** Dispatcher / aplicación de deltas defectuosa (¿cómo apply_delta computa qty<0 sobre size válido?)
- **H3:** Ordenamiento / out-of-order (gap seq=40 es señal fuerte de delta fuera de orden)
- **H4:** Interpretación del snapshot (¿shape de parseo de `yes_dollars_fp` correcto?)

NO tocar producción. NO escribir fix. Próximo discovery enfocado a estas hipótesis cuando se retome el frente V2.

### Lección 10 redactada (causa cerrada, fix validado)

**Estado de causa raíz: VALIDADA** — silencio aplicativo de feed externo con TCP vivo, sin detector de aplicación en V1.

**Decisiones derivadas (5):**
1. Detección de silencio aplicativo es obligatoria cuando se tiene loop sin timeout
2. Métricas calculadas que nadie consume son anti-patrón
3. Defensas de lecciones anteriores deben validarse al agregar código nuevo
4. `last_error` debe tener TTL o stickiness explícita
5. Atribución externa requiere refutar hipótesis internas con discovery arquitectónico

**Anti-patrones confirmados:**
- "Dashboard sin actuador" (métricas que no se consumen)
- "Defensa de lección previa que regresó silenciosamente" (regresión Lección 7)
- "Decoupling que oculta fallas" (REST ocultó WS muerto)
- "Atribución externa por eliminación de hipótesis internas"

Pendiente: commit al `KALSHI_BOT_CONTEXT.md` v1.6 (contenido listo).

## Estado consolidado al cierre del 29-may

| Frente | Estado |
|---|---|
| V1 WS zombie | ✅ CERRADO LIMPIO (fix validado 7h) |
| Lección 10 | ✅ Redactada, pendiente commit administrativo |
| V2 causa raíz | 🔄 Pivot a H2/H3/H4, próximo discovery cuando se retome |
| Capital | 🔒 Cero — `TRADING_ENABLED=false`, sin urgencia |

## Patrones meta validados los últimos 4 días

1. **Validación en producción ≠ tests verdes.** V2 attempts: tests verdes, falla en prod. V1 watchdog: tests verdes + 7h prod = cierre real.
2. **Atribución externa requiere refutar hipótesis internas con discovery arquitectónico.** "REST estable → externa" no prueba sin saber acoplamiento de loops.
3. **Logs preservados de incidentes pasados son insumo de validación.** El forense V2 refutó H1 sin re-activar V2.
4. **Trabajo de cabeza fresca > trabajo maratónico cansado.** Discovery surgical del log V2 salió en una sola pasada porque arranqué descansado.

## Próximos pasos (no urgentes)

## 30-may — Cuarto discovery V2 + correcciones + plan instrumentación

### Cuarto discovery: tres correcciones a hallazgos del 29-may

**Corrección 1 — "Gap seq=40" era ARTEFACTO, no señal independiente.** Código probó (`orderbook_manager_v2.py:159-174`): cuando `_apply_delta_msg` lanza `OrderbookDesyncError`, `self._last_seq_by_sid[sid]` no avanza (línea 174 condicional). El siguiente mensaje con seq=41 produce "expected 40, got 41". El gap es efecto colateral del crash, no señal de mensaje perdido. **Message-loss eliminado como causa.**

**Corrección 2 — "El bucket estaba en 1114 al momento del delta" era overreach.** `_apply_delta_msg` no loggea aplicaciones exitosas. Entre snapshot (seq=2) y error (seq=40), 37 deltas no logueados. **Estado del bucket pre-delta es punto ciego.** Inferencia "delta = -4222" no establecida.

**Corrección 3 — 3 dominios de seq coexistentes** (batch snapshot index, Sid global del WS, per-delta seq del feed). Código NO mezcla dominios incorrectamente, pero **amplifica blast radius**: un crash dispara `_start_recovery(sid)` marcando 38 tickers stale.

### Comparación lado a lado parsing snapshot vs delta

| Punto | Snapshot | Delta | ¿Idéntico? |
|---|---|---|---|
| Conversión precio→cents | `parse_price_to_cents()` | `parse_price_to_cents()` | ✅ Misma función |
| Conversión size→int | `parse_size()` | `parse_size()` | ✅ Misma función |
| Filtro `size==0` | SÍ (dos veces) | NO | ⚠️ Asimetría latente |
| Side handling | yes/no separados | side del msg | ✅ Consistente |
| Routing | Solo bids | Solo bids | ✅ Consistente |

**Parsing limpio.** No hay mismatch lógico que explique `qty=-3108` partiendo de bucket 1114 o 500.

**Pero filtro size=0 asimétrico NO aplica al caso ATL** (su bucket tenía 1114/500, no cero). Queda como bug latente catalogado.

### Sesgo hardcodeado encontrado
`orderbook.py:65`: `"new_qty < 0 indicates feed-level corruption"`. La excepción se llama literal `(feed corruption)`. **El código pre-juzga causa externa.** Diagnósticos futuros se contaminan con esa palabra antes de pensar. Eliminación pendiente para Opción A2/B.

### Anti-patrón cazado en tiempo real
Claude Code y Gemini concluyeron: *"V2 exculpado, indiscutiblemente es el feed."*

Lección 9 enseña a desconfiar de "indiscutiblemente". Discovery probó **parsing limpio, NO V2 limpio**. Hay 3 hipótesis vivas:
- **(A)** Feed corruption real
- **(B)** Snapshot inicial parcial — bucket real en exchange divergía del cargado por V2
- **(C)** Bug de V2 en ventana 2.7s entre snapshot y crash — deltas no logueados dejaron bucket divergente

**B y C NO son atribuibles al feed.** Concluir "es el feed" sería **atribución externa redux** — el mismo anti-patrón del 25-may en forma más sofisticada.

Capa adversarial cazó la trampa: **V2 NO ESTÁ EXCULPADO.** Causa raíz sigue ABIERTA.

### Plan: instrumentación asimétrica antes de tercera ventana

**Branch PR #2 nueva** (separada del PR #1 watchdog):
- Update Lección 9 al `KALSHI_BOT_CONTEXT.md` (párrafo redactado)
- `_apply_snapshot_msg`: `logger.debug` con `raw_msg` completo (sin truncar a 3 levels)
- `_apply_delta_msg`: try/except + `logger.error` con `raw_msg` + bucket state defensivo + re-raise idéntico

**Por qué asimétrico:**
- Snapshot DEBUG (1 por ticker en bootstrap, no inunda; útil para hipótesis B)
- Delta ERROR (solo cuando crashea, se persiste con LOG_LEVEL=INFO — el mismo fix del 25-may para evitar `NoneType: None`)

**Acceso defensivo al bucket:** usar `state` ya en scope + `.get(price)` + bloque de logging envuelto en su propio try/except. Sin esto, un `KeyError` enmascararía el `OrderbookDesyncError` original.

**Verificación previa obligatoria:** Claude Code debe confirmar estado actual del try/except antes de escribir (patrón del 27-may con `logger.opt`).

### Tercera ventana V2 — DESACOPLADA

La instrumentación es **preparación**, no activación. La cámara queda apagada hasta la tercera ventana.

**La tercera ventana es decisión de GESTIÓN** (cuando haya 2-3h continuas), **NO siguiente paso técnico**. Lección 9: "La urgencia de sprint es un fantasma en proyecto solo-founder sin capital trabajando."

Después de mergear PR #2: NO encadenar activación. Cierre de sesión.

## Estado consolidado al cierre 30-may

| Frente | Estado |
|---|---|
| V1 WS zombie | ✅ CERRADO (PR #1 mergeable) |
| Lección 10 | ✅ Redactada (commit administrativo pendiente) |
| V2 cuatro discoveries | ✅ Cerrado en su límite informacional |
| V2 instrumentación | 🔵 PREPARADA (brief + update + decisión branch) |
| V2 tercera ventana | 🔒 DESACOPLADA (decisión de gestión) |
| Capital | 🔒 Cero |

## Próximos pasos (no urgentes)

## 30-may TARDE — Watchdog en prod + V2 attempt #3 CAUSA RAÍZ CAPTURADA 🎯

### Watchdog V1 → producción
- PR #1 (`claude/nifty-darwin-2s7wm`) mergeado → commit `b52a052` → deploy.
- Validación: 7h+ sin force_reconnect espurio, sin tracebacks post-deploy, throughput continuo.
- Frente WS V1 cerrado limpio.

### Tercera ventana V2 (17:41 UTC) — capturó causa raíz
Pre-flight completo por primera vez con los 4 ✅:
- Backup íntegro (`integrity=ok`)
- Flags por nombre (`printenv VAR1 VAR2`, NO env dump — corrección de seguridad al runbook para no exponer `KALSHI_API_KEY_ID`, `TELEGRAM_BOT_TOKEN`)
- Telegram confirmado **EN EL CLIENTE** (no solo `sent=True` de la API)
- Código verificado en vivo (no por commit message)

**Activación:** 17:41:01 UTC, USE_ORDERBOOK_MANAGER_V2 false→true.

### SMOKING GUN (log capturado por la instrumentación del PR #2)

```
msg_seq=186 state_seq=184 side=yes price_cents=3 delta_size=-13 bucket_qty_pre_delta=2
```

- Bot interno en seq=184
- Llega delta seq=186
- **Falta el seq=185**
- V2 aplica directo: 2 + (-13) = -11 → OrderbookDesyncError
- Ticker: KXMLB-26-PHI a 3¢
- Tiempo desde activación: T+37 segundos

**El feed entregó secuencia válida y consecutiva (184 → 185 → 186). V2 saltó el 185 durante bootstrap.**

### Hipótesis: estado final tras attempt #3

| Hipótesis | Estado |
|---|---|
| (A) Feed corruption real | ❌ DESCARTADA — feed entregó secuencia consecutiva |
| (B) Snapshot inicial parcial | ❌ DESCARTADA — bug en manejo de gap, no en snapshot |
| (C) Bug interno V2 en gap/recovery en bootstrap | ✅ **CONFIRMADA con evidencia dura** |

### Cascada del incidente
- 17:41:08 — primer error (KXMLB-26-PHI)
- 17:41:08 — Sid 1 gap detected → `_start_recovery` → 37 tickers stale
- 17:41:0X — Kalshi `code 15 "Action required"`
- 17:47:XX — `books_initialized: 0` a T+6min, recovery NO convergió
- 17:47:XX — Rollback ejecutado <5min, V1 baseline sano

### Logs preservados
- `data/v2_attempt3_20260530_174849.log` (29 KB, 390 líneas)
- En volumen Docker persistente, sobrevive restarts
- Contiene `raw_msg` pre-corrupción, cadena completa de error, `_start_recovery`, `/status`

### Sesgo hardcodeado de `orderbook.py:65` confirmado erróneo
El código dice: `"new_qty < 0 indicates feed-level corruption"`. El attempt #3 prueba que es desync interno, NO feed. El label `"(feed corruption)"` encubrió la causa real durante 5 días. **Acción derivada:** eliminarlo en el fix definitivo.

### Comparación los 3 attempts

| Atributo | #1 (25-may) | #2 (27-may) | #3 (30-may) |
|---|---|---|---|
| Duración pre-crash | ~5 min | ~12 min | **~37 segundos** |
| Stack traces | `NoneType: None` (perdidos) | Completos | **Completos + `raw_msg`** |
| Causa identificada en su momento | "feed corruption" (falsa) | "size=0" (falsa) | **"desync interno" (confirmada)** |
| Resultado neto | Rollback limpio | Rollback + logging fix valida | **Rollback + CAUSA CAPTURADA** |

**Tendencia:** cada attempt crashea más rápido pero captura más información.

### Decisiones tomadas durante la ventana

1. Rollback al primer error en T+37s sin esperar línea defensiva T+30min (regla literal del runbook).
2. NO escribir fix hoy. Cuarto discovery primero, otra sesión.
3. PR #2 cumplió su propósito y puede mergearse limpio.
4. Sesión cerrada disciplinadamente post-rollback.

## Estado del frente V2 al cierre del 30-may noche

- ✅ Causa raíz IDENTIFICADA (desync de secuencia en bootstrap)
- ✅ Hipótesis C confirmada con evidencia
- ✅ A y B descartadas
- ✅ PR #2 cumplió su propósito (instrumentación + Lección 9 update #1 mergeados)
- ⏳ Cuarto discovery pendiente para entender mecanismo exacto
- ⏳ Diseño fix de bootstrap/gap-handling post-discovery
- 🔒 V2 sigue dormant
- 🔒 Cuarta ventana = decisión de gestión separada (solo post fix validado)

## Meta-aprendizajes validados

1. **La instrumentación pagó.** 25-may volamos a ciegas (`NoneType: None`). 30-may el `raw_msg` en ERROR resolvió en una ventana lo que 4 discoveries no pudieron.
2. **"Capturar es ganar"** — V2 falló pero la ventana fue éxito porque salió con evidencia.
3. **Sistema de contención funciona en todas las capas** — agentes frenaron solos ante backup colgado y arranque "no verde".
4. **Pre-flight literal por primera vez** con los 4 ✅. Sin atajos.
5. **Lección 9 "atribución externa requiere refutar internas"** — sin esa disciplina, attempt #3 hubiera ido a buscar variantes del feed y se hubiera perdido la causa.

## Próximos pasos (no urgentes, en orden)

1. Cuarto discovery sobre log preservado
2. Diseñar fix de bootstrap/gap-handling
3. Test fix offline (escenario reproducido: seq=184 → seq=186 sin 185)
4. Commit update Lección 9 #2 al `KALSHI_BOT_CONTEXT.md` v1.7
5. Commit Lección 10 al `KALSHI_BOT_CONTEXT.md`
6. Cuarta ventana V2 (post-fix validado, decisión separada)
7. Si V2 estable a T+2h → desbloquear Motor 1 (paso separado)

## Segunda ventana V2 — preparación completa (27-may, contexto previo)

**Revisión sobria del diff (cerrada limpia):**
- `b9abaa0` confirmado como format/tests sin cambios funcionales
- Lógica V2 efectiva = `ed7b7ac`
- Tests endurecidos (no relajados): ticker de producción `KXMLB-26-ATH`, seq 100/101 + 1000/1001, regresión con magnitud -6247

**Inspección de `_apply_snapshot_msg` (3 min, confianza estructural):**
- TODAS las excepciones posibles del path snapshot ocurren antes del seq update
- `apply_snapshot` es atómica: 8 setattr en asyncio single-thread sin await
- Cero corrupción posible
- Hallazgo colateral: `parse_price_to_cents` no valida rango [0,100] → ticket de hardening defensivo (NO bloqueante)

**Cheat-sheet operativo finalizado con adiciones de Lección 9:**
- Sección 5.bis nueva: línea defensiva T+5 a T+30, 1 error no-SidGap adicional = rollback inmediato sin réplica
- Sección 6 ampliada: preservar logs en archivo (`docker logs --tail 1000 > /tmp/rollback_TIMESTAMP.log`) ANTES de cualquier debug

**Pre-flight ejecutado (27-may 14:58 UTC):**
- Backup SQLite con `.backup` + integrity_check `('ok',)`: 619 MB persistidos
- Telegram API: `send_alert returned: True` (drift documentado: cheatsheet decía `alert_info`, no existe → corregido a `send_alert`)
- /status: `capture_running=True`, `ws_connected=True`, 38 markets, 3 motors False, `trading_enabled=False`, V2 OFF

**Gates pendientes para flippear:**
- Confirmación de recepción Telegram en cliente (API solo confirma 200, no entrega)
- SHA de Lección 9 mergeada al `KALSHI_BOT_CONTEXT.md` v1.5

## Próximos pasos (orden)
1. Confirmar Telegram recibido + SHA Lección 9
2. Web Agent flippea `USE_ORDERBOOK_MANAGER_V2: false → true` en Coolify + verifica `MOTOR_1_ARBITRAGE_ENABLED=false` y `TRADING_ENABLED=false` antes de Save
3. Redeploy + esperar log `OrderbookManagerV2 registered (data-capture only, no Motor 1)`
4. T+5 a T+30: línea defensiva activa (1 error no-SidGap = rollback inmediato)
5. T+2h: criterios de éxito runbook literal
6. Si V2 estable a T+2h → desbloquear Motor 1 (paso separado, otra ventana, otro día)
7. Si rollback → diagnóstico empírico antes de tercera ventana (NO reintentar inmediatamente)

## Referencias clave
- Runbook 12.5 — en `KALSHI_BOT_CONTEXT.md` del repo (v1.5 con Lección 9 pendiente merge)
- Lección 7 — WS muerto silenciosamente con bot "healthy" (precedente del patrón "todo verde + bug oculto")
- Lección 8 — "deuda del roadmap" como retórica vs argumento técnico
- Lección 9 — runbook literal, atribución externa prematura, fix sin respirar (este incidente)
- Lección 9 — runbook literal vs interpretación clemente (este incidente)
