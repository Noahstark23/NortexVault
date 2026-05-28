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

## Estado actual (2026-05-28, tres frentes abiertos)

### Fases del roadmap
- **Fase 1 (data capture):** ✅ V1 operando estable AHORA (Mundo 1 confirmado), uptime 24h post-rollback attempt #2. **PERO:** hubo incidente de WS zombie hoy 05:00-09:00 UTC (blackout escalonado ~3h), recovery fortuito del lado del feed, no del bot.
- **Fase 2 (Motor 1 arbitraje):** 🔴 **CAUSA RAÍZ NO RESUELTA** — Attempt #2 V2 falló ayer (27-may 15:36→15:48) con el fix `ed7b7ac` aplicado. H1 (size=0) refutada empíricamente. Logs preservados para tercer discovery.
- **Fase 3 (trading):** 🔒 `TRADING_ENABLED=false`, `MOTOR_1_ARBITRAGE_ENABLED=false`. No tocar hasta Fase 2 cerrada.

### Tres frentes técnicos al cierre

| Frente | Estado | Bloqueante para |
|---|---|---|
| **V2 — causa raíz** | Tercer discovery pendiente con logs del attempt #2 | Toda activación futura de Motor 1 |
| **V1 — WS zombie** | Ticket capturado, sin discovery | Confiabilidad del feed de data capture |
| **Lección 10** | Stub creado, llenar post-discovery V1 | Documentación arquitectónica |

### Métricas operativas
- **Mercados tracked:** 38 (multi-deporte MLB + UCL + NHL — tendencia 40→39→38 en 3 días, ticket aparte)
- **DB size:** ~650 MB, crecimiento ~250 MB/día confirmado
- **Bankroll:** [pendiente registrar en daily]
- **Edge:** Motor 1 = arbitraje intra-mercado en milisegundos. Estado: [pendiente confirmar — Fase 2 bloqueada antes]

## Próximos hitos

### Cerrado
- [x] Fix Opción A implementado → [[fix-v2-opcion-a-implementado-commits]]
- [x] Revisión sobria del diff (27-may) — b9abaa0 confirmado format/tests
- [x] Inspección `_apply_snapshot_msg` → [[inspeccion-apply-snapshot-msg-paths-excepcion]]
- [x] Pre-flight ejecutado (27-may) → [[pre-flight-checklist-2026-05-27]]
- [x] **Attempt #2 V2 ejecutado (27-may 15:36→15:48 UTC)** — falló en 12 min, rollback limpio → [[incidente-v2-attempt-2-2026-05-27]]
- [x] H1 (size=0) refutada empíricamente — el fix se aplicó y el bug volvió
- [x] Logging fix validado en producción (única pieza del fix que cumplió)
- [x] **Lección 9 CORREGIDA y committeada al repo** — SHA `3a4b384`, v1.5, causa raíz NO RESUELTA prominente → [[leccion-9-FINAL-causa-raiz-pendiente]]
- [x] Versión obsoleta marcada como tal → [[leccion-9-canonica-kalshi-bot-context-md]]
- [x] **Incidente V1 WS zombie detectado** (28-may 05:00-09:00 UTC blackout escalonado ~3h) — ticket capturado → [[ticket-v1-ws-zombie-degradacion-escalonada]]
- [x] Stub Lección 10 → [[leccion-10-ws-zombie-pendiente-discovery]]

### Pendiente (en orden, MAÑANA o cuando descanse)

**Frente V1 (prioridad operativa — capa que está corriendo):**
- [ ] Discovery read-only de `src/clients/kalshi_ws.py` (loop recv, timeouts, keepalive)
- [ ] Discovery read-only de `src/monitoring/` (detector zombie, por qué solo setea last_error)
- [ ] Discovery read-only de `watchdog.py` + `health.py` (capas que deberían haber actuado)
- [ ] Investigar 18-may (posible microblackout silencioso similar)
- [ ] Diseñar fix WS zombie
- [ ] Cerrar Lección 10 con causa raíz validada
- [ ] Validar fix offline + segunda ventana de despliegue

