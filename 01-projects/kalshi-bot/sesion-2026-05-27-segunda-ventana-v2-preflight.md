---
fecha: 2026-05-27
tipo: sesion-conmigo
proyecto: kalshi-bot
ia: Claude + Claude Code + Gemini (CTO) + Web Agent
modelo: multi-agent workflow
tags:
  - sesion-conmigo
  - kalshi-bot
  - v2
  - segunda-ventana
  - pre-flight
---

# 27-may — Segunda ventana V2: revisión sobria, pre-flight, listo para flip

> Día siguiente al cierre disciplinado del 26-may. Disciplina sostenida: NO se activó V2 anoche. Hoy se ejecutó la revisión sobria del diff, se cerraron los 3 puntos pendientes, se ejecutó pre-flight completo. Estado al cierre del log: TODO LISTO, esperando confirmación de Telegram recibido para flippear el flag.

## Contexto
Tras decidir ayer NO activar (ver [[decision-2026-05-26-no-reactivar-hoy]]), hoy se ejecutó el plan de Opción A en orden correcto: status check → revisión sobria del diff → inspección del path de snapshot → decisión → cheat-sheet operativo finalizado → pre-flight ejecutado.

## Decisiones / conclusiones

### 1. Status check matutino — V1 sostiene Fase 1
- Bot healthy 8h+ post-deploy del fix (commit `b9abaa0`)
- 0 ERROR / 0 CRITICAL
- Throughput ~4.9 events/s (consistente con runs previos)
- 38 tickers (vs 39 ayer, vs 40 inicial — tendencia a confirmar como ticket aparte)
- DB 647 MB, crecimiento consistente
- WS reconnect transitorio 08:29 → recuperado solo

**Lección 9 validada en práctica:** el patrón "ya entendimos el bug, activamos rápido" se evitó. Decisión disciplinada de ayer (no reactivar) sostuvo Fase 1 sin incidentes.

### 2. Revisión sobria del diff b9abaa0 → ed7b7ac — CERRADA LIMPIA
Confirmación empírica vía `git log --oneline 9b809a6..b9abaa0` + `git diff 9b809a6 b9abaa0 --stat`:

**b9abaa0 (1 commit, 2 archivos, +52/-49):**
- `orderbook_manager_v2.py:341-348` → solo strings de logging (formato + un cambio de variable `raw_msg → msg` en debug que no afecta flujo posterior)
- `tests/strategies/motor_1_arbitrage/test_v2_fixes.py` → renombres de tests + aserciones más estrictas + tickers de producción. **No relaja ningún test; los endurece.**

**Veredicto:** funcional NULO en producción. La lógica V2 efectiva sigue siendo la de `ed7b7ac`. Reporte de Claude Code de anoche ("correcciones de formato/tests") exacto.

### 3. Tres puntos pendientes de revisión sobria (re-evaluados contra ed7b7ac)

**Punto 1 — Swap seq/apply cubre `_apply_snapshot_msg`:**  Confirmado por inspección del código (ver [[inspeccion-apply-snapshot-msg-paths-excepcion]]). El swap protege ambos paths (delta y snapshot) porque la asignación de `_last_seq_by_sid` se movió a DESPUÉS de la invocación, no DENTRO de `_apply_delta_msg`. Todas las excepciones posibles de `_apply_snapshot_msg` (KeyError en parsing de `raw_msg`, ValueError en `_parse_level`) se levantan antes del seq update.

**Punto 2 — `logger.opt(exception=r)` emerge en Coolify sink:**  Validado en pytest (caplog). Sink real solo confirmable durante activación. Riesgo conocido NO bloqueante — peor caso, logs vacíos otra vez y reabrimos.

**Punto 3 — Test #2 cubre estructura, no operación:**  Validado que `_last_seq_by_sid[sid]` queda en 100 post-error. Falta validar que el siguiente delta válido con seq=101 se procesa OK. Ticket de cobertura NO bloqueante — si fix funciona, next-delta procesa bien por construcción.

### 4. Inspección de `_apply_snapshot_msg` (3 min) — atomicidad confirmada
Ver [[inspeccion-apply-snapshot-msg-paths-excepcion]] para detalle. Veredicto: TODAS las excepciones posibles del path snapshot ocurren ANTES de la mutación atómica del state (8 setattr en asyncio single-thread sin await). El swap protege el seq. Cero corrupción posible.

**Hallazgo colateral:** `parse_price_to_cents` no valida rango [0, 100] cents. "1.5000" produce 150 → `_parse_fp_levels` lo pasa sin warning → `apply_snapshot` lo rechaza con ValueError. Path teórico que en práctica Kalshi no produce, pero queda como ticket de hardening defensivo.

### 5. DECISIÓN: activar V2 hoy con runbook 12.5 literal
Tras revisión sobria limpia + 3-min de inspección snapshot + V1 sano 8h+, criterios cumplidos. Ver [[decision-2026-05-27-activar-v2-segunda-ventana]].

**Discrepancia rechazada:** Opción C (activar sin cerrar `_apply_snapshot_msg`) descartada por Gemini. "Asumir riesgo operacional por evitar 3 min de lectura de código es mala ingeniería." Correcto.

### 6. Cheat-sheet operativo finalizado con adiciones de Lección 9
Extraído fielmente del runbook 12.5 + 2 adiciones empíricas:

**Adición 5.bis — Línea defensiva T+5 a T+30min:** Entre T+5 y T+30 post-activación, 1 solo error no-SidGap adicional → rollback inmediato. Esta es la línea que disparó el rollback correcto el 25-may. NO está en runbook base; se valida por Lección 9.

