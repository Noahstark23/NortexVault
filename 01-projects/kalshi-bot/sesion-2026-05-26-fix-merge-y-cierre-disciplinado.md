---
fecha: 2026-05-26
tipo: sesion-conmigo
proyecto: kalshi-bot
ia: Claude + Claude Code
modelo: multi-agent workflow
tags:
  - sesion-conmigo
  - kalshi-bot
  - post-incidente
  - fix
  - leccion-9
---

# 26-may — Fix V2 mergeable, Lección 9 canónica, cierre disciplinado

> Día siguiente al incidente del 25-may. Confirmación de V1 estable, validación del fix de Claude Code, redacción de Lección 9 para el repo, y decisión explícita de NO reactivar V2 hoy.

## Contexto
Después del rollback de V2 ayer (ver [[sesion-2026-05-25-v2-activacion-y-rollback]]), el día de hoy operó en V1 sin novedad. Claude Code completó el brief de Opción A. La sesión cubrió: status check, verificación del fix, redacción de Lección 9 canónica, decisión sobre cuándo reactivar.

## Decisiones / conclusiones

### 1. V1 confirmado estable post-rollback (13h+)
Status snapshot a las 18:13:48 UTC tras 12h 50min de uptime:
- `USE_ORDERBOOK_MANAGER_V2=false`, `TRADING_ENABLED=false`, `MOTOR_1_ARBITRAGE_ENABLED=false`
- **289,986 events WS persistidos** en 13h
- Tasa: ~22,300 events/h = ~6.2 events/s sostenido
- Acumulado total: 4,590,874 eventos
- Snapshot REST cycles: 39/39 completados consistentemente
- **0 errores** desde el deploy actual (commit 9b809a6e)
- 4 warnings — todos pre-deploy, normales de shutdown graceful

Cambios observados vs ayer:
- **Mix multi-deporte:** ahora tracking 39 tickers entre KXMLB (MLB), KXUCL (Champions League fútbol) y KXNHL (hockey NHL). Antes solo MLB. Un mercado MLB salió de circulación (40→39).
- Tasa de eventos ~50% menor (~6 vs ~13 events/s) — consistente con horario vespertino y mix diferente. No es regresión.

### 2. Fix Opción A entregado por Claude Code

**Commits:** `ed7b7ac` (cambios lógicos) + `b9abaa0` (correcciones de formato/tests vs brief)

**Archivos modificados:**

| Archivo | Líneas | Cambio |
|---|---|---|
| `src/strategies/motor_1_arbitrage/orderbook_manager_v2.py` | 170-175 | Swap orden seq/apply en `handle_message` |
| ↑ | 343-348 | Logging INFO/DEBUG raw snapshot |
| ↑ | 415-416 | Filter `size=0` en `_parse_fp_levels` |
| `src/clients/kalshi_ws.py` | 320 | `logger.opt(exception=r).error(...)` en dispatcher |
| `tests/strategies/motor_1_arbitrage/test_v2_fixes.py` | nuevo | 4 tests del fix |

**Pytest: 282/282 ✓** (suite completa sin regresiones, 4 nuevos verdes).

### 3. Una desviación técnica justificada (loguru vs stdlib logging)
**Mi brief** especificó `exc_info=r` (patrón stdlib logging).
**Code descubrió** que el proyecto usa **Loguru** (declarado en KALSHI_BOT_CONTEXT.md §2). Loguru NO acepta `exc_info=` como kwarg en `.error()` — se ignora silentemente. Implementar el brief literal habría reproducido el mismo bug que estamos arreglando (log sin traceback, pero esta vez convencidos de tenerlo).

**Code escaló y aplicó la API equivalente correcta:** `logger.opt(exception=r).error(...)` — produce el traceback completo con la excepción capturada vía `return_exceptions=True`.

**Veredicto: desviación correcta.** Code aplicó la cláusula 6 (escalación) del brief, no improvisó scope, eligió cumplir la intención del brief (stack traces visibles) sobre la letra (kwarg específico). Este es el patrón que queremos en el workflow.

**Lección menor para mí:** el brief reveló mi bias hacia stdlib logging. Worth noting para futuros briefs que toquen logging.

### 4. Lección 9 canónica redactada para KALSHI_BOT_CONTEXT.md
Versión final, estructura paralela a Lecciones 4, 6, 7, 8. Cinco decisiones derivadas, cuatro anti-patrones confirmados, sección "Lo que sí funcionó" agregada (primera vez que se incluye en este formato).

Versión completa guardada en: [[leccion-9-canonica-kalshi-bot-context-md]]

Header del repo a actualizar:
- Versión: 1.4 → **1.5**
- Cambios v1.4 → v1.5: Lección 9 nueva, sección 11 (deuda técnica) actualizada con segunda ventana pendiente, sección 12.5 sin cambios (runbook validado empíricamente).

