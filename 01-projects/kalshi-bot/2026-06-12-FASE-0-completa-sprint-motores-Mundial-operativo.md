---
tipo: sesion-resumen-sprint
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-12
tags:
  - kalshi
  - motor-rest
  - motor-2
  - motor-3
  - riskmanager
  - settlement
  - kill-switch
  - mundial
  - fase-0
  - sprint-motores
  - 2026-06-12
estado: fase-0-codigo-completo · esperando-deploy-unico
frente: "FASE 0 (los frenos) completa de código — falta merge + shapes + ventana del deploy único"
deadline: ventana de deploy (a elegir)
---

# 2026-06-12 — De "el cable existe" a "los frenos funcionan"

## Estado en una línea
**FASE 0 (los frenos) completa de código.** Motor REST listo para encender con
RiskManager que VE, stop-losses que DISPARAN y kill-switch que SOBREVIVE reinicios.
Falta: merge #40/#41 + shapes settlement + ventana del deploy único.

---

## 🔍 Los 3 hallazgos de la verificación adversarial (antes de que costaran plata)

### 1. RiskManager CIEGO al Motor REST

- Stop-losses leen `Trade` settled+pnl (`manager.py:148`)
- Exposición lee pending/filled (`manager.py:95`)
- **El cable del Motor REST no escribía `Trade`** → una racha mala **no activaba NINGÚN freno acumulado**

### 2. Kill-switch volátil

- `BotState.is_paused` era memoria pura para TODOS los motores
- Con Coolify `restart: unless-stopped`, un reinicio **des-pausaba el bot con la pata expuesta**
- *"Un kill-switch que se des-pausa solo no es un kill-switch."*

### 3. Settlement greenfield

- **NADIE pasaba trades a `settled`** en todo el codebase
- La escalera −3/−8/−15% era literalmente **incapaz de disparar**, también para Motor 1

**Cuarto bug del path de capital descubierto antes de que costara dinero.** Junto con
los 3 attempts V2 (rolledback), el bug latente del executor #14, el sensor con campos
inexistentes, y el KILL como HTTP 409 — la serie continúa, esta vez en los frenos.

---

## 🏗️ Lo construido (PRs de estas sesiones)

| PR | Pieza | Estado |
|---|---|---|
| #31 | EdgeWindow: count/fees/edge_pct + **primer ALTER de la historia** (migración idempotente en init_db) | ✅ main |
| #32 | **Kill-switch persistente** (tabla `OperationalState`, rehidratación al boot, despausa SOLO manual vía `clear_kill_switch.py`) | ✅ main |
| #33 | **Harness E2E de `execute()`** — 5 rutas contra shapes reales | ✅ main |
| #34-#37 | **Motor 2 analítico completo**: no_vig (multiplicativo+aditivo) · Odds API client (backoff 60s, tipado) · matcher (4 reglas + acentos NFKD) · detector (edge >3pp post-fee, ¼ Kelly cap 5%) | ✅ main |
| #38 | **A.1 — Trade persistence en RestExecutor**: arb_id, intents PRE-red (abort si falla), rollback→settled pnl<0 inmediato, expuesta→filled visible, pausa preventiva | ✅ main |
| #39 | **PR-B — Settlement core**: transacción atómica por arb (pérdida fantasma IMPOSIBLE), poller supervisado, `KalshiSettlementSource` stub `[shapes]` | ✅ main |
| #40 | **Deuda RiskManager**: lock de clase (race), descuento de arbs hedged (sobrestima), 9 tests de integración (escalera dispara con pnl real de AMBOS motores) | 🟡 draft |
| #41 | **P2 — Discovery por prefijo real + re-discovery 6h** (cierra el misterio KXFIFAGAME + markets nuevos sin restart) | 🟡 draft |

---

## ⚽ El Mundial (lo operativo)

### P1 confirmado: el bot NO trackeaba el Mundial antes del fix
- Los prefijos eran series exactas; **faltaban `KXWC*`/`KXFIFA*`**
- Fix #30 → **1.2M eventos/día**, **89% Mundial**, pico **213k/hora**

### Infra validada bajo fuego
- **0 locks** (WAL hizo su trabajo) ✅
- **0 errores** ✅
- Watchdog auto-recuperó **2 veces** ✅
- Cadencia ticker: **20× (6-7 ticks/seg)** ✅
- `size_real` discriminando en vivo (peor caso 186/200) ✅

### Negocio binario = 0 (dato real)
Mercados de selección bien arbitrados, **la comisión come el spread**.
→ El negocio del fútbol está en **P3 multi-outcome** (`detect_multi_outcome_arb` existe en el código, sin usar — diseño pendiente).

