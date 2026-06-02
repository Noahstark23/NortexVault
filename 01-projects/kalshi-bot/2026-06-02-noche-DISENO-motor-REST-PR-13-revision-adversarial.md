---
fecha: 2026-06-02
tipo: diseno-en-revision
proyecto: kalshi-bot
componente: Motor-REST
pr: '#13'
branch: docs/motor-rest-design
estado: DISENO-APROBADO-EN-DIRECCION-2-bloqueantes-cerrados
tags:
  - diseno
  - motor-rest
  - kalshi-bot
  - 2026-06-02
  - pr-13
---

# 📐 Diseño Motor REST — PR #13 + revisión adversarial

> Diseño en texto del Motor REST, entregado por Claude Code con auto-marca honesta de 6 puntos débiles (§7). Revisión adversarial identificó el bloqueante real (ejecución de dos patas) que el resto del diseño hacía fácil pasar por alto. Ambos bloqueantes cerrados con Gates 0 y 0.5.

## El diseño en una pasada

**Filosofía:** detección barata por WS, ejecución cara por REST solo cuando vale.

```
┌──────────────────────────────────────────────┐
│ DETECCIÓN — WS canal `ticker` SOLAMENTE     │
│ (sin orderbook_delta, sin estado in-memory) │
│ Mata la clase entera de bugs de V2          │
└──────────────────┬───────────────────────────┘
                   │ spread crudo del ticker cruza umbral grueso
                   ▼
┌──────────────────────────────────────────────┐
│ TRIGGER → throttle por-ticker (anti-429)    │
│ Falible a propósito: prefiere pedir de más   │
│ a perder ventanas                            │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│ EVALUACIÓN — get_orderbook REST              │
│ Parse → derivar asks → detect_binary_arb()   │
│ (Reusa path validado en bench_rest_arb_path) │
└──────────────────┬───────────────────────────┘
                   │ edge ≥ umbral fino
                   ▼
┌──────────────────────────────────────────────┐
│ EJECUCIÓN — gateada por:                     │
│ - RiskManager.check_pre_trade (NO reinventar)│
│ - umbral fino de edge                        │
│ - TRADING_ENABLED (False → modo SHADOW)      │
└──────────────────┬───────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────┐
│ INSTRUMENTACIÓN — tabla edge_windows         │
│ Cada ventana: duración, magnitud, outcome,   │
│ cycle_latency_ms, rest_rtt_ms                │
│ Calibra la captura neta en VIVO durante     │
│ Mundial, incluso en shadow                   │
└──────────────────────────────────────────────┘
```

## Por qué WS-ticker-only es la jugada que MATA la clase de bugs de V2

**Sin orderbook_delta:**
- ❌ Sin buffer (no hay `_bootstrap_buffer` ni `_pending_deltas`)
- ❌ Sin seq (no hay `_last_seq_by_sid`)
- ❌ Sin desync (no hay state mutable in-memory que se pueda corromper)
- ❌ Sin recovery (no hay `_recovering`, no hay supervisor que pueda colgarse)
- ❌ Sin bootstrap frágil (no hay ventana ciega de inicialización)
- ❌ Sin ventana Q3 (no hay "modo de cuelgue permanente si snapshot no vuelve")

**Toda la fortaleza B1+A2 desaparece porque el problema desaparece.**

El WS es solo la campana. El estado del orderbook se construye on-demand vía REST cuando hay edge candidato.

## Componentes del diseño

### Módulo nuevo
- `src/strategies/motor_rest_arb/` (separado de V2)
- Flag nuevo: `MOTOR_REST_ENABLED=False`
- NO toca `orderbook_manager_v2.py`
- NO toca `executor.py` directamente (ver bug aislado)

### Detección
- Suscripción WS al canal `ticker` solamente
- Filtro a tickers del Mundial (parametrizable)
- Trigger: spread crudo (`yes_ask + no_ask`) < umbral grueso

### Trigger (anti-429)
- Throttle por-ticker (intervalo mínimo entre GETs del mismo mercado)
- **PENDIENTE:** throttle global anti-429 además del por-ticker (gol = ráfaga simultánea de triggers)

### Evaluación
- `get_orderbook(ticker, depth)` — `KalshiRestClient` existente
- Parse del shape REST (`yes`/`no` arrays como bids)
- Derivar asks: `yes_ask = 100 - best_no_bid`, `no_ask = 100 - best_yes_bid`
- `detect_binary_arb()` — función existente
- Umbral fino de edge (parametrizable, calibrable en shadow)