### 5. DECISIÓN: no reactivar V2 hoy
La pregunta de cierre de Code propuso dos opciones: re-activar hoy o correr más tests E2E. **Rechacé ambas.** Lección 9 acaba de documentar que el patrón "vamos directo a activar, ya entendimos el bug" es el anti-patrón a evitar. Activar hoy invalida la lección en el primer test de aplicarla.

Razones:
1. **Fatiga acumulada:** 24h operando esta ventana. Runbook 12.5 requiere 2-3h de supervisión activa atenta — la fatiga viola el espíritu del runbook validado hace 6 horas.
2. **El fix no respiró:** commits ed7b7ac/b9abaa0 son de hace <2h. Sin revisión sobria del diff. Mismo anti-patrón "el bug parece obvio, dame el fix" pero replicado en el otro extremo.
3. **V1 sano sin urgencia:** 0 errores en 13h, sin capital trabajando, Motor 1 no se activa hoy ni mañana. No hay nada que la urgencia compre.

Ver: [[decision-2026-05-26-no-reactivar-hoy]].

### 6. Lo que falta antes de la segunda ventana (no es trivial)
**Revisión sobria del diff** (no código nuevo, 20 min con cabeza fresca):
- Confirmar que el swap seq/apply en `handle_message:170-175` no afecta `_apply_snapshot_msg` que también se invoca desde `handle_message` post seq update. Si el snapshot también puede fallar, el swap solo cubre la mitad.
- Verificar manualmente que `logger.opt(exception=r).error(...)` produce el log esperado en Coolify (no solo en pytest). El cambio del wrapper podría dejar tests verdes con contrato divergente.
- Test #2 valida `last_seq_by_sid[sid]` intacto post-`OrderbookDesyncError`. Falta validar que el delta siguiente con seq correcta se procesa OK. Mitad estructural cubierta; falta validar mitad operativa.

## Próximos pasos
- [x] Mergear Lección 9 al KALSHI_BOT_CONTEXT.md con header v1.5
- [ ] Mergear PR del fix a main (si no está)
- [ ] Cierre de sesión hoy
- [ ] Mañana — revisión sobria del diff (los 3 puntos arriba, 20 min)
- [ ] Si revisión limpia → agendar ventana con 2–3h libres confirmadas, runbook 12.5 literal otra vez
- [ ] Si revisión revela algo → ticket Claude Code antes de re-activar
- [ ] Durante segunda ventana: misma línea defensiva ("1 error no-SidGap → rollback"), raw snapshot logging activo para capturar evidencia si vuelven qty<0

## Métrica de éxito específica para la segunda activación
No solo "no falla" sino **"no falla por la razón que arreglamos"**. El raw snapshot logging (cambio 2b del fix) es justo para distinguir.

Si vuelven a aparecer `qty<0` con magnitudes similares → H1 (bug `size=0`) no era el único, reabrir investigación con la evidencia ahora capturada.

## Artefactos relacionados
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — ventana original (activación + rollback)
- [[leccion-9-canonica-kalshi-bot-context-md]] — Lección 9 versión final para el repo
- [[leccion-9-runbook-literal-vs-interpretacion]] — versión operativa/conceptual previa (complementaria)
- [[diagnostico-v2-size-zero-bug]] — diagnóstico de la causa raíz
- [[fix-v2-opcion-a-implementado-commits]] — detalle del fix (commits, archivos, tests, desviación)
- [[decision-2026-05-26-no-reactivar-hoy]] — decisión formal de pacing
- [[decision-2026-05-25-fix-opcion-a]] — decisión arquitectónica del fix
- [[kalshi-bot]] — proyecto raíz (actualizado)

## Observación sobre el workflow multi-agent (refuerzo)
Hoy se validaron empíricamente DOS patrones del workflow:

1. **Claude Code escala incompatibilidades de API en lugar de aplicar brief literal.** Aplicación correcta de la cláusula 6.
2. **El operador humano (yo) rechazó la presión implícita de "activar hoy"** que venía del flujo natural de la sesión. La disciplina del runbook no se relaja porque sea conveniente — especialmente cuando es conveniente relajarla.

## Snippets útiles

Verificar status del bot vía /status (sin V2):
```bash
curl -s http://localhost:8080/status | python -m json.tool
```

Confirmar variables runtime:
```bash
docker exec kalshi-bot env | grep -E "USE_ORDERBOOK_MANAGER_V2|TRADING_ENABLED|MOTOR_1"
```

Log del proyecto del día:
```bash
docker exec kalshi-bot tail -f /app/logs/bot_$(date +%Y-%m-%d).log
```
