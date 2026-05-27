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

## Estado actual (2026-05-27, pre-flight completo segunda ventana V2)
- **Fase 1 (data capture):** ✅ V1 operando estable, 8h+ healthy hoy, 0 ERROR / 0 CRITICAL, throughput ~4.9 events/s
- **Fase 2 (Motor 1 arbitraje):** 🟡 **LISTA PARA FLIP** — fix Opción A mergeado, revisión sobria cerrada limpia, pre-flight ejecutado. Esperando confirmación de Telegram recibido en cliente para flippear el flag.
- **Fase 3 (trading):** 🔒 `TRADING_ENABLED=false`, `MOTOR_1_ARBITRAGE_ENABLED=false`. No tocar hasta Fase 2 cerrada.
- **Mercados tracked:** 38 (multi-deporte MLB + UCL + NHL — tendencia 40→39→38 en 3 días, ticket aparte)
- **DB size:** 647 MB, crecimiento consistente ~250 MB/día
- **Bankroll:** [pendiente registrar en daily]
- **Edge:** Motor 1 = arbitraje intra-mercado en milisegundos. Estado: [hipótesis vs demostrado pendiente confirmar]

## Próximos hitos
- [x] Claude Code implementó fix Opción A → ver [[fix-v2-opcion-a-implementado-commits]]
- [x] Lección 9 redactada en versión canónica → [[leccion-9-canonica-kalshi-bot-context-md]]
- [x] Decisión disciplinada de NO reactivar el 26-may → [[decision-2026-05-26-no-reactivar-hoy]]
- [x] **27-may:** Revisión sobria del diff completa, b9abaa0 confirmado como format/tests
- [x] **27-may:** Inspección de `_apply_snapshot_msg` → swap cubre path snapshot, atomicity confirmada → [[inspeccion-apply-snapshot-msg-paths-excepcion]]
- [x] **27-may:** Decisión de activar hoy → [[decision-2026-05-27-activar-v2-segunda-ventana]]
- [x] **27-may 14:58 UTC:** Pre-flight ejecutado (backup ✓, Telegram API ✓, /status ✓) → [[pre-flight-checklist-2026-05-27]]
- [ ] **GATE BLOQUEANTE:** confirmar recepción Telegram en cliente
- [ ] **GATE BLOQUEANTE:** confirmar SHA de Lección 9 mergeada al `KALSHI_BOT_CONTEXT.md`
- [ ] Flip `USE_ORDERBOOK_MANAGER_V2: false → true` + Redeploy
- [ ] T+5 a T+30: aplicar línea defensiva (1 error no-SidGap = rollback)
- [ ] T+2h: aplicar criterios de éxito runbook 12.5 literal
- [ ] Si V2 estable a T+2h → desbloquear Motor 1 (paso separado, otra ventana)
- [ ] Política de retención DB (90 GB/año proyectado) + VACUUM mensual vía cron
- [ ] Investigar ticker drift (40→39→38 sin reemplazo)

## Decisiones tomadas
- [[decision-2026-05-25-rollback-v2]] — rollback de V2 según runbook literal, ejecutado en ~6 min
- [[decision-2026-05-25-fix-opcion-a]] — fix puntual (5–8 líneas + 4 tests) vs rediseño (B) o status quo (C)
- [[decision-2026-05-26-no-reactivar-hoy]] — pacing disciplinado: cierre de sesión, revisión sobria al día siguiente
- [[decision-2026-05-27-activar-v2-segunda-ventana]] — activar V2 hoy con runbook literal + adiciones Lección 9

## Diagnósticos clave
- [[diagnostico-v2-size-zero-bug]] — causa raíz del incidente V2: `_parse_fp_levels` no filtra `size=0` mientras `apply_snapshot` sí + seq ordering inverted + logger sin `exc_info`

## Validaciones técnicas
- [[inspeccion-apply-snapshot-msg-paths-excepcion]] — swap seq/apply protege ambos paths (delta y snapshot), apply_snapshot atómica, cero corrupción posible

## Implementación del fix
- [[fix-v2-opcion-a-implementado-commits]] — commits `ed7b7ac` + `b9abaa0`, 282/282 tests, desviación loguru documentada

## Runbooks operativos (reusable)
- [[cheatsheet-runbook-12.5-v2-activacion]] — cheat-sheet ejecutivo runbook 12.5 + adiciones Lección 9 (línea defensiva T+5→T+30, log preservation)

## Lecciones aprendidas
- [[leccion-9-canonica-kalshi-bot-context-md]] — versión final para `KALSHI_BOT_CONTEXT.md` (v1.5)
- [[leccion-9-runbook-literal-vs-interpretacion]] — versión operativa/conceptual (complementaria)

## Sesiones documentadas
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — primera activación + rollback + diagnóstico + fix plan
- [[sesion-2026-05-26-fix-merge-y-cierre-disciplinado]] — verificación del fix, Lección 9 canónica, decisión de pacing
- [[sesion-2026-05-27-segunda-ventana-v2-preflight]] — revisión sobria + inspección + decisión + pre-flight
- [[sesion-2026-05-24-setup-git-fase2]] — setup de Obsidian Git (vault infra)

## Pre-flights ejecutados
- [[pre-flight-checklist-2026-05-27]] — segunda ventana, ejecutado 14:58 UTC

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
