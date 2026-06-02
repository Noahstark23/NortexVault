---
tipo: proyecto
estado: activo
fase: 1-data-capture
fecha-inicio: 2026-05-24
fecha-objetivo: 
tags:
  - proyecto
  - trading
  - kalshi
  - bot
---

# kalshi-bot

## Objetivo
Bot de trading en Kalshi operando de forma autónoma con edge positivo verificable y bankroll protegido. Roadmap por fases: Fase 1 (data capture solo) → Fase 2 (Motor 1 arbitraje intra-Kalshi) → Fase 3 (`TRADING_ENABLED=true`).

## Por qué importa
Ingreso independiente y escalable. Si funciona, runway deja de depender de un solo flujo. Aprendizaje aplicable a otros mercados.

## Estado actual (2026-06-02, V1 sano + DECISIÓN FINAL Motor REST para Mundial)

### Fases del roadmap
- **Fase 1 (data capture):** ✅ V1 sano corriendo continuo. DB en 7.96M filas (16-may → 2-jun). Watchdog `b52a052` activo.
- **Fase 2 (Motor 1 arbitraje):** 🎯 **DECISIÓN ARQUITECTÓNICA FINAL el 02-jun** — Motor REST puro para el Mundial 2026 (11-jun). V2 archivado en PR #11 (recuperable). Sustentada por 3 chequeos empíricos sobre 7.9M eventos: **liquidez DILATA el edge ~800× (premisa de Gemini refutada), REST captura 73% en mercados líquidos, NO hay penalización por magnitud**. Ver [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]].
- **Fase 3 (trading):** 🔒 `TRADING_ENABLED=false`, `MOTOR_1_ARBITRAGE_ENABLED=false`. No tocar hasta validar Motor REST en demo + decisión consciente.

### Frentes al cierre del 02-jun (saga V2 CERRADA)

