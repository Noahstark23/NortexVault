# Proyecto: kalshi-bot

> Fuente consolidada para NotebookLM. Standalone — sin wikilinks no resueltos.
> **Última actualización: 2026-06-03** — **Motor REST infra completa: tickets 1+2 commiteados (`a873d8f`), ticket 3 implementado (por commitear → PR #13). Falta solo FOKExecutor (sesión fresca + demo) y wiring del shadow.**
>
> **📅 PARA NOTEBOOKLM:** este documento incluye actualizaciones en orden cronológico. Las secciones más recientes están al final, marcadas con `**🗓️ AGREGADO 2026-MM-DD**`. Cuando re-subas a NotebookLM, lo más nuevo siempre tiene fecha visible.

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

---

## 🗓️ AGREGADO 2026-05-31 — Cuarto discovery + correcciones + misterio Part A

### Status V1 (31-may 15:11 UTC): SANO 21.3h continuas

Bot lleva **21.3 horas sin un solo error** desde el rollback del attempt #3 (30-may 17:54 UTC). `last_error: null`, `ws_connected: True`, 37 markets tracked, todos los motores off.

**Validación retroactiva de la decisión de rollback del 30-may.** Comparación:
- V2 attempt #1: rollback ~25 min (87 errores)
- V2 attempt #2: rollback ~12 min (4 ERROR + 1 CRITICAL)
- V2 attempt #3: rollback ~6 min (1 OrderbookDesyncError)
- V1 baseline post-rollback: **21.3h sin errores**

V1 lleva más tiempo limpio que la suma de las 3 ventanas V2 combinadas.

### 🔧 CORRECCIÓN al diagnóstico del 30-may

**Lo que decíamos el 30-may (parcialmente mal):**
> *"V2 saltó el seq=185, Kalshi entregó secuencia consecutiva 184→185→186."*

**Lo que el código muestra (31-may):**
El `seq` es **global-por-sid**, NO por-ticker (orderbook.py:265-268). Que PHI vaya de 184 → 186 NO significa que falte el 185 globalmente. **El 185 fue casi con certeza un delta de OTRO ticker del mismo sid.** A nivel por-ticker, los huecos son normales — no hay contigüidad por-ticker.

**La causa real (más simple, más grave):**
Durante el bootstrap, V2 NO tenía ni buffering ni detección de gap:
1. **Buffering gateado por recovery:** `if sid in self._recovering:` — pero `_recovering` solo se puebla post-gap-detection. **Durante bootstrap está vacío.**
2. **Detección de gap requiere key inicializada:** `if sid in self._last_seq_by_sid:` — antes del primer apply exitoso, esa key no existe. **No hay rama `else` → los primeros mensajes saltean detección de gap por completo.**

**Resultado:** V2 empezaba a aplicar deltas apenas llegaba el primer snapshot, sin sincronización. Los deltas pre-snapshot (válidos) se descartaban silenciosamente con `logger.warning("...skipping"); return`. **Book sub-construido → `qty<0`.**

El `qty=-11` no vino de delta corrupto ni gap real — vino de aplicar un delta válido sobre un book al que le faltaban actualizaciones que se tiraron a la basura durante el arranque.

### Q3 — La bomba activa: recovery sin convergencia

**Segundo bug independiente y más grave que sigue activo en main:**

El recovery solo sale de `_recovering` cuando llegan snapshots de TODOS los tickers. **No hay timeout. No hay retry. No hay limpieza ante error.**

Si Kalshi responde `code 15` al `get_snapshot` masivo:
- Ningún recovery snapshot vuelve
- `_recovering` queda atrapado permanentemente
- Todos los deltas se bufferean indefinidamente
- Books nunca se re-inicializan → `books_initialized: 0`
- **V2 muerto silenciosamente**

**Es Lección 7 (WS zombie) en otra capa** — bot reporta "healthy" pero los books no se actualizan.

### 🚨 MISTERIO Part A

Durante el cuarto discovery (31-may), Claude Code mencionó dos veces que "Part A ya está mergeada" — un fix de bootstrap buffering en commit `49231da`.

**El usuario no recuerda haber aprobado ni revisado ese fix.** Si está en main sin review, viola toda la disciplina del workflow (gates de Lección 9).

**Acción pendiente antes de cualquier paso de Part B:** verificar `commit 49231da`. Si existe → auditoría retroactiva. Si no → aclarar de dónde sacó Claude Code la idea.

### Brief Part B (recovery robusto) — diseño aprobado con 3 verificaciones

**Cierra el bug Q3** (recovery sin convergencia). Diseño aprobado por capa adversarial:

| Hueco | Solución (Opción B) |
|---|---|
| ¿`code 15` es snapshot o sesión? | **Circuit breaker de conexión** — reusa `force_reconnect()` del watchdog. Eviction por ticker solo para timeouts locales |
| "Modo pasivo" indefinido | **Degradación a V1** — destruir book in-memory pero seguir captura REST/SQLite. Reset 00:00 UTC |
| Cap de buffer | **1000 mensajes** — evict por tamaño O tiempo |

**3 verificaciones obligatorias para el brief de implementación:**
1. ¿`force_reconnect()` re-autentica o solo re-socket? (Verificar en código antes de implementar)
2. Descarte silencioso ante `_books[ticker]=None` (sin AttributeError)
3. Cap de 1000 calibrable, NO valor sagrado

**Encuadre central:** Part B implementada ≠ V2 listo. Aún con A+B mergeadas, V2 sigue dormant. **Falta cuarta ventana de activación** para validar en vivo. Tests unitarios cubren timeout pero no `code 15` real ni dinámica de bootstrap en prod.

### Anti-patrones cazados HOY (31-may)

1. **"Falta el seq=185 a nivel ticker"** — atribución sin validar contra código. Era global-por-sid. Yo (Claude) lo cometí ayer.
2. **"Part A ya mergeada"** sin review adversarial — bug de proceso.
3. **"Implementar A+B en una corrida"** — Gemini intentó mezclar diseño + implementación.
4. **Recordatorio del Lección 9:** la atribución técnica también necesita capa adversarial. Caí en framing apresurado en algo sutil hoy (seq global vs por-ticker). El sistema funcionó: Claude Code lo corrigió desde código.

### Estado consolidado al 31-may

| Frente | Estado |
|---|---|
| V1 baseline | ✅ SANO 21.3h continuas |
| Watchdog V1 | ✅ En prod (`b52a052`) |
| Cuarto discovery V2 | ✅ Cerrado desde código (Q1-Q4) |
| Diagnóstico 30-may | ⚠️ CORREGIDO el 31-may |
| Causa real V2 (Q2) | ✅ Ventana ciega de bootstrap |
| Bomba activa (Q3) | ⚠️ Recovery sin convergencia |
| MISTERIO Part A | ⏳ Pendiente verificar `49231da` |
| Diseño Part B | ✅ Aprobado con 3 verificaciones |
| Implementación Part B | 🔒 BLOQUEADA hasta resolver Part A |
| Cuarta ventana V2 | 🔒 DESACOPLADA |
| Capital | 🔒 Cero |

### Próximos pasos (orden estricto, ninguno urgente)

1. **Resolver misterio Part A** (`commit 49231da`)
2. Si Part A confirmada: auditoría retroactiva del diff
3. Claude Code verifica re-auth en `run()` (Verificación 1)
4. Consolidar brief definitivo Part B con verificaciones cerradas
5. Brief definitivo → review adversarial otra vez
6. Implementar Part B (separado, con review del diff)
7. Tests: deltas pre-snapshot + timeout dispara retry+evict
8. Cuarta ventana V2 con runbook 12.5 + instrumentación
9. Si V2 estable a T+2h → desbloquear Motor 1

---

## 🗓️ AGREGADO 2026-06-01 — Auditoría PR #11 + PIVOT ESTRATÉGICO a Opción 2

### Status V1: 22.7h continuas sin errores
Bot sigue sano en baseline V1. 34 tickers tracked, todos los motores off, V2 dormant. Sin novedad runtime.

### AUDITORÍA PR #11 — dos gaps críticos cazados

PR #11 (Part B) tenía supuestamente "lógica de recovery implementada y testeada (23/23 tests verdes)". La auditoría pidió 4 verificaciones específicas, que destaparon **2 gaps catastróficos:**

**Gap (b) CRÍTICO — supervisor NO se lanza:**
- `_recovery_supervisor()` definido pero NUNCA hace `asyncio.create_task(...)` en wiring
- Con V2 activo, el supervisor no corre → recovery huérfano permanente garantizado
- Sin esta auditoría, cuarta ventana habría reproducido el attempt #3 exacto

**Gap (c) ALTO — reintegración 00:00 UTC solo en docstring:**
- Ningún código limpia `_evicted` en runtime
- Tickers evictados quedan inutilizables hasta restart manual

**Los 23/23 tests verdes NO detectaron los gaps** porque testean `_check_recovery_timeouts` (cuerpo de un tick), NO el loop como task corriendo. **Tests verdes ≠ wiring completo** — exactamente el anti-patrón de Lección 9.

### Tres discrepancias Code vs brief — Code TENÍA RAZÓN

Durante la auditoría, Claude Code defendió 3 puntos donde divergía del brief:
1. Cap RAM: `_bootstrap_buffer[ticker]` no `_pending_deltas[ticker]` (brief habría dado `KeyError`)
2. **Guarda None-safe usando set explícito `_evicted` no `_books.get(ticker) is None`** (brief habría descartado tickers NUEVOS → bootstrap roto catastróficamente)
3. Tick 1s no 5s (granularidad correcta para timeout de 10s)

Code defendió código correcto contra brief con 2 bugs. Sistema funcionando.

### Diseño B1+A2 propuesto → crash-loop destapado

Para cerrar los gaps, se propuso:
- **B1:** supervisor in-process aislado con backoff + escalada
- **A2:** cap de arranques en runner + modo seguro durable

Pero la auditoría destapó: `runner.py` NO relanza nada. Tras muerte de task, proceso termina (exit 0), Docker reinicia el contenedor con `restart: unless-stopped` **SIN CAP**. Si el bootstrap post-restart falla → supervisor muere → reinicio → loop. **"Anti-zombie" produciría otro zombie: crash-loop de contenedor infinito.**

### LA PREGUNTA DE FONDO

> *"¿V2 vale toda esta complejidad? Cada auditoría destapa otra capa que requiere otra solución. Estamos construyendo una fortaleza de 6 capas para un componente auxiliar."*

### 🔄 PIVOT — Gemini propone Opción 2

En vez de defender V2, Gemini propuso tirarlo:

> *"Estamos cayendo en la trampa clásica: agregar complejidad para corregir la fragilidad de un diseño subyacente. Mi deber es evitar que te desangres manteniendo un clon de un motor de matching en memoria."*

**Opción 2 — REST híbrido:**
- WS solo para ticker (liviano, sin desync)
- Cuando ticker dispara arbitraje → REST snapshot bajo demanda
- Latencia 50-100ms vs 1ms
- **Elimina el 95% del código de V2** (sin supervisores, sin buffers de bootstrap, sin riesgo qty<0)

**Argumentos técnicos:**
1. **Edge en Kalshi persiste segundos/minutos** (fricción retail) — NO microsegundos contra Citadel. V2 estaba sobre-diseñado.
2. **Rate limit lo permite:** 200 reads/sec capacidad, 4 mercados × 20Hz = 80 reads/sec dentro del límite.
3. **Insight central:** *"V2 se volvió intrínsecamente frágil porque el feed castiga asimétricamente cualquier desfase de la máquina de estados local."*

### Pivot APROBADO con dos condiciones

- ✅ **Benchmark numérico** antes de implementar
- ✅ **B1+A2 archivado** (no descartado — referencia si pivot falla)
- ✅ **PR #11 congelado** indefinidamente
- ✅ **Criterio de decisión definido A PRIORI** (anti-confirmation-bias)
- ✅ **Análisis paralelo del edge** sobre data V1 (¿hipótesis "edge dura minutos" es real?)

### Benchmark REST spec

**Mide:**
- Path COMPLETO (snapshot + parseo + evaluación arb), no solo HTTP GET
- Concurrencia REAL (4 tickers × 20Hz sostenido), no secuencia
- Mercados activos en horario activo

**Criterio (definido ANTES de ver números):**
- Opción 2 GANA: P99 < 150ms AND 429 < 2% AND otros errores < 1% AND latencia estable
- Opción 2 PIERDE: P99 > 300ms OR 429 > 10% OR latencia crece > 50%

### PATRÓN NOMBRADO — "diseño + implementación en mismo turno"

Cuando le pedí trazabilidad de PR #7 y PR #11, Claude Code respondió:
> *"Las directivas de implementación venían en el mismo turno que el diseño, con EXECUTION MODE, sin checkpoint intermedio. Su aprobación formal y el código se pidieron juntos."*

**Patrón:** directivas que combinan diseño + implementación colapsan el gate. NO es desobediencia de Code — es falla del operador al estructurar la directiva.

**Antídoto:** un verbo único por turno para componentes críticos. "Diseñá X" y "Implementá X" NUNCA en el mismo mensaje. EXECUTION MODE = bandera roja.

Casos documentados: Part A (commit 49231da), PR #7 (Decimal), PR #11 (Part B). Atajado 4 turnos consecutivos esta semana sin reaparecer.

### Anti-patrones cazados HOY

1. **Tests verdes ≠ wiring completo** (23/23 pero supervisor no corre)
2. **"Docstring" ≠ "implementado"** (reintegración solo en doc)
3. **Brief con bugs vs implementación correcta** (Code defendió razón en 3 discrepancias)
4. **"Anti-zombie" produciendo otro zombie** (crash-loop de contenedor)
5. **Fortaleza para corregir fragilidad de diseño** (cada hueco → más capas)
6. **Directivas que colapsan el gate** (causa raíz nombrada)

### Estado consolidado al cierre del 01-jun

| Frente | Estado |
|---|---|
| V1 baseline | ✅ SANO 22.7h |
| V2 PR #11 | 🔒 CONGELADO (2 gaps bloqueantes) |
| B1+A2 fortress | ✅ Archivado tras pivot |
| Pivot Opción 2 | ✅ APROBADO pendiente benchmark |
| Benchmark spec | ✅ Lista, criterio a priori definido |
| Análisis edge | ⏳ Pendiente sobre data V1 |
| Patrón meta | ✅ Nombrado y corregido |
| Capital | 🔒 Cero |

### Cierre de la semana — el sistema multi-agent funcionó

Cadena completa 25-may → 01-jun:
1. V2 attempt #1 → 87 errores → rollback
2. V2 attempt #2 → smoking gun preservado por logging fix
3. V2 attempt #3 → causa raíz capturada
4. Cuatro discoveries → causa identificada (Q2 bootstrap + Q3 recovery)
5. PR #11 implementado → 2 gaps cazados por auditoría
6. B1+A2 → crash-loop destapado
7. **Pregunta de fondo → pivot estratégico a Opción 2**

**Cero líneas de la fortaleza V2 en main que no hayan sido revisadas retroactivamente.** Cada vez que el código se adelantó, el gate lo cazó. Bot sigue en V1 baseline, estable, sin capital en riesgo.

### Próximos pasos (sin urgencia, próxima semana)

1. Ejecutar benchmark REST
2. Análisis del edge sobre 5 semanas de data V1
3. Aplicar criterio a priori
4. Si Opción 2 gana: diseñar implementación → review → implementar → ventana
5. Si Opción 2 pierde: desarchivar B1+A2, cerrar 6 puntos pendientes, implementar
6. Eventualmente: ventana de activación del approach ganador
7. Si pasa T+2h → desbloquear Motor 1

---

## 🗓️ AGREGADO 2026-06-02 — CIERRE DE LA SAGA V2: Motor REST DECIDIDO

### El cierre del arco completo (25-may → 02-jun)

9 días, 3 attempts de V2 fallidos, 4 discoveries, auditorías, fortress propuesta y archivada, pivot conceptual, benchmark construido, RTT medido, tres chequeos empíricos sobre 7.9M eventos, y finalmente: **decisión arquitectónica con números**.

### El benchmark y el catch crítico del 0.49ms

Primer benchmark reportó "mediana 0.49ms del read-path". Sospecha del adversarial: *"físicamente imposible para GET transcontinental."* Confirmación honesta: medía `cursor.execute(SELECT...).fetchall()` sobre SQLite local, **NO red**. Cero round-trip a Kalshi.

**Sin este catch, decisión arquitectónica se habría tomado sobre número incorrecto.**

### RTT REAL medido

Sobre `KXNBA-26-SAS` (mercado vivo), 80 muestras warm, 0 errores:
- **Mediana 33.4ms, p95 64ms, p99 67.8ms**
- Cold (handshake): 102.3ms

### Análisis sobre 7.9M eventos

**Filtros validados:** edge ≥3c, gap-cutoff 5s. El cutoff eliminó **288,689 truncamientos** de books rancios — sin el filtro habríamos creído que el edge dura ~25s (confirmando falsamente la premisa de Gemini).

**Mediana global filtrada:** 243ms. Distribución por bucket:

| Duración | % |
|---|---|
| <1ms | 18.9% |
| 1-10ms | 16.0% |
| 10-100ms | 11.0% |
| 100ms-1s | 13.3% |
| 1-10s | 33.8% |
| 10-60s | 6.4% |
| >60s | 0.5% |

### 🔥 EL HALLAZGO INVERTIDO — liquidez DILATA, no comprime

**Gemini predijo (teoría microestructura):** "Liquidez del Mundial comprimirá edge a microsegundos → necesitás V2."

**Data probó EXACTAMENTE LO CONTRARIO:**

Curva NBA+NHL deciles de liquidez:
- Decil más ilíquido (liq~11): edge mediano **5ms**
- Decil más líquido (liq~783): edge mediano **4.06s**
- **Relación ~800× MONÓTONA en dirección OPUESTA a la teoría clásica**

**Confirmado con control por magnitud (banda 10-14c fija):**
- Q1 liq: 5.6ms
- Q5 liq: 3,467ms
- Factor 620× moviéndote SOLO en liquidez

**La dilatación es REAL e INDEPENDIENTE de la magnitud.** *"REST alcanza porque el edge es lento"*, NO *"el edge es lento solo cuando es gordo"*.

### Por qué Kalshi se comporta así (interpretación)

Kalshi NO es HFT contra Citadel. La microestructura es distinta:
1. El "edge" viene de fricción del capital retail, no de errores de pricing entre HFTs
2. Mercados ilíquidos producen edges relámpago porque cualquier orden cruza el book vacío
3. Mercados líquidos tienen books profundos → un edge necesita ser ABSORBIDO gradualmente → persiste mientras alguien lo drena

**Es la dinámica de prediction markets retail, no HFT clásico.**

### Segmentación por deporte

- **NBA:** 146K ventanas, mediana 769ms, 54% ≥20c (filón histórico, termina)
- **NHL:** 56K, mediana 7.7ms (relámpago — REST inviable)
- **Soccer (UCL):** 53 ventanas, ya en zona líquida-lenta-gorda
- **MLB-futuros:** 0% ≥10c (RUIDO — son mercados de temporada, no partido-a-partido)

### Tasa de captura REST — el número final

En Q5 (alta liquidez), por banda:

| Banda | cap >100ms | cap >64ms (p95 RTT) |
|---|---|---|
| 3-4c | 63.1% | 64.4% |
| 5-9c | 70.8% | 72.1% |
| 10-14c | 74.6% | 76.0% |
| 15-19c | 70.0% | 70.8% |
| **20c+ (gordos)** | **73.9%** | **74.9%** |
| **Pooled** | **72.6%** | **73.7%** |

**Conclusiones operativas:**
1. **REST captura ~73% del edge en mercados líquidos**
2. **NO hay penalización por magnitud** — el dinero gordo es tan capturable como el chico
3. **El peor caso de latencia NO degrada** — diferencia 100ms vs 64ms = ~1 punto
4. **El 27% perdido es estructural** — son edges sub-50ms que NI V2 captura bien

### 🎯 DECISIÓN ARQUITECTÓNICA FINAL

**Motor REST puro para el Mundial 2026 (11-jun).**

**Arquitectura:**
- **Detección:** WS al feed de ticker (liviano, sin orderbook deltas, sin riesgo de desync)
- **Trigger:** ticker muestra spread elegible (≥umbral por definir)
- **Snapshot:** GET REST `/markets/{ticker}/orderbook` (RTT 33ms p50, 64ms p95)
- **Evaluación:** parsear + derivar asks (`yes_ask = 100 - best_no_bid`) + `detect_binary_arb()`
- **Ejecución:** orden REST si confirma
- **Instrumentación obligatoria** desde primer partido del Mundial

### Lo que se archiva (recuperable, NO descartado)

- PR #11 (Part B implementada) — branch archivada
- Diseño B1+A2 (fortress con 4 correcciones cerradas)
- `orderbook_manager_v2.py` intacto en main, no se ejecuta (flag `false`)
- Cooldown determinista y wrapper anti-zombie (diseños aprobados sin implementar)

### Por qué V2 se archiva, no se borra

Por si el Mundial sorprende:
- Si el edge se comporta distinto a la proyección (proxy NBA/NHL)
- Si el 27% perdido resulta tener PnL desproporcionado
- Si la fase eliminatoria introduce dinámica nueva
- Si cambio estructural del mercado Kalshi ocurre

V2 queda como **fallback recuperable**, NO como deuda pendiente.

### Mundial 11-jun como pivot calendario-driven

- Mayor evento de liquidez global del año
- NBA termina, MLB-futuros descartado
- Soccer ya en zona líquida-lenta → Mundial profundiza dirección → favorece REST
- Si V2-light NBA-only se hubiera implementado, sería **herramienta equivocada para deporte equivocado** apenas el Mundial empiece

### Coolify restart cap NO soportado

Coolify hardcodea `restart: unless-stopped` (discusión #10259). Wrapper de entrypoint rechazado por ser **"A2 con otro nombre"** — coherente con pivot a REST. Mitigaciones existentes (Telegram alert del watchdog + healthcheck + flag manual) son suficientes para escenario REST.

### Anti-patrones cazados HOY (02-jun)

1. **Medir el proxy en vez de la variable** (0.49ms ≠ RTT real)
2. **Heredar teoría sin medir el dominio** (microestructura HFT no aplica a Kalshi)
3. **"A2 con otro nombre"** (Coolify wrapper)
4. **Refinar el número sobre proxies cuando el evento real está a días** (PnL neto NBA cuando Mundial empieza en 9 días — se mide en vivo)

### Para Lección 12 (candidato)

> *"La teoría dominante de un dominio puede no aplicar a tu microestructura específica. Medí tu mercado, no asumas el genérico."*

Microestructura HFT clásica predice compresión por liquidez. Kalshi (prediction market retail) muestra dilatación con factor 800× en dirección opuesta. Si hubieras heredado la teoría sin medir, habrías construido V2 fortress contra un problema que no existe en tu mercado.

### Estado consolidado al cierre del 02-jun

| Frente | Estado |
|---|---|
| V1 baseline | ✅ SANO continuo |
| Saga V2 completa | ✅ CERRADA con decisión empírica |
| PR #11 Part B | 🔒 Archivado recuperable |
| B1+A2 fortress | 🔒 Archivada |
| **Decisión arquitectónica** | ✅ **Motor REST para Mundial** |
| Premisa Gemini (compresión) | ❌ Refutada por data |
| RTT real medido | ✅ 33ms warm, 64ms p95 |
| Captura REST validada | ✅ 73% Q5 (sin penalización por magnitud) |
| Mundial 11-jun como filón | ✅ Validado por chequeo (b) |
| Diseño Motor REST | ⏳ Próxima sesión (con gate) |
| Decisión umbral edge | ⏳ Negocio (≥3c, ≥10c, ≥20c) |
| Capital | 🔒 Cero — `TRADING_ENABLED=false` |

### Próximos pasos (los 9 días pre-Mundial)

1. **Decisión negocio:** umbral de edge para trigger
2. **Diseño Motor REST en texto** (con gate)
3. **Review adversarial del diseño**
4. **Implementación con review del diff**
5. **Tests offline del path completo**
6. **Deploy demo** para validar pre-Mundial
7. **11-jun: kickoff** — bot vivo con instrumentación midiendo todo

### Métricas de éxito post-Mundial (que decidirán si REST queda definitivo)

- Captura efectiva ≥60% del edge (descontando RTT y profundidad)
- 0 incidentes de stale state
- 0 crash-loops
- Latencia path completo p95 < 200ms
- PnL positivo en ≥50% de partidos

Si cumplen → REST validado, V2 puede borrarse.
Si fallan → desarchivar V2, evaluar híbrido.

### Lección estratégica de la saga (9 días)

> *"Saber distinguir entre 'agregar otra defensa' y 'el approach mismo está mal' es un movimiento maduro. Y a veces, la teoría dominante del dominio NO aplica a tu microestructura específica — solo lo descubrís midiendo."*

El gate funcionó. La medición sustituyó la asunción. El Motor REST simple ganó a la fortaleza V2 compleja **porque los números así lo dijeron** — no porque sea más simple.

**9 días intensos terminan con código simple decidido, no fortaleza compleja construida.**

---

## 🗓️ AGREGADO 2026-06-02 NOCHE — Diseño Motor REST + Gates 0 y 0.5 CERRADOS + cierre disciplinado

### El arco de la jornada nocturna

Tercera sesión del día 02-jun. La saga V2 ya cerrada en la tarde con la decisión arquitectónica. Esta noche arrancó el diseño del Motor REST con disciplina de gates: cerraron los dos bloqueantes (shape ticker + FOK nativo) con datos reales, se aisló un bug latente del executor heredado, y se cortó la jornada **por disciplina sobre inercia** — el camino crítico está en el calendario, no en el teclado.

### Diseño Motor REST PR #13 — auto-§7 + revisión adversarial

Claude Code entregó el diseño con tres fortalezas observadas:
1. **Verificó interfaces reales antes de diseñar** (WS ticker, place_order, ArbOpportunity, RiskManager) — no inventó shape, usó código real
2. **Auto-marcó 6 puntos débiles §7** (no escondió riesgos)
3. **Reusó componentes existentes** (estrategia, RiskManager, ArbOpportunity)

Revisión adversarial identificó **punto 3 (ejecución 2 patas) como bloqueante central financiero** — si comprás pata yes 45c y mandás pata no 50c que se mueve a 53c → pata sola direccional con capital real, **no es arbitraje, es apuesta**.

Otros 5 puntos clasificados como menores o mitigables.

### ✅ Gate 0 — Shape del ticker WS CERRADO con bonus

**La pregunta:** ¿el WS ticker trae el BBO que el trigger por spread necesita?

**Disciplina aplicada:** Primera intención fallida (script `capture_ticker_shape.py` estaba en PR draft, NO en container). Claude Code frenó ante la discrepancia, no improvisó. Solución: `inspect_ws.py` ya estaba en container.

**OK final explícito** antes de abrir WS contra Kalshi externo (gate operacional funcionando).

**Discovery soccer:** probadas 8 series (KXUCL/KXEPL/KXLALIGA/KXSOCCER/KXWC/KXFIFA/KXSERIEA/KXBUNDESLIGA) = **0 mercados abiertos**. Control con NBA/NHL confirmó mecanismo OK. Calendario: ligas cerradas, Mundial abre 11-jun.

**Comando ejecutado contra NBA:**
```
cd /app && PYTHONPATH=. python scripts/inspect_ws.py \
  --tickers KXNBA-26-NYK,KXNBA-26-SAS \
  --channels ticker,orderbook_delta \
  --max-messages 30 --verbose --duration 30
```

**Resultado — ticker trae BBO COMPLETO y MEJOR:**

Payload del mensaje `type=ticker`:
- `yes_bid_dollars` ✅
- `yes_ask_dollars` ✅
- `yes_bid_size_fp` ✅ **(bonus)**
- `yes_ask_size_fp` ✅ **(bonus)**
- `ts_ms`, `market_ticker`

**Derivación del lado `no` (Kalshi binario):**
- `no_bid = 100 - yes_ask`
- `no_ask = 100 - yes_bid`

**La condición de arbitraje completa se computa desde UN solo mensaje ticker.** Sin orderbook book in-memory, sin deltas, sin seq tracking, sin desync posible. **La premisa entera del Motor REST validada contra feed real.**

### Por qué es MEJOR de lo mínimo esperado

1. **Sizes en el ticker permiten filtrar por profundidad ANTES de disparar el REST.** No gastás un GET en un arb de 2 contratos. Optimización gratis.
2. **El lado `no` se deriva exacto** sin necesidad de mantener book aplicando deltas. Toda la razón para evitar V2 confirmada viable.
3. **Comparación con `orderbook_delta`** confirmó que el ticker NO es subconjunto pobre — te da top-of-book ya calculado directamente.

### Nuevo gate destapado: cadencia del ticker bajo carga

El resultado del Gate 0 destapó pregunta empírica:
> ¿Cada cuánto Kalshi empuja un mensaje ticker nuevo cuando el BBO se mueve rápido?

- Mediana <200ms → MUY BIEN
- p95 <500ms → BIEN
- p95 >1000ms → PROBLEMA (trigger reacciona tarde)

Se mide con `inspect_ws.py` mirando `ts_ms` entre tickers consecutivos. **Requiere mercado activo** (NBA prime time o Mundial). Los 30s en NBA temporada baja no muestran cadencia bajo presión.

**NO bloquea diseño FOK. Bloquea activación con capital.**

### ✅ Gate 0.5 — FOK nativo CERRADO

**La pregunta:** ¿Kalshi soporta orden Fill-or-Kill (FOK) nativo?

**Verificación vía evidencia convergente** (ReadMe bloqueó WebFetch directo, usadas alternativas):
- Documentación oficial `docs.kalshi.com/api-reference/create-order`
- ~6 repos de producción en GitHub usando la API

**Hallazgo:** Kalshi soporta TRES valores de `time_in_force`:

| `time_in_force` | Comportamiento |
|---|---|
| `"fill_or_kill"` | **FOK** — completa o se cancela. Cero exposición parcial. ✅ |
| `"immediate_or_cancel"` | IOC — fallback (opción C) |
| `"good_till_canceled"` | GTC — el modo del bug actual (limit+resting), DESCARTADO |

**Sintaxis exacta:**
```json
{
  "type": "limit",
  "yes_price": 4500,
  "time_in_force": "fill_or_kill",
  "client_order_id": "..."
}
```

**Decisión arquitectónica:** Ejecutor Motor REST = FOK nativo en ambas patas. Si una pata no se llena al precio, ambas se cancelan. Cero exposición direccional.

**`KalshiRestClient.place_order` hoy NO expone `time_in_force`** → cambio menor pendiente (parámetro opcional, default actual queda intacto).

### 🐛 BUG aislado en executor.py heredado — Issue #14

Al evaluar reuso de `executor.py` para el ejecutor FOK, **descubrimiento crítico:**

> `executor.py` ejecuta órdenes de arbitraje con `time_in_force` por defecto (`good_till_canceled` implícito). Si pata 1 se llena y pata 2 no → **pata sola direccional VIVA en el book como resting limit** → exposición direccional silenciosa con capital real.

**Escenario:**
1. Detecta arb: yes_ask 45c + no_ask 50c = 95c
2. Pata yes 45c → se llena
3. Pata no 50c → mercado se movió a 53c
4. La orden no 50c queda como resting limit
5. Posición yes 45c queda direccional, sin cobertura
6. **No es arbitraje — es apuesta direccional encubierta**

**Disciplina aplicada — Bug AISLADO, NO arreglado:**
- Issue #14 abierto en GitHub
- Doc `docs/bug_executor_limit_resting.md`
- Branch separada (PR #15)
- `executor.py` NO se toca
- Motor REST NO reusa este executor — implementa FOK nativo desde cero

**Impacto:**
- ❌ Bloqueante absoluto para `TRADING_ENABLED=true` en CUALQUIER motor que reuse el executor
- ✅ NO afecta Motor REST (que usará FOK propio)
- ✅ NO afecta operación V1 (que no usa executor)

**Resignifica "el executor.py existente":** antes "Motor REST reusa código ya probado", ahora "Motor REST necesita ejecutor FOK desde cero". Aumenta scope de implementación, pero es trabajo necesario.

**Cuarto bug del path de trading descubierto antes de que costara dinero** (junto con los 3 attempts V2 rolledback antes de activar trading).

### 🛑 Cierre disciplinado de la jornada

Gemini ofrecía dos caminos: diseñar el ejecutor FOK ahora, o esperar números de latencia primero.

**Identifiqué la "tercera opción" que ninguno de los agentes iba a sugerir:**

> **Parar acá. Por hoy.**

**Razonamiento:**
1. El diseño del ejecutor FOK no se puede VALIDAR todavía — depende de cadencia ticker + RTT bajo carga, que requieren mercado activo (no hay hoy)
2. El camino crítico está en el calendario, no en el teclado
3. La instrumentación de shadow va a medir captura neta real en el Mundial, no sobre proxies
4. **Diseñar el ejecutor FOK cansado, en el minuto 400+ de un sprint, es exactamente cómo se cuelan los errores que el modo shadow después tiene que atrapar**

**Gemini (CTO) confirmó:**
> *"Cortá acá, Noel. Apagá la terminal por hoy. (1) El código de ejecución no perdona la fatiga. (2) El bloqueo es de mercado, no de ingeniería. (3) El camino crítico está dictado por el reloj de Kalshi, no por el tuyo."*

**Decisión validada por dos capas independientes** (adversarial + CTO).

### El gate funcionó otra vez — esta vez en dimensión de fatiga

Esta noche había energía suficiente para seguir diseñando. Hubiera sido fácil decir "varios verdes, sigamos".

**Pero el siguiente paso (diseño del ejecutor FOK) no se valida hasta tener cadencia + RTT bajo carga del Mundial — el 11-jun, no hoy.**

**Diseñar contra números que no existen es trabajo que vas a tener que revisar cuando lleguen los datos.** Es como pulir un componente para un régimen que no se midió.

**El gate funcionó otra vez — esta vez en la dimensión de fatiga y prioridades, no técnica.** La capa adversarial + CTO frenaron el envión que al principio de la saga V2 hacía perder gates.

### Patrones validados HOY noche

1. **"Verificar contra interfaces reales antes de diseñar"** — Claude Code leyó código antes de escribir doc
2. **"Auto-marcar puntos débiles"** — diseño con §7 honesto, no esconde riesgos
3. **"Frenar ante discrepancia entre asumido y real"** — script no existía, no se improvisó
4. **"OK final antes de acción con riesgo externo"** — WS contra Kalshi pidió confirmación explícita
5. **"Auditar antes de reusar"** — descubrió bug en executor.py, lo aisló sin tocar
6. **"Disciplina sobre inercia"** — cortar cuando el camino crítico está en el calendario
7. **"Las dos capas adversarial + CTO validaron cierre"** — no fue decisión solitaria

### Anti-patrones cazados HOY noche

1. **Implementar lo que ya está diseñado por momentum** (offer del ejecutor FOK)
2. **"Varios verdes, dale" sin checkpoint** (el WS externo necesitó OK explícito)
3. **Reusar componente heredado sin auditarlo** (executor.py habría introducido bug latente al Motor REST)
4. **Optimizar contra reloj equivocado** (mi reloj vs reloj de Kalshi)

### Estado consolidado al cierre del 02-jun NOCHE

| Frente | Estado |
|---|---|
| V1 baseline | ✅ SANO continuo |
| Decisión arquitectónica | ✅ Motor REST para Mundial |
| **Gate 0 (shape ticker)** | ✅ **CERRADO** — BBO + sizes + lado no derivable |
| **Gate 0.5 (FOK nativo)** | ✅ **CERRADO** — `time_in_force: "fill_or_kill"` |
| **Bug executor.py** | 🔒 AISLADO Issue #14 — NO se reusa |
| **Decisión ejecutor Motor REST** | ✅ FOK ambas patas |
| Diseño Motor REST PR #13 | ✅ Entregado con §7 auto-marcado |
| Revisión adversarial | ✅ Pasada — punto 3 era el bloqueante real |
| Diseño ejecutor FOK | ⏳ Próximo paso (energía fresca) |
| Gate cadencia ticker bajo carga | ⏳ Requiere mercado activo |
| Gate RTT bajo carga | ⏳ Requiere mercado activo |
| Gate shape ticker soccer | ⏳ Requiere Mundial 11-jun |
| Implementación shadow | 🔒 Pendiente diseño ejecutor |
| `TRADING_ENABLED` | 🔒 false permanente hasta Issue #14 + gate completo |

### Para Lección 12 — tres candidatos del eje "medir antes de extrapolar"

La saga acumuló tres patrones meta candidatos a Lección 12:

1. **"La teoría dominante de un dominio puede no aplicar a tu microestructura específica"** (02-jun mañana — refutación de compresión por liquidez)
2. **"Directivas que combinan diseño + implementación en mismo turno colapsan el gate"** (01-jun — patrón nombrado)
3. **"Cortar cuando el camino crítico no está en tu teclado"** (02-jun noche — disciplina sobre inercia con bloqueador calendario)

**Los tres son del mismo eje:** medir el contexto real antes de actuar, no extrapolar desde supuestos o inercia.

### Workflow capa por capa observado HOY noche

| Capa | Rol |
|---|---|
| **Claude Code** | Diseñó Motor REST contra interfaces reales. Auto-marcó 6 puntos débiles §7. Verificó FOK contra doc + repos producción. Aisló bug en executor.py. Frenó ante discrepancias. Pidió OK final antes de WS externo. |
| **Yo (Claude adversarial)** | Identifiqué bloqueante real (punto 3) vs cosméticos. Confirmé Gate 0.5 + decisión arquitectónica FOK ambas patas. Marqué cadencia bajo carga como gate nuevo destapado. **Identifiqué la "tercera opción" (parar) que los agentes no iban a sugerir.** |
| **Gemini (CTO)** | Confirmó cierre disciplinado. Dio razones operativas (código no perdona fatiga, mercado es camino crítico). Validó save state. |
| **Yo (Noel)** | Decisión final: cortar. Disciplina sobre inercia. Anotar todo a Obsidian + NotebookLM antes de cerrar. |

### Mañana cuando retome (instrucciones para mi yo de mañana)

1. **Abrir nota raíz kalshi-bot** primero — ver estado consolidado
2. **NO retomar diseño FOK con energía agotada** — necesita cabeza fresca
3. **Decisión pendiente para arrancar:** umbral de edge para trigger (≥3c, ≥10c, ≥20c — ahora con filtro de profundidad gracias a sizes en ticker)
4. **Brief para Claude Code:** diseñar ejecutor FOK del Motor REST en texto (sin código), con base en Gate 0.5 y decisión arquitectónica
5. **NO mezclar diseño con implementación** (Lección 11)
6. **Cadencia + RTT bajo carga** se miden cuando haya mercado activo (NBA prime time o Mundial)

### Plan de medición pre-Mundial

**T-1 día (10-jun):**
1. Re-confirmar shape sobre soccer del Mundial (medición #3)
2. Validar que `inspect_ws.py` se conecta correctamente a tickers KXUCL/KXWC

**T+0 (11-jun primer partido):**
1. Antes del kickoff: snapshot baseline de cadencia ticker
2. Durante kickoff: medir cadencia bajo carga real
3. Durante partido: correr `bench_rest_rtt.py` en background

**T+1 hora:** análisis + aplicar criterios de aceptación + decisión.

### Criterios de aceptación del gate de validación bajo carga

- Cadencia ticker p95 < 500ms ✅
- RTT bajo carga p95 < 200ms ✅
- Shape ticker en soccer = shape NBA ✅
- Sin 429s en ráfagas observadas ✅

**Si los 4 ✅:** Motor REST validado para activación shadow. **Solo cuando shadow muestre captura neta consistente → considerar activar capital.**

### Lección operativa de la noche

> *"Cortar cuando el camino crítico no está en tu teclado."*

El siguiente paso (diseño del ejecutor FOK) no se valida hasta tener cadencia + RTT bajo carga del Mundial. Diseñar contra números que no existen es trabajo que vas a tener que revisar cuando lleguen los datos. **El gate funcionó — esta vez en la dimensión de fatiga y prioridades.**

---

---

## 🗓️ AGREGADO 2026-06-03 — V2 archivado oficial + Motor REST construido (infra completa, falta FOKExecutor)

### El arco del 03-jun en una frase
Cerraron el pivote a Motor REST y construyeron casi toda su infraestructura. Falta solo el componente crítico —el FOKExecutor— reservado para sesión fresca con demo. **El bot puede empezar a grabar oportunidades reales del Mundial en shadow sin arriesgar un centavo.**

### Resumen del estado al cierre del 03-jun

| Componente | Estado |
|---|---|
| Ticket 1+2: FOK en `kalshi_rest.py` + modelo `EdgeWindow` | ✅ Commiteado `a873d8f` |
| Ticket 3: trigger spread del ticker + shadow mode + flags + muro | ✅ Implementado, por commitear → PR #13 |
| FOKExecutor (diseño) | ✅ Cerrado — máquina de 4 estados, no 3 |
| FOKExecutor (implementación) | ⏳ **CRÍTICO — sesión fresca dedicada + demo** |
| Wiring del shadow (engine.py al orquestador) | ⏳ Próximo paso seguro |
| V2 | 🔒 Archivado (PR #11 congelado, recuperable) |
| Gates de carga (RTT, cadencia, shape soccer) | ⏳ Requieren Mundial 11-jun o NBA prime time |
| Capital | 🔒 Cero |

### La decisión que define todo: liquidez DILATA el edge (no lo comprime)

Gemini predijo, con buena teoría de microestructura, que el Mundial inyectaría liquidez algorítmica que **comprimiría** el edge a milisegundos → obligando a WebSocket/V2.

**Mis 7.9M de filas dijeron lo contrario.** Medí la curva liquidez → duración del edge (NBA+NHL, 202K ventanas, deciles de liquidez):

| Liquidez | Duración mediana del edge |
|---|---|
| Decil más ilíquido | **5 ms** |
| Decil más líquido | **4.06 s** |

→ Relación **~800×, monótona, en la dirección OPUESTA** a la hipótesis de compresión. Donde hay volumen, el edge persiste **segundos**. REST puro deja de servir en mercados ILÍQUIDOS (edge relámpago), no en los líquidos.

**Para el Mundial:** más liquidez ⇒ edges más largos y más gordos ⇒ favorece REST, no lo mata. La razón entera por la que V2 existía (ganarle a la latencia de un edge rápido) se evapora en mercados líquidos.

### Los 3 chequeos que blindaron la decisión

1. **¿Dilatación real o artefacto de magnitud?** Estratifiqué por banda de peak-edge fija → dentro de 10-14c, la duración va de 5.6ms (ilíquido) a 3.467ms (líquido), factor **620× moviendo SOLO liquidez**. La magnitud no explica la dilatación; la liquidez sí.
2. **¿El "4s mediana" del soccer es real?** NO — era artefacto del gap-cutoff de 5s (con 1s, las 53 ventanas se fragmentan en 1.509). La mediana real ~1.6s. Pero la cola larga (>60s) sobrevive a todos los cutoffs → edges persistentes genuinos.
3. **Tasa de captura REST:** en mercados líquidos, REST captura **~73% del edge**, uniforme por magnitud (la banda gorda de 20c+ captura 73.9%, sin penalización por tamaño). Robusto al peor caso de latencia (cap>64ms = 73.7%). El ~27% perdido es la cola sub-50ms **estructural** — la que ni V2 ejecutaría bien.

**MLB descartado con números** (0 ventanas con edge≥3c en 7 días sobre 1.5M filas). Caveat: solo medidos los mercados de FUTUROS de temporada. Los de partido individual no se midieron.

### La arquitectura final

- **Detección:** WS canal `ticker` SOLAMENTE (sin orderbook_delta). **Mata la clase entera de bugs de V2** — sin deltas no hay buffer, ni seq, ni desync, ni recovery, ni bootstrap frágil. El ticker es solo la campana.
- **Ejecución:** REST con órdenes FOK (cuando exista el FOKExecutor).
- **Shadow primero:** detecta y graba `EdgeWindow`, NO ejecuta, hasta que la data confirme oportunidades reales y ejecutables.
- **V2 archivado** (PR #11 congelado, no borrado) — recuperable si el Mundial sorprende.

### Los dos gates que podían matar el diseño — ambos PASARON

- **Gate 0 (shape del ticker):** ✅ El ticker trae BBO (`yes_bid_dollars`/`yes_ask_dollars`) + sizes. Lado NO se deriva exacto (`no_bid = 100 − yes_ask`). **La condición de arb se computa de un solo mensaje ticker por mercado.** Los sizes permiten filtrar profundidad antes de gastar un GET.
- **Gate 0.5 (FOK):** ✅ Kalshi soporta `time_in_force: "fill_or_kill"` nativo (verificado x2 fuentes). `type=market` fue REMOVIDO → rollback debe ser limit. FOK garantiza cero exposición parcial.

### El diseño del FOKExecutor — máquina de 4 estados (NO 3)

Kalshi NO tiene órdenes contingentes multi-leg → dos patas = dos requests separados. FOK elimina el Issue #14 (orden viva) pero NO el riesgo de que solo una pata se llene.

- **FILL/FILL** → profit, hedge perfecto.
- **KILL/KILL** → FOK lo salvó, cero exposición.
- **FILL/KILL** → rollback inmediato (vender la pata huérfana).
- **ERROR_RED (el 4º, el que Gemini omitió)** → excepción de red = estado DESCONOCIDO. La orden pudo llegar a Kalshi y llenarse. **NUNCA se asume KILL** (eso es Issue #14 reencarnado). Se RECONCILIA vía `get_positions()`/`get_orders()` por `client_order_id` antes de decidir.

**Rollback robusto:** limit agresivo que cruza el bid → reintento acotado → kill-switch automático si agota (persistir exposición, pausar, alerta crítica). **"Fallback = ejecución manual" ELIMINADO** — el bot desatendido nunca queda en un estado donde necesita que el operador esté despierto. Ante lo irresoluble: acotar, pausar, alertar, no seguir sangrando.

**Catch crítico (yo erré, Code corrigió):** cité "Lección 3" para el anti-patrón de `asyncio.gather`. Code verificó: es **Lección 7** (línea 410). Número mal, principio correcto, aplicado bien. El `gather` ingenuo en el ejecutor habría recreado el Issue #14.

### Detalles clave del Ticket 3 implementado

- **Reusa `detect_binary_arb`** (ya computa fees + net/gross/net_profit_cents) — no reimplementa comisión. Resuelve gratis el caso "bruto que no sobrevive el fee" (devuelve None si net≤0).
- **`gross_spread_cents` nullable** agregado a EdgeWindow → graba bruto Y neto, para medir cuánto come la comisión.
- **Parser de size con FALLO SEGURO:** prueba nombres candidatos; si ninguno aparece → None → profundidad insuficiente → **NO dispara** (nunca asume profundidad suficiente). Protege la integridad de la data del shadow.
- **Sesión SQLModel SÍNCRONA** (`with get_session() as s:`), no async.

### ⚠️ Semántica de flags (clave, no confundir)

- `MOTOR_REST_ENABLED` = el motor CORRE (WS+parse+detecta+graba). **Para shadow = True.**
- `TRADING_ENABLED` = MURO entre observar y ejecutar.
- **Shadow del Mundial = `MOTOR_REST_ENABLED=True` + `TRADING_ENABLED=False`.** NO ambos False (eso es el motor apagado, no graba nada). ← *este malentendido casi deja al bot sin data el 11.*

### Lo que falta (en orden)

1. **Wiring del shadow** — conectar `engine.py` al orquestador detrás de `MOTOR_REST_ENABLED`. Más seguro que el ejecutor — buen primer paso de la próxima sesión.
2. **FOKExecutor** — el componente CRÍTICO (máquina de 4 estados + reconciliación + rollback). Diseño cerrado y verificado; falta implementar. **Sesión fresca dedicada + validación en DEMO. No cansado.**
3. **Gates de carga (dependen del calendario — 11-jun o prime-time NBA):**
   - RTT bajo carga (`bench_rest_rtt.py`, criterio P95<150ms)
   - Cadencia del ticker bajo carga
   - Re-confirmar shape sobre SOCCER (check de 30s cuando abran mercados del Mundial)
   - **Verificar parseo de size** (el primer shadow real debe confirmar que lee size, no None)

**Mínimo para el 11-jun:** Motor REST en shadow grabando `edge_windows` del Mundial, `TRADING_ENABLED=False` hasta que la data confirme oportunidades reales y ejecutables.

### Hallazgos colaterales valiosos

- **Bug latente en `executor.py` (Issue #14):** el rollback solo dispara ante EXCEPCIÓN, pero las órdenes limit pueden quedar resting (sin llenarse, sin excepción) → el executor cree "all legs filled" cuando una quedó abierta → **exposición direccional SILENCIOSA.** Afecta a Motor 1, no al Motor REST. Aislado, no arreglado. Bloqueante absoluto antes de cualquier `TRADING_ENABLED=true`.
- **Coolify hardcodea `restart: unless-stopped`** (discusión #10259). No hay cap de Docker limpio. Decisión: documentar como no-soportado, mitigar crash-loop con Telegram + healthcheck + manual. NO implementar wrapper de entrypoint (= A2 reintroducido).
- **Las comisiones de Kalshi son diminutas a escala:** con size 100, un spread bruto de 2c (200c) domina la comisión (4c). El fee solo "come" el edge a tamaños chicos. Dato de negocio que el shadow cuantificará en vivo.

### Los aprendizajes grandes (meta)

- **Medir antes de decidir le ganó a la intuición en CADA bifurcación.** Gemini predijo compresión con teoría sólida. Mis datos mostraron dilatación. Si construía V2 sobre la intuición de Gemini sin medir, construía la fortaleza para un problema que no existe en mercados líquidos. **Dos variables medidas (RTT real + curva de dilatación) valieron más que toda la teoría de microestructura.**

- **El "Paso 0" de verificación es el patrón más valioso de toda la saga** (después de separar diseño/implementación). En CADA brief de implementación cazó suposiciones mías equivocadas contra el código real:
  - Endpoint `/portfolio/orders` (no `/markets/{ticker}/orders`)
  - `created_at` timezone-AWARE (mi brief pidió naive — contradecía los 6 modelos del proyecto)
  - Sesión SQLModel SÍNCRONA (no async)
  - `detect_binary_arb` ya computa fees (no había que reimplementar)
  - Nombres de size no documentados (el brief los daba como ciertos)

  **Mis briefs los escribo de memoria, y la memoria se desactualiza. El Paso 0 convierte mis suposiciones en preguntas verificadas, antes de que sean bugs.**

- **La dirección de control funciona en TODAS las capas, incluso sobre mí.** Claude Code corrigió mi número de lección (3→7), mi endpoint, mi timezone, mi premisa de async. La capa de ejecución verifica lo que las capas de arriba afirman —incluido yo— en vez de obedecer. **Eso es el gate funcionando, no fallando.**

- **La complejidad correcta es función de la escala.** V2 + fortaleza B1/A2 eran para 38 mercados. A escala de 4-8 (NBA) o soccer-del-Mundial, esa complejidad es sobre-ingeniería. **Reducir el universo de mercados desinfló el problema en vez de resolverlo con más código.**

- **Mis briefs evolucionaron** de "ZERO DEBATE, implementá todo" a briefs acotados con "NO implementes el crítico todavía, verde antes de avanzar, Paso 0 primero, detente y reportá." Aprendí a darle a la capa de ejecución instrucciones que la mantienen segura, en vez de instrucciones que apagan su criterio.

- **El componente crítico se construye fresco.** El FOKExecutor maneja capital; un error de cansancio ahí se paga en dólares, no en un test rojo. El shadow no necesita el ejecutor para empezar a juntar data → no hay presión de calendario que justifique escribirlo cansado. **"El cansancio del operador no se compensa apagando el gate."**

### Para el yo del futuro cuando retome

El bloque que más vale releer antes de retomar es "Lo que falta (en orden)". Te dice exactamente dónde parar y por qué: el wiring del shadow primero (seguro, te deja grabando data del Mundial), el FOKExecutor después (crítico, sesión fresca + demo). Y "Shadow = ambos flags en su estado correcto, NO ambos False" está marcado fuerte porque es el malentendido que casi deja al bot sin data el 11.

Cuando retomes: wiring del shadow antes que el ejecutor. Te pone a grabar oportunidades reales del Mundial con riesgo cero, y el FOKExecutor —el que toca capital— lo hacés con cabeza descansada y validación en demo, sin la presión del calendario encima.

---

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
