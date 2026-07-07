---
tipo: sesion-implementacion
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-26
repo: Noahstark23/botkalshi
rama: claude/nifty-darwin-2s7wm
tags:
  - kalshi
  - motor-3
  - take-profit
  - trailing-stop
  - underdog-filter
  - shadow-first
  - risk-event-audit
  - 2026-06-26
estado: mergeado-en-main / pendiente-activar-flags
prs: [103, 104, 105]
relacionado:
  - "[[2026-06-23-parte-2-F1-auto-sync-capital-PR-100-en-progreso]]"
  - "[[2026-06-21-botkalshi-arquitectura-completa-sistema-rentable]]"
---

# 2026-06-26 — Motor 3 con salidas inteligentes (take-profit + trailing + underdog filter)

## TL;DR

Construí y mergeé el sistema de **salidas por precio** de Motor 3 (antes el 100% iba a
settlement, `closed_by_clv=0` en 1.620 trades). Todo entró **shadow-first** (flags default
OFF): el merge **NO cambió nada en prod** hasta encender flags en Coolify. **3 PRs, ~666
tests verdes.**

---

## Qué problema resolvía

Análisis histórico (1.620 trades, semana 17-24 jun):

- **Sin take-profit** → un ticket al ~90% se remontó a pérdida total. Caso real: ganancia
  evaporada por no salir a tiempo.
- **Underdogs <40¢ sangraron −$110,77.** Los favoritos altos (consensus apuesta al ganador)
  funcionan; los underdogs (consensus apuesta al perdedor a precio bajo) son el componente que
  más pierde del Motor 2.
- **`risk_events` vacío** → pausas por stop-loss sin auditoría. El sistema pausaba pero no se
  podía reconstruir POR QUÉ.

**Patrón común a los 3:** falta de gestión post-entrada. El bot entraba bien (Motor 2 +69.5%
wr según snapshot 21-jun) pero salía mal (settlement = "esperar que se resuelva solo" en vez
de "salir antes si el precio lo justifica").

---

## PRs de la sesión

| PR | Qué | Estado |
|---|---|---|
| #103 | Capital autosync (C-02/C-03: capital base = cash real × factor, alerta de desfase) | ✅ Lo mergeaste vos |
| #104 | FASE 0.2 + FASE 1 + FASE 3 | ✅ merged |
| #105 | FASE 1 calibración + FASE 2 trailing | ✅ merged |

**El #103 (C-02/C-03) cierra el F1 del roadmap** que arrancó el 23-jun con #100 (C-01).
Auto-sync completo: base + factor + alerta. Solo C-04 (tests edge cases) queda pendiente del F1.

---

## Fases (estado)

| Fase | Qué | Estado |
|---|---|---|
| 0.1 | capital 1500→1200 (`ACTIVE_CAPITAL_USD`, `KALSHI_INITIAL_BANKROLL`) | ⏳ pendiente, solo Coolify |
| 0.2 | auditoría `RiskEvent` al pausar por stop-loss | ✅ #104 |
| 1 | take-profit por precio (bid ≥ umbral) | ✅ #104 |
| 1c | script de calibración + runbook | ✅ #105 |
| 2 | trailing stop (retroceso del bid desde el pico) | ✅ #105 |
| 3 | filtro underdog <40¢ (Motor 2) | ✅ #104 |
| 4 | Motor 1 (`action required` Kalshi) + `MOTOR_REST_ENABLED=false` | ⏳ pendiente, decisión/Coolify |

**Capital 1500→1200** es una baja deliberada (parte 1 del 23-jun había subido a $1500 — ahora
con la calibración del mes en marcha y los nuevos filtros, baja para tener más margen sobre el
hard cap $5k y para reducir varianza durante la prueba shadow de los nuevos detectores).

---

## Decisiones clave (para recordar)

### Gating de 2 capas (patrón del repo)

- `*_ENABLED` = **detecta + loguea** (shadow)
- La venta la gatea `MOTOR_3_EXECUTION_ENABLED` vía la existencia del executor (**Capa A**)
- `place_order` **NO** frena `sell` con `TRADING_ENABLED=false` → la protección shadow es
  **Capa A**, no el muro global

**⚠️ Esto es importante:** TRADING_ENABLED=false protege BUYS pero no SELLS. La protección
shadow del Motor 3 vive en que el executor no exista (Capa A), no en el muro global. Si en el
futuro alguien refactoriza place_order para frenar también sells, la lógica de gating cambia.

### Restart-survival ya existía

