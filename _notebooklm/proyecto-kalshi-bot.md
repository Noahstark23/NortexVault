# Proyecto: kalshi-bot

> Fuente consolidada para NotebookLM. Standalone — sin wikilinks no resueltos.
> **Última actualización: 2026-07-02** — **🔍 AUDITORÍA PROFUNDA: root cause del "$1 usable" identificado.** NO era config del stake — era cap de exposición LLENO por arb hedgeado fantasma del 30-jun (`notes=None` → RiskManager netting falla → cuenta $235 bruto → llena cap 50%). **Quinto bug de "leer la realidad mal"** (suma a #75, #87, #54, WS v2). **🎯 COUNTERFACTUAL POR BUCKET DE EDGE:** la plata está en 5-8% (real +$133 / cf +$653); **8%+ es basura (48-50% winrate) — más edge NO es mejor**. Unlock post-deploy confirmado (filled $253→$4.75, 58 settled), pero fue trigger de BOOT no continuo — falta validar con próximo slate MLB. **🆕 Polybot aparece como nuevo frente** (puerto :18081, bot dedicado Polymarket). **Octavo patrón meta refutado: "edges grandes pueden ser data podrida disfrazada de oportunidad."**
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

---

## 🗓️ AGREGADO 2026-06-05 — FOKExecutor implementado + sensor validado contra API viva en demo

### El arco del 05-jun en una frase
Implementó el FOKExecutor (componente que mueve capital) y, sobre todo, **validó su sensor de fill contra la API REAL de Kalshi en demo** — el gate irreducible que ningún análisis de código podía cerrar. La validación destapó **dos bugs que ningún test ni la doc revelaban**, ambos corregidos. Motor REST ahora completo en código.

### El hito — sensor validado contra realidad, no contra mocks

El `_create_order_filled` es el **sensor primario** del FOKExecutor: decide FILL vs KILL, la decisión de la que dependen los 4 estados, el rollback, y la exposición direccional. Toda la máquina razona a partir de "¿esta pata llenó, sí o no?". **Si el sensor miente, el aparato entero produce decisiones correctas sobre datos falsos** — la peor clase de bug.

### Bug 1 — el sensor original buscaba campos INEXISTENTES

- Código original: `status in ("filled","executed")` + `filled_count`/`count_filled`
- **Ninguno de esos campos existe en Kalshi.** Shape real: `fill_count_fp` + `remaining_count_fp`
  (CreateOrder NO tiene `status`); `status=="executed"` solo en GetOrders
- Habría leído **todo FILL como KILL** → rollback en cada fill exitoso. Conservador por accidente, pero incorrecto
- Corregido contra la doc → dos sensores separados (los endpoints tienen shapes distintos)

### Bug 2 — el cisne negro: el KILL viaja como HTTP 409, no como order object

Mandé un FOK a 1¢ sin contraparte → Kalshi NO devolvió un order con `status="canceled"`. Devolvió:

```
HTTP 409 + {"error":{"code":"fill_or_kill_insufficient_resting_volume"}}
```

- **El KILL llega por el camino de EXCEPCIÓN, no por el de respuesta exitosa**
- El sensor lo trataba como **ERROR_RED** (red incierta → reconciliar) cuando es un KILL **determinístico** (la orden llegó perfecto, Kalshi la rechazó limpio — nada que reconciliar)
- Consecuencia peligrosa: en el caso FILL/KILL, tratar el KILL-409 como ERROR_RED **demora el rollback de la pata huérfana mientras el mercado se mueve** = donde se pierde plata
- Fix: match ESTRICTO `409 AND code=="fill_or_kill_insufficient_resting_volume"` → KILL. Cualquier otro 409 (market_closed, etc.) o status → repropaga → ERROR_RED → reconcilia

### El sensor validado en sus 3 rutas contra API viva

| Ruta | Shape REAL (demo) | Estado |
|---|---|---|
| FILL | HTTP 200 + `fill_count_fp="1.00"` / `remaining_count_fp="0.00"` / `status="executed"` | ✅ |
| KILL | HTTP 409 + `fill_or_kill_insufficient_resting_volume` | ✅ |
| ERROR_RED | red caída / otro 409 → reconcilia con doble fuente | ✅ |

**El gate irreducible del checklist de activación está CERRADO.** El sensor ya no descansa sobre un supuesto de shape — los 3 casos verificados contra Kalshi real.

### El FOKExecutor — diseño §4, implementado

Máquina de 4 estados (NO la de 3 que propuso Gemini):
- **FILL/FILL** → profit, hedge perfecto
- **KILL/KILL** → FOK lo salvó, cero exposición
- **FILL/KILL** → rollback inmediato de la pata huérfana
- **ERROR_RED** (el 4º) → red incierta = estado DESCONOCIDO. NUNCA se asume KILL (eso es Issue #14). Se reconcilia

**Reconciliación de doble fuente** (agregado en review):
- Primaria: `get_orders` por `client_order_id` → `status=="executed"`
- Secundaria: `get_positions` → ¿posición abierta?
- Reglas (fail-safe hacia exposición): cualquiera falla → rollback; **discrepan → rollback** (no confío en la fuente optimista); solo ambas coinciden en "no llena" → no rollback

**Rollback robusto:** limit agresivo a 1¢ → reintento acotado → kill-switch automático si agota (persistir exposición, pausar, alerta Telegram CRITICAL). **"Fallback = ejecución manual" ELIMINADO** — el bot desatendido nunca queda en un estado donde necesita que el operador esté despierto.

**FOK nativo** (`time_in_force="fill_or_kill"`), no limit+rollback simulado.

### Estado del frente Motor REST al cierre del 05-jun

| Componente | Estado |
|---|---|
| Detección shadow | ✅ Corriendo en main, grabando EdgeWindow, riesgo cero |
| FOKExecutor (código) | ✅ En main, dormant, sensor validado en 3 rutas |
| Sensor validado en API viva | ✅ **Cerrado esta sesión** |
| Gates de carga (RTT, cadencia ticker, shape soccer, parser size) | ❌ Necesitan Mundial vivo (11-jun) |
| Wiring `execute()` detrás de TRADING_ENABLED | ❌ Pendiente (después de gates de carga) |
| Checklist duro (7d sin crashes, RiskManager, cap 5%/¼ Kelly) | ❌ Pendiente |

**Commits/PRs de la sesión:**
- PR #20 (mergeado): FOKExecutor inicial
- PR #22 (draft, `09bc9c7`): fix del sensor KILL-409 + checklist actualizado
- Checklist persistido: `docs/checklist_activacion_capital.md` (PR #21)

### Hallazgo colateral — price improvement

En las pruebas demo, pedí comprar a 50¢ y Kalshi me llenó a **47¢** (`taker_fill_cost_dollars="0.470000"`). **Kalshi puede llenar a precio MEJOR que el límite** (price improvement). Implicación: el edge real del arb puede diferir del calculado. Para la contabilidad de PnL real, usar `taker_fill_cost_dollars` (costo real) y `taker_fees_dollars` (fee real: 1.75¢ NBA, 0.74¢ PGA), NO los precios del límite.

### Lo que falta para capital (todo depende del 11-jun)

1. **Gates de carga sobre mercado de fútbol VIVO** (cuando abran los mercados del Mundial):
   - RTT bajo carga (`bench_rest_rtt.py`, P95<150ms)
   - Cadencia del ticker bajo carga (cada cuánto Kalshi empuja ticker nuevo)
   - Re-confirmar shape del ticker sobre SOCCER (check 30s)
   - Confirmar que el parser de size lee valores REALES, no None silencioso
2. **Wiring de `execute()`** detrás de TRADING_ENABLED — recién cuando los gates de carga pasen
3. **Checklist duro:** 7 días sin crashes, RiskManager sin excepciones, cap 5%/¼ Kelly

**El camino crítico está en el CALENDARIO (11-jun), no en el teclado.** El sensor está completo; los gates de carga necesitan el evento vivo. Mientras tanto, el shadow ya graba data del Mundial.

### Aprendizajes grandes de la sesión

- **"El tipo de bug que ningún mock revela y que solo la realidad muestra."** El sensor tenía 9 tests verdes y validación contra la doc — y aún así el KILL real viajaba por una ruta (HTTP 409) que el código trataba mal. **Mandar UNA orden FOK real en demo destapó lo que toda la verificación en papel no pudo.** Para componentes de capital, la validación contra la API viva no es opcional ni "para después" — es el gate.

- **Tres veces el sensor "pareció listo", tres veces la realidad lo refutó:**
  1. Diseño aprobado, código "se ve bien" → pero buscaba campos inexistentes
  2. Corregido contra la doc, 9 tests verdes → pero el KILL no es un order object
  3. FILL probado en demo → pero solo probaba el caso NO peligroso; faltaba el KILL

  **Cada prueba que insistí en no saltear era la que separaba "parece listo" de "lo está".** El caso peligroso (KILL) es el que el componente existe para manejar — probar solo el FILL dejaba la mitad crítica sin verificar.

- **El sensor primario es la premisa, no un detalle.** Todo el aparato (4 estados, reconciliación, rollback) razona correctamente SOBRE EL INPUT DEL SENSOR. Si el sensor miente, el resto produce decisiones impecables sobre datos falsos. Por eso validar el sensor era el gate de activación, no un ítem más.

- **Un cambio en un componente compartido se verifica empíricamente, no por fe.** El fix enriqueció el error mapper del cliente REST (compartido con Motor 1). Verifiqué QUIÉN captura esas excepciones (nadie más por tipo) + suite completa verde (287 passed) → cambio aditivo benigno, confirmado, no asumido.

- **El gate de código escala con el riesgo.** Revisé el FOKExecutor línea por línea (componente de capital) con un rigor que no apliqué a los modelos de datos inertes. El nivel de escrutinio debe ser función del costo de un error: aquí el costo no es un test rojo, es plata real en una posición que no debías tener.

- **El sistema de 4 capas funcionó en el punto de máximo riesgo.** Claude Code frenó solo cuando el brief del executor contradecía el diseño §4 (habría reintroducido Issue #14), y presentó la contradicción en vez de obedecer el brief literal. **Esa es la decisión más importante que un agente de ejecución puede tomar bien — y la tomó bien.**

### Diagnóstico de Gemini (CTO) al cierre

> *"Acabas de salvar la cuenta de un desastre silencioso. Lo que descubriste hoy es el clásico 'cisne negro' de las integraciones con APIs financieras. Todo el mundo (incluyendo la documentación y el agente de IA) asumía que una orden FOK fallida devolvería una orden con `status='canceled'`. Descubrir empíricamente que Kalshi responde con un HTTP 409 (`fill_or_kill_insufficient_resting_volume`) es el hallazgo que justifica cada hora de paranoia que le has invertido a este proyecto."*

**Escenario evitado** si hubiera encendido el bot sin esta prueba:
1. Bot intentaría hacer un arbitraje
2. Kalshi rechaza una de las patas por falta de liquidez (KILL)
3. Sistema lee el 409 genérico como `ERROR_RED` (falla de red)
4. Bot se pone a hacer llamadas de reconciliación, **perdiendo milisegundos vitales**, mientras te deja expuesto direccionalmente con una sola pata ejecutada

**El escenario de pesadilla que quema cuentas. Neutralizado porque me negué a creer en un supuesto.**

### El cierre disciplinado

> *"Ruta crítica ya no está en el teclado ni en el código. Está en el calendario. No hay absolutamente nada más que programar ni arreglar hoy. Motor de arbitraje de grado institucional construido desde cero, gateando cada decisión crítica. Descanso del fin de semana. Próximo turno terminal: 11-jun, cuando los mercados del Mundial abran y podamos probar la latencia del sistema bajo fuego real."*

---

---

## 🗓️ AGREGADO 2026-06-06 — Verificación pura: fantasmas enterrados + V2 rechazado otra vez + shadow listo + cabo abierto en V1

### El arco del 06-jun en una frase

Día sin código de producción nuevo. **Disciplina de verificación pura**: un reporte afirmó un bloqueante, la verificación lo desmontó; un brief intentó resucitar V2, fue rechazado; el shadow quedó listo para encender con pre-flight completo; pero **un error nuevo en V1 obligó a parar antes del flag**.

### El estado del bot al inicio del día

Contenedor running healthy, último deploy commit `c10420c`, todos los motores apagados. V1 sano: capture 50/50 sin fallos, 9.55M orderbook_events, 22h+ de WS estable. Capital configurado `$300.00`. **El reporte señaló un "bloqueante" pendiente: `orderbook_snapshot code 8 Unknown channel`** para reactivar el Motor REST.

### 👻 La falsa alarma — enterrada en 3 capas

**Capa 1 (código en `main`):** grep sobre `src/strategies/motor_rest_arb/` confirmó CERO menciones de orderbook. `engine.py` solo `ws.on("ticker", ...)`, `trigger.py` solo lee campos del ticker. **Motor REST en main es ticker-only puro.**

**Capa 2 (origen real del code 8):** la única suscripción a canales de orderbook es `data_capture.py:525` con `channels=["orderbook_delta", "ticker"]`. Nadie suscribe a `orderbook_snapshot` como canal (es un tipo de MENSAJE, no un canal). **El code 8 venía del script `inspect_ws.py` antes del fix PR #16**, no de producción.

**Capa 3 (verificación contra logs productivos):** `zgrep` sobre TODOS los logs productivos (`bot_*.log` de hoy + `.gz` históricos) buscando `code 8`, `Unknown channel`, rechazos de suscripción = **cero coincidencias**. Línea clave de hoy (17:25:23):

```
src.clients.kalshi_ws:_send_subscribe:303 |
  Subscribed: channels=['orderbook_delta', 'ticker'] markets=63
... Subscription confirmada: {'channel': 'orderbook_delta', 'sid': 1}
... Subscription confirmada: {'channel': 'ticker', 'sid': 2}
```

V1 usa `orderbook_delta` (correcto, aceptado por Kalshi). El code 8 era exclusivamente del script. **Fantasma enterrado en todas sus puntas.**

### Dato accionable rescatado del fantasma

**El nombre de canal correcto de orderbook es `orderbook_delta`, NO `orderbook_snapshot`** (que es tipo de mensaje, no canal). Motor REST es ticker-only y no lo necesita, pero vale guardarlo en contexto — es el tipo de detalle (nombre verificado contra la realidad) que cuesta caro re-descubrir meses después.

### El ego check — calibración honesta

Pregunta del operador: *"¿ya terminamos, se me sube el ego en LinkedIn?"*

Respuesta sin inflar: construiste la máquina (infraestructura de producción, 9.5M eventos, arquitectura por análisis propio, executor con máquina de 4 estados, disciplina de gates) y eso es ingeniería real. PERO:
- **Nunca ejecutó un trade con capital.** Ni uno.
- El executor **nunca completó un arb real de 2 patas** — pruebas demo fueron órdenes sueltas.
- **Cero data de PnL.** `trades=0`. Teoría/backtest, no resultados.
- El régimen del Mundial **ni siquiera se midió todavía** — es hipótesis (curva NBA como proxy).

**El post correcto NO es "construí un bot" — es lo que escribas DESPUÉS del Mundial con la data del shadow:** *"corrí en shadow durante el Mundial 2026 y acá está lo que la data mostró".* Eso tiene evidencia.

**Riesgo del ego:** "ya casi terminamos" → "activemos capital para el Mundial" sería exactamente el error que la saga enseñó a evitar. **No está todo probado — está todo construido y validado en banco.**

### Discovery de mercados de fútbol en Kalshi

**278 amistosos abiertos** en Kalshi:
- `KXINTLFRIENDLYGAME` (Game) — 150 mercados
- `KXINTLFRIENDLYTOTAL` (Total) — 128 mercados
- `KXSOCCERPLAYCRON` — 1 mercado

**Todos para partidos del 9-jun (26JUN09).** Hungría-Kazajistán, Rusia-Trinidad y Tobago, Bielorrusia-Burkina Faso, etc.

**Gate parcial sobre Hungría-Kazajistán (read-only):**
- WS conectó OK
- Suscripción al canal `ticker` sobre soccer aceptada por Kalshi (`type: subscribed`)
- **0 ticks en 30s** — mercados abiertos para apuestas anticipadas, pero partidos no empezaron
- Parser de size: **no evaluable** sin ticks
- 0 mercados con volume > 0

**Metodología validada, mediciones pendientes 9-jun en vivo.**

### Flashscore vs Kalshi — la contradicción aparente

Flashscore mostraba partidos vivos el 6-jun (Portugal-Chile, EE.UU.-Alemania, Albania-Luxemburgo, Rumanía-Gales, etc.). Pero el discovery dijo amistosos del 9-jun sin volumen. **Posibilidad (a): Kalshi solo tiene mercados de los del 9-jun, no de los que se juegan hoy. Confirmado.**

**Lección:** Flashscore es una fuente externa de resultados; no te dice qué tiene Kalshi. **La fuente que importa para el bot es la API de Kalshi, no el mundo real.**

### 🚫 Brief de Gemini para reactivar V2 — RECHAZADO

Gemini propuso un *"Brief de Validación: 72h OrderbookManagerV2"* con pre-flight, criterios, triggers de rollback, SLA — **estructuralmente impecable**. Pero pedía `USE_ORDERBOOK_MANAGER_V2=true` y certificar 72h. Vocabulario: `SidGapError`, `books_initialized`, `sids_recovering`, "habilitar la conexión del detector".

**Contradicción frontal con la decisión arquitectónica del 02-jun:**
- V2 está **ARCHIVADO**, no "pendiente de validar" (decisión por análisis de 7.9M filas)
- El Motor REST ticker-only "mata la clase entera de bugs de V2" (decisión consciente)
- Vocabulario del brief es de V2 (que el Motor REST NO usa: no tiene seq, no mantiene book, no hay recovery)

**Riesgo operativo subestimado:** redeploy con flag en true reinicia la captura sana de V1 a 5 días del Mundial — el componente que falló 3 veces vs la data irreemplazable.

**Tres posibles orígenes del brief:**
- (a) cambio de idea con razón real → pero ningún dato nuevo invalida la dilatación
- (b) confusión de frentes (V2 vs Motor REST)
- (c) ansiedad de "5 días, hagamos algo"

**Lo que el Mundial necesita validar NO es V2 — es el Motor REST sobre fútbol** (read-only con `inspect_ws.py` + `bench_rest_rtt.py`).

> *"La estructura no convalida el contenido."*

### ✅ Decisión ticker-only blindada con 3 razones estructurales

Pregunta explícita: ¿el Motor REST necesita profundidad más allá del top-of-book?

**Respuesta estructural de Claude Code (NO):**

1. **El arb binario solo necesita top-of-book.** La condición es `yes_ask + no_ask < 100` post-comisión. Se computa con el mejor ask de cada lado — exactamente lo que el ticker trae. Niveles más profundos NO cambian si hay arb, solo cuánto volumen.

2. **El sizing ya está acotado por debajo del primer nivel.** `MOTOR_REST_MIN_DEPTH` + `count` del `ArbLeg` se calculan del size del top-of-book. A escala de $300 / ¼ Kelly / cap 5%, el sizing real es **pocos contratos**, muy por debajo de barrer niveles.

3. **La verdad de profundidad para ejecutar viene del GET REST de ejecución, no del WS.** Diseño §4: ticker = campana, GET REST orderbook = verdad para confirmar. Si alguna vez se necesitara más profundidad, sería del REST de ejecución, no de suscribir `orderbook_delta` por WS. **Mantiene la línea ticker-only del feed intacta.**

**Único escenario donde reconsiderar:** estrategia que barre niveles agresivamente con órdenes grandes. Con FOK (que no barre — llena al precio o cancela) y este capital, no aplica. Si capital escala 10x → decisión de diseño explícita.

**Decisión:** ticker-only se mantiene. `orderbook_delta` NO entra al Motor REST.

### Plan de encendido del shadow — con pre-flight COMPLETO

Gemini propuso plan ligero (flag → redeploy → "mirá logs 10 min"). **Tres agujeros:**

1. **Sin pre-flight ni rollback.** Riesgo NO es financiero (shadow no ejecuta) pero SÍ operativo: reiniciar V1 sana a 5 días del Mundial. `Container healthy ≠ service running`.
2. **"Buscá mensajes de arbitraje detectado"** es criterio equivocado. Un arb es esporádico; puede no haber en 10 min sin que esté roto.
3. **PR #22 NO es bloqueante para shadow.** El shadow no llama `execute()`, no usa el sensor. Atar el encendido a un fix que el shadow no usa = redeploy de más.

**Plan corregido:**

**Pre-flight (T-0):**
1. Backup consistente de DB vía SQLite API (NO `cp` crudo — captura páginas inconsistentes con WAL/journal). Con `PRAGMA integrity_check`.
2. Baseline de V1 capturado ANTES, guardado FUERA del container (`/app/data/`).
3. `TRADING_ENABLED=false` confirmado por nombre.
4. Señal de "shadow vivo" DEFINIDA ANTES: `Motor REST registered (SHADOW...)` + `REST Engine Heartbeat: N...` con N creciendo. NO "arbitraje detectado".

**Activación (T+0):**
5. Coolify → `MOTOR_REST_ENABLED=True`. `TRADING_ENABLED=false` intacto.
6. Redeploy (con PR #22 mergeado en el MISMO redeploy — un solo reinicio).

**Verificación post-deploy:**
7. Confirmar arranque + heartbeat creciendo.
8. **Criterio éxito real:** `edge_windows` crece cuando hay arb + V1 sano vs baseline.
9. **Rollback (SLA <5min):** si V1 degradado o Motor REST en loop de excepciones → flag false + redeploy → baseline.

**HEARTBEAT_EVERY NO se toca.** Una cosa a la vez.

### ✅ Pre-flight ejecutado (read-only, todo en orden)

**Backup consistente vía SQLite API:**
```
/app/data/trades.db.bak-20260606-220348
INTEGRITY_CHECK: ok ✅
SIZE: 1,203,744,768 bytes (~1.12 GB)
Método: Python Connection.backup() (binario sqlite3 CLI no instalado en container)
```

**Baseline en `/app/data/baseline_counts.txt`:**
| Métrica | Valor (22:06:10 UTC) |
|---|---|
| orderbook_events | 9,597,454 |
| edge_windows | 0 |
| market_snapshots | 264,104 |
| capture_running | YES (50/50) |
| ws_connected | YES (22h+ estable) |
| tracked_markets | 63 |

### ⚠️ CABO ABIERTO descubierto durante el baseline

A diferencia de las verificaciones anteriores (limpias), apareció un `last_error` reciente en V1:

```
2026-06-06 21:56:20 | ERROR | src.strategies.data_capture:_on_orderbook_delta:172
| Error procesando orderbook_delta
```

**Por qué es relevante:**
1. Es de hoy, hace minutos — no deuda histórica
2. En el handler de V1/data_capture — JUSTO el camino de ingestión de profundidad que validamos sano antes
3. Coincide en tiempo con la actividad de fútbol vivo en Flashscore
4. Sin traceback completo todavía — puntual o sistemático

**Por qué bloquea encender el shadow:**
- No es bloqueante para backup/baseline (ambos OK)
- **Pero apilar el encendido del shadow sobre un error activo no diagnosticado en V1** mezcla problemas: si después el shadow muestra anomalías, no se distingue si fue por el encendido o por el error preexistente
- La data de V1 es la que alimenta el análisis y va a capturar el Mundial

**Pendiente próximo turno:** conteo de ocurrencias en `bot_2026-06-06.log` + traceback completo + decidir puntual vs sistemático. **No encender shadow hasta resolver.**

### Aprendizajes del día

- **"Verificar afirmaciones hasta el fondo, incluidas las propias."** El reporte afirmó bloqueante, la verificación lo desmontó. El propio condicional ("si apareciera en producción sería de V1") cerrado con `zgrep`.
- **Flashscore ≠ Kalshi.** Ver fútbol vivo en el mundo no significa tener mercado tradeable.
- **El brief estructuralmente impecable puede ser conceptualmente contradictorio.** Pre-flight, criterios, SLA — bien escritos — pero pidiendo resucitar el componente que el análisis había archivado.
- **Ticker-only no es shortcut — es una decisión arquitectónica con 3 razones estructurales.** Mantenerla bajo presión de "5 días al Mundial, hagamos algo" es la disciplina que separa el proyecto del problema.
- **`cp` crudo de SQLite con escrituras activas captura estado a medias.** Backup vía API SQLite (`Connection.backup()`) es transaccionalmente coherente. El binario `sqlite3` CLI no está en el container.
- **No apilás cambios sobre un sistema con error activo no diagnosticado.** Aunque el shadow no toque capital, encender sobre V1 con error confunde diagnóstico.

### Estado al cierre del 06-jun

| Frente | Estado |
|---|---|
| V1 baseline | ✅ Sano (22h+ WS, 9.6M events) PERO error nuevo a las 21:56:20 |
| Motor REST en main | ✅ Ticker-only confirmado en código |
| Falsa alarma code 8 | ✅ Enterrada en 3 capas |
| Brief V2 reactivación | ❌ Rechazado |
| Decisión ticker-only | ✅ Blindada con 3 razones estructurales |
| Mercados fútbol Kalshi | ✅ Mapeados (278 amistosos para 9-jun) |
| Gate parcial sobre amistoso | ✅ Metodología validada (sin ticks pre-evento) |
| Pre-flight shadow | ✅ Completo (backup 1.12 GB integrity ok + baseline) |
| PR #22 | 🟡 Branch `fix/fok-kill-409-sensor` HEAD `58ecc24` lista |
| Shadow encendido | 🟡 LISTO pero bloqueado |
| ⚠️ Cabo abierto V1 `_on_orderbook_delta:172` | 🔴 Pendiente diagnóstico antes de encender shadow |
| Capital | 🔒 Cero |

### Para el próximo turno (orden estricto)

1. Diagnosticar error V1 `_on_orderbook_delta:172` — conteo + traceback completo
2. Si puntual: mergear PR #22 + encender shadow con pre-flight completo (un solo redeploy)
3. Si sistemático: arreglar primero, NO encender shadow sobre V1 con problemas activos
4. Día 9-jun: gates de carga reales sobre amistosos en vivo

---

---

## 🗓️ AGREGADO 2026-06-07 — Motor REST ENCENDIDO en SHADOW + fix WAL descubierto por pre-flight

### El arco del 07-jun en una frase

**El Motor REST está encendido y corriendo en producción en modo shadow** (detecta y graba, NO ejecuta — cero riesgo de capital). El pre-flight descubrió un problema de concurrencia de SQLite que el shadow habría destapado bajo la carga del Mundial; lo resolví con WAL + busy_timeout + synchronous=NORMAL y encendí con pre-flight completo + verificación post-deploy. **Falta confirmar que VIVO = GRABANDO.**

### Decisión arquitectónica blindada otra vez: ticker-only se mantiene

Tentación de medir `orderbook_delta` "por completitud" → rechazada. Razón estructural:

1. Arb binario solo necesita top-of-book (la condición `yes_ask + no_ask < 100` se computa del mejor ask de cada lado = lo que el ticker trae)
2. Sizing a $300 / ¼ Kelly / cap 5% nunca barre niveles
3. Si alguna vez se necesitara profundidad, vendría del GET REST de ejecución (diseño §4: ticker = campana, REST = verdad), NO de suscribir orderbook_delta por WS

Único escenario para reconsiderar: capital 10x + estrategia que barre niveles. Con FOK (que no barre — llena al precio o cancela) y este capital, no aplica.

**Medir orderbook_delta difuminaría la línea trazada a propósito para matar los bugs de V2. No entra.**

### El hallazgo del pre-flight: contención de SQLite

Al preparar el pre-flight, descubrí que `get_engine` **NO seteaba `journal_mode` (=delete) ni `busy_timeout` (=0 → falla al instante ante lock)**. El shadow agrega un 2° escritor permanente (las escrituras de `edge_windows`).

**El problema:** dos escritores (V1 + shadow) + `journal_mode=delete` (lock exclusivo) + `busy_timeout=0` (falla al instante) = `database is locked` apenas las escrituras se solapen. Bajo la carga del Mundial, ese solapamiento es **frecuente, no excepcional**.

**Por qué el "0 errores en 20h" era engañoso:** hoy NO hay dos escritores, por eso no hay locks. El lock aparece **cuando enciendo el shadow** (2° escritor) Y **bajo carga** (Mundial). **El pre-flight lo cazó ANTES de descubrir locks en pleno Mundial con la data del evento en juego.**

### El fix (PR `fix/sqlite-wal-busy-timeout`)

- **Event listener `connect`** (idiomático SQLAlchemy — aplica PRAGMAs a CADA conexión del pool, no solo la primera)
- `journal_mode=WAL` (lectores concurrentes + 1 escritor SIN lock exclusivo — **ataca la RAÍZ**)
- `busy_timeout=5000` (espera residual en vez de fallar)
- `synchronous=NORMAL` (seguro con WAL, menos fsync, bonus de rendimiento)
- Guard `is_sqlite`
- **Test clave:** dos escritores concurrentes sin `database is locked`. 2/2 + suite 275 passed

**Por qué WAL y no solo busy_timeout:** la opción "solo busy_timeout" parchea el síntoma (esperar en vez de fallar) pero deja el lock exclusivo de `delete` → los escritores se siguen serializando con latencia hasta 5s. WAL ataca la raíz Y el síntoma. **Para 2 escritores permanentes bajo la carga más alta del año, la solución de raíz.**

### El encendido: con pre-flight completo (la disciplina de V2)

El plan inicial de Gemini era ligero ("flag, redeploy, mirá logs"). Rechazado — el encendido del shadow es cambio de producción y va con el pre-flight de V2, escalado al riesgo REAL: **operativo, no financiero** (reiniciar la captura sana de V1 a 5 días del Mundial).

**Secuencia ejecutada:**
1. Backup FRESCO vía `.backup()` + integrity_check (NO `cp` crudo, NO el de hace horas — la migración a WAL ocurre en el redeploy, backup debe ser inmediatamente previo al estado que se migra).
2. Baseline V1 capturado.
3. Merge de WAL + #22 (fix del sensor) JUNTOS a main → un solo redeploy.
4. `MOTOR_REST_ENABLED=true` + `TRADING_ENABLED=false` → redeploy (commit `1b35b4a`).

**Decisiones de orden:**
- #22 NO era bloqueante del shadow (shadow no llama executor) pero se mergeó por higiene en mismo redeploy (un solo reinicio de V1, no dos)
- HEARTBEAT_EVERY NO se tocó — una cosa a la vez al encender en producción

**Nota sobre rollback:** apagar `MOTOR_REST_ENABLED` NO revierte WAL (la DB ya migró de formato). Está bien — WAL es seguro de mantener con un solo escritor. Dos redes distintas para dos riesgos: el flag cubre "shadow se porta mal", el backup fresco cubre "la migración a WAL salió mal".

### Verificación post-deploy — encendido limpio

| Check | Resultado |
|---|---|
| Deployment | healthy, commit `1b35b4a` |
| Flags | `MOTOR_REST_ENABLED=true`, `TRADING_ENABLED=false`, `MOTOR_1=false` ✅ |
| WAL migrado | `journal_mode=wal`, archivos `-shm`/`-wal` presentes ✅ |
| Motor REST registrado | log `Motor REST registered (SHADOW...)` + polling REST activo ✅ |
| Captura viva + sin locks | +262 eventos en 6s, lectura concurrente bajo WAL, cero `database is locked` ✅ |
| `edge_windows` | **0** — ⚠️ pendiente confirmar que graba |

### Falso positivo bien debuggeado

El `awk` contó 4 matches de `database is locked` como "post-encendido". Investigué: son 2 EVENTOS (cada error = 2 líneas: causa + wrapper), AMBOS PRE-redeploy (timestamps `20:46`/`20:48`, durante el baseline en modo `delete`). El awk los metió en rango porque las líneas de continuación del traceback no empiezan con timestamp. **Verificado contra timestamps reales: cero locks tras WAL.** Si hubiera tomado el conteo crudo al pie de la letra, habría creído que WAL falló cuando funcionó.

### ⚠️ Lo único que falta: confirmar que VIVO = GRABANDO

`edge_windows=0`. El shadow está **registrado, escuchando, procesando ticks** (vivo confirmado). Pero **todavía no grabó una sola `edge_window`**. Dos explicaciones imposibles de distinguir con `edge_windows=0` solo:

- **(a) Benigno:** no hubo arb que cruce umbral aún (esporádico). Shadow perfecto, esperando.
- **(b) A descartar:** camino detección→grabado roto — trigger no dispara, grabado falla en silencio, o **el parser de size devuelve None → filtro de profundidad descarta TODO** → `edge_windows` queda en 0 aunque haya arbs.

**Conecta con el `[verificar contra captura real]` pendiente:** el gate sobre amistosos confirmó que el parser PUEDE leer size (`yes_bid_size_fp: "2033.43"`) — pero con `inspect_ws.py`, NO con el código del Motor REST en producción.

### 5 chequeos para distinguir (a) vs (b) durante soccer en vivo

1. Heartbeat del Motor REST sigue creciendo (motor vivo, no colgado)
2. ¿Logs de ticks de soccer procesados? ¿Recibe y parsea mensajes ticker?
3. **CRÍTICO:** ¿el parser de size lee valores REALES en producción (NO None)? Si lee None, el filtro descarta todo y `edge_windows` queda en 0 aunque haya arbs
4. ¿Hubo `edge.detected` SIN `EdgeWindow` grabada? = grabado roto
5. `edge_windows` creciendo, interpretado con 1-4: crece = graba bien; no crece pero 1-3 sanos = "no hubo arb" benigno

### Cabo del 06-jun cerrado de facto

El error `_on_orderbook_delta:172 Error procesando orderbook_delta` del 21:56:20 del 06-jun quedó cerrado: el handler cambió de `:172` a `:136` en este deploy por el merge, y el síntoma NO reaparece post-deploy en primera ventana de observación. **Pendiente confirmar formalmente** que el cambio de línea es solo reubicación, no cambio funcional (WAL es del engine, #22 del executor dormant — ninguno DEBERÍA tocar el trigger).

### Estado del frente Motor REST

| Componente | Estado |
|---|---|
| Detección ticker-only validada sobre soccer en vivo | ✅ (amistosos, sesión 06-jun) |
| Sensor FOKExecutor (3 rutas, API viva) | ✅ + ahora en main (#22 mergeado) |
| SQLite concurrencia (WAL) | ✅ migrado y validado en vivo |
| Shadow encendido en producción | ✅ VIVO, sin riesgo de capital |
| Shadow GRABANDO (`edge_windows`) | ⚠️ pendiente confirmar durante soccer en vivo |
| Gates de carga restantes (RTT bajo carga) | pendiente — mercado de alta liquidez |
| Wiring `execute()` + checklist capital | ❌ NO este Mundial (7d sin crashes no se cumple) |

### Aprendizajes de la sesión

- **El pre-flight cazó un problema que el "todo sano, 0 errores/20h" escondía.** El 0/20h era real pero engañoso — no había locks porque no había 2 escritores. El shadow introduce el 2° escritor; el lock aparecería bajo carga del Mundial. **Verificar la config de SQLite ANTES de encender, en vez de descubrir locks en pleno Mundial, es la disciplina de pre-flight de V2 pagando dividendos en un componente nuevo.**

- **WAL ataca la raíz; busy_timeout solo el síntoma.** Cuando hay opción de parche-vs-raíz para un sistema que va a estar bajo la carga más alta del año, la raíz.

- **"Vivo" no es "grabando".** Un componente puede arrancar, no crashear, parecer sano —y no hacer su trabajo (grabar) por un camino roto silencioso. `edge_windows=0` con el motor vivo no distingue "no hubo trabajo" de "trabajo roto". Hay que verificar el camino interno, no solo el resultado final.

- **No tomar el conteo de una herramienta al pie de la letra.** El awk contó 4 locks "post-encendido"; verificar timestamps reales mostró que eran pre-redeploy. Mismo principio de toda la saga.

- **Una cosa a la vez al encender en producción.** Rechacé bajar el HEARTBEAT_EVERY en el mismo redeploy del encendido — meter un cambio de comportamiento justo cuando observás el arranque limpio confunde el diagnóstico si algo sale raro.

- **El riesgo del encendido del shadow es operativo, no financiero.** TRADING_ENABLED=false → cero riesgo de capital. Pero reiniciar la captura sana de V1 (la fuente de data) a 5 días del Mundial SÍ es riesgo.

### Para el próximo turno (orden estricto)

1. Durante soccer en vivo (9-jun o antes): correr los 5 chequeos de "VIVO = GRABANDO" para distinguir (a) benigno de (b) camino roto.
2. Si el camino está roto: diagnosticar y arreglar antes del Mundial.
3. Si el camino está sano y `edge_windows` empieza a crecer durante mercados con liquidez: shadow validado, listo para grabar el Mundial.
4. Confirmar que el cambio de `:172` a `:136` en el handler de `_on_orderbook_delta` es solo reubicación.
5. Día 9-jun: gates de carga reales (RTT bajo carga + cadencia ticker + parser size con valores reales en producción).

---

---

## 🗓️ AGREGADO 2026-06-12 — FASE 0 (los frenos) COMPLETA + Mundial confirma: binario=0, multi-outcome es el camino

### El arco del sprint 08-jun a 12-jun en una frase

**FASE 0 (los frenos) completa de código.** Motor REST listo para encender con RiskManager que VE, stop-losses que DISPARAN y kill-switch que SOBREVIVE reinicios. El Mundial corre bajo carga real con infra impecable; el binario = 0 confirmado con data; el negocio está en multi-outcome (P3).

### Los 3 hallazgos de la verificación adversarial (antes de que costaran plata)

**1. RiskManager CIEGO al Motor REST**
- Stop-losses leen `Trade` settled+pnl (`manager.py:148`); exposición lee pending/filled (`manager.py:95`)
- El cable del Motor REST no escribía `Trade` → una racha mala NO activaba NINGÚN freno acumulado
- Fix en #38 (Trade persistence) + #40 (deuda RM draft)

**2. Kill-switch volátil**
- `BotState.is_paused` era memoria pura para TODOS los motores
- Con Coolify `restart: unless-stopped`, un reinicio des-pausaba el bot con la pata expuesta
- *"Un kill-switch que se des-pausa solo no es un kill-switch."*
- Fix en #32 (persistencia en `OperationalState`, rehidratación al boot, despausa SOLO manual)

**3. Settlement greenfield**
- NADIE pasaba trades a `settled` en todo el codebase
- La escalera −3/−8/−15% era literalmente incapaz de disparar, también para Motor 1
- Fix en #39 (transacción atómica + poller supervisado + stub `KalshiSettlementSource`)

**Cuarto bug del path de capital descubierto antes de costar dinero.** Junto con los 3 attempts V2 rolledback, Issue #14 del executor heredado, el sensor con campos inexistentes, y el KILL como HTTP 409 — esta vez 3 bugs en los frenos.

### PRs construidos en el sprint

| PR | Pieza | Estado |
|---|---|---|
| #31 | EdgeWindow: count/fees/edge_pct + primer ALTER del proyecto (migración idempotente en init_db) | ✅ main |
| #32 | Kill-switch persistente (OperationalState, rehidratación al boot, despausa manual) | ✅ main |
| #33 | Harness E2E de execute() — 5 rutas contra shapes reales | ✅ main |
| #34-#37 | Motor 2 analítico completo: no_vig (multiplicativo+aditivo), Odds API client (backoff 60s tipado), matcher (4 reglas + NFKD), detector (edge >3pp post-fee, ¼ Kelly cap 5%) | ✅ main |
| #38 | A.1 — Trade persistence en RestExecutor: arb_id, intents PRE-red, rollback→settled pnl<0 inmediato, expuesta→filled visible, pausa preventiva | ✅ main |
| #39 | PR-B — Settlement core: transacción atómica por arb (pérdida fantasma IMPOSIBLE), poller supervisado, KalshiSettlementSource stub | ✅ main |
| #40 | Deuda RiskManager: lock de clase (race), descuento de arbs hedged (sobrestima), 9 tests de integración (escalera dispara con pnl real) | 🟡 draft |
| #41 | P2 — Discovery por prefijo real + re-discovery 6h (cierra el misterio KXFIFAGAME) | 🟡 draft |

### El Mundial (lo operativo)

**P1 confirmado:** el bot NO trackeaba el Mundial antes del fix
- Los prefijos eran series exactas; faltaban `KXWC*`/`KXFIFA*`
- Fix #30 → 1.2M eventos/día, 89% Mundial, pico 213k/hora

**Infra validada bajo fuego:**
- 0 locks (WAL hizo su trabajo)
- 0 errores
- Watchdog auto-recuperó 2 veces
- Cadencia ticker 20× (6-7 ticks/seg)
- `size_real` discriminando en vivo (peor caso 186/200)

**Negocio BINARIO = 0 (dato real, no teoría):**
- Mercados de selección bien arbitrados → la comisión come el spread del top-of-book
- La proyección de "73% de captura sobre liquidez NBA como proxy" **fue refutada por el régimen real**
- El régimen del Mundial es DIFERENTE al de NBA, y eso solo se descubrió midiendo en shadow
- **Sin riesgo de capital, sin pérdida**

**Nueva dirección de negocio: P3 multi-outcome**
- `detect_multi_outcome_arb` ya existe en el código, sin usar
- Diseño pendiente
- El negocio del fútbol está en arbitrar outcomes múltiples (1X2, total goles, etc.), no en binario YES/NO sobre el ganador

**KXFIFAGAME nunca apareció** → P2 (#41) lo resuelve de raíz: familias por prefijo + re-discovery 6h → markets nuevos sin restart.

### Decisiones / overrides registrados

- **Demo CANCELADA** (orden Noel): construimos directo sobre producción con `TRADING_ENABLED=false` + `KALSHI_ENV=production` como red de seguridad. Razonamiento: demo tampoco simula microestructura real, shadow ya da los números, mejor un solo entorno bien instrumentado.
- **Sizing arb = caps, cero Kelly** (p≈1 rompe Kelly)
- **Motor 2 = ¼ Kelly** (probabilístico, p<1 con incertidumbre)
- **PnL realized-only se documenta, NO se redefine** (semántica financiera de Noel)
- **Deploy NO en caliente**: todo FASE 0 entra en UNA ventana → el reloj de 7 días arranca una sola vez sobre el código final
- pnl del rollback a precios límite (sesgo conservador) — verificar contra `get_fills`
- Coid con sufijo `-yes/-no` (40 chars) — verificar en smoke

### El plan de los 3 motores (aprobado, en ejecución)

```
FASE 0 frenos ✅ código → FASE 1 Motor REST ON → FASE 2 Motor 2 cable → FASE 3 Motor 3
```

- **Motor REST:** cable completo + frenos completos → solo falta deploy + smoke + 7 días
- **Motor 2:** analítica completa (#34-#37). Falta: fuente de quotes Kalshi, poller shadow, ODDS_API_KEY ($30-60/mes — decisión Noel), executor 🔴 (diseño → review)
- **Motor 3:** greenfield. **Hueco de diseño:** ¿quién ABRE las posiciones que el exit CLV cierra? (decisión Noel antes de codear)

### Pendientes de Noel (lo único que falta para encender)

1. Merge #40 (deuda RM) y #41 (P2)
2. Correr snippet de shapes settlement (read-only, 2 min) → Claude llena `KalshiSettlementSource` + cablea el poller (1 sesión)
3. Elegir ventana del deploy único (una sola interrupción de captura)
4. Post-deploy: smoke `place_order` (1 contrato) → 7 días → `TRADING_ENABLED=true` con `ACTIVE_CAPITAL_USD` conservador

### Aprendizajes meta del sprint

- **"El cable existe ≠ los frenos funcionan."** Tener el Motor REST escribiendo trades NO basta si el RiskManager no los lee. Tener un kill-switch NO basta si no sobrevive un reinicio. Tener una escalera de stop-loss NO basta si nada nunca pasa a `settled`. **Cada componente del path de capital se verifica end-to-end contra el siguiente, no en aislamiento.**

- **El cuarto bug del path de capital descubierto antes de costar dinero.** La verificación adversarial sigue valiendo cada hora invertida — el patrón se mantiene desde V2.

- **El negocio puede no estar donde lo asumiste, y eso se descubre solo midiendo.** Asumimos que el Mundial daría arbitrajes binarios (la dilatación lo sostenía). La realidad: binario = 0 porque la comisión come el spread en mercados de selección bien arbitrados. **El negocio está en multi-outcome — descubrirlo ahora, en shadow con cero riesgo, en vez de en producción con capital, es exactamente lo que la disciplina compró.**

- **"Demo cancelada" no es falta de disciplina — es disciplina aplicada al gate correcto.** El demo no daba info que el shadow no diera. Multiplicar entornos no multiplica certidumbre cuando ambos son aproximaciones imperfectas del régimen real.

- **Discovery por familias > discovery por exactos.** El misterio KXFIFAGAME no era de Kalshi — era del filtro de discovery del bot. Las familias por prefijo (`KXFIFA*`) + re-discovery cada 6h cierran tanto el agujero como la dependencia de restart para markets nuevos.

### Runbooks vivos

- `docs/runbook_kill_switch.md` — kill-switch 3am: NO reiniciar, posiciones, CLEAR
- `docs/checklist_activacion_capital.md` — gates de capital al día

### Estado consolidado al cierre del 12-jun

| Frente | Estado |
|---|---|
| V1 baseline | ✅ SANO continuo, 1.2M ev/día (89% Mundial) |
| Motor REST shadow | ✅ Corriendo, cable completo, frenos completos |
| Mundial bajo fuego | ✅ Infra impecable (0 locks, 0 errores, watchdog 2× auto-recovery) |
| Negocio BINARIO en Mundial | ❌ = 0 (comisión come spread) |
| Nueva dirección negocio P3 multi-outcome | 🟡 código existe, diseño pendiente |
| RiskManager arreglado | 🟡 #38 main, #40 draft |
| Kill-switch persistente (#32) | ✅ main |
| Settlement core (#39) | ✅ main, stub shapes pendiente |
| Harness E2E execute (#33) | ✅ main, 5 rutas |
| Motor 2 analítico (#34-#37) | ✅ main, falta cable |
| Discovery por prefijo (#41) | 🟡 draft |
| EdgeWindow ampliado (#31) | ✅ main, primer ALTER del proyecto |
| Demo | ❌ Cancelada (orden Noel) |
| TRADING_ENABLED | 🔒 false hasta smoke + 7d post-deploy |
| Capital | 🔒 Cero |

### El veredicto del Mundial al 12-jun

> *"El Mundial está corriendo, la infra aguanta, el binario no da. El próximo motor de negocio está en multi-outcome, y la disciplina del shadow nos permitió descubrirlo SIN PÉRDIDA. Eso es ganar el Mundial, aunque no se haya operado un solo contrato."*

---

## 🗓️ AGREGADO 2026-06-12 (auditoría) — El gap entre "el bot funciona" y "el bot gana plata"

### Diagnóstico en una frase

> **Construimos primero (y muy bien) la infraestructura y los frenos del motor cuya estrategia tiene la MENOR frecuencia de señal del menú; las dos estrategias con señal REAL (P3 y Motor 2) son las que faltan cablear.**

### La tabla de auditoría motor por motor

| Motor | Mecánica | Negocio | Veredicto |
|---|---|---|---|
| **Motor REST (arb binario)** | 10/10 — cable, frenos, settlement, kill-switch, harness | 🔴 caza una presa casi inexistente (libro cruzado) | Dejarlo armado (opción gratis, dispara si algún día pasa) pero NO esperar trades de acá |
| **P3 multi-outcome (1X2)** | NO construido — `detect_multi_outcome_arb` existe en `math/`, sin usar | 🟢 LA oportunidad real del fútbol: 3 mercados del mismo partido (Gana/Empata/Pierde) sumando <100 post-fee. Desalineación entre 3 libros = más frecuente y ventanas más largas que un libro cruzado | El gap #1 entre "el bot funciona" y "el bot gana plata" |
| **Motor 2 (consenso sportsbooks)** | cerebro completo (#34-37), sin manos: falta fuente de quotes + poller + executor + tu API key | 🟢 el roadmap lo llama "EL MÁS RENTABLE" — no necesita ineficiencia interna de Kalshi, solo que Kalshi se atrase vs los books (>3pp). Pasa mucho más seguido que un libro cruzado | Gap #2 — el cerebro está, hay que cablearle las manos |
| **Motor 3 (CLV)** | cero código | depende de entradas que no existen | Último, correcto que espere |

### El agravante: ceguera por falta de telemetría near-miss (P4)

> *"Ni siquiera sabemos cuán cerca estuvo cada mercado (¿a 1¢? ¿a 20¢?), porque la telemetría de near-miss (P4) nunca se construyó. Estamos ciegos a la distancia de la oportunidad."*

Por qué importa:
- Binario = 0 confirmado, pero no sabemos si la comisión come por 1¢ (cerca, ajustable) o por 20¢ (lejos, estructural)
- Sin esa data, no podemos calibrar umbrales ni decidir si un cambio de fee schedule de Kalshi nos abriría el mercado
- P4 es la data que convierte "binario = 0" en accionable

### El reordenamiento estratégico implícito

**FASE 0 completa fue trabajo correcto de los frenos, PERO el orden de las FASES 1-2-3 está al revés vs el ranking de negocio:**

| Plan original | Lo que el diagnóstico sugiere |
|---|---|
| FASE 1: Motor REST ON (smoke + 7d + capital) | FASE 1: Motor REST ON — pero con expectativa cero de trades, es la opción gratis |
| FASE 2: Motor 2 cable | FASE 2: P3 multi-outcome (1X2) — la oportunidad real del fútbol, y el Mundial está corriendo AHORA |
| FASE 3: Motor 3 | FASE 3: Motor 2 cable — "el más rentable" según roadmap |
| (sin lugar) | P4 near-miss telemetría — habilita decisiones sobre binario |

**No es que FASE 0 esté mal hecha — es que cablear las manos a los motores con señal real (P3 + Motor 2) genera más PnL esperado que pasar al smoke del Motor REST con TRADING_ENABLED=true.**

### El dilema operativo

- Ya construimos los frenos para el Motor REST. Activarlo con capital tiene marginal cost bajo (smoke + 7d)
- PERO con el binario = 0 confirmado, el ROI esperado de esos 7 días es ≈ 0
- Los mismos 7 días invertidos en P3 (que ya tiene matemática hecha) o en cablear las manos de Motor 2 dan EV mucho más alto

**Pregunta para próxima sesión:** ¿activar Motor REST igual (opción gratis, frenos ya están, "dispara si algún día pasa") MIENTRAS en paralelo se cablea P3? ¿O pausar Motor REST en TRADING_ENABLED=false indefinido y dedicar 100% del foco a P3 + Motor 2?

### Por qué este diagnóstico vale más que cualquier PR del sprint

El sprint de 5 días (PRs #31-#41) fue ingeniería disciplinada y bien hecha. Pero la auditoría destapa algo que ningún PR podía destapar:

> **Estábamos resolviendo correctamente el problema equivocado.**

Los frenos del Motor REST son perfectos. La infra del Motor REST es 10/10. Y el Motor REST captura una oportunidad **que casi no existe** en el régimen real medido.

Esto es exactamente el patrón meta que toda la saga viene cazando — pero esta vez aplicado al diseño de portafolio de estrategias, no a la arquitectura de un componente:

- En la saga V2: construíamos defensas para un componente cuya complejidad NO era necesaria → archivamos V2, pivot a Motor REST.
- En este sprint: construimos frenos para un motor cuya señal NO es frecuente → reordenar prioridades hacia los motores con señal real.

**Mismo principio: medir el régimen real antes de invertir en el componente.** Lo aplicamos para arquitectura; faltaba aplicarlo para selección de estrategia.

### Lo que NO cambia (sigue válido)

- FASE 0 está bien hecha. Los frenos del Motor REST son reutilizables cuando se cablee Motor 2 (que TAMBIÉN ejecuta órdenes en Kalshi). RiskManager, settlement, kill-switch, harness — todo aplica.
- El Motor REST sigue siendo una opción gratis — si en algún momento el régimen cambia (cambio de fee schedule, mercado con menos market makers), dispara solo.
- La decisión de demo cancelada sigue siendo correcta. La decisión de TRADING_ENABLED=false hasta gates duros sigue siendo correcta.

### Acciones nuevas que esta auditoría destapa

1. **P3 multi-outcome (1X2) sube a prioridad #1** — diseñar + implementar + cablear. La matemática (`detect_multi_outcome_arb`) ya existe.
2. **P4 telemetría near-miss sube a prioridad #2** — habilita decisiones informadas sobre binario en futuro régimen.
3. **Motor 2 cable de manos sube a prioridad #3** — el cerebro analítico está (#34-#37), falta fuente de quotes Kalshi + poller shadow + ODDS_API_KEY ($30-60/mes — decisión Noel) + executor (puede reusar frenos del Motor REST).
4. **Motor REST mantiene plan original** pero con expectativa explícita de 0 trades — no es prioridad, es opción gratis.

### Aprendizajes meta de la auditoría

- **"Construir bien la cosa equivocada es peor que construir mal la cosa correcta."** Frenos del Motor REST 10/10, motor captura oportunidad casi inexistente. El sprint fue ingeniería disciplinada, pero el diagnóstico destapa que el orden de FASES estaba mal vs el ranking de negocio.

- **El régimen real refuta la teoría de portafolio también, no solo la de arquitectura.** Asumimos que el ranking del roadmap (Motor 1 → 2 → 3) era el orden correcto de construcción. La data del Mundial dice que el orden correcto es P3 → Motor 2 → resto. Mismo patrón: medir el régimen antes de invertir.

- **La ceguera de near-miss (P4) es deuda de telemetría que se paga ahora.** Sin saber si el binario está a 1¢ o a 20¢, no podemos tomar decisiones informadas sobre el componente. P4 no es lujo — es la data que convierte "binario = 0" en accionable.

- **Una auditoría adversarial vale más que un PR completo cuando el componente que dejaste de construir tiene más EV que el que terminaste.** El gap entre "el bot funciona" y "el bot gana plata" no se cierra con más código del Motor REST — se cierra con código de P3 y Motor 2.

---

---

## 🗓️ AGREGADO 2026-06-13 — Motor 2 LIVE con feed real + primera EdgeWindow consensus + disciplina N=1

### El arco del 13-jun en una frase

El pivot estratégico de la auditoría de ayer se ejecutó en UN día: ambos gaps cerrados en main (Motor REST arb 1X2 ejecutable + Motor 2 cable shadow + executor), feed real de The Odds API conectado, primera señal consensus capturada (3.11pp neto USA/AUS), capital sigue en false por disciplina N=1 marginal.

### Lo que se mergeó (todo en main, shadow-safe)

| PR | Qué | Estado |
|---|---|---|
| #48 | chore: limpieza de CI (formato + 2 tests muertos + lint) | merged |
| #49 | Motor 2 executor direccional single-leg (el cable que apuesta) | merged |
| #47 | Motor 2 cable shadow (extractor Kalshi + poller + matcher) | merged |
| #50 | Motor REST: arb multi-outcome 1X2 ejecutable (profit lockeado) | merged |
| #51 | Flip por config: ODDS_API_KEY set → LiveOddsSource (regiones eu,us / Pinnacle) | merged |
| #52 | fix: throttle de alertas V2 init a -inf (bug latente + flake de CI) | merged |
| #53 | Motor 2: desglose auditable (gross/fee/neto) + umbral tuneable + script reporte | verde, listo |

### El hito: feed real conectado

- `ODDS_API_KEY` seteada (len 32), `SPORT_KEYS=soccer_fifa_world_cup`, `REGIONS=eu,us`
- `TRADING_ENABLED=false` → observa, no apuesta
- **Primera fila `EdgeWindow(kind='consensus')`:**
  - `KXWCGAME-26JUN19USAAUS-USA` · **edge 3.11pp neto** · 2026-06-13 20:32 UTC
  - Conteo tabla: `consensus=1`, `multi_outcome=116`

**Lo que esto significa:** la pipeline `Odds API → Pinnacle (regiones eu,us) → no-vig consensus → match contra ticker Kalshi → comparación con BBO de Kalshi → cálculo de edge neto post-fee` está corriendo end-to-end sobre data real del Mundial. Sin shortcuts, sin fixture, sin demo.

### Bugs encontrados y arreglados

**Throttle de alertas V2 (#52) — latente + causa del flake de CI**

El throttle usaba `now - last_alert > THRESHOLD` con `now = time.monotonic()` (segundos desde el boot) y `last_alert` init en `0.0`. En un proceso con uptime < THRESHOLD (container/CI recién arrancado), bloqueaba por error la primera alerta. Fix: init a `float("-inf")`.

**Impacto producción:** un container recién deployado no alertaba sobre tormentas de gaps en su primer arranque. Bug silencioso, latente, descubierto al investigar un flake de CI que recreaba la condición. **Los flakes de CI a veces son señal de bugs latentes en producción, no ruido.**

**"¿Por qué no conectaba?" — la trampa del deploy**

Setear la env var no alcanza si el código desplegado no la lee. El flip que lee `ODDS_API_KEY` vivía en un PR sin mergear → el bot seguía con el fixture demo. **Lección: merge ≈ deploy; una env var nueva solo sirve si el código corriendo la consume.**

### Conceptos clave (para no olvidar)

- **Motor 2 (consensus) = apuesta DIRECCIONAL +EV, NO arbitraje.** Puede perder un trade individual. A $5/apuesta sobre $100 = ~20 tiros → varianza alta aun con edge real. El edge paga en cientos de apuestas.
- **Arb multi-outcome 1X2 (#50) = profit LOCKEADO, sin varianza** (comprar YES en los 3 outcomes si Σasks<100). Pero dispara raro (near-miss ~101c).
- **`edge_pct` YA es neto** (la comisión se resta en `_net_edge_pct`). El `gross/fee None` era cosmético; con #53 se persiste el desglose explícito.
- **Muro de 3 capas para apostar plata real:** (1) `LiveOddsSource` (odds reales) — con fixture fake nunca apuesta; (2) `TRADING_ENABLED=true` → construye el executor (Capa A); (3) `place_order` bloquea buys con flag off (Capa C). Para apostar por error se necesitan TRES cosas configuradas mal al mismo tiempo — defense in depth en el path de capital.
- **Encendido = solo env vars.** Ya no hay que editar código. Separa decisión operativa de decisión de código, reduce blast radius del error humano.

### La decisión clave del día: NO encender con N=1 marginal

Apareció UNA señal de 3.11pp neto, sobre umbral de 3pp pero apenas. La tentación es decir "ya hay edge, encendamos capital — solo $100 para empezar".

**La disciplina dice no.** Razones:

1. **Motor 2 es DIRECCIONAL.** Una señal individual puede perder por varianza. El edge paga en cientos, no en una. N=1 es ruido, no señal.
2. **3.11pp sobre 3pp umbral es MARGINAL.** Si el umbral real necesario para PnL positivo es 3.5pp (post-fee de ejecución, slippage, etc.), entonces 3.11pp es perdedor esperado. Solo la data con N alto y reporte de desglose dice si los edges sobre 3pp son consistentes o aislados.
3. **24-48h es barato.** No hay urgencia. El Mundial sigue. Cada hora de shadow es una hora de data adicional sobre la distribución real de edges en este régimen.
4. **El reporte con #53 va a desglosar gross/fee/neto** → permite ver si las señales son estructurales (consistente gross alto, fee normal) o de borde (fee come casi todo el gross).

**El patrón:** *"medir antes de decidir le ganó a la intuición en cada bifurcación de la saga."* Esta es la misma disciplina aplicada al gate de capital. **Plata intacta cuando la data no es clara es SIEMPRE la opción correcta.**

### Próximos pasos (decisión con datos, no con ansiedad)

1. Mergear #53 + redeploy → empieza a guardar gross/fee/neto, umbral tuneable
2. Dejar correr shadow con feed real 24-48h (`TRADING_ENABLED=false`)
3. Mañana: `python scripts/motor2_consensus_report.py --hours 48`
4. **Gate de decisión:** ¿hay un puñado consistente de edges >3pp NO-marginales?
   - **Sí** → encender `TRADING_ENABLED=true` + `ACTIVE_CAPITAL_USD=100` + `MOTOR_REST_ENABLED=true`. Frenos: $5/trade, $25 exposición, stop diario −$3.
   - **No** (solo señales marginales aisladas) → no encender, plata a salvo.

### Variables Coolify (referencia)

Shadow readout (ahora):
```
ODDS_API_KEY=<set>
MOTOR_2_SPORTSBOOK_ENABLED=true
TRADING_ENABLED=false
```

Encender capital (si el gate da SÍ):
```
TRADING_ENABLED=true
ACTIVE_CAPITAL_USD=100
MOTOR_REST_ENABLED=true
```

Tunear umbral / filtrar marginales (tras #53):
```
MOTOR_2_MIN_EDGE_PCT=4.0
```

### El arco de hoy en contexto del pivot de ayer

Ayer la auditoría destapó que construimos los frenos del motor con menor señal mientras P3 y Motor 2 (los de señal real) faltaban cablear. Hoy:

- **P3 multi-outcome (1X2):** cableado ejecutable en PR #50 (arb LOCKEADO, profit garantizado si dispara). El componente que la auditoría llamó "gap #1".
- **Motor 2 cable shadow:** cableado en PR #47 + executor en PR #49. El componente que la auditoría llamó "gap #2 — el cerebro está, hay que cablearle las manos".
- **Feed real conectado:** ODDS_API_KEY set, LiveOddsSource activo. The Odds API ($30-60/mes decisión pendiente de ayer) → ejecutada y operando.
- **Primera EdgeWindow consensus** registrada con data real.

**El pivot de la auditoría se ejecutó en UN DÍA.** El sprint de los 5 días previos había construido los frenos del Motor REST; hoy se cablearon las manos a los motores con señal real. Velocidad de ejecución sostenida por la disciplina de gates — no se rompen las reglas del shadow, no se enciende capital con N=1, no se mete capital en motor de varianza alta sin muestra.

Y aún así: Motor REST sigue armado como opción gratis (PR #50 le agregó el arb multi-outcome 1X2 ejecutable, sumándole un componente sin varianza). **No se desarmó nada — se sumó.**

### Aprendizajes de la sesión

- **"Merge ≈ deploy."** Setear una env var sin que el código mergeado la lea = bot corriendo con fixture indefinido sin que nadie lo note. La verificación end-to-end contra logs es lo único que confirma que el path real está activo.
- **Bug latente cazado por flake de CI.** El throttle de alertas V2 nunca se ejercitó en producción porque siempre había uptime > THRESHOLD al primer trigger. CI lo expuso al arrancar containers nuevos. Los flakes de CI a veces son señal de bugs latentes en producción, no ruido — vale investigar antes de skip-earlos.
- **N=1 marginal NO es base para activar capital.** El Motor 2 es direccional con varianza alta; el edge paga en cientos de apuestas. 3.11pp sobre 3pp umbral es marginal aun siendo matemáticamente sobre el threshold. 24-48h de shadow con #53 dan la data para decidir con N suficiente.
- **Encendido = solo env vars** es disciplina de blast radius. Separa la decisión operativa de la decisión de código. Permite encender y apagar sin reinicio de captura sana de V1 y sin tocar el código que ya pasó review.
- **El pivot estratégico se ejecuta rápido cuando los componentes están listos.** Ayer la auditoría reordenó prioridades; hoy ambos gaps están en main. La velocidad vino de que la matemática y el cerebro ya estaban — solo faltaba cablear y conectar el feed.
- **El muro de 3 capas reduce el riesgo del error humano.** Para que el bot apueste por error se necesitan TRES cosas configuradas mal al mismo tiempo.

### Estado consolidado al cierre del 13-jun

| Frente | Estado |
|---|---|
| V1 baseline | SANO continuo |
| Motor REST shadow | Corriendo, ahora con arb 1X2 ejecutable (#50) |
| Motor 2 (consensus) feed real | LIVE en shadow con The Odds API |
| Primera EdgeWindow consensus | 3.11pp neto USA/AUS, 20:32 UTC |
| EdgeWindow multi_outcome | 116 (acumulado) |
| EdgeWindow consensus | 1 (primera del día) |
| Throttle de alertas V2 (latente) | Arreglado (#52) — init a -inf |
| Flip por env var (ODDS_API_KEY) | #51 mergeado |
| Desglose gross/fee/neto auditable | #53 verde, pendiente merge + redeploy |
| Script reporte 48h | scripts/motor2_consensus_report.py |
| TRADING_ENABLED | false hasta gate de decisión con muestra |
| Capital | Cero — disciplina N=1 sostenida |
| Ventana de decisión | 24-48h de shadow con feed real → gate |

### Resumen de una línea del día

> **Feed real conectado · primera señal capturada (3.11pp) · CI verde · plata intacta.**

---

## 🗓️ AGREGADO 2026-06-14 — Edges fantasma de Motor 2 cazados, fix con 3 guardarraíles

### El arco del 14-jun en una frase

El día 2 del feed real generó 146 EdgeWindow consensus con distribución BIMODAL: 137 sanas (3-5pp) + 8 monstruos (48-51pp). Las 8 anomalías eran todas del mismo partido jugándose in-play. Fix con 3 guardarraíles en capas. Motor 2 confirmado como estrategia pre-match. Capital intacto.

### La data que destapó el bug

EdgeWindow consensus pasó de 1 → 146 filas, todas >3pp. **Distribución bimodal:**

| Bucket | Cantidad | Veredicto |
|---|---|---|
| 3-5pp | 137 | Sanas, plausibles — lo esperado |
| 48-51pp | 8 | Monstruos imposibles |

**Las 8 anomalías:**
- Todas del mismo ticker family: `KXWCGAME-26JUN14GERCUW` (Alemania vs Curazao)
- Outcomes CUW (Curazao gana) y TIE (empate)
- Ventana temporal acotada: 18:40-18:57 UTC (~17 min)
- Coincidencia exacta con la fase in-play del partido

**Por qué se sabe que son falsos positivos sin verificar la causa:** un edge neto de 51pp = duplicar capital sin riesgo. Económicamente imposible en un mercado binario líquido con participantes informados. Si fuera real, lo habrían arbitrado en segundos.

### Causa raíz: spread fantasma por mercado in-play

Cuando el partido arranca a jugarse:

1. **Kalshi reacciona al juego en vivo** → cuando Alemania empieza a dominar, el outcome perdedor (CUW gana) y el empate (TIE) colapsan a precios ~0/100 rápidamente. El BBO de Kalshi refleja la realidad emergente del partido.
2. **The Odds API sigue sirviendo líneas pre-partido o in-play degeneradas.** El feed no se actualiza con la velocidad/precisión que Kalshi sí tiene.
3. **El detector compara las dos** → diferencia gigantesca → "edge de ~50pp" → guardar EdgeWindow.

**El gap real:** faltaba un filtro de mercado iniciado / resuelto / stale. El núcleo matemático estaba bien (las 137 señales de 3-5pp lo prueban). Era ruido de borde, no bug estructural.

**Por qué esto es coherente con la lógica de la estrategia:** Motor 2 es comparación de consenso pre-match vs precio de Kalshi. La hipótesis del edge es "Kalshi se atrasa vs los sportsbooks profesionales pre-kickoff". **Después del kickoff esa hipótesis se rompe** — Kalshi tiene MÁS información en tiempo real (el juego en vivo) que la línea consensus pre-partido.

### El fix — PR #54 (3 guardarraíles en capas)

| # | Guardarraíl | Dónde | Qué hace |
|---|---|---|---|
| 1 | Pre-match (principal) | detector.find_signals | solo evalúa partidos con commence_time > now |
| 2 | Mercado resuelto | sources._parse_event_quotes | saltea markets con status != open/active |
| 3 | Cap plausibilidad | MAX_PLAUSIBLE_EDGE = 0.15 | descarta y loguea cualquier edge >15pp |

**Por qué 3 capas y no 1 — defense in depth:**
- Capa 1 (pre-match) ataca la causa raíz
- Capa 2 (mercado resuelto) captura el caso donde Kalshi marca como cerrado antes de commence_time
- Capa 3 (cap plausibilidad) es la red de seguridad estructural — "si nada de lo anterior te atrapa pero el edge resulta >15pp en binario líquido, es data podrida por definición"

**Las tres juntas:** para que se cuele un falso positivo monstruo se necesitan los tres filtros fallando al mismo tiempo.

### Tests + fixtures relativas a now

- 3 tests nuevos cubriendo cada guardarraíl
- Fixtures pasadas a fecha RELATIVA a `now` — evita flake por reloj congelado, **misma clase de bug que el #52 del throttle de alertas**. Cuando se hardcodea una fecha en fixture, cualquier test que dependa del tiempo presente queda susceptible al paso del tiempo.
- 443 passed · ruff/format limpios

### Lección estructural

> **El edge de consenso SOLO es válido pre-kickoff.**

Comparar el precio de Kalshi (que reacciona al juego en vivo) contra una línea de sportsbook (pre-partido o in-play degenerada) **después del kickoff** produce basura. Motor 2 es una estrategia **pre-match**. Esto es estructural, no una optimización — la hipótesis del edge solo se sostiene antes del kickoff.

**Regla nueva como heurística operativa:**

> *"Ningún edge >15pp es real en un binario líquido — es data podrida."*

Esta heurística es independiente de la causa específica del fantasma. Cualquier fuente de podredumbre futura genera edges absurdos; el cap los caza todos.

### Estado y próximos pasos

- Diagnóstico confirmado (8 monstruos = GER/CUW in-play, 17 min de ventana)
- Fix con 3 guardarraíles (#54, 443 passed)
- Tests con fixtures relativas a `now` (evita futuro flake)
- Pendiente: mergear #54 + redeploy → solo se graban filas pre-match y <15pp
- Pendiente: 24-48h con data limpia + reporte + gate de decisión

### Seguridad (sin cambios)

- TRADING_ENABLED=false
- trades=0
- risk_events=0
- kill-switches=0
- Cero capital en riesgo

**Infra sana:** 1.25M tickers evaluados, frescura 200/200, shadow multi-outcome en 688 señales.

### El patrón meta que esto refuerza

"Construir bien la cosa equivocada es peor que construir mal la cosa correcta" — y un corolario: **construir bien la cosa correcta TAMBIÉN destapa que el régimen real difiere de la hipótesis idealizada.**

El detector de Motor 2 funciona perfecto. Las 137 señales sanas son la prueba: la matemática es correcta. **El bug NO estaba en el cálculo — estaba en la asunción implícita de que todas las muestras del feed son comparables.**

Hipótesis idealizada: "el feed de Odds API y el BBO de Kalshi miden lo mismo".
Realidad del régimen: "el feed mide pre-match consensus, Kalshi mide pre-match O in-play según el reloj del partido — son la misma cosa SOLO antes del kickoff".

Mismo patrón meta de toda la saga aplicado a una clase nueva:
- Saga V2: teoría microestructural HFT no aplicaba al régimen Kalshi (refutación de compresión)
- Auditoría 12-jun: ranking del roadmap no era el orden correcto (la data del Mundial dijo P3 y Motor 2 son señal real)
- Hoy 14-jun: hipótesis "feed consensus comparable con BBO Kalshi siempre" no aplica in-play

**Mismo principio: medir el régimen real antes de confiar la asunción.** Tres aplicaciones en arquitectura, portafolio, y ahora calidad de data.

### Aprendizajes de la sesión

- "El núcleo matemático estaba bien — era ruido de borde." Cuando un detector produce 138 buenas + 8 monstruos, la pregunta NO es "¿el cálculo está mal?" sino "¿qué hay diferente en esas 8?". La distribución bimodal es la pista — si fuera bug de cálculo, todas serían monstruos o ninguno.
- Heurísticas de plausibilidad económica son red de seguridad poderosa. "Ningún edge >15pp es real en binario líquido" no requiere identificar la causa del fantasma para protegerte de él.
- Defense in depth en filtros, igual que en el muro de capital. Mismo principio: para que un error se cuele se necesitan todas las capas fallando simultáneamente, lo cual reduce el blast radius exponencialmente.
- Fixtures relativas a `now` eliminan una clase entera de flakes. Misma raíz que el bug del throttle (#52): hardcodear un tiempo en lugar de relativizar al presente.
- La hipótesis idealizada vs el régimen real es la fuente más fértil de bugs estructurales. No hay forma de cazarlos en revisión de código aislada — solo aparecen cuando el detector se ejecuta sobre datos reales en condiciones reales.
- **La disciplina N=1 del día 1 PROTEGIÓ la integridad de la muestra del día 2.** Si hubieras encendido capital con N=1 marginal, los 8 monstruos del día 2 habrían contaminado la data en DB y sesgado decisiones futuras (aunque el muro de capas hubiera parado órdenes por sizing/exposición).

### Resumen de una línea

> **Día 4: feed real funcionando, falso-positivo de mercado in-play cazado y filtrado, capital intacto. La muestra para decidir empieza limpia ahora.**

---

## 🗓️ AGREGADO 2026-06-18 — PRIMER DÍA CON CAPITAL: Motor 2 gana, Motor REST sangra (arreglado)

### El arco del 18-jun en una frase

Primer día con capital real activado. 19 trades en 24h. Motor 2 (consensus MLB) confirmado como el negocio con +$13.16. Motor REST (arb binario) sangrando -$2.61 por arbs huérfanos sistemáticos — bug latente en main desde el 02-jun, cazado por capital real. Fix "pata dura primero" mergeado (PR #85). Auditoría del 12-jun confirmada profética con N=19 trades reales.

### Datos que dispararon todo (24h, 19 trades)

| Motor | n | win% | P&L |
|---|---|---|---|
| `motor_2_consensus` (MLB) | 8 | 50% | +$13.16 |
| `motor_rest_arb` | 11 | 9% | -$2.61 |
| Total | 19 | 26% | +$10.55 |

Balance: $100 → $95.17 (Δ -$4.83). El "faltante" era capital atado en portfolio_value ($24.92), **no perdido**.

Pendiente confirmar: fills grandes de AUTJOR ($75, $60) marcados NO-EN-DB → ¿manuales o fills no-registrados durante el bug de firma 401 (#75)?

### Causa raíz del arb huérfano

**El bug:** `RestExecutor.execute()` disparaba TODAS las patas en paralelo como FOK (fill-or-kill), sin orden ni atomicidad.

**Mecanismo (5 pasos):**
1. FOK = llena completa al instante o se cancela (no parcial, no resting)
2. La pata cara/favorita (AUT@80¢, ENG@77¢) tiene poco volumen resting → KILL
3. Las patas baratas y profundas (TIE@15¢, JOR@3¢) → FILL
4. Quedan patas perdedoras compradas sin la ganadora → huérfano
5. El rollback las liquida a 1¢ → pérdida garantizada (~$0.84-0.96) cada ciclo

**Confirmación empírica:** 4/4 de los KILLs fueron la pata cara. Cero contraejemplos (N=6 arbs). Win-rate 9% = la rara coincidencia de que la pata cara tenga volumen al mismo tiempo que las baratas.

**El rollback NO estaba roto** — hacía lo correcto. La pérdida ERA el costo del rollback, pagado cada vez que la pata dura no llenaba. Un mecanismo de seguridad que se ejercita frecuentemente NO es seguridad — es síntoma.

### El fix: "pata dura primero" (PR #85)

- Identifica la pata dura = `max(price_cents)` (desempate por menor `available_size`)
- La dispara sola y espera:
  - KILL → no se compró nada → no-op, $0 pérdida (las baratas NO se envían)
  - FILL → recién ahí las baratas en paralelo (profundas, casi siempre llenan)
  - ERROR_RED → no persigue baratas; reconcilia la dura sola
- Convierte ~91% de las pérdidas en no-ops
- Reusa intacto reconcile/rollback/kill-switch — solo reestructura `execute()`

**Diseño elegante:** "El FOK secuenciado sobre la pata dura ES la prueba de profundidad en vivo → no hace falta query extra de depth." Defensa empírica vs especulativa.

### PRs de la sesión

| PR | Qué | Estado |
|---|---|---|
| #82 | Motor 3 diagnóstico CLV por-tick | merged |
| #84 | Motor 1 revivido (shadow-first, arb binario WS) | merged |
| #85 | Guardarraíl pata-dura-primero | merged |
| #83 | Análisis huérfanos (cerrado, redundante con check_portfolio) | cerrado |
| #75 (previa) | fix firma 401 (firmar path sin querystring) | habilitó leer cartera real |

### Estado de los motores

- Motor REST — arreglado de fondo; dormido hasta validar en shadow
- Motor 1 — revivido en shadow, dormido por default
- Motor 2 — el ganador (+$13/día), intacto ← **escalar acá**
- Motor 3 — diagnóstico CLV activo

### Pendientes operativos

- MOTOR_REST_ENABLED=False + redeploy (frenar sangría hasta validar #85)
- Validar #85 en shadow: confirmar que los KILL de pata dura aparecen como no-ops
- Al re-armar arb: MOTOR_REST_ENABLED=True + subir MOTOR_REST_EXECUTION_EDGE_PCT (cubrir rollback residual)
- Confirmar si los fills AUTJOR ($75/$60) son manuales o fills perdidos
- Considerar escalar Motor 2 (más mercados/deportes, sizing)

### Lecciones para reusar

1. **Arbitraje multi-pata sin fill atómico es peligroso:** secuenciar la pata más difícil primero convierte pérdidas en no-ops. Kalshi no tiene órdenes contingentes multi-leg — el FOK nativo cubre cada pata individualmente, falta cubrir la atomicidad entre patas, y ese hueco se cierra con el orden de disparo.

2. **El rollback que "funciona" puede ser la fuente de pérdida** — mirá el costo del mecanismo de seguridad, no solo si dispara. Un mecanismo que se ejercita frecuentemente NO es seguridad — es síntoma.

3. **`check_portfolio.py` con vista por `arb_id` ya revela patas huérfanas** → no hace falta script dedicado. Antes de escribir herramienta nueva, verificar qué da la existente con otra agregación.

4. **FOK + pata fina/cara = KILL sistemático.** El precio del favorito es buen proxy de "pata dura".

### Conexión con la auditoría del 12-jun

Hace 6 días la auditoría dijo:
- "Motor REST (arb binario): caza presa casi inexistente. Dejarlo armado pero NO esperar trades de acá."
- "Motor 2 (consenso sportsbooks): el roadmap lo llama EL MÁS RENTABLE."

**La data de hoy confirma con N=19 trades reales:**

| Motor | Auditoría dijo | Realidad |
|---|---|---|
| Motor REST | "presa casi inexistente, no esperar trades" | 11 trades, 9% wr, -$2.61 |
| Motor 2 | "el más rentable" | 8 trades, 50% wr, +$13.16 |

**El diagnóstico del 12-jun fue PROFÉTICO.** No solo predijo qué motor iba a ganar, sino que identificó **antes de que costara plata** que el Motor REST iba a tener problemas.

**Y aun así Motor REST se mantuvo armado. ¿Fue error? No:**
- Sangría total < $5 con balance $100 — orden de magnitud que la disciplina de frenos podía absorber
- Activarlo fue lo que destapó el bug del FOK paralelo — un bug latente en main desde el 02-jun
- El fix tiene valor general para cualquier ejecutor multi-pata futuro
- Sin capital, el bug no se descubre

**Costo total de aprender esto: $4.83.** Es de lejos la lección más barata de toda la saga relativo a su valor.

### El patrón meta que esto cierra

**El capital ES el régimen más real de todos.** Mientras todo era shadow, los bugs de ejecución estaban latentes. El primer día con plata destapó el problema en 24h con N=11 trades. Ninguna cantidad de tests offline habría capturado esto — requería el régimen exacto (FOK sobre orderbook real con depth real de Kalshi en partidos del Mundial).

Cuarta aplicación del mismo patrón meta de toda la saga:
- Saga V2: teoría microestructural HFT no aplicaba al régimen Kalshi
- Auditoría 12-jun: ranking del roadmap no era el orden correcto
- 14-jun: hipótesis "feed siempre comparable con BBO" no aplica in-play
- **Hoy 18-jun: hipótesis "FOK paralelo es seguro para arb multi-pata" no aplica cuando hay pata cara con poco volumen resting**

Mismo principio: **medir el régimen real antes de confiar la asunción.** Cada vez en una capa diferente (arquitectura, portafolio, calidad de data, mecánica de ejecución).

### Aprendizajes específicos

**El día 1 con capital es DIFERENTE al shadow.** Los fills reales tienen latencia, slippage, partial-fill semantics que el shadow no simula perfectamente. El comportamiento del orderbook bajo carga real (con tus órdenes participando) puede diferir del shadow. Las patas caras/finas se ven distinto cuando vos sos el comprador que cuando solo observabas.

**El primer día con capital DEBE estar diseñado para descubrir bugs, no para hacer plata** — y este lo logró: $4.83 de costo para destapar un bug de capital que sin el experimento habría seguido latente.

**La defensa en profundidad funcionó.** Frenos $5/trade, $25 exposición, stop diario -$3. Capital total $100 — calibrado para "descubrimiento", no para "operación". Motor 2 generó +$13 que compensó la sangría → balance final positivo. **Si todos los motores hubieran sido como Motor REST, la sangría habría sido contenida por los frenos pero acumulada — el balance estaría peor.** Que Motor 2 esté ganando AL MISMO TIEMPO que Motor REST está roto es el diseño de portafolio funcionando.

**El revival de Motor 1 y el diagnóstico de Motor 3 no fueron tiempo perdido.** Reusan frenos del Motor REST. Habilitan futuras decisiones informadas si el régimen cambia. Inversiones de bajo costo con opción gratis.

### Estado consolidado al cierre del 18-jun

| Frente | Estado |
|---|---|
| V1 baseline | SANO continuo |
| Capital activo | $100 desplegado, balance $95.17 + $24.92 portfolio = ~$120 |
| Motor 2 (consensus) | +$13.16 / 8 trades / 50% wr — EL GANADOR |
| Motor REST (arb binario) | -$2.61 / 11 trades / 9% wr → DORMIDO post-fix #85 |
| Causa raíz arbs huérfanos | Identificada (FOK paralelo + pata cara KILL sistemático) |
| Fix "pata dura primero" (#85) | Mergeado — convierte ~91% pérdidas en no-ops |
| Motor 1 revival (#84) | Shadow-first, dormido por default |
| Motor 3 diagnóstico CLV (#82) | Activo |
| Frenos | $5/trade · $25 exposición · stop diario -$3 |
| AUTJOR fills $75/$60 NO-EN-DB | Pendiente confirmar manual vs perdido durante #75 |
| Auditoría del 12-jun | CONFIRMADA con N=19 trades reales — predijo ganador y perdedor |

### Frase del día

> **"Primer día con capital, balance positivo, bug latente cazado por $4.83. La sangría era el síntoma de que el rollback funcionaba bien sobre un mecanismo de ejecución mal diseñado. Motor 2 está confirmado como el negocio."**

---

## 🗓️ AGREGADO 2026-06-18 (parte 2) — Flags por-motor, bug position_fp, escalado Motor 2, Telegram

### El arco de la parte 2 en una frase

Continuación del arreglo de los motores. Se descubrió que `TRADING_ENABLED` es global (no hay control de ejecución por-motor) → flags propios para validar en shadow sin apagar al ganador. Se cazó un bug de campo (`position_fp`) que dejaba a Motor 3 ciego y al dashboard mintiendo. Se escaló Motor 2 (el ganador) y se sumó aviso de Telegram en cada apuesta. 5 PRs mergeados (#85-#89).

### Lección arquitectónica central: TRADING_ENABLED es GLOBAL

Un solo flag enciende/apaga la ejecución de TODOS los motores. Con Motor 2 ya operando live (`True`), no se podía correr Motor 3 ni Motor REST en shadow para validarlos sin (a) arriesgar plata real o (b) apagar al ganador. **Restricción NO-evidente hasta que el problema operativo lo destapó.**

**Patrón fix reusable:** flag de ejecución propio por motor, en consenso con el global.

- Motor 3 → `MOTOR_3_EXECUTION_ENABLED` (PR #86)
- Motor REST → `MOTOR_REST_EXECUTION_ENABLED` (PR #88)
- Regla: ejecuta sólo si `TRADING_ENABLED AND MOTOR_X_EXECUTION_ENABLED`. Con el propio en False → corre en shadow (detecta + loguea) aunque el global esté on.

**Por qué este patrón importa para portafolio multi-motor:** una vez que tenés un motor ganador en producción, no podés "pausar todo para experimentar" sin costo de oportunidad. El gate global como ÚNICO interruptor es OK para un solo motor; con varios, cada uno necesita su gate propio AND con el global. Defense in depth con flags independientes.

### Bug position_fp (PR #87) — el bloqueador real de Motor 3

**Campo mal nombrado, falla en silencio.** Kalshi devuelve la cantidad de posición como fixed-point string en `position_fp` (ej. `"-1.00"`), NO en `position`. El código leía `position` → `None` → descartaba TODAS las posiciones como "cantidad cero".

**Afectaba 4 lectores:**

1. `motor_3_clv/poller.py` → `portfolio_positions` vacía → Motor 3 escaneaba 0 posiciones (Motor 3 estaba ciego)
2. `motor_rest_arb/executor.py _has_open_position` → 2da fuente del reconcile real-money siempre decía "sin posición" (el guardián del reconcile mintiendo)
3. `scripts/check_portfolio.py` → el dashboard mostraba todo como `position=0` (dashboard mintiendo)
4. `scripts/clear_kill_switch.py` → display + `int("-1.00")` rompía (kill-switch parcialmente roto)

**Fix:** leer `<campo>_fp` con fallback al plano (robusto ante ambos shapes). `_as_int` ya toleraba `"-1.00"`. Patrón forward y backward compatible.

**Implicación retroactiva — AUTJOR:** el análisis de AUTJOR ("position=0 → settlement pendiente") salió de check_portfolio que leía mal → esas posiciones **probablemente están abiertas de verdad.** Mismo espíritu que el bug de firma 401.

### Tres bugs de "leer la realidad mal" identificados en la saga

1. #75 firma 401 — firmar path con querystring → no podía leer cartera real
2. #87 position_fp — leer campo equivocado → todo aparecía 0
3. #54 in-play vs Odds API — comparar feeds no-comparables → fantasmas 48-51pp

**Patrón común:** todos fallan EN SILENCIO — no excepción, no log de error, solo decisiones sesgadas aguas abajo. Por eso valen tanto los gates adversariales — son la única forma de cazarlos.

### Escalado de Motor 2 (el ganador)

**El cuello NO era el size por-trade.** `usable=$0.11` (lo que se podía apostar por señal) venía del cap de exposición simultánea (25%) saturado por ~$24.92 ya atados. El pool es global (compartido por todos los motores), no por-motor.

**Decisión:**
- Depósito → `ACTIVE_CAPITAL_USD=300` (subir el flag sin agregar plata = over-betting; por eso primero el depósito)
- `MAX_SIMULTANEOUS_EXPOSURE_PCT` 25→50
- `MAX_TRADE_SIZE_PCT` 5→10
- Resultado a $300: exposición simultánea $150, bet Kelly ~$5/señal (3×), stop diario $9

**Caveat:** 8 trades / 1 día es muestra chica → escalar modesto, juntar track record antes de $1k+.

**Lección operativa:** "mirar dónde se satura el pool antes de subir números". Subir `MAX_TRADE_SIZE_PCT` sin liberar exposición simultánea no habría cambiado nada — el cuello estaba en otro cap.

### Avisos de Telegram (PR #89)

Motor 2 no avisaba nada antes (solo Motor REST tenía `alert_trade`). Nueva `alert_bet_placed()` genérica → se dispara en el fill de Motor 2 (no en IOC-sin-fill, no shadow).

**Best-effort aislado:** si Telegram cae, no rompe el loop. **Principio operacional reusable:** notificaciones nunca deben poder romper el loop de ejecución.

### Estado objetivo en Coolify

```bash
# Motor 2 — escalar (tras acreditar depósito a $300)
ACTIVE_CAPITAL_USD=300
MAX_SIMULTANEOUS_EXPOSURE_PCT=50
MAX_TRADE_SIZE_PCT=10

# Motor REST — validar guardarraíl en SHADOW (Motor 2 sigue live)
MOTOR_REST_ENABLED=True
MOTOR_REST_EXECUTION_ENABLED=False

# Motor 3 — validar en SHADOW (poller ya ve posiciones tras #87)
MOTOR_3_CLV_ENABLED=True
MOTOR_3_EXECUTION_ENABLED=False

# Telegram (si no están ya)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

### Validación post-deploy

- `[MOTOR 3 DIAG]`: `posiciones=0` → `posiciones=8` con `con_close_time` resolviéndose
- Motor REST shadow: en cruces huérfanos, log `rest_exec.hard_leg_kill → no se envían N patas` (el no-op de #85)
- `check_portfolio.py`: posiciones reales (no todo `position=0`) → ver estado verdadero de AUTJOR
- Llega un 🎰 a Telegram en la próxima apuesta de Motor 2

### Flips a live (uno por uno cuando shadow confirme)

1. `MOTOR_REST_EXECUTION_ENABLED=True` (+ subir `MOTOR_REST_EXECUTION_EDGE_PCT` para rollback residual)
2. `MOTOR_3_EXECUTION_ENABLED=True`

**Orden importa:** uno por uno, con monitoreo de la ventana de detección humana en cada flip. NO flip simultáneo — si algo sale raro, querés saber CUÁL motor fue.

### Lecciones reusables

1. Un flag global de trading no alcanza: para validar motores en shadow sin apagar a los que ganan, hace falta un gate de ejecución por-motor.
2. Bugs de nombre de campo de API (`position_fp`, querystring de firma) fallan en silencio y contaminan decisiones aguas abajo (el dashboard) → leer `_fp` con fallback.
3. El cuello de capital era el cap de exposición global, no el size por-trade → mirar dónde se satura el pool antes de subir números.
4. Notificaciones = best-effort aislado: nunca deben poder romper el loop de ejecución.

### Conexión con el patrón meta de la saga

Esta parte 2 agrega matices al patrón meta de "medir el régimen real antes de confiar la asunción":

**Las asunciones implícitas más peligrosas son las de ESTRUCTURA, no las de cálculo:**
- "El cálculo del edge está bien" ✅
- "El campo se llama `position`" ❌ (es `position_fp`)
- "El gate global cubre todos los motores" ❌ (cuando hay varios)
- "El cap de exposición global es por-motor" ❌ (es compartido)
- "Telegram nunca cae" ❌ (puede)

Cada una de estas es una asunción estructural que el régimen real refuta cuando lo medís. Todas pasaron desapercibidas en revisión de código porque "el código corre bien" — solo aparecen cuando interactúa con el régimen real y la decisión depende de la lectura correcta de la estructura.

### Frase del día (parte 2)

> **"El régimen real no solo refuta asunciones de cálculo — refuta asunciones de ESTRUCTURA. Un flag global, un nombre de campo, un cap compartido. Cada uno es una decisión arquitectónica que el primer día con capital y multi-motor destapó."**

---

## 🗓️ AGREGADO 2026-06-21 — 🏆 SNAPSHOT: SISTEMA OFICIALMENTE RENTABLE

### El estado en una línea

Running healthy · **+$252.91 P&L Motor 2 (48 trades · 69.5% wr) · fees $0.70** · cash $216 + portfolio $158 = **~$375 sobre depósito $300** → **+$75 neto acumulado** · sistema oficialmente rentable.

### Los 3 motores al 21-jun

| Motor | Rol | Estado | P&L |
|---|---|---|---|
| Motor 2 — consensus | El que gana 🏆 | Activo real | +$252.91 (48 tr) |
| Motor REST — arbitraje | Detecta cruces | Shadow (REST=False) | -$2.61 (11 tr) |
| Motor 3 — CLV | Trackea posiciones + close_time | Activo diagnóstico | — |

### Las 6 capas del sistema

Flujo: Mercado → Estrategia → Riesgo → Ejecución → Persistencia (+ Observabilidad transversal)

1. Datos de mercado — ingiere y evalúa tickers (Motor REST evalúa 41k+/ciclo)
2. Estrategia — los 3 motores, independientes entre sí
3. Risk Manager — guardián único; toda orden pasa por acá
4. Ejecución — habla con Kalshi vía FOK/IOC
5. Persistencia — sqlite `/app/data/trades.db`, fuente de verdad del P&L
6. Observabilidad — logs + alertas Telegram + health checks Coolify

### Risk Manager (la pieza clave)

Toda la lógica de sizing vive en `risk/manager.py`:
- `ceiling = ACTIVE_CAPITAL_USD × 50%` (exposición máx simultánea)
- `max_trade = CAP × 5%`
- `usable = min(max_trade, cupo_restante, $200)`
- **Regla de oro:** `CAP ≤ cash real` (si no, órdenes fallan por fondos)

Cuando "no apostaba" → no era bug, era el techo de exposición lleno ($149/$150). **El sistema protegiendo, no roto.** Mismo patrón meta de la saga: un mecanismo de seguridad funcionando se ve igual que uno roto si no mirás la métrica correcta.

### Estados de un trade (snapshot 21-jun)

- 30 filled
- 59 settled
- 1475 cancelled

El ratio de cancelled altísimo (94%) es esperable y SANO: FOK/IOC prioriza precio sobre fill — preferimos perder la oportunidad antes que llenar a peor precio. Los 89 que llenaron son los que tenían profundidad real al precio elegible.

### Infra

- Droplet 2GB/1vCPU, uso ~437MB, load ~1.0
- Deploy vía Coolify → Configuration → Environment Variables
- Config actual: `CAP=300 · EXP=50% · TRADE=5% · MAX_TRADE=$200 · TRADING=true · REST=false`

### Gotchas operativos (memoria de terminal)

- Terminal Coolify: reconectar tras cada redeploy (container nuevo)
- Click en terminal ANTES de tipear — el "/" abre el palette y tira la sesión
- DB es `/app/data/trades.db` (NO `bot.db`) · columna es `strategy` (NO `motor`) · timestamp `placed_at`
- settings: `from src.utils.config import get_settings` (NO `src.config.settings`)
- `KalshiRestClient` necesita `async with` · no hay sqlite3 CLI ni `free` → usar python3 / /proc
- `get_page_text` obsoleto → usar screenshots

### Roadmap

- F0 Higiene (runbook, gaps Motor 1, reinicios)
- **F1 ⭐ Auto-sync de capital** — bot lee cash real y ajusta techo solo
- F2 Validar + activar Motor REST (tests KILL ya listos)
- F3 Observabilidad (dashboard métricas, alertas ricas)
- F4 Resiliencia infra (separar DB, backups)
- F5 Escalado de capital continuo

### Constitución del proyecto (5 reglas)

1. Diagnosticar con datos reales antes de actuar
2. Código de dinero real → solo vía PR del operador
3. Capital/env vars → solo el operador en Coolify
4. Validar contra realidad (API/logs/DB), no suposiciones
5. Separar siempre bot vs manual · P&L por motor

**Cada regla se ganó con un bug o un casi-bug a lo largo del proyecto:**
- Regla 1 ← V2 attempts #1/#2/#3, edges fantasma 14-jun
- Regla 2 ← misterio Part A commit 49231da, PR #11 audit
- Regla 3 ← TRADING_ENABLED global, AUTJOR
- Regla 4 ← fantasma code 8, position_fp, firma 401
- Regla 5 ← AUTJOR fills, dashboard mintiendo

### El salto del 18-jun → 21-jun en perspectiva

**18-jun (primer día con capital):**
- Balance neto: +$10.55 sobre $100 (+10.5% en 24h)
- Motor 2: 8 trades, 50% wr, +$13.16
- Motor REST: 11 trades, 9% wr, -$2.61 (sangrando — fix #85)

**21-jun (hoy, después del escalado parte 2 + 3 días operativos):**
- Balance neto: +$75 acumulado sobre $300 depósito
- Motor 2: 48 trades, 69.5% wr, +$252.91 (6× más trades, win-rate subió de 50% → 69.5%)
- Motor REST: dormido por fix pendiente validar
- Total: cash $216 + portfolio $158 = ~$375

El win-rate subió de 50% → 69.5% con N de 8 → 48 trades. Esto puede ser:
- Convergencia hacia el win-rate true (la varianza con N=8 era demasiado alta para creer 50%)
- El escalado funcionó porque destrabó el cap de exposición
- Mejor selección por el `MOTOR_2_MIN_EDGE_PCT` calibrado tras #53/desglose auditable
- Mundial entrando en eliminatorias con mercados más predecibles

**Caveat:** N=48 sigue siendo muestra acotada (semanas, no meses). Pero la trayectoria es la que esperabas — la auditoría del 12-jun acertó con N=19, y ahora con N=48 sigue acertando.

### El cierre del arco "de shadow a rentable" en 9 días

| Fecha | Hito | Estado |
|---|---|---|
| 13-jun | Feed real conectado, primera señal consensus 3.11pp | Shadow |
| 14-jun | Edges fantasma cazados (PR #54: 3 guardarraíles) | Shadow limpio |
| 18-jun parte 1 | Primer día con capital $100. Bug arb huérfano cazado por $4.83 | Live, frenos OK |
| 18-jun parte 2 | Per-motor flags + position_fp + escalado $100→$300 + Telegram | Live, multi-motor desacoplado |
| 19-21-jun | Tres días de operación escalada | +$250 acumulado |
| **21-jun** | **Snapshot rentable: 48 tr · 69.5% wr · $375 total** | **🏆 RENTABLE** |

**9 días entre el primer feed real y el sistema rentable.** Costo total del aprendizaje a lo largo de la operación con capital: $4.83. Todo lo demás es ganancia.

### Conexión con el patrón meta de la saga

**El sistema está rentable PORQUE respetó el patrón meta en cada bifurcación:**
- Saga V2 archivada por análisis empírico → no se construyó fortaleza compleja
- Auditoría 12-jun reordenó portafolio → Motor 2 prioridad #1
- Disciplina N=1 marginal 13-jun → protegió integridad de la muestra del 14-jun
- 3 guardarraíles 14-jun → defensa contra fantasmas in-play
- Capital con frenos 18-jun → cazó bug arb huérfano por $4.83
- Flags por-motor 18-jun parte 2 → permitió validar shadow sin apagar ganador
- Escalado modesto $100→$300 (no $3k) → varianza acotada
- Motor REST dormido hasta validar fix → no recurre el bug

**Cada decisión "lenta" pagó dividendos.** La velocidad real del proyecto no es la velocidad de mergear PRs — es la velocidad de iterar SIN romper lo que funciona.

### Valor de ingeniería estimado

~$18k–45k USD (sistema $15-40k + operaciones $1.5-4k).

Costo de reproducir el trabajo ≠ valor comercial (depende de rentabilidad sostenida a escala).

### Próximo hito: F1 — Auto-sync de capital

El operador no debería tener que ajustar `ACTIVE_CAPITAL_USD` manualmente cada vez que deposita o retira. El bot debería leer el cash real de Kalshi y ajustar el techo automáticamente. Esto elimina una clase de error (sobre-betting si el cash bajó) y libera al operador para enfocarse en estrategia, no en sincronización.

---

## 🗓️ AGREGADO 2026-06-23 — Sesión de optimización: capital $1500 + upgrade servidor + modo prueba 1 mes

### El arco del 23-jun en una frase

Bot estaba bloqueado (no tomaba posiciones) + servidor saturado (18-19 reinicios). Subimos capital $1050→$1500 y servidor 1vCPU/2GB→2vCPU/4GB. Bot ahora corriendo limpio. En modo prueba 1 mes.

### Diagnóstico — los 3 problemas

**1. Capital (RESUELTO):**
- Bot rechazaba TODAS las señales con `usable=$0.19`
- Causa: exposición topada al 100% ($525 de $525)
- **Hallazgo clave: el bot NO lee el cash real de Kalshi** — solo usa `ACTIVE_CAPITAL_USD` (config) + exposición interna en `trades.db`
- Variables relevantes: `ACTIVE_CAPITAL_USD` = capital que el bot cree tener; `MAX_SIMULTANEOUS_EXPOSURE_PCT = 50%` → cap de exposición; `MAX_TRADE_SIZE_PCT = 3.0`

**2. Servidor (RESUELTO):**
- Droplet 1vCPU/2GB saturado
- CPU 70-75%, load 2.0-2.8 (sobre 1 solo núcleo)
- **RAM patrón sierra 50-82% = firma de OOM** → causaba los reinicios
- Reinicios eran del contenedor (Coolify), NO del servidor (DO confirmó último power event hace 1 mes)

**3. SidGapError (PENDIENTE — no urgente):**
- Sid gap `expected seq=102, got 105` → WS perdió mensajes
- NO crashea el bot: lo captura `asyncio.gather(return_exceptions=True)` → solo loggea
- Era síntoma del servidor saturado, no causa de reinicios
- Fix = solo limpieza de log (ERROR ruidoso → INFO)

### Acciones ejecutadas

| Cambio | De | A |
|---|---|---|
| ACTIVE_CAPITAL_USD | $1050 | $1500 |
| Cap de exposición (50%) | $525 | $750 |
| Plan droplet | $14/mo (1vCPU/2GB) | $28/mo (2vCPU/4GB) |
| do-agent (métricas) | — | instalado |

**Secuencia usada:** guardar variable en Coolify → power off droplet → resize → power on. Un solo downtime resolvió ambas cosas (el reinicio del SO ya hizo que el contenedor leyera el capital nuevo, sin redeploy extra).

### Estado actual (confirmado en logs 03:55)

- Capital activo: $1500.0
- Trading enabled: True
- Running (healthy)
- motor2.kalshi 11/11 eventos con quotes usables
- Búsqueda `usable=$0.19` → 0 matches (salió del estado de rechazo)

### Economía / break-even

- Costo fijo: $58/mes ($28 droplet + $30 API)
- Sobre $1500 capital = ~3.9% mensual mínimo para no perder
- Cash real disponible: $3000 (solo $1500 puesto a trabajar por ahora)

### Siguientes pasos

1. Vigilar 24-48h → confirmar que RAM se estabiliza (ya no sierra) y reinicios paran
2. Confirmar que abre posiciones nuevas → ~$225 de margen libre ($750 cap − $525 abierto)
3. Validar break-even en el mes → si genera >$58 neto + estable → justifica escalar hacia los $3000
4. (Opcional) Aplicar fix SidGapError con Claude Code (solo logs)

### Notas de criterio

- **Estabilidad (hardware) ≠ volumen de trading (capital/config) — dos problemas independientes.** El servidor más potente no aumenta posiciones; eso lo hace el capital.
- NYC3 es óptimo para latencia (cerca de Kalshi/AWS us-east-1). El upgrade da estabilidad, NO menos latencia de red.
- **No escalar capital más allá de $1500 hasta ver resultados del mes.** Con 50% exposure, $1500 = hasta $750 simultáneos en riesgo.
- General Purpose / Dedicated CPU no disponibles en NYC3 — por eso fuimos a Basic Premium AMD.

### El hallazgo que conecta con F1 del roadmap

"El bot NO lee el cash real de Kalshi — solo usa `ACTIVE_CAPITAL_USD` (config) + exposición interna en `trades.db`."

**Este es EXACTAMENTE el problema que el F1 del roadmap del 21-jun anticipó:**

Del snapshot 21-jun: "F1 Auto-sync de capital — bot lee cash real y ajusta techo solo. Elimina sobre-betting si cash baja."

**Hoy se manifestó el problema:** `ACTIVE_CAPITAL_USD=1050` quedó desactualizado, no correspondía al cash real, y el bot rechazaba señales con `usable=$0.19` mientras había $3000 disponibles. La operación manual de "match cap con cash" se sostuvo manualmente (bumping de $1050 a $1500), pero F1 lo va a eliminar como categoría de problema.

**Lección operativa:** mientras F1 no esté implementado, el operador debe revisar periódicamente que `ACTIVE_CAPITAL_USD` ≤ cash real Y que la exposición real esté dentro del cap. El bot puede entrar a "modo rechazo silencioso" sin avisar.

### Patrón meta del día

**Dos problemas independientes que parecían uno solo.** Reinicios + bot bloqueado → fácil asumir "los reinicios bloquearon el bot". La realidad: dos causas separadas (servidor saturado por OOM + exposición topada por config desactualizada) que se solucionaron con dos cambios independientes (upgrade hardware + bump de cap).

- Si hubieras escalado solo capital (sin upgrade de servidor) → los reinicios habrían continuado
- Si hubieras hecho solo el upgrade (sin bumpear cap) → el bot seguía rechazando señales

**Mismo patrón meta de toda la saga aplicado a diagnóstico:** "medir la causa real antes de actuar — los síntomas correlacionados pueden tener causas independientes."

### Frase del día

> **"Dos problemas independientes que parecían uno: servidor saturado (OOM) bloqueaba la infra; cap de capital desactualizado bloqueaba el flujo. Upgrade + bump resolvieron ambos con un solo downtime. Modo prueba 1 mes antes de escalar a $3000."**

---

## 🗓️ AGREGADO 2026-06-23 (parte 2) — F1 Auto-sync de capital en progreso (PR #100)

### El arco de la parte 2 en una frase

Continuación del día. Después de bumpear cap manualmente + upgradeear servidor (parte 1), se arrancó la implementación del F1 del roadmap. PR #100 (C-01) draft con `refresh_capital_from_balance()` implementado, caché a nivel CLASE, fallback nunca $0. C-02/C-03/C-04 pendientes. Decisión NO posponer: techo de $5k antes de depositar más capital.

### Infraestructura (recap de parte 1)

- Capital: ACTIVE_CAPITAL_USD $1050 → $1500
- Servidor: resize 1vCPU/2GB → 2vCPU/4GB
- do-agent métricas instalado
- Bot: Running healthy, Capital activo $1500
- **SidGapError: ya fixeado en main** (commit previo del día — log INFO limpio)

### F1 — Auto-sync capital (EN PROGRESO)

**C-01 implementado → PR #100 (draft, rama claude/nifty-darwin-2s7wm):**
- `refresh_capital_from_balance()` lee GET /portfolio/balance (cash disponible)
- Caché a nivel CLASE (cada motor crea su RiskManager)
- Fallback nunca $0
- 18 risk tests + 51 totales pasando
- Handoff C-02 en docs/handoff/C-02.md

**C-02 pendiente:** factor 90% + clamp hard cap $5k
**C-03 pendiente:** alerta de desfase
**C-04 pendiente:** tests edge cases

### Guardrails arquitectónicos (NO olvidar)

1. **Hard cap $5000 en _production_safety** → clampear capital efectivo. Aún si Kalshi reporta $10k de balance, el bot no debería operar con más de $5k hasta que el operador suba este techo conscientemente. El auto-sync NO elimina el techo manual.

2. **Caché balance a nivel CLASE** (cada motor crea su RiskManager). Si la caché estuviera a nivel INSTANCIA, cada motor pegaría independientemente a Kalshi → rate limit. A nivel CLASE, una sola llamada compartida.

3. **Stop-losses (daily/weekly/monthly) también se vuelven dinámicos.** Si el cap cambia automáticamente, los stop-losses (% del cap) también cambian. Feature no bug, pero comportamiento ya no es estático.

4. **ACTIVE_CAPITAL_USD default en código ya es $4000** (scale-4k). Cualquier deploy nuevo arranca con $4000 si el env var no está seteado.

### Acciones pendientes del owner

- Revisar PR #100 + esperar CI verde
- Mergear #100 → validar logs post-deploy (balance real, no fallback)
- **Decidir techo de seguridad real ($5k actual vs subirlo) antes de depositar más**
- Abrir sesión nueva C-02 con docs/handoff/C-02.md

### La decisión que NO se debe posponer

"Como planeas depositar más capital, decide en frío si ese límite [$5k] te sirve antes de que un depósito grande haga que el bot no arranque (o sub-utilice el capital)."

Por qué importa decidirlo AHORA:
1. Decisión en frío vs en caliente — decidir cuando tenés el depósito pendiente pero no transferido es decisión deliberada; decidirlo después de transferir es decisión bajo presión que saltea gates.
2. El bot puede sub-utilizar sin avisar (parte 1 lo probó). Si depositás $5k+, el bot operaría con $5000 (clampado) silenciosamente.
3. El techo es decisión de gestión, no técnica. Subirlo es trivial. Bajarlo después de tener $10k corriendo es más doloroso. Mejor techo conservador que se sube DELIBERADAMENTE.

### El arco del día completo (parte 1 + parte 2)

| Hora | Hito |
|---|---|
| Parte 1 mañana | Bot bloqueado por exposición topada, servidor saturado con 18-19 reinicios |
| Parte 1 | Diagnosis: 2 problemas independientes — capital desactualizado + droplet OOM |
| Parte 1 | Fix: ACTIVE_CAPITAL_USD $1050→$1500, droplet upgrade, do-agent instalado |
| Parte 1 03:55 | Logs confirman: capital $1500, 11/11 quotes usables, healthy |
| Parte 2 | Hallazgo: F1 del roadmap se justifica con evidencia operacional. Arranque inmediato. |
| Parte 2 | C-01 implementado en PR #100 (draft). refresh + caché CLASE + fallback. 18+51 tests passing |
| Parte 2 | Handoff doc para C-02 listo en docs/handoff/C-02.md |
| Parte 2 cierre | Decisión pendiente NO posponer: techo de $5k antes de depositar más |

**Velocidad del día:** del "F1 es próximo hito" del 21-jun al "F1 C-01 en PR draft" del 23-jun parte 2. **Dos días desde la idea hasta el código.** Y el motivador no fue impaciencia — fue que el problema operativo del cap desactualizado lo pasó de "deuda teórica" a "deuda manifestada con usable=$0.19".

### Conexión con el patrón meta de la saga

F1 es el primer item del roadmap que se acelera porque el problema operativo lo destapó. Los items anteriores del roadmap (FASE 0, sprint de motores) fueron construidos por anticipación. F1 también estaba anticipado — pero la diferencia es que hoy el problema se manifestó (parte 1) y eso justificó arrancarlo HOY (parte 2) en vez de "cuando toque".

**Lección operativa:** los items del roadmap que están "anticipados" se aceleran cuando el régimen real los reclama. La auditoría del 12-jun acertó el orden de motores; el roadmap del 21-jun acertó la prioridad de F1; hoy 23-jun el problema operativo justifica el código.

**Mismo patrón meta:** medir el régimen real, dejar que la realidad ordene las prioridades.

### Estado consolidado al cierre del 23-jun (parte 2)

| Frente | Estado |
|---|---|
| Capital activo (operativo) | $1500 |
| Capital default en código | $4000 (scale-4k) — nuevo |
| Cap de exposición (50%) | $750 |
| Cash real Kalshi | $3000 disponible, $1500 puesto a trabajar |
| Hard cap producción | $5000 (clampa cualquier balance reportado) |
| Servidor | 2vCPU/4GB |
| do-agent | Instalado |
| SidGapError | FIXEADO en main (commit previo del día) |
| F1 C-01 (refresh_capital_from_balance) | Implementado en PR #100 (draft) |
| F1 C-02 (factor 90% + clamp hard cap) | Pendiente, handoff doc listo |
| F1 C-03 (alerta de desfase) | Pendiente |
| F1 C-04 (tests edge cases) | Pendiente |
| Tests passing | 18 risk + 51 totales |
| Decisión pendiente NO posponer | Techo $5k antes de depositar más capital |
| Modo prueba 1 mes (parte 1) | Sigue activo |

### Frase del día (parte 2)

"F1 pasó de roadmap a código en dos días — no por impaciencia, sino porque el régimen real (cap desactualizado bloqueando señales) lo reclamó. La velocidad correcta sale de la realidad pidiéndola, no del impulso de hacer."

---

## 🗓️ AGREGADO 2026-06-26 — Motor 3 con salidas inteligentes (take-profit + trailing + underdog filter) shadow-first

### El arco del 26-jun en una frase

Motor 3 pasó de "esperar el settlement" a "gestionar salidas con datos" — 3 mecanismos (take-profit por precio, trailing stop, filtro underdog pre-entrada) + auditoría completa de pausas (RiskEvent), todo en main con flags default OFF (shadow-first). 3 PRs mergeados (#103-#105), ~666 tests verdes.

### Qué problema resolvía

Análisis histórico (1.620 trades, semana 17-24 jun):
- Sin take-profit → un ticket al ~90% se remontó a pérdida total
- Underdogs <40¢ sangraron −$110,77
- `risk_events` vacío → pausas por stop-loss sin auditoría

Patrón común: falta de gestión post-entrada. El bot entraba bien pero salía mal (settlement = "esperar a que se resuelva solo" en vez de "salir antes si el precio lo justifica").

### PRs de la sesión

- #103 — Capital autosync C-02/C-03 (capital base = cash real × factor + alerta de desfase). Cierra F1 parcial; solo falta C-04 (tests edge cases).
- #104 — FASE 0.2 (RiskEvent audit) + FASE 1 (take-profit) + FASE 3 (filtro underdog)
- #105 — FASE 1c (script calibración + runbook) + FASE 2 (trailing stop)

### Decisiones clave

**Gating de 2 capas (patrón del repo):**
- `*_ENABLED` = detecta + loguea (shadow)
- La venta la gatea `MOTOR_3_EXECUTION_ENABLED` vía la existencia del executor (Capa A)
- **⚠️ `place_order` NO frena `sell` con `TRADING_ENABLED=false`** → la protección shadow es Capa A, no el muro global

**Restart-survival ya existía:** la pausa sobrevive reinicios vía `OperationalState` + `_rehydrate_kill_switch`. FASE 0.2 fue solo auditoría, no restore.

**Take-profit en shadow necesita cliente:** el engine ahora abre `KalshiRestClient` read-only siempre (para leer el orderbook), aunque no venda.

**Trailing solo protege ganancia:** se arma únicamente si `peak > entry`. Las pérdidas las maneja el RiskManager, no el trailing.

**Entry del trailing = FIFO:** primer BUY filled, consistente con `_settle_originals`. Alternativa documentada: promedio ponderado.

**Reuso, no reescritura:** `Motor3ExitExecutor.exit_position()` reutilizado sin tocar. `exit_position` NO recibe `reason` (vive en el Outcome). Patrón: agregar callers, no parámetros al callee.

**DB:** SQLite + `_MIGRATIONS` propio en `models.py` (NO Alembic, NO `.sql` sueltos). Nueva columna `("portfolio_positions","peak_bid_cents","INTEGER")`.

### Flags nuevos (Coolify) — defaults OFF

| Variable | Default | Para qué |
|---|---|---|
| `MOTOR_3_TAKE_PROFIT_ENABLED` | false | detecta take-profit |
| `MOTOR_3_TAKE_PROFIT_CENTS` | 90 | umbral del bid |
| `MOTOR_3_TRAILING_ENABLED` | false | detecta trailing |
| `MOTOR_3_TRAILING_DROP_CENTS` | 5 | retroceso ¢ desde el pico |
| `MOTOR_2_MIN_ENTRY_CENTS` | 40 | piso del filtro underdog |
| `MOTOR_2_UNDERDOG_FILTER_ENABLED` | false | off=loguea / on=bloquea |

`docker-compose.yml` ya las define con `${VAR:-default}` → si no las ponés, toman el default (todo OFF). **Agregar variable = querer sobrescribir.** Defense in depth contra cambios no intencionales.

### Runbook de activación (shadow → live, sin riesgo)

1. `MOTOR_3_CLV_ENABLED=true` + `MOTOR_3_TAKE_PROFIT_ENABLED=true` + `MOTOR_3_TRAILING_ENABLED=true`, todo con `MOTOR_3_EXECUTION_ENABLED=false`.
2. Dejar correr días. Juntar logs `[MOTOR 3 TP SHADOW]` y `[MOTOR 3 TRAIL SHADOW]` + correr `python scripts/calibrar_take_profit.py` en el contenedor.
3. Fijar `MOTOR_3_TAKE_PROFIT_CENTS` y `MOTOR_3_TRAILING_DROP_CENTS` con esos datos (90 y 5 son placeholders).
4. Recién ahí `MOTOR_3_EXECUTION_ENABLED=true` → vende de verdad.

**⚠️ Calibración real = LOGS shadow (bid live), no el script.** `scripts/calibrar_take_profit.py` usa `market_snapshots` (~cada 5min), es aproximado.

### Próximos pasos

- Coolify: capital 1500→1200 (FASE 0.1)
- Coolify: prender los 3 detectores en shadow
- Tras días de shadow: calibrar umbrales con logs + script
- Decidir Motor 1 (action required Kalshi) y apagar Motor REST (FASE 4)
- (Futuro) afinar entry a promedio ponderado si hay entradas a precios distintos

### Conexión con el patrón meta de la saga

**Sexto patrón meta refutado por la data:** "settlement (100% pasivo) es gestión suficiente" — no lo era. 1.620 trades sin salidas activas mostraron pérdidas evitables.

**Sumá a la serie:**
- V2/HFT (saga): teoría microestructural no aplica al régimen Kalshi
- Ranking roadmap (12-jun auditoría): Motor 1→2→3 no era el orden correcto
- Feed in-play (14-jun): hipótesis "feed siempre comparable con BBO" no aplica
- FOK paralelo (18-jun): "FOK paralelo es seguro para arb multi-pata" no aplica
- Cap manual (23-jun): "bot lee cash real" — no lo hacía
- **Settlement pasivo (26-jun): "settlement es gestión suficiente" — no lo era**

Mismo principio cada vez: asunción estructural que el régimen real refuta cuando lo medís.

### Frase del día

"Motor 3 pasó de 'esperar el settlement' a 'gestionar salidas con datos'. Y entró todo shadow-first: el merge no cambió nada hasta encender flags. Defense in depth por defecto."

---

## 🗓️ AGREGADO 2026-06-28 — Deploy shadow Motor 3 + capital dinámico operativo (F1 cerrado) + WS v2 bug causa raíz + multi-agent

### El arco del 28-jun en una frase

Deploy de main (#104-#107) con activación shadow Motor 3 (TP=62¢ calibrado, trailing OFF, execution OFF), capital dinámico operativo (`ACTIVE_CAPITAL_USD` obsoleta), bot reanudado tras stop-loss del 26-jun. Pendiente: validar shadow real vs +$761 backtest antes del go-live. Multi-agent coordination apareció por primera vez (otro agente arregla Motor REST en paralelo).

### Estado actual del bot

- Operando: is_paused=false, capture_running=true, trading_enabled=true
- Capital (dinámico): balance real $300.50 → opera con $270.45 efectivos (colchón ~10%)
- Ya NO depende de ACTIVE_CAPITAL_USD (obsoleta). Al depositar, el bot lo detecta solo.
- Motores activos: Motor 1 (arbitraje), Motor 2 (sportsbook), Motor 3 (CLV)
- Stop-loss diario activo: MAX_DAILY_LOSS_PCT=3.0 (≈ −$8 sobre $270)
- Commit desplegado: f9d8e11… (main, incluye #104/#105/#106/#107)

### Cambios aplicados hoy en Coolify

| Variable | Valor | Nota |
|---|---|---|
| MOTOR_3_CLV_ENABLED | True | ya estaba |
| MOTOR_3_TAKE_PROFIT_ENABLED | true | ya estaba |
| MOTOR_3_TAKE_PROFIT_CENTS | 62 | óptimo del backtest (antes 90 placeholder) |
| MOTOR_3_TRAILING_ENABLED | false | nueva, OFF (decidido) |
| MOTOR_3_EXECUTION_ENABLED | false | shadow: detecta y loguea, NO vende |

- Redeploy sobre main → healthy
- POST /admin/resume → kill-switch persistente levantado

### Roadmap de PRs (todo en main)

| PR | Qué | Estado |
|---|---|---|
| #104 | take-profit + underdog + auditoría RiskEvent | merged (26-jun) |
| #105 | calibración take-profit + trailing | merged (26-jun) |
| #106 | capital dinámico (floor/cap + pausa + toggle + /status) | merged |
| #107 | shadow PnL neto de fees en logs | merged |

**#106 cierra F1 del roadmap operativamente.** El auto-sync de capital del 23-jun (PRs #100/#103) se completó hoy con el toggle + endpoint /status + floor/cap explícitos + pausa automática si el balance cae bajo floor. `ACTIVE_CAPITAL_USD` quedó OBSOLETA — el bot detecta depósitos y retiros solo.

### Validación pendiente — Shadow vs Backtest

- Motor 3 ahora loguea `[MOTOR 3 TP SHADOW] ... entry / gross / fees / net=$...`
- Tarea: dejar correr unos días → sumar los `net=` → comparar contra +$761 (backtest TP=62¢ sobre 140 trades MLB)
- El shadow valida trigger + PnL con fees, NO la liquidez/fill real al bid (es un techo, igual que el backtest)
- Go-live: si el shadow confirma el número → MOTOR_3_EXECUTION_ENABLED=true, arrancar chico

### El WebSocket v2 bug — causa raíz identificada

**Síntoma:** instance missing, error code 15.

**Causa raíz:** el código envía `update_subscription` con `action="get_snapshot"` (acción **inválida** en Kalshi WS v2). **NO es problema de cuenta** → por eso Kalshi no muestra alerta.

**Fix:** re-suscribir (delete_markets+add_markets) para forzar snapshot.

**Workaround actual:** USE_ORDERBOOK_MANAGER_V2=False → V2 dormant, V1 sigue capturando OK.

**Cuarto bug de "leer la realidad mal" identificado en la saga** (después de #75 firma 401, #87 position_fp, #54 in-play vs Odds API). Patrón común: todos fallan en silencio sin alerta de Kalshi, todos requieren probar contra API real.

### Hallazgos de la auditoría

**Pérdida del 26-jun:** kill-switch por Stop-Loss Diario (PnL=$-29.90 vs límite −$24.31). El RiskEvent audit (FASE 0.2 del #104) ya estaba en main cuando esto pasó → la pausa quedó registrada en risk_events (antes estaba vacío). "El primer dato del audit es del momento en que el audit empieza a existir."

**Motor 2 (consensus) en data fresca:** +$130.95 en 129 trades settled. 48 perdedores. **23 iban ganando ≥8¢ antes de remontarse**. Picos típicos 56-62¢. **De ahí el TP=62¢** — no es número arbitrario, sale del análisis del comportamiento real de los trades perdedores que en algún momento estuvieron ganadores.

**Backtest 140 trades MLB:** baseline sin TP = −$390. Con TP=62¢ = **+$761 sim** (cierra 107/140). Trailing NO mejora sobre TP simple en béisbol → trailing OFF (los movimientos del bid son escalonados, trailing con drop=5¢ se dispara con movimiento natural sin capturar el pico).

**Decisión de fondo:** capital auto-detectado para no tener que editar variables (usuario no siempre frente a la PC). Implementado en #106. Esta es la operacionalización del F1.

### Multi-agent coordination (NUEVO en la saga)

"Motor REST viene perdedor (−$2.61, 10/11 trades). Dejado ON → **otro agente lo está arreglando**."

Hasta ahora todo era trabajo serializado del operador con agentes. Hoy aparece la división del trabajo: el operador atiende Motor 3 + capital dinámico mientras otro agente arregla Motor REST. **Es signo de madurez del sistema** — múltiples frentes en paralelo, cada uno con su contexto, sin colisión porque los frenos por motor (#86/#88 del 18-jun parte 2) permiten trabajar en cada uno independientemente.

### Conexión con el patrón meta de la saga

**F1 cerrado operativamente:** 5 días desde "F1 es próximo hito" del snapshot 21-jun hasta "F1 cerrado" del 28-jun. Cuando se cierra, se cierra COMPLETAMENTE — no a medias, no en versión light.

**WS v2 bug es el cuarto bug de "leer la realidad mal":** identificado HOY como causa raíz. `action="get_snapshot"` inválido en v2, falla con `instance missing` sin alerta de Kalshi. NO se cazaba en revisión de código — solo aparecía al interactuar con la API real.

**Coordinación multi-agente cuando hay rentabilidad:** flags por motor (del 18-jun parte 2) habilitan trabajo paralelo. Madurez del sistema.

### Estado consolidado al cierre del 28-jun

| Frente | Estado |
|---|---|
| Bot | Operando, healthy, capital dinámico activo |
| Balance real Kalshi | $300.50 |
| Capital efectivo (con colchón 10%) | $270.45 |
| ACTIVE_CAPITAL_USD | OBSOLETA — capital dinámico la reemplaza |
| F1 auto-sync capital | CERRADO OPERATIVAMENTE (PR #106) |
| Stop-loss diario | MAX_DAILY_LOSS_PCT=3.0 (≈ -$8 sobre $270) |
| Motor 3 shadow desplegado | TP=62¢ (calibrado del backtest), trailing OFF, execution OFF |
| Logs shadow con net= | PR #107 — sumar net= y comparar vs +$761 backtest |
| Motor REST | Perdedor (-$2.61, 10/11), otro agente lo arregla |
| Stop-loss disparó 26-jun | Registrado en risk_events (FASE 0.2 del #104 ya estaba activa) |
| WS v2 bug causa raíz identificada | action="get_snapshot" inválido en v2 → instance missing |
| Workaround WS v2 | USE_ORDERBOOK_MANAGER_V2=False |

### Frase del día

"F1 cerrado operativamente: el bot ya detecta capital solo. Motor 3 desplegado en shadow con TP=62¢ calibrado del backtest. Falta validar que el +$761 del backtest se sostenga en shadow real, recién ahí flip a live. Mientras tanto, otro agente arregla Motor REST en paralelo — primera vez que el sistema soporta multi-agent coordination en el mismo bot."

---

## 🗓️ AGREGADO 2026-07-01 — Julio arranca: kill-switch limpiado, Motor 4 MM elegido, V2 desync bloquea

### Estado en una frase

Kill-switch limpiado ✅ · Falta redeploy para arrancar. Capital ~$353 efectivo ($392.73 raw) · modo dinámico. Motor 2 acumulado −$404.95 (bajó de +$252.91 del 21-jun). Motor 4 elegido pero V2 desync bloquea.

### Decisiones tomadas

- Dashboard Telegram activado (TELEGRAM_DASHBOARD_ENABLED=true)
- Kill-switch mensual pegado limpiado (clear_kill_switch.py)
- Redeploy pendiente para reactivar trading
- Fix del OrderbookManagerV2 (bloquea Motor 4) → Claude Code
- Construir Motor 4 (market making) — solo tras fix V2

### Kill-switch — qué pasó

Mes reseteó a $0 el 1-jul 00:00 UTC, pero el flag `kill_switch=engaged` **NO se auto-limpió** (quedó pegado en tabla `operational_state`). Ejecutado `clear_kill_switch.py` (verifica posiciones=0 en vivo vs Kalshi) → `KILL_NOW: clear`.

**Bug latente:** el reset mensual debería auto-limpiar el kill-switch → reportar a Claude Code. Semántica rota: "no te pasás del límite mensual" ≠ "quedaste pausado permanentemente por pasar del límite del mes anterior".

### Motor 4 — Market Making elegido

**Market Making (Spread Capture)** — todo dentro de Kalshi, reutiliza patrón de motores + RiskManager, cero dependencias externas. Prerequisito bloqueante: arreglar desync del V2.

**Cross-Venue Arb (Kalshi vs Polymarket/PredictIt) DESCARTADO** — la "spec fase0" no existe en el repo, no hay clientes de Polymarket/PredictIt, leg-risk + capital fragmentado en 2 venues con solo ~$350 = inviable.

**Nota de diseño:** MM ≠ arbitraje binario. La auditoría 12-jun descartó arb binario, no MM. MM = proveer liquidez (post limits en ambos lados y capturar spread) — diferente estrategia estructuralmente. Requiere V2 estable como prerequisito estructural (libro en memoria para postear limits al bid/ask con precisión). Motor REST NO funciona para MM (usa REST bajo demanda, no continuous quoting).

### Bug crítico: OrderbookManagerV2 desync

- Síntoma: `/status` → `v2: {enabled:true, instance:"missing"}` intermitente
- Medición: ~207 errores V2 desync en 2000 líneas de log (~10%)
- Origen: `orderbook_manager_v2.py:672` en `_apply_delta_msg` → `OrderbookDesyncError`
- Ejemplo: `msg_seq=18408 state_seq=18405` (gap de secuencia → mensajes WS perdidos)
- Instancia: SÍ se crea (data_capture.py:628-633); el "missing" es race condition en `health.py:197`
- Fix pedido: resync tras gap (resnapshot/buffer reorden) + revisar registro en BotState

### La saga V2 vuelve con dos causas conocidas ahora

**Cronología del desync V2 en el proyecto:**
- Mayo 25/27/30: attempts #1/#2/#3 fallaron con exactamente este síntoma
- 31-may: cuarto discovery identificó causa raíz — ventana ciega de bootstrap
- 02-jun: V2 archivado, pivot a Motor REST
- 28-jun: WS v2 bug `action="get_snapshot"` inválido → `instance missing` (causa diferente)
- Hoy 07-01: desync del `_apply_delta_msg` reaparece con 10% de tasa de error

**Dos causas conocidas ahora:**
1. Bootstrap sin buffering (identificado 31-may)
2. Gap de secuencia en steady-state (10% actual) — mensajes WS perdidos → delta sobre estado desactualizado → `qty<0`

**Coherente con la lección del 02-jun:** V2 se archivó cuando la data mostró que Motor REST alcanzaba (73% captura). Pero para market making V2 es prerequisito estructural, no alternativa.

### PnL histórico (contexto)

- Motor 2 consenso: **−$404.95** (143 trades, 57% WR, avgW +$10.96 / avgL −$21.38)
- Motor rest_arb: −$2.59 (15 trades)
- **Trailing/CLV closes: 0** (nunca disparó)
- Mes actual (julio): $0 (reseteado)

### El salto 21-jun → 07-01

- 21-jun snapshot maestro: Motor 2 +$252.91 (48 trades, 69.5% WR)
- 07-01 hoy: Motor 2 **−$404.95** (143 trades, 57% WR)

**Delta de PnL: −$657.86 sobre 95 trades adicionales.** WR bajó de 69.5% a 57%. Distribución `avgW +$10.96 / avgL −$21.38` — pérdidas 2× ganancias.

**El "nunca disparó" del Motor 3:** ejecución en shadow desde 28-jun, TP=62¢ calibrado, **execution=false nunca se flip a true.** El shadow LOGGEABA oportunidades pero el executor NO cerraba. Los 23 trades que iban ganando ≥8¢ (análisis 26-jun) siguieron remontándose sin salir.

**Consecuencia:** entre el 28-jun (deploy Motor 3 shadow) y el 01-jul, oportunidades detectadas por shadow no se ejecutaron. Algunos de esos trades terminaron en la columna de −$404.95.

**Lección operativa nueva:** *"shadow que valida oportunidades pero nunca flip a live es shadow que te cuesta plata en la modalidad clásica."* La disciplina del shadow-first vale, pero requiere cerrar el loop con el flip a live cuando la data confirme.

### Séptimo patrón meta refutado por la data

"Shadow que valida sin flip cuesta plata cuando el problema shadow-detecta sigue ocurriendo en producción."

Los primeros 6 patrones meta son sobre construir la cosa correcta con la data correcta:
1. Saga V2 — HFT no aplica a Kalshi
2. Auditoría 12-jun — ranking del roadmap incorrecto
3. 14-jun — feed in-play no comparable
4. 18-jun — FOK paralelo no seguro multi-pata
5. 23-jun — el bot no leía cash real
6. 26-jun — settlement pasivo no es gestión

**El 7º es NUEVO:** es sobre activar lo que ya construiste cuando la data lo respalda. La disciplina shadow-first es defensiva; sin cierre del ciclo con el flip a live, deja el problema que motivó el shadow sin resolver.

### `MOTOR_3_TRAILING_ENABLED=true` aplicado

Cambio del criterio del 28-jun (era OFF por backtest MLB que decía "trailing no mejora sobre TP simple en béisbol"). Ahora activado. **Vale entender por qué el cambio de criterio** — si es para no dejar ganadores remontarse (el problema del "nunca disparó"), es coherente. Si es cambio sin justificación con data nueva, vale re-verificar contra el análisis del 26-jun.

### Estado consolidado al cierre del 07-01

| Frente | Estado |
|---|---|
| Bot | Pausado (kill-switch limpiado, falta redeploy) |
| Capital dinámico | Activo — $353 efectivo / $392.73 raw |
| Kill-switch mensual pegado | Limpiado con `clear_kill_switch.py` |
| Bug latente: auto-limpieza en reset mensual | Pendiente reportar a Claude Code |
| Dashboard Telegram | Activado — comandos `/dashboard`, `/dash`, `/status` |
| Motor 2 acumulado | **−$404.95** (143 tr, 57% wr — bajó de 69.5% del 21-jun) |
| Motor REST acumulado | −$2.59 (15 tr — otro agente lo arregla) |
| Trailing/CLV closes | 0 — Motor 3 nunca activó execution |
| Mes actual (julio) | $0 reseteado |
| Motor 4 elegido | Market Making (Spread Capture) — bloqueado por V2 desync |
| V2 desync | ~10% tasa error (207/2000 líneas), gap secuencia en `_apply_delta_msg` |
| `MOTOR_3_TRAILING_ENABLED=true` | Aplicado (empezará a cerrar ganadores al operar) |
| Server status HTTP :18080 | A veces no responde — investigar aparte |
| Redeploy pendiente | Necesario para reactivar trading |

### Frase del día

"Julio arranca con kill-switch limpio y $353 efectivo. Pero el mes que se cierra deja una lección: construimos el take-profit y trailing (26-jun), los desplegamos en shadow (28-jun), y NUNCA los activamos. Motor 2 perdió $657 desde el snapshot rentable. La disciplina shadow vale — pero el ciclo shadow→live tiene que cerrarse cuando la data lo respalda, si no el problema que motivó el shadow te sigue costando."

---

## 🗓️ AGREGADO 2026-07-02 — Auditoría profunda: root cause del "$1 usable" + counterfactual + Polybot nuevo frente

### El arco del 02-jul en una frase

Auditoría del "por qué Motor 2 apostaba $1 por señal". NO era config del stake — era el cap de exposición saturado por un arb hedgeado del 30-jun que quedó sin reconciliar por bug en RiskManager netting (notes=None). El counterfactual reveló que la plata está en el bucket 5-8% de edge; los edges 8%+ son basura. Polybot aparece como nuevo frente en la infra.

### Infra

- Droplet: 104.236.211.240 | Coolify v4.0.0
- Kalshi status: :18080/status | Polybot: :18081 (previsto)
- Kalshi container live: kalshi-bot-...-032023877818 (commit 0c7b2d7)

### KALSHI — Root cause del "$1 usable"

**Lo que NO era:**
- Motor 2 usa sizing FLAT (no Kelly), MOTOR_2_MAX_STAKE_PCT default 1.0%
- RiskManager cap por trade = min(3%×$1200, $200) = $36
- Con esos parámetros el bot podía haber estado apostando $36 por señal, no $1

**Causa REAL:** el cap de exposición simultánea (50%) estaba LLENO por un arb hedgeado viejo del 30-jun (KXMLBGAME-26JUN...TBKC, 243×243, ~$235 total).

**Bug RiskManager netting:**
- Netea arbs hedgeados agrupando por arb_id parseado de `notes`
- Pero `notes=None` → netting falla → cuenta $235 BRUTO en vez de neto → llena cap → Motor 2 bloqueado a `usable=$0.02`

**Dos bugs concatenados:**
1. Motor 1 no escribe arb_id / kalshi_order_id → sin arb_id no se puede netear
2. Reconciliación de settlement no cerraba posiciones 30-jun → arb quedó abierto en contabilidad interna aunque en Kalshi ya estaba resuelto

**El sistema veía un arb activo consumiendo $235 de exposición que en la realidad ya no existía.** El cap saturado NO era el sistema protegiéndote — era el sistema contabilizando fantasmas.

### Quinto bug de "leer la realidad mal"

Suma a la serie: #75 firma 401, #87 position_fp, #54 in-play vs Odds API, WS v2 action=get_snapshot, **hoy: RiskManager netting con notes=None**.

Patrón común: todos fallan en silencio, todos requieren mirar la realidad (no el config) para descubrir. La contabilidad del cap era el "dashboard" que mentía, igual que el dashboard del 18-jun parte 2 mentía con position_fp.

### KALSHI — Counterfactual por bucket de edge (INSIGHT CLAVE)

| Edge bucket | Real P&L | Counterfactual @$36 |
|---|---|---|
| <5% | +$9 | +$151 |
| **5-8%** | **+$133** | **+$653 ← bucket rentable** |
| 8-11% | −$237 | +$21 ← basura (48-50% winrate) |
| ≥11% | −$339 | +$37 ← basura |

**La plata está en el bucket 5-8% de edge.** Los buckets 8%+ son basura (48-50% winrate = casi random). Contra la intuición: **más edge NO es mejor.** Los edges >8% en Motor 2 consensus probablemente son datos podridos (fantasmas tipo del 14-jun, líneas stale del sportsbook, mercados que Kalshi movió agresivamente por razones que consensus no capta).

**Conclusión operativa:** "NO subir stake global a ciegas." La respuesta NO es "poné $36 en todos los trades" — es "poné $36 en los 5-8%, filtrá los 8%+ como probable data podrida."

**Conexión con guardarraíl del 14-jun:** MAX_PLAUSIBLE_EDGE=0.15 fue defensa contra fantasmas in-play. El counterfactual sugiere que el umbral real es más bajo: >8% ya es sospechoso en régimen normal.

### KALSHI — Unlock confirmado (nuevo deploy 03:20-03:21)

Post-deploy con fix del settlement:
- filled $253 → $4.75 (bajó de casi todo lleno a casi nada)
- settled 166 → 224 (58 posiciones adicionales pasaron a settled)
- 30-jun TBKC → 'settled' $235.71 (el arb viejo específicamente cerró)
- Logs: settlement.group_settled + settlement.tick settled_legs=58

**OJO:** fue trigger de BOOT, no continuo. **3ª señal (counts reales Motor 2) sin confirmar hasta que llegue slate MLB.**

**Validación pendiente:** ver si con el próximo slate MLB, el Motor 2 usable vuelve a $36 sostenido (no $1). Si sí → fix estructural. Si no → hay reconciliación continua rota.

### POLYBOT — nuevo frente en la infra

Aparece un nuevo bot: Polybot, puerto :18081 previsto. Del contexto del 07-01: se había descartado cross-venue arb Kalshi ↔ Polymarket porque "no hay clientes de Polymarket". Hoy aparece Polybot como bot dedicado a Polymarket, no cross-venue.

**Implicaciones:**
- Dos bots corriendo en paralelo en el mismo droplet — Kalshi + Polybot
- El droplet 2vCPU/4GB (upgrade del 23-jun) debería soportarlos, pero hay que verificar saturación como en el 23-jun
- Multi-agent coordination se hace más complejo: ahora hay Kalshi (Motor 2/3/REST/1) + Polybot como frentes distintos

### Octavo patrón meta refutado

"Un edge más grande no es necesariamente un edge mejor — puede ser data podrida disfrazada de oportunidad."

Los ocho patrones meta acumulados:
1. Saga V2 — HFT no aplica a Kalshi
2. Auditoría 12-jun — ranking del roadmap incorrecto
3. 14-jun — feed in-play no comparable
4. 18-jun — FOK paralelo no seguro multi-pata
5. 23-jun — el bot no leía cash real
6. 26-jun — settlement pasivo no es gestión
7. 07-01 — shadow sin flip cuesta plata
8. **07-02 — edges grandes pueden ser data podrida (bucket >8% pierde plata)**

Todos comparten estructura: una asunción implícita que el régimen real refuta cuando lo medís.

### Los 3 hallazgos que valen recordar

1. **El $1 usable NO era config — era contabilidad fantasma.** El cap saturado por un arb que ya no existía en la realidad. Mismo patrón que #75, #87, 14-jun, 28-jun WS v2.

2. **El bucket 5-8% es donde está la plata; los edges >8% son data podrida.** Contraintuitivo pero medido. Vale calibrar MAX_PLAUSIBLE_EDGE con esta nueva evidencia (8% ya es sospechoso, no 15pp).

3. **La reconciliación continua NO está confirmada.** El unlock de hoy fue trigger de boot post-deploy. Validación pendiente: próximo slate MLB con Motor 2 usable sostenido en $36.

### Frase del día

"El bot no apostaba $1 por falta de capital — apostaba $1 porque contabilizaba un arb fantasma que en Kalshi ya estaba cerrado. El sistema no estaba roto; estaba viendo un mundo que no existía. Y el counterfactual dice algo aún más incómodo: los edges grandes que parecían la oportunidad, en realidad estaban costando plata. La plata está en el 5-8%."

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