| Frente | Estado |
|---|---|
| **V1 baseline** | ✅ SANO continuo, DB 7.96M filas |
| **V1 WS zombie** | ✅ CERRADO LIMPIO (commit `b52a052`) |
| **Saga V2 (4 discoveries + 3 attempts + auditorías + 3 chequeos)** | ✅ CERRADA |
| **PR #11 (Part B)** | 🔒 ARCHIVADO en branch, recuperable |
| **B1+A2 fortress** | 🔒 Archivada con 4 correcciones cerradas |
| **Coolify restart cap** | 🔒 NO soportado (discusión #10259) — A2 wrapper descartado |
| **🎯 DECISIÓN ARQUITECTÓNICA** | ✅ **Motor REST puro para Mundial** — 73% captura validada |
| **Premisa de compresión por liquidez** | ❌ REFUTADA por data (~800× en dirección opuesta) |
| **Mundial 11-jun como filón** | ✅ Identificado y validado por chequeo (b) |
| **RTT real** | ✅ Medido: 33ms warm p50, 64ms p95 |
| **Tasa captura REST** | ✅ Q5: 73% (20c+: 73.9%, sin penalización por magnitud) |
| **Diseño Motor REST en texto** | ⏳ Próxima sesión (con gate diseño→review→implementación) |
| **Decisión umbral de edge** | ⏳ Pendiente (negocio: ≥3c, ≥10c, ≥20c) |
| **Implementación Motor REST** | 🔒 Pendiente diseño aprobado |
| **Kickoff Mundial** | 📅 **11-jun** (9 días) |
| Capital | 🔒 Cero — `TRADING_ENABLED=false`, sin urgencia |

### Métricas operativas
- **Mercados tracked:** 38 (multi-deporte MLB + UCL + NHL — tendencia 40→39→38 en 3 días, ticket aparte)
- **DB size:** ~650 MB, crecimiento ~250 MB/día confirmado
- **Bankroll:** [pendiente registrar en daily]
- **Edge:** Motor 1 = arbitraje intra-mercado en milisegundos. Estado: [pendiente confirmar — Fase 2 bloqueada antes]

## Próximos hitos

### Cerrado
- [x] Fix Opción A implementado (25-may) → [[fix-v2-opcion-a-implementado-commits]]
- [x] Attempt #2 V2 ejecutado y fallido (27-may) → [[incidente-v2-attempt-2-2026-05-27]]
- [x] Lección 9 corregida y committeada (28-may) — SHA `3a4b384` → [[leccion-9-FINAL-causa-raiz-pendiente]]
- [x] Versión obsoleta de Lección 9 marcada → [[leccion-9-canonica-kalshi-bot-context-md]]
- [x] Incidente V1 WS zombie detectado (28-may) → [[ticket-v1-ws-zombie-degradacion-escalonada]]
- [x] Auditoría 18-may (29-may) — confirmado día normal, NO blackout encubierto
- [x] Discovery read-only V1 (28-may noche) — 5 preguntas respondidas con código verbatim
- [x] **PR fix V1 watchdog mergeado (commit `21fe6fd`, 29-may)** → [[fix-v1-watchdog-21fe6fd-validado-produccion]]
- [x] **Validación 7h 14min en producción** — 161k events, 435/435 minutos con data, 0 force_reconnect espurios, 0 zombie detections
- [x] **Lección 10 FINAL redactada** con causa cerrada → [[leccion-10-FINAL-ws-zombie-con-fix-validado]]
- [x] Stub Lección 10 marcado como superado → [[leccion-10-ws-zombie-pendiente-discovery]]
- [x] **Tercer discovery V2 (29-may)** — forense del log preservado → [[discovery-forense-v2-attempt2-h1-refutada]]
- [x] **H1 (size=0) REFUTADA empíricamente** — bucket 10c tenía size>0 en ambos lados (YES=1114.07, NO=500.00)
- [x] **Pivot V2:** decisión de abandonar variantes de size=0, ir a H2/H3/H4 → [[decision-2026-05-29-v2-pivot-nuevo-espacio-hipotesis]]
- [x] **Cuarto discovery V2 (30-may)** — cruce log + código fuente → [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]]
- [x] **Corrección hallazgo previo:** gap seq=40 era ARTEFACTO del manejo de error, no señal independiente
- [x] **Corrección hallazgo previo:** estado del bucket pre-delta es punto ciego (apply_delta no loggea exitosos)
- [x] **3 dominios de seq identificados** (batch index, Sid global, per-delta) — código no comete error obvio pero amplifica blast radius
- [x] **Parsing comparado lado a lado** — idéntico en snapshot y delta, filtro size=0 asimétrico pero no aplica a ATL
- [x] **Anti-patrón cazado en tiempo real:** "indiscutiblemente es el feed" como atribución externa redux → corregido a "V2 NO exculpado, 3 hipótesis vivas A/B/C"
- [x] **Sesgo hardcodeado documentado:** `orderbook.py:65` dice "indicates feed-level corruption" — pre-juzga causa externa
- [x] **Update Lección 9 redactado** → [[update-leccion-9-29may-tercer-discovery-cerrado]]
- [x] **Decisión branch separada** → [[decision-2026-05-30-branch-separada-v2-instrumentacion-asimetrica]]
- [x] **Brief instrumentación asimétrica corregido** (snapshot DEBUG full, delta ERROR, defensivo, verificación previa) → [[brief-instrumentacion-v2-asymmetric-logging]]
- [x] **30-may tarde: Watchdog V1 mergeado a producción** (PR #1 → commit `b52a052`)
- [x] **30-may tarde: PR #2 mergeado** (instrumentación V2 + update Lección 9 #1)
- [x] **30-may 17:41 UTC: Tercera ventana V2 ejecutada con runbook 12.5 literal**
- [x] **🎯 CAUSA RAÍZ V2 CAPTURADA** — smoking gun: `msg_seq=186 state_seq=184 delta=-13 bucket=2` → [[causa-raiz-v2-desync-secuencia-bootstrap-CAPTURADA]]
- [x] **Hipótesis C (gap/recovery handling en bootstrap) CONFIRMADA con evidencia dura**
- [x] **Hipótesis A (feed) y B (snapshot parcial) DESCARTADAS empíricamente**
- [x] **Rollback attempt #3 ejecutado <5min** sin daño operativo → [[incidente-v2-attempt-3-2026-05-30-causa-capturada]]
- [x] **Log preservado:** `data/v2_attempt3_20260530_174849.log` (29 KB, 390 líneas)
- [x] **Update Lección 9 #2 redactado** (causa identificada) → [[update-leccion-9-v2-causa-raiz-resuelta-30may]]
- [x] **Pre-flight completo por 1ª vez** con los 4 ✅ (backup íntegro + flags por nombre + Telegram en cliente + código verificado en vivo)
- [x] **Corrección de seguridad al runbook:** `printenv VAR1 VAR2` por nombre, NO env dump (expondría secrets)

### Pendiente (orden estricto, ninguno urgente)

**Próxima sesión (cuando esté con cabeza fresca, no urgente):**
- [ ] **Cuarto discovery V2** — analizar `data/v2_attempt3_20260530_174849.log`
  - Q1: ¿por qué V2 no bufferó el seq=185? El código tiene buffer en `handle_message:166` pero no se llenó. Hipótesis a contrastar: (C1) buffer no se llena en bootstrap, (C2) race condition snapshot apply vs delta processing, (C3) gap detection antes de inicializar `_last_seq_by_sid`.
  - Q2: ¿por qué el recovery no convergió? `books_initialized: 0` a T+6min. Hipótesis: Kalshi `code 15` interrumpió, recovery loop con bug, o cascada genera más mensajes que recovery puede drenar.
- [ ] **Diseñar fix de bootstrap/gap-handling** (post-cuarto discovery)
- [ ] **Eliminar texto `"(feed corruption)"`** hardcodeado en `orderbook.py:65` — sesgo confirmado erróneo
- [ ] **Commit update Lección 9 #2** al `KALSHI_BOT_CONTEXT.md` v1.7
- [ ] **Decidir versión de Lección 10** (corta vs completa) + commit
- [ ] Test fix offline contra escenario reproducido (seq=184 → seq=186 sin 185)

**Frente V2 — Cuarta ventana de activación (post-fix validado):**
- [ ] Agendar 2-3h continuas para supervisión activa
- [ ] Runbook 12.5 literal otra vez + línea defensiva T+5→T+30
- [ ] Métrica de éxito: NO reaparece patrón `msg_seq=N+2 state_seq=N` durante bootstrap
- [ ] Si V2 estable a T+2h → desbloquear Motor 1 (paso separado, otra ventana)

**Frente V2 — Deuda separada (post-causa raíz):**
- [ ] Eliminar `(feed corruption)` hardcodeado en `orderbook.py:65` — sesgo de atribución externa
- [ ] Reducir blast radius del cascade Sid-wide (38 tickers stale por crash de 1)
- [ ] Cubrir asimetría del filtro size=0 en deltas — bug latente

**Deuda V1 (mejoras, no bloqueante):**
- [ ] Fase 2 watchdog: detector de tasa con baseline por hora
- [ ] Unificación de las dos señales `ws_connected`
- [ ] Test causa externa vs starvation interna
- [ ] Latencia detección actual ~10-15 min worst case → mejorable

**Deuda general:**
- [ ] Política de retención DB (~90 GB/año proyectado) + VACUUM mensual
- [ ] Investigar ticker drift (40→39→38 sin reemplazo)
- [ ] Hardening defensivo de `parse_price_to_cents` (validar rango [0,100])

## Decisiones tomadas
- [[decision-2026-05-25-rollback-v2]] — rollback V2 attempt #1
- [[decision-2026-05-25-fix-opcion-a]] — fix puntual size=0 (hipótesis refutada)
- [[decision-2026-05-26-no-reactivar-hoy]] — pacing disciplinado
- [[decision-2026-05-27-activar-v2-segunda-ventana]] — segunda ventana (attempt #2 falló)
- [[decision-2026-05-29-v2-pivot-nuevo-espacio-hipotesis]] — abandonar variantes de size=0
- [[decision-2026-05-30-branch-separada-v2-instrumentacion-asimetrica]] — branch separada PR #2

## Diagnósticos y discoveries (V2)
- [[diagnostico-v2-size-zero-bug]] — H1 original (26-may). **REFUTADO.** Historia.
- [[discovery-forense-v2-attempt2-h1-refutada]] — tercer discovery (29-may), binario sobre H1
- [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]] — cuarto discovery (30-may mañana), parsing limpio + 3 dominios + sesgo hardcodeado
- [[causa-raiz-v2-desync-secuencia-bootstrap-CAPTURADA]] — **🎯 CAUSA RAÍZ CAPTURADA** por attempt #3 (30-may tarde). Smoking gun. C confirmada, A/B descartadas.

## Incidentes V2 (tres rollbacks limpios)
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — attempt #1
- [[incidente-v2-attempt-2-2026-05-27]] — attempt #2
- [[incidente-v2-attempt-3-2026-05-30-causa-capturada]] — **attempt #3 — el que capturó la causa**

## Validaciones técnicas
- [[inspeccion-apply-snapshot-msg-paths-excepcion]] — swap seq/apply protege ambos paths (delta y snapshot), apply_snapshot atómica. **Sigue válida arquitectónicamente** aunque el fix no resolvió el bug primario.

## Implementación de fixes
- [[fix-v2-opcion-a-implementado-commits]] — V2: commits `ed7b7ac` + `b9abaa0`. Solo el dispatcher logging cumplió. Los otros dos fixes eran bugs reales pero NO la causa.
- [[fix-v1-watchdog-21fe6fd-validado-produccion]] — V1: commit `21fe6fd` + **7h 14min validación en producción sin huecos**

## Incidentes y discoveries
- [[incidente-v2-attempt-2-2026-05-27]] — post-mortem attempt #2 V2 (12 min, stack traces preservados)
- [[ticket-v1-ws-zombie-degradacion-escalonada]] — ticket V1 zombie (causa cerrada por fix)
- [[discovery-forense-v2-attempt2-h1-refutada]] — forense de logs preservados, H1 refutada empíricamente

## Validaciones técnicas
- [[inspeccion-apply-snapshot-msg-paths-excepcion]] — swap seq/apply válido arquitectónicamente (aunque H1 no era la causa)

## Runbooks operativos (reusable)
- [[cheatsheet-runbook-12.5-v2-activacion]] — runbook 12.5 + adiciones Lección 9. **Validado en 2 rollbacks limpios.**

## Lecciones aprendidas
- [[leccion-9-FINAL-causa-raiz-pendiente]] — **versión FINAL en repo** (SHA `3a4b384`). Base.
- [[update-leccion-9-29may-tercer-discovery-cerrado]] — **UPDATE #1** (parsing limpio, A/B/C abiertas) — mergeado en PR #2
- [[update-leccion-9-v2-causa-raiz-resuelta-30may]] — **UPDATE #2** (causa CAPTURADA en attempt #3) — pendiente commit, va al v1.7
- [[leccion-10-FINAL-ws-zombie-con-fix-validado]] — Lección 10 FINAL. Watchdog mergeado a prod, validado 7h+.
- [[leccion-9-runbook-literal-vs-interpretacion]] — versión operativa/conceptual (complementaria)
- [[leccion-9-canonica-kalshi-bot-context-md]] — ⚠️ OBSOLETA (historia)
- [[leccion-10-ws-zombie-pendiente-discovery]] — ⚠️ STUB SUPERADO (historia)

## Briefs operativos reusables
- [[brief-instrumentacion-v2-asymmetric-logging]] — brief para Claude Code: instrumentación V2 asimétrica (snapshot DEBUG full, delta ERROR on failure, defensivo, verificación previa)

## Sesiones documentadas
- [[sesion-2026-05-24-setup-git-fase2]] — setup de Obsidian Git (vault infra)
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — attempt #1 V2 + rollback + diagnóstico + fix plan
- [[sesion-2026-05-26-fix-merge-y-cierre-disciplinado]] — verificación del fix, Lección 9 borrador, decisión de pacing
- [[sesion-2026-05-27-segunda-ventana-v2-preflight]] — revisión sobria + inspección + pre-flight (attempt #2 ejecutado al final del día)
- [[sesion-2026-05-28-leccion-9-corregida-y-ws-zombie]] — Lección 9 corregida + descubrimiento WS zombie V1

## Pre-flights ejecutados
- [[pre-flight-checklist-2026-05-27]] — segunda ventana V2, ejecutado 14:58 UTC

## Recursos
- Repo: `Noahstark23/botkalshi` (privado, GitHub)
- Cuenta Kalshi: [agregar]
- Documentos clave en repo: `KALSHI_BOT_CONTEXT.md` (lecciones + runbooks v1.5 pendiente merge), runbook 12.5 (activación V2)
- Coolify: dashboard de deploy
- Multi-agent workflow: Gemini (CTO planning) + Claude (review adversarial) + Claude Code (ejecución) + Yo (decisiones operativas)

## Métricas a trackear (en daily)
- Bankroll Kalshi (USD): pre-trading sigue siendo 0 efectivo, capital reservado en otra cuenta
- Uptime del bot: target >99% en Fase 1
- Errores no-SidGap por día: target 0 en V1; <umbral durante ventanas V2
- DB size + growth rate (path REST de V1): ~250 MB/día confirmado = ~90 GB/año proyectado

## Bloqueos / dudas abiertas
- Edge de Motor 1: ¿demostrado en simulación o solo hipótesis?
- Magnitud del bankroll inicial cuando se active `TRADING_ENABLED`
- Si Opción A falla en segunda ventana, ¿pivot a B (rediseño con invariantes internas) o C (continuar V1 indefinido)?
- Punto pendiente de review sobria: ¿el swap seq/apply en `handle_message:170-175` cubre también `_apply_snapshot_msg` o solo `_apply_delta_msg`?

## Log
- **2026-05-24** — proyecto creado, vault sembrado. Pendiente brain dump.
- **2026-05-25 16:50 UTC** — ventana de activación V2 abierta tras review adversarial del plan de Gemini.
- **2026-05-25 16:52-16:57 UTC** — 2 ráfagas de errores `qty<0` (19 + ≥8, magnitudes -15 a -6247).
- **2026-05-25 17:18 UTC** — rollback ejecutado en ~6 min. V2 dormant.
- **2026-05-25 ~20:30 UTC** — diagnóstico empírico cerrado. 3 bugs identificados, hipótesis "feed corruption" refutada.
- **2026-05-25 ~20:37 UTC** — brief de Opción A revisado y listo para mandar a Claude Code.
- **2026-05-26 ~02:43 UTC** — reporte CTO confirma V1 estable 9h+ post-rollback. Decisión arquitectónica desbloqueada.
- **2026-05-26 ~10:00 UTC** — Claude Code entrega fix: commits `ed7b7ac` + `b9abaa0`, 282/282 tests verdes. Una desviación técnica justificada (loguru vs stdlib).
- **2026-05-26 ~10:15 UTC** — Lección 9 redactada en versión canónica para `KALSHI_BOT_CONTEXT.md`.
- **2026-05-26 ~10:20 UTC** — decisión: NO reactivar hoy. Mergear Lección 9 + fix, revisión sobria mañana, segunda ventana después.
- **2026-05-26 18:13 UTC** — V1 sigue estable 13h+ post-rollback, 0 errores nuevos, mix multi-deporte (MLB + UCL + NHL).
- **2026-05-27 ~10:00 UTC** — Status matutino: bot healthy 8h+, 0 errores, 38 tickers (drift documentado).
- **2026-05-27 ~12:00 UTC** — Revisión sobria del diff cerrada: `b9abaa0` = format/tests, lógica V2 efectiva sigue siendo `ed7b7ac`.
- **2026-05-27 ~13:00 UTC** — Inspección de `_apply_snapshot_msg`: swap cubre path snapshot, atomicity confirmada.
- **2026-05-27 ~13:30 UTC** — Decisión: activar hoy. Gemini descartó Opción C. Cheatsheet finalizado con adiciones Lección 9.
- **2026-05-27 14:58 UTC** — Pre-flight ejecutado: backup ✓ (619 MB, integrity ok), Telegram API ✓ (`send_alert returned: True`), /status ✓ (38 markets, todos motors OFF). Drift documentado: `alert_info` no existe → `send_alert`.
- **2026-05-27 ~15:00 UTC** — Estado: TODO LISTO. Esperando confirmación Telegram recibido en cliente + SHA Lección 9 mergeada para flippear el flag.
- **2026-05-27 15:36 UTC** — Gates confirmados, flag flippeado, V2 activado (attempt #2).
- **2026-05-27 15:36 +2.7s del primer snapshot** — Primer error: `KXMLB-26-ATL at 10c: qty=-3108`. H1 (size=0) refutada en vivo.
- **2026-05-27 15:48 UTC** — Rollback completado (~12 min total). Logs preservados con stack traces (logging fix funcionó). V2 dormant.
- **2026-05-28** — Día completo dedicado a: (a) reescribir Lección 9 con causa raíz NO RESUELTA, (b) commit al repo (SHA `3a4b384`), (c) descubrir incidente V1 WS zombie del propio día (blackout escalonado 05:00-09:00 UTC), (d) ticket V1 capturado, (e) stub Lección 10. Cierre disciplinado sin tocar código.
- **2026-05-28 noche** — Discovery V1 read-only ejecutado (5 preguntas con código verbatim). Capa adversarial frenó atribución externa de Claude Code, reordenó plan epistémicamente. 
- **2026-05-29 ~06:13 UTC** — PR fix V1 watchdog mergeado (commit `21fe6fd`), Coolify deploy.
- **2026-05-29 ~13:28 UTC** — Validación 7h 14min: 161k events, 435/435 minutos sin huecos, 0 force_reconnect espurios, 0 zombies. **Frente WS V1 CERRADO LIMPIO.**
- **2026-05-29 mañana fresca** — Tercer discovery V2 ejecutado sobre log preservado. Pregunta binaria. **H1 (size=0) REFUTADA empíricamente:** bucket 10c tenía size>0 (YES=1114.07, NO=500.00). Decisión de pivot a H2/H3/H4. Cierre del día con frente V1 efectivamente terminado y frente V2 con espacio acotado.
- **2026-05-30 mañana** — Cuarto discovery V2: cruce log + código fuente real. Tres correcciones a hallazgos del 29: (1) gap seq=40 es artefacto del manejo de error, no señal independiente; (2) estado bucket pre-delta es punto ciego (no logueado); (3) 3 dominios de seq coexistentes. Comparación lado a lado parsing snapshot vs delta = idéntico. Filtro size=0 asimétrico pero no aplica a ATL.
- **2026-05-30** — **Anti-patrón "indiscutiblemente es el feed" CAZADO en tiempo real.** Claude Code/Gemini concluyeron "V2 exculpado" — corregido por capa adversarial. **V2 NO está exculpado:** parsing limpio ≠ V2 limpio. Tres hipótesis vivas A (feed), B (snapshot parcial), C (apply en ventana no logueada).
- **2026-05-30 mañana** — Update Lección 9 redactado. Decisión branch separada (PR #1 watchdog vs PR #2 V2 instrumentación + update). Brief instrumentación corregido: asimétrico (snapshot DEBUG full, delta ERROR), acceso defensivo a bucket, verificación previa obligatoria.
- **2026-05-30 tarde** — PR #1 mergeado → commit `b52a052` → watchdog en producción, validado 7h+. PR #2 mergeado (instrumentación + update Lección 9 #1). **Tercera ventana V2 ejecutada** con runbook 12.5 literal + pre-flight completo por 1ª vez con los 4 ✅.
- **2026-05-30 17:41:01 UTC** — Activación V2 attempt #3.
- **2026-05-30 17:41:08 UTC (T+37s)** — **🎯 PRIMER ERROR captura CAUSA RAÍZ:** `msg_seq=186 state_seq=184 side=yes price_cents=3 delta_size=-13 bucket_qty_pre_delta=2` en KXMLB-26-PHI. El feed entregó secuencia consecutiva, V2 saltó el seq=185. **NO es feed corruption. Es desync interno de V2 en bootstrap.**
- **2026-05-30 17:41:08+** — Cascada: Sid 1 gap → `_start_recovery` (37 tickers stale) → Kalshi `code 15`. Recovery no convergió a T+6min.
- **2026-05-30 ~17:47 UTC** — Rollback ejecutado <5min. V1 baseline sano. **Logs preservados** en `data/v2_attempt3_20260530_174849.log` (29 KB).
- **2026-05-30 noche** — Update Lección 9 #2 redactado. **Estado de causa raíz V2: pasa de NO RESUELTA a IDENTIFICADA (C confirmada, A/B descartadas).** Cuatro discoveries cerrados. Cuarto discovery (sobre log preservado) pendiente — para determinar mecanismo exacto antes de diseñar fix.
- **2026-05-31 15:11 UTC** — Status V1 check: **21.3 horas continuas sin errores**, 37 markets tracked, baseline saludable. Decisión de rollback validada retroactivamente.
- **2026-05-31 mañana** — **Cuarto discovery V2 ejecutado desde CÓDIGO** (sin acceso al log preservado, declarado honestamente). Q1-Q4 respondidas con evidencia autoritativa de código. **Q2 = hallazgo central:** ventana ciega de bootstrap, V2 descartaba deltas pre-snapshot silenciosamente. **Q3 = bomba activa:** recovery sin convergencia (modo de cuelgue permanente). **Q4 = corrección de framing:** seq global-por-sid, no por-ticker.
- **2026-05-31** — **CORRECCIÓN del diagnóstico del 30-may:** la causa NO era "Kalshi saltó el seq=185" (mal framing por contigüidad por-ticker asumida). La causa real es ventana ciega de bootstrap + descarte de deltas pre-snapshot. Documentado en [[2026-05-31-CORRECCION-diagnostico-30may-no-falto-seq185]].
- **2026-05-31** — **🚨 MISTERIO Part A:** Claude Code mencionó dos veces que "Part A ya está mergeada" (commit `49231da`) — fix de bootstrap buffering que el usuario no aprobó ni revisó. Bug de proceso documentado en [[2026-05-31-MISTERIO-part-a-commit-49231da-sin-review-adversarial]]. Pendiente verificar antes de cualquier paso de Part B.
- **2026-05-31** — Brief Part B (recovery robusto) **aprobado** por capa adversarial con 3 verificaciones obligatorias: (1) ¿`force_reconnect()` re-autentica o solo re-socket?, (2) descarte silencioso ante `_books[ticker]=None`, (3) cap de 1000 calibrable. Implementación BLOQUEADA hasta resolver Part A.
- **2026-06-01** — Status V1: 22.7h continuas sin errores, 34 tickers, V1 baseline saludable.
- **2026-06-01** — **Auditoría PR #11 (Part B):** Claude Code defendió 3 discrepancias contra brief con bugs (TENÍA RAZÓN en las 3, incluida una que habría descartado tickers nuevos). Las 4 verificaciones pedidas destaparon **2 gaps críticos: supervisor NO se lanza (b), reintegración 00:00 UTC solo en docstring (c)**. Sin esta auditoría, cuarta ventana habría fallado garantizado. Ver [[2026-06-01-AUDITORIA-PR11-gaps-criticos-cazados]].
- **2026-06-01** — Diseño B1+A2 (supervisor in-process aislado + cap restarts) propuesto para cerrar gaps. **Auditoría destapó:** `runner.py` NO relanza; Docker/Coolify `restart: unless-stopped` SIN CAP → riesgo de crash-loop de contenedor. "Anti-zombie" produciría otro zombie.
- **2026-06-01** — **PREGUNTA DE FONDO planteada:** ¿V2 vale toda esta complejidad? 6 capas de robustez para un componente auxiliar...
- **2026-06-01** — **🔄 PIVOT ESTRATÉGICO: Gemini propone Opción 2 (REST híbrido).** Eliminar 95% de V2. WS solo para ticker, REST snapshot bajo demanda. Latencia 50-100ms vs 1ms (memoria). **Aprobado pendiente benchmark + análisis del edge.** Ver [[2026-06-01-PIVOT-opcion-2-rest-hibrido]].
- **2026-06-01** — **PATRÓN nombrado:** "directivas con diseño + implementación en mismo turno colapsan el gate". Causa raíz de Part A, PR #7, PR #11. Antídoto definido y aplicado. Candidato a Lección 11. Ver [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]].
- **2026-06-01** — Benchmark REST spec lista con criterio de decisión definido **A PRIORI** (anti-confirmation-bias): P99<150ms AND 429<2% → Opción 2 gana. Ver [[2026-06-01-benchmark-rest-spec-criterio-decision]].
- **2026-06-01** — **CIERRE DE LA SEMANA:** 7 días, 4 discoveries, 3 attempts fallidos, 2 gaps cazados en auditoría, 1 pivot estratégico, 0 código de la fortaleza en main que no haya sido revisado retroactivamente. Sistema multi-agent funcionó.
- **2026-06-02 madrugada** — Benchmark `bench_rest_arb_path.py` construido. **Catch crítico:** primer benchmark medía SQLite local (0.49ms), NO red. RTT real medido: **33ms warm p50, 64ms p95**.
- **2026-06-02 tarde** — Análisis empírico sobre 7.9M eventos. **Tres chequeos:** (a) curva liquidez-duración por deciles, (b) sensibilidad cutoff en soccer, (c) control por magnitud + tasa de captura.
- **2026-06-02** — **🔥 HALLAZGO INVERTIDO:** liquidez **DILATA** el edge ~800× monótono. Premisa de Gemini (compresión por liquidez) **REFUTADA empíricamente**. Ver [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]].
- **2026-06-02** — Pivot Mundial 11-jun identificado como filón. Soccer ya en zona líquida-lenta. NBA termina, MLB-futuros descartado (0% ≥10c — son mercados de temporada).
- **2026-06-02** — **Tasa de captura REST: 73%** en Q5 (alta liquidez), pooled. Banda 20c+ (más valiosa) = 73.9%. NO hay penalización por magnitud. p95 RTT no degrada significativamente (74% captura).
- **2026-06-02** — **🎯 DECISIÓN ARQUITECTÓNICA FINAL:** Motor REST puro para el Mundial. V2 archivado recuperable (PR #11). Detección por ticker WS + ejecución REST. Instrumentación obligatoria desde el primer partido. Ver [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]].
- **2026-06-02** — Coolify restart cap NO soportado (hardcodea `unless-stopped`). Wrapper de entrypoint rechazado por ser "A2 con otro nombre" → coherente con pivot a REST.
- **2026-06-02** — **CIERRE DE LA SAGA V2:** 9 días, V2 fortress archivada por evidencia empírica (no opinión), Motor REST simple decidido con números. **Próximos 9 días:** diseño + implementación + tests + demo, kickoff Mundial 11-jun.