### KXFIFAGAME nunca apareció
→ P2 (#41) lo resuelve de raíz: **familias por prefijo** + re-discovery 6h
→ markets nuevos sin restart.

---

## 📋 Decisiones / overrides registrados

- **Demo CANCELADA** (orden de Noel): se construye directo sobre producción; red de seguridad = `TRADING_ENABLED=false` + `KALSHI_ENV=production` (solo captura).
- **Sizing arb = caps, cero Kelly** (p≈1 rompe Kelly).
- **Motor 2 SÍ usa ¼ Kelly** (probabilístico, p<1 con incertidumbre).
- **PnL realized-only se documenta, NO se redefine** (semántica financiera de Noel).
- **Deploy NO en caliente**: todo FASE 0 entra en UNA ventana → el reloj de 7 días arranca una sola vez sobre el código final.
- pnl del rollback a precios límite (sesgo conservador) `[verificar: get_fills]`.
- Coid con sufijo `-yes/-no` (40 chars) `[verificar en smoke]`.

---

## 🎯 El plan de los 3 motores (aprobado, en ejecución)

```
FASE 0 frenos ✅ código  →  FASE 1 Motor REST ON  →  FASE 2 Motor 2 cable  →  FASE 3 Motor 3
```

### Motor REST (el que ya tiene cable + frenos)
Cable completo + frenos completos → solo falta deploy + smoke + 7 días.

### Motor 2 (analítica completa, falta cable)
- Analítica: ✅ #34-#37
- Falta: **fuente de quotes Kalshi**, **poller shadow**, **ODDS_API_KEY** ($30-60/mes — decisión Noel), **executor 🔴** (diseño → review)

### Motor 3 (greenfield)
**Hueco de diseño:** ¿quién ABRE las posiciones que el exit CLV cierra? (decisión Noel antes de codear).

---

## ✅ Pendientes de Noel (lo único que falta para encender)

- [ ] Merge **#40** (deuda RM) y **#41** (P2)
- [ ] Correr snippet de **shapes settlement** (read-only, 2 min, está en el chat)
      → Claude llena `KalshiSettlementSource` + cablea el poller (1 sesión)
- [ ] Elegir **ventana del deploy único** (una sola interrupción de captura)
- [ ] Post-deploy: smoke `place_order` (1 contrato) → 7 días → `TRADING_ENABLED=true` con `ACTIVE_CAPITAL_USD` conservador

---

## Runbooks vivos

- `docs/runbook_kill_switch.md` — kill-switch 3am: NO reiniciar, posiciones, CLEAR
- `docs/checklist_activacion_capital.md` — gates de capital al día

---

## El arco entre 07-jun y 12-jun (recap)

Del 07-jun (shadow encendido, `edge_windows=0`, "VIVO ≠ GRABANDO") al 12-jun (FASE 0 código completo, Mundial corriendo en vivo) hubo 5 días de sprint denso:

- **Misterio KXFIFAGAME → P1 cazado:** los prefijos del discovery eran series EXACTAS (`KXNBA-26-NYK`), no familias (`KXNBA*`). El bot ni siquiera trackeaba el Mundial porque las familias `KXWC*`/`KXFIFA*` no estaban en la lista. Fix #30 → tracking habilitado, 1.2M eventos/día confirmados, 89% Mundial. **Lección operativa:** asumir que "el discovery funciona" sin verificar la lógica del filtro era el equivalente al fantasma del code 8 — un supuesto sin evidencia.
- **Negocio binario = 0:** Mundial corriendo bajo carga real, infra impecable, parser leyendo size, cadencia 20× — **y CERO arbs binarios cruzaron el umbral neto post-comisión.** Confirmado con data, no con teoría. La comisión efectivamente come los spreads del top-of-book en mercados de selección bien arbitrados. **El negocio no está en lo binario — está en lo multi-outcome.**
- **Verificación adversarial del RiskManager:** antes de prender el cable de ejecución, revisión cruzada destapó que el RiskManager era CIEGO al Motor REST (stop-losses leen `Trade` settled+pnl, y el cable no escribía Trade). Una racha mala no activaba NINGÚN freno acumulado. Fix en #38 + #40.
- **Kill-switch volátil cazado:** `BotState.is_paused` era memoria. Con Coolify `restart: unless-stopped` un reinicio des-pausaba el bot con la pata expuesta. Fix #32: persistencia en `OperationalState`, rehidratación al boot, despausa SOLO manual vía script. *"Un kill-switch que se des-pausa solo no es un kill-switch."*
- **Settlement greenfield:** investigando por qué la escalera de stop-loss no se ejercitaba en tests, hallazgo: **NADIE pasaba trades a `settled` en todo el codebase**. El detector de pérdidas estaba escuchando un canal vacío por diseño. Fix #39: transacción atómica + poller supervisado + stub para shapes de Kalshi.
- **Motor 2 analítico completo:** no_vig (multiplicativo + aditivo), Odds API client tipado con backoff, matcher con 4 reglas y acentos NFKD, detector con edge >3pp post-fee + ¼ Kelly + cap 5%. PRs #34-#37. Falta el cable de ejecución (después del Motor REST validado).
- **Demo cancelada:** decisión de Noel. Construimos directo sobre producción con `TRADING_ENABLED=false` como red de seguridad. Razonamiento: la demo tampoco simula la microestructura real, y el shadow ya nos da los números que necesitamos. Mejor un solo entorno bien instrumentado que dos parcialmente verificados.
- **Deploy NO en caliente:** todo FASE 0 entra en UNA ventana → el reloj de 7 días arranca una sola vez sobre el código final. Disciplina aprendida de V2: cada redeploy reinicia la captura sana de V1, queremos minimizar reinicios.

---

## Aprendizajes meta de este sprint

- **"El cable existe ≠ los frenos funcionan."** Tener el Motor REST escribiendo trades NO basta si el RiskManager no los lee. Tener un kill-switch NO basta si no sobrevive un reinicio. Tener una escalera de stop-loss NO basta si nada nunca pasa a `settled`. **Cada componente del path de capital se verifica end-to-end contra el siguiente, no en aislamiento.**

- **El cuarto bug del path de capital descubierto antes de costar dinero.** Junto con (1) los 3 attempts V2 rolledback, (2) el Issue #14 del executor heredado, (3) el sensor con campos inexistentes, (4) el KILL como HTTP 409 — esta vez 3 bugs en los frenos. **El patrón se mantiene: la verificación adversarial sigue valiendo cada hora invertida.**

- **El negocio puede no estar donde lo asumiste, y eso se descubre solo midiendo.** Asumimos que el Mundial daría arbitrajes binarios (la teoría de la dilatación lo sostenía). La realidad del Mundial: binario = 0 porque la comisión come el spread en mercados de selección bien arbitrados. **El negocio está en multi-outcome — descubrirlo ahora, en shadow con cero riesgo, en vez de en producción con capital, es exactamente lo que la disciplina compró.**

- **"Demo cancelada" no es falta de disciplina — es disciplina aplicada al gate correcto.** El demo no nos daba info que el shadow no nos diera. Multiplicar entornos no multiplica certidumbre cuando ambos son aproximaciones imperfectas del régimen real. Mejor un solo entorno bien instrumentado.

- **Discovery por familias > discovery por exactos.** El misterio KXFIFAGAME no era de Kalshi — era del filtro de discovery del bot. Las familias por prefijo (`KXFIFA*`) más re-discovery cada 6h cierran tanto el agujero como la dependencia de restart para tomar markets nuevos.

---

## Estado consolidado al cierre del 12-jun

| Frente | Estado |
|---|---|
| V1 baseline | ✅ SANO continuo, 1.2M ev/día (89% Mundial) |
| Motor REST shadow | ✅ Corriendo, cable completo, frenos completos |
| Negocio binario en Mundial | ❌ = 0 (esperado por comisión vs spread) |
| RiskManager arreglado (#38, #40 draft) | 🟡 #38 main, #40 draft |
| Kill-switch persistente (#32) | ✅ En main, `OperationalState` |
| Settlement core (#39) | ✅ En main, stub `KalshiSettlementSource` pendiente shapes |
| Harness E2E execute() (#33) | ✅ En main, 5 rutas |
| Motor 2 analítico (#34-#37) | ✅ En main, falta cable |
| Discovery por prefijo (#41) | 🟡 draft |
| EdgeWindow ampliado (#31) | ✅ En main, primer ALTER del proyecto |
| Demo | ❌ Cancelada (orden Noel) |
| TRADING_ENABLED | 🔒 false hasta smoke + 7 días post-deploy |
| Capital | 🔒 Cero |
| Próximo paso | Merge #40 + #41 → ventana deploy único → smoke `place_order` 1 contrato |

---

## Pendiente preguntado al cierre

> *"¿Querés que agregue una sección con los números del reporte post-jornada (la tabla de eventos/hora del Mundial) o lo dejás como nota operativa aparte?"*

Decisión a tomar: integrar la tabla aquí o crearla como nota separada referenciable desde acá. **Recomendación:** nota separada con prefijo de fecha (`2026-06-12-Mundial-jornada-1-metricas.md` o similar) — las tablas de métricas operativas envejecen distinto que las decisiones de arquitectura, y NotebookLM las puede ingerir mejor por separado.

---

## Links
- [[kalshi-bot]]
- [[2026-06-07-sesion-Motor-REST-encendido-SHADOW-WAL-fix]] — sesión inmediatamente previa (shadow encendido + WAL)
- [[2026-06-06-sesion-fantasma-V2-shadow-listo-error-data-capture]] — pre-flight que cazó SQLite
- [[2026-06-05-sesion-FOKExecutor-sensor-validado-API-viva]] — sensor en 3 rutas (#22 ahora en main)
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — la decisión arquitectónica
