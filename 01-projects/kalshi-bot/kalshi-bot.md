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

## Estado actual (2026-05-29, frente V1 CERRADO + V2 pivot)

### Fases del roadmap
- **Fase 1 (data capture):** ✅ V1 **SANO Y ENDURECIDO**. Fix watchdog mergeado (commit `21fe6fd`) y **validado 7h 14min en producción sin huecos** (161k events / 435 minutos consecutivos). El bug del 28-may queda estructuralmente cerrado.
- **Fase 2 (Motor 1 arbitraje):** 🔄 **CAUSA RAÍZ V2 — pivot del espacio de hipótesis.** H1 (size=0 filter) REFUTADA empíricamente por forense del log del attempt #2 (bucket 10c tenía size>0 en ambos lados). Nuevo espacio: H2 (dispatcher), H3 (ordering / out-of-order), H4 (parsing del snapshot). NO se reactiva V2.
- **Fase 3 (trading):** 🔒 `TRADING_ENABLED=false`, `MOTOR_1_ARBITRAGE_ENABLED=false`. No tocar hasta Fase 2 cerrada.

### Frentes al cierre del día

| Frente | Estado |
|---|---|
| **V1 WS zombie** | ✅ **CERRADO LIMPIO** — fix validado 7h en producción |
| **Lección 10** | ✅ Redactada con causa cerrada — pendiente commit administrativo al repo |
| **V2 causa raíz** | 🔄 **Pivot a H2/H3/H4** — discovery sobre dispatcher/ordering/parsing cuando se retome |
| Capital | 🔒 Cero — `TRADING_ENABLED=false`, sin urgencia operativa |

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

### Pendiente (no urgente, cuando se retome)

**Administrativo:**
- [ ] Commit Lección 10 al `KALSHI_BOT_CONTEXT.md` v1.6 (contenido listo en [[leccion-10-FINAL-ws-zombie-con-fix-validado]])

**Frente V2 (siguiente vez que se trabaje el roadmap a Motor 1):**
- [ ] Discovery sobre `_apply_delta_msg` enfocado a H2 (¿cómo apply_delta procesa delta negativo grande sobre size válido?)
- [ ] Análisis de deltas entre seq=2 y seq=39 en log preservado — ¿algún otro también produjo error?
- [ ] Investigar shape de parseo de `yes_dollars_fp` — H4 (¿unidad esperada?)
- [ ] El gap de seq=40 es señal fuerte de H3 — discovery sobre handling de out-of-order
- [ ] NO escribir fix sin causa raíz validada contra log preservado (Lección 9 #1)
- [ ] Decisión A2 (parche puntual sobre H2/H3/H4) vs B (rediseño) — depende del discovery

**Deuda técnica V1 (mejoras, no bloqueante):**
- [ ] Fase 2 watchdog: detector de tasa con baseline por hora (Fase 1 ya da auto-recuperación)
- [ ] Unificación de las dos señales `ws_connected` (consolidar Señal A → message-based)
- [ ] Test causa externa vs starvation interna (cuestión técnica abierta)
- [ ] Latencia detección actual ~10-15 min worst case → mejorable

**Deuda catalogada general:**
- [ ] Política de retención DB (~90 GB/año proyectado) + VACUUM mensual vía cron
- [ ] Investigar ticker drift (40→39→38 sin reemplazo)
- [ ] Hardening defensivo de `parse_price_to_cents` (validar rango [0,100])

## Decisiones tomadas
- [[decision-2026-05-25-rollback-v2]] — rollback V2 attempt #1
- [[decision-2026-05-25-fix-opcion-a]] — fix puntual size=0 (hipótesis válida en su momento, después refutada)
- [[decision-2026-05-26-no-reactivar-hoy]] — pacing disciplinado
- [[decision-2026-05-27-activar-v2-segunda-ventana]] — segunda ventana (resultado: attempt #2 falló)
- [[decision-2026-05-29-v2-pivot-nuevo-espacio-hipotesis]] — **abandonar variantes de size=0, pivot a H2/H3/H4**

## Diagnósticos clave
- [[diagnostico-v2-size-zero-bug]] — diagnóstico H1 (26-may). **REFUTADO** por forense (29-may). Historia.
- [[discovery-forense-v2-attempt2-h1-refutada]] — forense del log preservado, evidencia binaria que refuta H1

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
- [[leccion-9-FINAL-causa-raiz-pendiente]] — **versión FINAL** en repo (SHA `3a4b384`). Causa V2 NO RESUELTA. H1 ahora refutada empíricamente.
- [[leccion-10-FINAL-ws-zombie-con-fix-validado]] — **versión FINAL** lista para commit v1.6. Causa cerrada + fix validado 7h.
- [[leccion-9-runbook-literal-vs-interpretacion]] — versión operativa/conceptual (complementaria, sigue vigente)
- [[leccion-9-canonica-kalshi-bot-context-md]] — ⚠️ **OBSOLETA** (historia del razonamiento)
- [[leccion-10-ws-zombie-pendiente-discovery]] — ⚠️ **STUB SUPERADO** (historia del razonamiento)

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
