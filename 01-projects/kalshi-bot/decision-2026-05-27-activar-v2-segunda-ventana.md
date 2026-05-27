---
fecha: 2026-05-27
tipo: decision
proyecto: kalshi-bot
estado: en-ejecucion-gate-telegram
tags:
  - decision
  - kalshi-bot
  - v2
  - segunda-ventana
---

# Decisión: activar V2 en segunda ventana (27-may-2026)

## La decisión
Proceder con la activación de `USE_ORDERBOOK_MANAGER_V2=true` en Coolify hoy 27-may, aplicando runbook 12.5 literal + adición de Lección 9 (línea defensiva T+5 a T+30min). Activación condicionada a gates de pre-flight cumplidos, especialmente confirmación de Telegram recibido por el cliente.

## Contexto / problema
Tras la decisión disciplinada de ayer ([[decision-2026-05-26-no-reactivar-hoy]]), hoy se ejecutó el plan de revisión sobria + inspección técnica. Tres caminos posibles emergieron:

- **A** — Cerrar el punto pendiente (`_apply_snapshot_msg` excepciones) en 3 min y decidir si activar hoy.
- **B** — Posponer activación, abrir tickets de cobertura, activar en otra ventana.
- **C** — Activar hoy sin cerrar `_apply_snapshot_msg`. Riesgo bajo pero no cero.

**Gemini (CTO) descartó C explícitamente:** "Asumir riesgo operacional por evitar 3 minutos de lectura de código es una mala decisión de ingeniería." Correcto.

**Recomendación de Gemini:** Opción A condicionada a disponibilidad operativa real de 2-3h continuas. Coincide con mi análisis.

## Razones para activar HOY

1. **Revisión sobria del diff cerrada limpia.** `b9abaa0` confirmado como format/tests sin cambios funcionales. La lógica efectiva es `ed7b7ac`. Ver [[fix-v2-opcion-a-implementado-commits]].

2. **Inspección de `_apply_snapshot_msg` cerrada con confianza estructural.** TODAS las excepciones posibles del path snapshot ocurren antes del seq update. `apply_snapshot` atómica (8 setattr en asyncio single-thread). Cero corrupción posible. Ver [[inspeccion-apply-snapshot-msg-paths-excepcion]].

3. **V1 sostiene Fase 1 sin novedad.** 8h+ healthy hoy, 0 errores, throughput estable, sin urgencia operacional. Misma condición que ayer pero con el frente del fix cerrado limpio.

4. **Ventana de tiempo disponible.** Mañana despejada en zona horaria local. 2-3h continuas confirmadas para supervisión activa.

5. **Lección 9 internalizada en el cheat-sheet.** Las adiciones empíricas (línea defensiva T+5 a T+30, log preservation pre-debug) están listas para aplicarse. Ver [[cheatsheet-runbook-12.5-v2-activacion]].

## Riesgos restantes y mitigación