### Ejecución
- **Solo si `TRADING_ENABLED=True`** y `RiskManager.check_pre_trade()` aprueba
- Ejecutor FOK nativo en ambas patas (decisión arquitectónica del Gate 0.5)
- Si `TRADING_ENABLED=False` → modo SHADOW (detecta, evalúa, loggea, NO ejecuta)

### Instrumentación — el corazón
Tabla `edge_windows` con cada ventana detectada:
- `ticker`, `timestamp_detection`, `timestamp_execution`
- `yes_ask`, `no_ask`, `edge_cents`, `magnitude`
- `cycle_latency_ms` (detección → decisión completa)
- `rest_rtt_ms` (GET puro)
- `outcome` (filled / partial / rejected / not_attempted)
- **PENDIENTE:** capturar fill de AMBAS patas, no solo detección

**Mide captura NETA real del Mundial en vivo, incluso en shadow, para calibrar antes de arriesgar capital.**

## Los 6 puntos auto-marcados por Claude Code (§7)

Claude Code marcó los puntos débiles ÉL MISMO en el diseño, en vez de esconderlos:

1. **Shape del mensaje ticker no verificado** — todo el trigger depende, no hay fixture
2. **Race trigger→REST** — el book se mueve en los ~100ms del RTT
3. **Ejecución de 2 patas** — ¿reuso executor.py FOK+rollback o algo más simple?
4. **429 bajo ráfaga de goles** — un gol mueve muchos mercados simultáneo
5. **Calibración de umbrales en shadow** — no se calibran sin data real
6. **Reuso de RiskManager** — confirmar que sus invariantes (stop-loss, sizing 5%) aplican

**Esa honestidad técnica permitió que la revisión adversarial atacara el correcto, no perdiera tiempo en cosméticos.**

## Revisión adversarial — el bloqueante REAL identificado

### Bloqueante #1: ejecución de 2 patas (punto 3) — RIESGO FINANCIERO CENTRAL

**El escenario:**
1. Detectás arb: `yes_ask 45c` + `no_ask 50c` = 95c (edge 5c)
2. Mandás orden pata `yes` a 45c → **se llena**
3. Mandás orden pata `no` a 50c → pasaron 60ms, mercado se movió, `no_ask` ahora 53c

**Resultado:**
- Posición `yes` comprada a 45c (pata sola)
- Arb evaporado (45 + 53 = 98, sin edge)
- **Exposición direccional pura** — apostaste a "yes gana" sin cobertura

**Esto NO es detalle de implementación — es el RIESGO CENTRAL del Motor REST.** El arbitraje es sin riesgo SOLO si capturás ambas patas al precio esperado. Una sola → te volviste apostador direccional con capital real.

### Cierre del Bloqueante #1 (Gate 0.5)

**Decisión arquitectónica del ejecutor:**

| Opción | Descripción | Veredicto |
|---|---|---|
| (A) FOK ambas patas | Si una falla, ambas se cancelan. Cero exposición. | ✅ **ELEGIDO** |
| (B) Primera pata + rollback | Captura más, riesgo de pérdida en rollback | ❌ Es el BUG del executor.py |
| (C) IOC | Fallback documentado | ⏸ Reserva |

**Validado por Gate 0.5:** Kalshi soporta FOK nativo vía `time_in_force: "fill_or_kill"`.

Ver [[2026-06-02-noche-GATES-0-y-0-5-CERRADOS-shape-ticker-y-FOK]] y [[2026-06-02-noche-BUG-executor-limit-resting-Issue-14]].

### Bloqueante #2: shape del mensaje ticker (punto 1)

**Cerrado por Gate 0** — ticker trae BBO completo + sizes. Trigger por spread vive.

### Los otros 4 puntos clasificados

**Punto 2 (race trigger→REST):** No bug, pregunta empírica. Se mide por instrumentación en vivo. Aceptado como riesgo medido si la instrumentación captura el fill de ambas patas.

**Punto 4 (429 bajo ráfaga):** Riesgo real, mitigable, NO bloqueante. **MEJORA pendiente:** throttle global + estrategia ante 429 (¿priorizar mayor edge?).

**Punto 5 (calibración shadow):** NO es debilidad — es FORTALEZA del diseño. Modo shadow (`TRADING_ENABLED=False`) permite calibrar umbrales con data real del Mundial sin arriesgar capital.

**Punto 6 (reuso RiskManager):** Correcto, NO reinventar. Solo confirmar que invariantes (stop-loss, sizing 5%) aplican igual al Motor REST.

