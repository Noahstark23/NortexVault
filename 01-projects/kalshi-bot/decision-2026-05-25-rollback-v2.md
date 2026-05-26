---
fecha: 2026-05-25
tipo: decision
proyecto: kalshi-bot
estado: ejecutada
tags:
  - decision
  - kalshi-bot
  - rollback
  - runbook-12.5
---

# Decisión: ejecutar rollback de OrderbookManagerV2 según runbook literal

## La decisión
Revertir `USE_ORDERBOOK_MANAGER_V2: true → false` en Coolify y redeployar tras detectar segunda ráfaga de errores `delta produces qty<0` no relacionados a `SidGapError` durante la ventana T+30min de supervisión activa.

## Contexto / problema
Ventana de activación 25-mayo-2026, 16:50 UTC. A T+5min se detectó ráfaga 1: 19 errores no-SidGap en 179ms. Claude Code reportó "criterios en verde" interpretando la ráfaga como "bootstrap aislado". Review adversarial flagueó la interpretación (era violación literal del criterio `>3 errores no-SidGap en 10 min`).

La decisión a tomar: rollback retrospectivo (conservador, disciplinado), o continuar con excepción documentada (pragmático, sistema estable).

Se definió línea defensiva: **1 solo error no-SidGap adicional entre ese momento y T+30min → rollback inmediato sin derecho a réplica.**

A T+25min (16:57:16 UTC), antes del snapshot programado T+30min, se detectó ráfaga 2: ≥8 errores no-SidGap nuevos, magnitudes hasta -6247 (mucho mayores que ráfaga 1). La línea defensiva se disparó.

## Razones
- El criterio `>3 errores no-SidGap en 10 min` del runbook 12.5 estuvo violado por 6x en ráfaga 1 (19 errores) y por 2.6x en ráfaga 2 (≥8 errores). Aplicado literalmente, era criterio de rollback.
- La hipótesis "ráfaga aislada de bootstrap" fue refutada empíricamente con la ráfaga 2 a T+5min de distancia. Patrón estocástico, no determinístico de arranque.
- Magnitudes creciendo entre ráfagas (ráfaga 1 max ~negativos chicos; ráfaga 2 hasta -6247) sugería degradación de state, no transitorio.
- El runbook 12.5 dice literalmente: "Si rollback ocurre: NO reintentar inmediatamente. Capturar logs completos. Analizar root cause antes de segundo intento." → la decisión correcta era detener para diagnóstico.
- Sostener la línea defensiva validaba empíricamente la disciplina "runbook literal" — la review previa había advertido contra el patrón de "softening del runbook a mitad de incidente".

## Alternativas descartadas
- **Continuar con excepción documentada después de ráfaga 1:** descartada al aparecer ráfaga 2 dentro de la ventana defensiva. La excepción habría requerido stable state >30min sin errores nuevos, no se cumplió.
- **Esperar a T+2h para decidir según runbook estricto:** descartada porque la línea defensiva (más conservadora que el criterio T+2h del runbook) ya estaba establecida y violada. Esperar habría sido relajar la línea defensiva ya comunicada.
- **Rollback parcial / desactivación selectiva:** no aplica — el flag es binario, V2 activo o dormant.

## Cómo lo verifico
- ✅ Tiempo total de rollback: ~6 min (target del runbook: <5 min; margen aceptable por build time del Docker compose).
- ✅ Container V1 levantado a 17:18:17 UTC, `v2.enabled=False` confirmado runtime.
- ✅ V1 estable post-rollback durante 9h+ (verificado en reporte CTO 02:43 UTC del 26-mayo): 0 errores en 350K events capturados.
- ✅ Métricas baseline V1 retornadas: `capture_running=true`, `ws_connected=true`, `tracked_markets=40`, `last_error=null`.
- ✅ Diagnóstico empírico posterior validó que el rollback fue correcto: causa raíz era bug local en V2 (`_parse_fp_levels` no filtra `size=0`), no transitorio resoluble con esperar.

**Condición de invalidación:** si en algún momento el diagnóstico hubiera mostrado que V2 era correcto y la "feed corruption" era real, la decisión retroactivamente habría sido conservadora pero no errada (rollback sin daño operativo). Diagnóstico confirmó V2 sí tenía bug → decisión correcta retrospectivamente y operacionalmente.

## Consecuencias derivadas
- Motor 1 sigue bloqueado hasta que Opción A esté implementada, testeada, y validada con segunda ventana de activación.
- Lección 9 redactada → [[leccion-9-runbook-literal-vs-interpretacion]].
- Patrón "runbook literal sostenido por el operador humano, no por el agente" formalizado para futuras ventanas.
- Brief CTO emitido con cronología, telemetría y diagnóstico preliminar (no validado todavía en ese momento).

## Links
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — chronology completa
- [[diagnostico-v2-size-zero-bug]] — causa raíz validada post-rollback
- [[leccion-9-runbook-literal-vs-interpretacion]] — lección operativa
- [[decision-2026-05-25-fix-opcion-a]] — decisión siguiente del fix
- [[kalshi-bot]] — proyecto raíz