| Riesgo | Mitigación |
|---|---|
| Sink Loguru en Coolify no emerge stack traces (test #4 solo valida pytest) | Conocido NO bloqueante. Peor caso: logs vacíos → rollback igualmente por línea defensiva. Ticket post-ventana para forzar excepción no-orderbook y validar sink. |
| Test #2 cubre estructura, no operación del next-delta | Por construcción del fix, si seq se preservó y state quedó intacto, next-delta válido procesa. Ticket de cobertura aparte. |
| `parse_price_to_cents` no valida rango [0,100] cents | Path teórico (Kalshi nunca emite fuera de rango). Ticket de hardening defensivo. |
| Drift conocido `alert_info` no existe → usar `send_alert` | Documentado en pre-flight, no impacta activación. |

**Ninguno es bloqueante.** Los tres entran como "deuda técnica post-activación".

## Gates obligatorios antes del flip (pre-flight)

1. ✅ `/status` healthy verificado (no hace 8h, ahora)
2. ✅ Backup SQLite + `integrity_check` OK
3. ✅ Telegram API responde 200 (`send_alert returned: True`)
4. ⏳ **GATE PENDIENTE:** confirmación de recepción del mensaje Telegram en cliente. Sin esto NO se flippea.
5. ⏳ Lección 9 mergeada al `KALSHI_BOT_CONTEXT.md` v1.5 (SHA pendiente confirmación)
6. ✅ 2-3h continuas confirmadas

## Criterios de éxito (T+2h, runbook literal)
- Cero ERROR nuevos relacionados a orderbook/manager/V2
- SidGapError rate sostenido < 5/min
- `_take_snapshots` completando N/N cada ~5 min (N = tracked_markets actual = 38)
- `/status` muestra `books_initialized` subiendo hacia 38

## Criterios de rollback (cualquiera dispara)
**Runbook base:**
- >3 errores NO-SidGap en 10 min
- SidGapError > 20/min por más de 5 min
- `tracked_markets` < 35
- `capture_running=false` o `ws_connected=false` >60s
- Cualquier CRITICAL nuevo

**Adición Lección 9:**
- Entre T+5 y T+30: **1 solo error no-SidGap adicional = rollback inmediato**

## Métrica de éxito específica para ESTA ventana
**"No falla por la razón que arreglamos."** Si vuelven `qty<0` con magnitudes similares al 25-may → H1 NO era el único bug. El raw snapshot logging (líneas 343-348 de `orderbook_manager_v2.py`) capturará evidencia que faltó la primera vez.

## Alternativas descartadas

### Alternativa C (activar sin cerrar `_apply_snapshot_msg`)
**Razón de descarte:** Gemini lo dijo bien — 3 minutos de lectura de código son gratis comparados con costo cognitivo de descubrir edge case durante la ventana. La inspección se hizo, el path está cubierto.

### Alternativa B (posponer y abrir tickets de cobertura)
**Razón de descarte:** los tickets restantes (sink Loguru, test #2 operativo, ticker count) son cobertura post-activación, no bloqueantes. Posponer sin razón técnica activa sería repetir el patrón opuesto a Lección 9: paralización por exceso de precaución cuando los gates están cumplidos.

### Alternativa: activar saltando backup + Telegram para "ahorrar 5 min"
**Razón de descarte:** Lección 9 documenta el anti-patrón "softening del runbook a mitad de incidente". Saltar pre-flight por momentum es exactamente eso. Los 5 min compran red de seguridad concreta. No-negociable.

## Plan post-decisión

1. **Confirmar Telegram recibido** (gate bloqueante)
2. **Confirmar SHA Lección 9 mergeada** (gate bloqueante)
3. Cuando ambos ✅:
   - Web Agent ejecuta secuencia Coolify:
     - Environment Variables → `USE_ORDERBOOK_MANAGER_V2: false → true`
     - Verificar `MOTOR_1_ARBITRAGE_ENABLED=false` y `TRADING_ENABLED=false`
     - Save + Redeploy
     - Monitorear logs esperando `OrderbookManagerV2 registered (data-capture only, no Motor 1)`
4. T+5min: aplicar línea defensiva. **1 error no-SidGap = rollback inmediato sin réplica.**
5. T+30min: snapshot completo `/status` + grep
6. T+2h: aplicar criterios de éxito runbook literal
7. Cierre de la ventana:
   - Si éxito → desbloquear paso a Motor 1 (otra ventana, otro día)
   - Si rollback → diagnóstico empírico, nueva iteración, NO reactivar inmediatamente

## Workflow capa por capa

| Capa | Responsabilidad en esta decisión |
|---|---|
| **Gemini (CTO)** | Recomendó A condicionada, descartó C, proveyó comandos pre-flight |
| **Claude (yo)** | Revisión sobria del diff + agregué adiciones Lección 9 al cheat-sheet |
| **Claude Code** | Inspección de `_apply_snapshot_msg`, ejecución pre-flight, documentación de drift `alert_info` |
| **Yo (Noel)** | Decisión final, confirmación de gates, ejecución de la ventana |

**Patrón aplicado:** la disciplina del runbook literal se ejecuta sobre evidencia técnica validada, no sobre confianza intuitiva. Hoy se cierra el ciclo que Lección 9 documentó: pre-flight literal → activación con criterios literales → operador humano como única capa que aplica el contrato.

## Cómo lo verifico (criterios de éxito de la decisión)

**Decisión correcta si:**
- Activación no produce errores `qty<0` (H1 era único bug)
- Si rollback, ocurre dentro de los criterios definidos sin override del operador
- Tiempo de rollback (si aplica) <5 min end-to-end
- Lección 9 aplicada en práctica sin relajación

**Decisión retroactivamente errada si:**
- Operador relaja runbook a mitad de incidente bajo presión
- Se descubre durante la ventana que un gate no estaba realmente cumplido
- Bug residual fuera de los 3 identificados aparece (requiere reabrir investigación)

## Links
- [[sesion-2026-05-27-segunda-ventana-v2-preflight]] — chronology
- [[cheatsheet-runbook-12.5-v2-activacion]] — runbook a aplicar
- [[inspeccion-apply-snapshot-msg-paths-excepcion]] — validación técnica
- [[fix-v2-opcion-a-implementado-commits]] — fix que estamos validando
- [[pre-flight-checklist-2026-05-27]] — ejecución pre-flight
- [[decision-2026-05-25-rollback-v2]] — decisión opuesta del 25-may (rollback)
- [[decision-2026-05-26-no-reactivar-hoy]] — decisión de pacing del 26-may
- [[leccion-9-canonica-kalshi-bot-context-md]] — lección que se aplica hoy en práctica
- [[kalshi-bot]]
