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

## Estado actual (2026-05-25, post-incidente V2)
- **Fase 1 (data capture):** ✅ V1 operando estable, 9h+ post-rollback sin errores, 350K+ events capturados
- **Fase 2 (Motor 1 arbitraje):** 🔴 BLOQUEADO hasta que V2 (OrderbookManagerV2) pase validación. V2 desactivado tras incidente del 25-mayo.
- **Fase 3 (trading):** 🔒 `TRADING_ENABLED=false`, `MOTOR_1_ARBITRAGE_ENABLED=false`. No tocar hasta Fase 2 cerrada.
- **Mercados tracked:** 40 (KXMLB-26 chains)
- **Bankroll:** [pendiente registrar en daily]
- **Edge:** [pendiente documentar — Motor 1 = arbitraje intra-mercado]

## Próximos hitos
- [ ] Claude Code implementa fix Opción A → ver [[decision-2026-05-25-fix-opcion-a]]
- [ ] Code review del diff antes de merge
- [ ] Segunda ventana de activación V2 con runbook 12.5 literal (2–3h continuas)
- [ ] Si V2 estable a T+2h → desbloquear Motor 1 (paso separado, otra ventana)
- [ ] Política de retención DB (90 GB/año proyectado real) + VACUUM mensual vía cron

## Decisiones tomadas
- [[decision-2026-05-25-rollback-v2]] — rollback de V2 según runbook literal, ejecutado en ~6 min
- [[decision-2026-05-25-fix-opcion-a]] — fix puntual de 5–8 líneas + 4 tests vs rediseño (B) o status quo (C)

## Diagnósticos clave
- [[diagnostico-v2-size-zero-bug]] — causa raíz del incidente V2 validada: `_parse_fp_levels` no filtra `size=0` mientras `apply_snapshot` sí. Plus seq ordering inverted + logger sin `exc_info`.

## Lecciones aprendidas
- [[leccion-9-runbook-literal-vs-interpretacion]] — disciplina del runbook literal sostenido por el operador humano, no por agentes

## Sesiones documentadas
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — ventana V2: activación, rollback, diagnóstico, fix plan
- [[sesion-2026-05-24-setup-git-fase2]] — setup de Obsidian Git + Restricted Mode (vault infra, no kalshi-bot directo)

## Recursos
- Repo: [agregar URL]
- Cuenta Kalshi: [agregar]
- Documentos clave en repo: `KALSHI_BOT_CONTEXT.md` (lecciones + runbooks), `runbook 12.5` (activación V2)
- Coolify: dashboard de deploy
- Multi-agent workflow: Gemini (CTO planning) + Claude (review adversarial) + Claude Code (ejecución) + Yo (decisiones)

## Métricas a trackear (en daily)
- Bankroll Kalshi (USD): pre-trading sigue siendo 0 efectivo, capital reservado en otra cuenta
- Uptime del bot: target >99% en Fase 1
- Errores no-SidGap por día: target 0 en V1; <umbral durante ventanas V2
- DB size + growth rate (path REST de V1): ~250 MB/día confirmado

## Bloqueos / dudas abiertas
- Edge de Motor 1: ¿demostrado en simulación o solo hipótesis?
- Magnitud del bankroll inicial cuando se active TRADING_ENABLED
- Si Opción A falla en segunda ventana, ¿pivot a B (rediseño) o C (continuar V1)?

## Log
- 2026-05-24: proyecto creado, vault sembrado. Pendiente brain dump (sigue pendiente — incidente V2 ocupó la jornada del 25).
- 2026-05-25 ~16:50 UTC: ventana de activación V2 abierta tras review adversarial del plan de Gemini.
- 2026-05-25 17:18 UTC: rollback ejecutado en ~6 min. V2 dormant.
- 2026-05-25 ~20:30 UTC: diagnóstico empírico cerrado (3 bugs identificados, hipótesis "feed corruption" refutada).
- 2026-05-25 ~20:37 UTC: brief de Opción A revisado y listo para mandar a Claude Code.
- 2026-05-26 ~02:43 UTC: reporte CTO confirma V1 estable 9h+ post-rollback. Decisión arquitectónica desbloqueada.
