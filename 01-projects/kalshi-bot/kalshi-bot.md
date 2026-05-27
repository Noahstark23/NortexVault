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

## Estado actual (2026-05-26, T+13h post-rollback V2)
- **Fase 1 (data capture):** ✅ V1 operando estable, **13h+ post-rollback sin errores**, 289,986 events capturados en último ciclo (acumulado total ~4.59M)
- **Fase 2 (Motor 1 arbitraje):** 🟡 **DESBLOQUEABLE** — fix Opción A entregado, mergeable. Pendiente revisión sobria del diff + segunda ventana de activación V2.
- **Fase 3 (trading):** 🔒 `TRADING_ENABLED=false`, `MOTOR_1_ARBITRAGE_ENABLED=false`. No tocar hasta Fase 2 cerrada.
- **Mercados tracked:** 39 (ahora multi-deporte: KXMLB MLB, KXUCL Champions League, KXNHL hockey)
- **Throughput:** ~6.2 events/s sostenido, ~22.3K events/h
- **Bankroll:** [pendiente registrar en daily]
- **Edge:** Motor 1 = arbitraje intra-mercado en milisegundos. Estado: [hipótesis vs demostrado pendiente confirmar]

## Próximos hitos
- [x] Claude Code implementó fix Opción A → ver [[fix-v2-opcion-a-implementado-commits]]
- [x] Lección 9 redactada en versión canónica → [[leccion-9-canonica-kalshi-bot-context-md]]
- [x] Decisión disciplinada de NO reactivar hoy → [[decision-2026-05-26-no-reactivar-hoy]]
- [ ] **MAÑANA:** Mergear Lección 9 al `KALSHI_BOT_CONTEXT.md` (header v1.5)
- [ ] **MAÑANA:** Revisión sobria del diff (20 min, 3 puntos en [[fix-v2-opcion-a-implementado-commits]])
- [ ] Si revisión limpia → agendar ventana V2 con 2–3h libres confirmadas
- [ ] Segunda ventana de activación V2 con runbook 12.5 literal (sin "ya entendimos el bug")
- [ ] Si V2 estable a T+2h → desbloquear Motor 1 (paso separado, otra ventana)
- [ ] Política de retención DB (90 GB/año proyectado real) + VACUUM mensual vía cron

## Decisiones tomadas
- [[decision-2026-05-25-rollback-v2]] — rollback de V2 según runbook literal, ejecutado en ~6 min
- [[decision-2026-05-25-fix-opcion-a]] — fix puntual (5–8 líneas + 4 tests) vs rediseño (B) o status quo (C)
- [[decision-2026-05-26-no-reactivar-hoy]] — pacing disciplinado: cierre de sesión, revisión sobria mañana, ventana después

## Diagnósticos clave
- [[diagnostico-v2-size-zero-bug]] — causa raíz del incidente V2: `_parse_fp_levels` no filtra `size=0` mientras `apply_snapshot` sí + seq ordering inverted + logger sin `exc_info`

## Implementación del fix
- [[fix-v2-opcion-a-implementado-commits]] — commits `ed7b7ac` + `b9abaa0`, 282/282 tests, desviación loguru documentada

## Lecciones aprendidas
- [[leccion-9-canonica-kalshi-bot-context-md]] — versión final para `KALSHI_BOT_CONTEXT.md` (v1.5)
- [[leccion-9-runbook-literal-vs-interpretacion]] — versión operativa/conceptual (complementaria)

## Sesiones documentadas
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — activación V2, rollback, diagnóstico, fix plan
- [[sesion-2026-05-26-fix-merge-y-cierre-disciplinado]] — verificación del fix, Lección 9 canónica, decisión de pacing
- [[sesion-2026-05-24-setup-git-fase2]] — setup de Obsidian Git (vault infra)

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