## Mejoras incorporadas al diseño post-revisión

1. **Throttle global anti-429** + estrategia ante 429 (¿priorizar mayor edge?) — punto 4
2. **Instrumentación captura fill de AMBAS patas**, no solo detección — refuerzo punto 2

## Por qué el diseño es genuinamente bueno

**El Motor REST es dramáticamente más simple que V2:**
- Sin orderbook in-memory
- Sin supervisor de recovery
- Sin máquina de estados con bootstrap frágil
- Sin cooldowns de evicción
- Sin "anti-zombie" wrapper

**PERO tiene su propio punto crítico:** ejecución de dos patas antes de que se mueva el mercado.

**Ninguna arquitectura es gratis.** REST mueve la dificultad de "mantener estado sincronizado" (V2) a "ejecutar dos patas antes de que se mueva" (REST). La diferencia:
- El segundo problema es más **acotado** (1 decisión por arb, no estado continuo)
- Más **testeable en shadow** (data real, sin capital)
- NO tiene la fragilidad de bootstrap (no hay ventana ciega)
- Y ahora cerrado con FOK nativo (Gate 0.5)

**Es el trade correcto.**

## El modo SHADOW como red de seguridad central

**`TRADING_ENABLED=False` durante todo el Mundial inicial:**
- Detecta edges
- Computa decisiones
- Loggea todo en `edge_windows`
- **NO ejecuta órdenes reales**

**Permite calibrar en VIVO:**
- Umbral grueso del trigger
- Umbral fino de ejecución
- Throttles
- Captura neta real (con RTT y profundidad reales)

**Sin riesgo de capital, con data del régimen real (no proxy).**

Solo cuando los números de shadow confirman que el ciclo ejecuta bien → activar `TRADING_ENABLED=True` con decisión consciente.

## Estado en repo

- **PR #13 draft** abierto: https://github.com/Noahstark23/botkalshi/pull/13
- **Doc:** `docs/motor_rest_design.md`
- **Branch:** `docs/motor-rest-design` (separada del frente de gaps PR #12)
- **CI:** rojo por deuda pre-existente (ruff/test_runner repo-wide), NO accionable
- Doc-only, cero cambios en `src/`

## Validación contra el feed/API REAL (no contra teoría)

**Tres ejes validados esta sesión:**

| Eje | Validación |
|---|---|
| Datos históricos | 7.9M eventos → captura 73% en Q5 (02-jun previo) |
| Feed real (WS) | Gate 0: ticker trae BBO + sizes |
| API real (REST) | Gate 0.5: FOK nativo disponible |

**Cero supuestos en la decisión arquitectónica.** Todos los pilares medidos.

## Próximos pasos del diseño (con disciplina del gate)

1. ✅ Gate 0 y 0.5 cerrados → bloqueantes despejados
2. ⏳ **Diseño del ejecutor FOK en texto** — cuando haya energía fresca
3. ⏳ Review adversarial del diseño FOK
4. ⏳ Implementación en modo shadow con review del diff
5. ⏳ Tests offline del path completo
6. ⏳ Deploy demo (no production)
7. ⏳ Gate validación bajo carga (mercado activo)
8. ⏳ 11-jun kickoff Mundial — bot vivo en shadow

## Decisiones pendientes

### Decisión de negocio: umbral del trigger
- ≥3c: alto volumen, riesgo de ruido
- ≥10c: balance
- ≥20c: solo gordos (54% NBA, los más valiosos)

**Ahora con sizes en el ticker, el umbral puede ser de precio Y profundidad.**

**Recomendación implícita:** "calibrar en shadow" es respuesta válida — arrancar conservador (≥10c + filtro profundidad mínima) y ajustar con data real del Mundial.

### Decisión técnica diferida
**Throttle global ante 429** — no urgente, definir antes de implementación.

## Links
- [[2026-06-02-noche-sesion-gates-cerrados-cierre-disciplinado]] — sesión
- [[2026-06-02-noche-GATES-0-y-0-5-CERRADOS-shape-ticker-y-FOK]] — bloqueantes cerrados
- [[2026-06-02-noche-BUG-executor-limit-resting-Issue-14]] — bug que motivó decisión FOK
- [[2026-06-02-noche-GATE-pendiente-validacion-bajo-carga-mundial]] — gate calendario
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — decisión arquitectónica del 02-jun previo
- [[2026-06-02-DATA-tres-chequeos-edge-RTT-captura-73]] — análisis empírico base
- [[kalshi-bot]]