**Adición sección 6 — Preservar logs antes de debug:**
```bash
docker logs kalshi-bot --tail 1000 > /tmp/rollback_$(date +%Y%m%d_%H%M%S).log
```

Ver [[cheatsheet-runbook-12.5-v2-activacion]].

### 7. Pre-flight ejecutado vía Claude Code (14:58 UTC)

| Paso | Estado | Resultado |
|---|---|---|
| Backup SQLite + integrity_check | ✅ | 619 MB persistidos, `integrity_check: ('ok',)` |
| Telegram send_alert | ⚠️→✅ | API returned `True`. Drift documentado: cheatsheet decía `alert_info` (no existe), código real es `send_alert` |
| /status local | ✅ | `capture_running=True`, `ws_connected=True`, 38 markets, 3 motors OFF, `trading_enabled=False`, V2 OFF |

**Drift cheatsheet vs código documentado** — ver [[pre-flight-checklist-2026-05-27]]. Update al cheat-sheet pendiente como deuda menor.

**Gate pendiente al cierre del log:** confirmación de RECEPCIÓN del Telegram en cliente (API solo confirma 200, no entrega). Sin esa confirmación NO se flippea el flag.

## Estado al cierre del log (15:00 UTC aprox)

| Gate | Estado |
|---|---|
| Backup íntegro persistido | ✅ |
| Canal Telegram API funcional | ✅ |
| **Recepción Telegram (cliente)** | ⏳ **bloqueante, pendiente tu confirmación** |
| WS conectado y capturando | ✅ |
| Trading & motores OFF | ✅ |
| V2 actualmente OFF | ✅ |
| Lección 9 pusheada a `KALSHI_BOT_CONTEXT.md` | ⏳ pendiente confirmación SHA |

## Próximos pasos en la ventana (cuando se confirme Telegram + SHA)

1. Web Agent flippea `USE_ORDERBOOK_MANAGER_V2: false → true` en Coolify
2. Confirmar `MOTOR_1_ARBITRAGE_ENABLED=false` y `TRADING_ENABLED=false` antes de Save
3. Save + Redeploy
4. Monitorear logs esperando `OrderbookManagerV2 registered (data-capture only, no Motor 1)`
5. T+5min: aplicar línea defensiva (1 error no-SidGap = rollback)
6. T+30min: snapshot completo `/status` + grep de errores
7. T+2h: aplicar criterios de éxito del runbook literal

## Criterios de éxito (T+2h, runbook literal)
- [ ] Cero ERROR nuevos relacionados a orderbook/manager/V2
- [ ] SidGapError rate sostenido < 5/min
- [ ] `_take_snapshots` completando 38/38 cada ~5 min
- [ ] `/status` muestra `books_initialized` subiendo hacia 38

## Criterios de rollback (cualquiera dispara)
- [ ] >3 errores NO-SidGap en 10 min (criterio que disparó rollback el 25-may)
- [ ] SidGapError > 20/min por más de 5 min
- [ ] `tracked_markets` < 35
- [ ] `capture_running=false` o `ws_connected=false` >60s
- [ ] Cualquier CRITICAL o excepción nueva
- [ ] **(Lección 9):** entre T+5 y T+30, 1 solo error no-SidGap adicional = rollback inmediato

## Métrica de éxito específica para ESTA ventana
**No solo "no falla" sino "no falla por la razón que arreglamos".** Si vuelven a aparecer `qty<0` con magnitudes similares → H1 (`size=0`) no era el único bug, reabrir investigación con raw snapshot logging que ya capturará evidencia.

## Workflow multi-agent observado hoy

| Capa | Rol hoy |
|---|---|
| **Gemini (CTO)** | Recomendó Opción A condicionada a disponibilidad, descartó Opción C, ejecutó pre-flight |
| **Claude (yo, review)** | Revisión sobria del diff, agregué 2 adiciones de Lección 9 al cheat-sheet, gate Telegram recepción |
| **Claude Code** | Ejecutó pre-flight (backup + Telegram + /status), reportó drift `alert_info` vs código |
| **Web Agent** | Prompt listo para flippear en Coolify, esperando luz verde |
| **Yo (Noel)** | Decisiones operativas + confirmaciones de gate |

**Patrón validado nuevamente:** la disciplina de pre-flight literal (no saltarse pasos por momentum) es el mecanismo de Lección 9 aplicado en frío. Anoche se documentó como teoría; hoy se ejecuta.

## Artefactos relacionados
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — primera ventana (rollback)
- [[sesion-2026-05-26-fix-merge-y-cierre-disciplinado]] — cierre disciplinado del 26
- [[cheatsheet-runbook-12.5-v2-activacion]] — cheat-sheet operativo finalizado
- [[inspeccion-apply-snapshot-msg-paths-excepcion]] — validación técnica del swap
- [[decision-2026-05-27-activar-v2-segunda-ventana]] — decisión formal
- [[pre-flight-checklist-2026-05-27]] — ejecución del pre-flight
- [[leccion-9-canonica-kalshi-bot-context-md]] — lección aplicada en práctica hoy
- [[fix-v2-opcion-a-implementado-commits]] — fix ya en main
- [[kalshi-bot]] — proyecto raíz

## Nota sobre el ticker count (38)
3 días consecutivos perdiendo 1 ticker (40 → 39 → 38) sin reemplazo. No es bloqueante para esta ventana — el market selector probablemente está cerrando partidos sin abrir nuevos. **Ticket de discovery aparte para otra ventana:** confirmar empíricamente que el market selector rota mercados nuevos correctamente cuando termina la ventana de los actuales.