**Frente V2 (prioridad de roadmap):**
- [ ] Tercer discovery con logs preservados del attempt #2 (`data/rollback_v2_attempt2_20260527_154809.log`)
- [ ] Foco: `KXMLB-26-ATL at 10c qty=-3108` a T+2.7s del primer snapshot
- [ ] Pregunta central: ¿tenía price 10c con size>0 en el snapshot WS inicial?
- [ ] Si H1 refutada al 100% → nuevas hipótesis (race snapshot/delta, wire format, parsing edge case)
- [ ] Diseñar fix real (post-discovery) — Opción A no era el fix completo
- [ ] Tercera ventana de activación con runbook 12.5 literal + adiciones Lección 9
- [ ] Si V2 estable → desbloquear Motor 1 (paso separado, otra ventana)

**Deuda técnica catalogada (no bloqueante):**
- [ ] Política de retención DB (~90 GB/año proyectado) + VACUUM mensual vía cron
- [ ] Investigar ticker drift (40→39→38 sin reemplazo)
- [ ] `last_error` TTL de auto-clear o stickiness explícita
- [ ] Detector de throughput-drop con baseline por-hora (NO threshold absoluto)
- [ ] Hardening defensivo de `parse_price_to_cents` (validar rango [0,100])

## Decisiones tomadas
- [[decision-2026-05-25-rollback-v2]] — rollback de V2 attempt #1 según runbook literal, ejecutado en ~6 min
- [[decision-2026-05-25-fix-opcion-a]] — fix puntual (5–8 líneas + 4 tests) vs rediseño (B) o status quo (C)
- [[decision-2026-05-26-no-reactivar-hoy]] — pacing disciplinado: cierre de sesión, revisión sobria al día siguiente
- [[decision-2026-05-27-activar-v2-segunda-ventana]] — activar V2 hoy con runbook literal + adiciones Lección 9 (resultado: attempt #2 falló)

## Diagnósticos clave
- [[diagnostico-v2-size-zero-bug]] — diagnóstico del 26-may (H1, size=0). **REFUTADO o INCOMPLETO** por attempt #2 del 27-may. Mantenido como historia del razonamiento.

## Validaciones técnicas
- [[inspeccion-apply-snapshot-msg-paths-excepcion]] — swap seq/apply protege ambos paths (delta y snapshot), apply_snapshot atómica. **Sigue válida arquitectónicamente** aunque el fix no resolvió el bug primario.

## Implementación del fix
- [[fix-v2-opcion-a-implementado-commits]] — commits `ed7b7ac` + `b9abaa0`. Solo el dispatcher logging fix validado en producción. Los otros dos fixes eran bugs reales pero NO eran la causa.

## Incidentes
- [[incidente-v2-attempt-2-2026-05-27]] — post-mortem del attempt #2 V2 (12 min, refutó H1)
- [[ticket-v1-ws-zombie-degradacion-escalonada]] — incidente V1 WS zombie del 28-may (blackout escalonado ~3h)

## Runbooks operativos (reusable)
- [[cheatsheet-runbook-12.5-v2-activacion]] — cheat-sheet ejecutivo runbook 12.5 + adiciones Lección 9 (línea defensiva T+5→T+30, log preservation). **Validado en 2 rollbacks limpios.**

## Lecciones aprendidas
- [[leccion-9-FINAL-causa-raiz-pendiente]] — **versión FINAL** committeada al repo (SHA `3a4b384`). Causa raíz V2 NO RESUELTA prominente.
- [[leccion-9-runbook-literal-vs-interpretacion]] — versión operativa/conceptual (complementaria, sigue vigente)
- [[leccion-9-canonica-kalshi-bot-context-md]] — ⚠️ **OBSOLETA** (mantenida como historia del razonamiento)
- [[leccion-10-ws-zombie-pendiente-discovery]] — stub pendiente discovery V1

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