La pausa sobrevive reinicios vía `OperationalState` + `_rehydrate_kill_switch`. **FASE 0.2 fue
solo auditoría (`RiskEvent`), no restore.** El bot ya restauraba kill-switch al boot desde el
sprint del 12-jun (PR #32). Hoy solo se agregó el insert de `RiskEvent` cuando se pausa, para
auditoría retroactiva.

### Take-profit en shadow necesita cliente

El engine ahora abre `KalshiRestClient` **read-only siempre** (para leer el orderbook), aunque
no venda. Antes solo se abría si EXECUTION_ENABLED=true. Cambio sutil pero necesario: para
detectar "el bid llegó al umbral", el shadow tiene que poder leer el orderbook.

### Trailing solo protege ganancia

Se arma únicamente si `peak > entry`. **Las pérdidas las maneja el RiskManager**, no el
trailing. Esta separación de responsabilidades es importante:
- Trailing = "salir si bajamos del pico de ganancia" (protege ganancia ya capturada en mark)
- RiskManager = "salir si nos pasamos del stop diario/semanal" (protege capital total)

Si los mezclás, el trailing puede dispararse contra una pérdida normal del rango operativo y
forzar salidas malas. La separación es defensa en profundidad de un tipo distinto al muro de
capital.

### Entry del trailing = FIFO

Primer BUY filled, consistente con `_settle_originals`. **Alternativa documentada:** promedio
ponderado — cambio de una función. Si en el futuro hay múltiples entradas a precios distintos
para la misma posición, vale el cambio. Por ahora FIFO es coherente con el resto del sistema.

### Reuso, no reescritura

`Motor3ExitExecutor.exit_position()` (vende IOC + audita + cierra la pata original) se
reutilizó **sin tocarlo**. **`exit_position` NO recibe `reason`** (vive en el Outcome). Esto
es importante porque mantiene el contrato del executor estable — los nuevos motivos de salida
(take-profit, trailing) no rompen tests existentes.

**Patrón meta:** *"si el componente que tenés cubre el caso, no lo reescribas — agregá callers,
no parámetros al callee."*

### DB = SQLite + `_MIGRATIONS` propio en `models.py`

**NO Alembic, NO `.sql` sueltos.** La columna nueva se agrega ahí:
`("portfolio_positions","peak_bid_cents","INTEGER")`. Mismo patrón que el primer ALTER del
proyecto (PR #31, EdgeWindow count/fees/edge_pct). Migraciones idempotentes en init_db.

---

## Flags nuevos (Coolify) — agregás SOLO lo que querés sobrescribir

| Variable | Default | Para qué |
|---|---|---|
| `MOTOR_3_TAKE_PROFIT_ENABLED` | `false` | detecta take-profit |
| `MOTOR_3_TAKE_PROFIT_CENTS` | `90` | umbral del bid |
| `MOTOR_3_TRAILING_ENABLED` | `false` | detecta trailing |
| `MOTOR_3_TRAILING_DROP_CENTS` | `5` | retroceso ¢ desde el pico |
| `MOTOR_2_MIN_ENTRY_CENTS` | `40` | piso del filtro underdog |
| `MOTOR_2_UNDERDOG_FILTER_ENABLED` | `false` | off=loguea / on=bloquea |

**`docker-compose.yml` ya las define con `${VAR:-default}`** → si no las ponés, toman el
default (todo OFF). **Agregar variable = querer sobrescribir.**

Esto es el patrón "no requires action" — el operador puede mergear y deployar sin tocar nada,
y el sistema se comporta exactamente igual que antes. Solo cuando QUIERE encender una feature,
agrega la variable. **Defense in depth contra cambios no intencionales.**

---

## Runbook de activación (shadow → live, sin riesgo)

1. **Encender detectores en shadow:**
   - `MOTOR_3_CLV_ENABLED=true`
   - `MOTOR_3_TAKE_PROFIT_ENABLED=true`
   - `MOTOR_3_TRAILING_ENABLED=true`
   - Todo con `MOTOR_3_EXECUTION_ENABLED=false` (no vende)

2. **Dejar correr días.** Juntar logs:
   - `[MOTOR 3 TP SHADOW]`
   - `[MOTOR 3 TRAIL SHADOW]`
   - Correr `python scripts/calibrar_take_profit.py` en el contenedor

3. **Fijar umbrales con esos datos:**
   - `MOTOR_3_TAKE_PROFIT_CENTS` (90 es placeholder)
   - `MOTOR_3_TRAILING_DROP_CENTS` (5 es placeholder)

4. **Recién ahí flip a live:** `MOTOR_3_EXECUTION_ENABLED=true` → vende de verdad.

### ⚠️ Calibración real = LOGS shadow (bid live), no el script

`scripts/calibrar_take_profit.py` usa `market_snapshots` (~cada 5min), es **aproximado**. La
calibración real sale de logs de detección shadow con bid live al milisegundo. El script da
una primera estimación; los logs dan la verdad.

**Mismo principio del 21-jun ("validar contra realidad, no suposiciones") aplicado a calibración
de parámetros:** el script es la suposición (snapshot cada 5min); los logs son la realidad
(bid en el momento exacto del trigger).

---

## Archivos tocados (mapa mental)

- `src/strategies/motor_3_clv/take_profit.py` — detector puro `take_profit_due`
- `src/strategies/motor_3_clv/trailing_stop.py` — `trailing_stop_due` / `next_peak_bid` / `decide_exit`
- `src/strategies/motor_3_clv/engine.py` — `_current_bid`, `_entry_bid_for`, `_persist_peak`,
  wiring `_tick`
- `src/strategies/motor_2_consensus/executor.py` — filtro underdog en `execute()`
- `src/risk/manager.py` — insert `RiskEvent` en `_trigger_kill_switch`
- `src/storage/models.py` — `PortfolioPosition.peak_bid_cents` + `_MIGRATIONS`
- `scripts/calibrar_take_profit.py` + `docs/runbook_take_profit_calibracion.md`
- flags en `src/utils/config.py`, `src/runner.py`, `docker-compose.yml`

---

## Próximos pasos

- [ ] **Coolify:** capital 1500→1200 (FASE 0.1)
- [ ] **Coolify:** prender los 3 detectores en shadow (CLV + TP + TRAIL, todos con
      EXECUTION=false)
- [ ] **Tras días de shadow:** calibrar umbrales con logs + script
- [ ] **Decidir Motor 1** (`action required` Kalshi) y apagar Motor REST (FASE 4)
- [ ] **(Futuro)** afinar entry a promedio ponderado si hay entradas a precios distintos

---

## El arco del proyecto al 26-jun

| Fecha | Hito | Estado |
|---|---|---|
| 21-jun | Sistema oficialmente rentable (+$252.91 / 69.5% wr) | Snapshot maestro |
| 23-jun parte 1 | Optimización capital + servidor (cap saturado destapó F1) | Operativo |
| 23-jun parte 2 | F1 C-01 implementado (PR #100) | F1 en progreso |
| 26-jun | **Motor 3 con salidas inteligentes + F1 cerrado con #103** | **🚀 Capacidades nuevas listas en shadow** |

**Velocidad sostenida sin romper disciplina:** 3 días entre snapshot rentable y nuevas
capacidades en shadow. Y la nueva capacidad (Motor 3 salidas) ataca el problema más concreto
identificado por el análisis histórico de 1.620 trades — no es feature "por las dudas".

---

## Conexión con el patrón meta de la saga

### Motor 3 antes vs después

**Antes (closed_by_clv=0 en 1.620 trades):**
- 100% de las posiciones cerraban por settlement
- Sin gestión activa post-entrada
- Pérdidas evitables: el ticket al 90% que se evaporó
- Underdogs sangrando sin filtro

**Después (shadow-first):**
- 3 mecanismos de salida activa: take-profit, trailing, filtro underdog pre-entrada
- Auditoría completa de pausas (RiskEvent)
- Calibración basada en datos reales (logs shadow)

**El patrón meta de toda la saga aplicado a gestión de salidas:**
- "Medir el régimen real antes de actuar" → análisis histórico de 1.620 trades destapó qué
  arreglar primero
- "Defense in depth" → 3 mecanismos independientes (TP, trailing, filtro) en vez de uno mega
- "Shadow-first" → encender detectores sin vender hasta calibrar
- "El componente que tenés cubre el caso, no lo reescribas" → `exit_position` reutilizado sin
  tocar

### El "1.620 trades con closed_by_clv=0" como evidencia

Este número es exactamente del tipo de "asunción estructural rota" que el patrón meta
identifica. La asunción implícita era: *"settlement es el mecanismo de salida por defecto y
está bien"*. La data refutó: settlement era el ÚNICO mecanismo, lo cual significa que cada
posición ganadora se mantenía expuesta a movimientos adversos hasta el cierre del mercado.

Mismo patrón meta de:
- Saga V2 (HFT no aplica a Kalshi)
- 12-jun auditoría (Motor REST es presa rara)
- 14-jun fantasmas (feed in-play no comparable)
- 18-jun arb huérfano (FOK paralelo no es seguro multi-pata)
- 23-jun cap desactualizado (bot no lee cash real)
- **26-jun salidas por settlement (100% pasivo NO es gestión)**

Cada vez una asunción estructural distinta que el régimen real refuta cuando lo medís.

---

## Estado consolidado al cierre del 26-jun

| Frente | Estado |
|---|---|
| Capital activo | $1500 (parte 1 del 23-jun) → bajará a $1200 con FASE 0.1 |
| Motor 2 | Activo (#103 cerró F1 con C-02/C-03 auto-sync) |
| Motor REST | Dormido (REST_EXECUTION_ENABLED=false) |
| Motor 3 — diagnóstico CLV | Activo |
| **Motor 3 — take-profit (#104)** | ✅ Código en main · default OFF · shadow listo |
| **Motor 3 — trailing stop (#105)** | ✅ Código en main · default OFF · shadow listo |
| **Motor 2 — filtro underdog <40¢ (#104)** | ✅ Código en main · default OFF |
| **RiskEvent al pausar (#104, FASE 0.2)** | ✅ Auditoría completa de stop-losses |
| F1 — C-01 refresh_capital_from_balance | ✅ Mergeado #100 |
| F1 — C-02/C-03 capital base + alerta desfase | ✅ Mergeado #103 |
| F1 — C-04 tests edge cases | ⏳ Pendiente |
| Script calibración + runbook (#105) | ✅ `scripts/calibrar_take_profit.py` + `docs/runbook_take_profit_calibracion.md` |
| Tests passing | ~666 (incluye 18 risk + nuevos de TP/trailing/underdog) |
| Restart-survival pausa | ✅ Ya existía vía `OperationalState` + `_rehydrate_kill_switch` |
| KalshiRestClient siempre abierto | ✅ Read-only mínimo (para leer orderbook en shadow) |
| **Pendiente Coolify** | (1) FASE 0.1 capital 1500→1200; (2) prender 3 detectores en shadow; (3) calibrar tras días; (4) flip a EXECUTION_ENABLED=true |
| **Pendiente decisión** | Motor 1 (action required Kalshi) + apagar Motor REST (FASE 4) |

---

## Frase del día

> **"Motor 3 pasó de 'esperar el settlement' a 'gestionar salidas con datos'. Y entró todo
> shadow-first: el merge no cambió nada hasta encender flags. Defense in depth por defecto."**

---

## Para el próximo turno

1. **Coolify FASE 0.1:** bajar capital de $1500 a $1200 (calibración cautelosa con nuevos
   detectores corriendo)
2. **Coolify activación shadow:** prender `MOTOR_3_CLV_ENABLED`, `MOTOR_3_TAKE_PROFIT_ENABLED`,
   `MOTOR_3_TRAILING_ENABLED` con `EXECUTION=false` y `UNDERDOG_FILTER_ENABLED=false`
3. **Días de shadow:** juntar logs `[MOTOR 3 TP SHADOW]` y `[MOTOR 3 TRAIL SHADOW]`
4. **Calibrar:** correr `scripts/calibrar_take_profit.py` + analizar logs → fijar
   `TAKE_PROFIT_CENTS` y `TRAILING_DROP_CENTS` reales (90 y 5 son placeholders)
5. **Flip a live:** `MOTOR_3_EXECUTION_ENABLED=true` para vender de verdad
6. **Decidir Motor 1 (FASE 4):** action required Kalshi + apagar Motor REST formal

---

## Links
- [[kalshi-bot]]
- **[[2026-06-23-parte-2-F1-auto-sync-capital-PR-100-en-progreso]] — F1 que esta sesión cerró con #103**
- [[2026-06-23-optimizacion-capital-1500-server-upgrade-modo-prueba-mes]] — parte 1 del 23-jun (capital + servidor)
- [[2026-06-21-botkalshi-arquitectura-completa-sistema-rentable]] — snapshot maestro
- [[2026-06-18-parte-2-flags-por-motor-bug-position_fp-escalado-Motor-2-Telegram]] — patrón "agregar flag por motor sin romper lo que funciona"
- [[2026-06-12-AUDITORIA-motores-gap-entre-infra-y-senal]] — auditoría que identificó Motor 3 como greenfield

### PRs
- #103: github.com/Noahstark23/botkalshi/pull/103
- #104: github.com/Noahstark23/botkalshi/pull/104
- #105: github.com/Noahstark23/botkalshi/pull/105
