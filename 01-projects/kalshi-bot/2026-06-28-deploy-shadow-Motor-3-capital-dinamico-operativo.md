---
tipo: sesion-ops
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-28
tags:
  - kalshi
  - coolify
  - motor3
  - take-profit
  - shadow
  - capital-dinamico
  - ws-v2-bug
  - 2026-06-28
estado: bot-operando
frente: "Shadow Motor 3 desplegado con TP=62¢ calibrado · capital dinámico operativo · bot reanudado · pendiente validar +$761 backtest"
prs: [104, 105, 106, 107]
relacionado:
  - "[[2026-06-26-Motor-3-salidas-inteligentes-take-profit-trailing-shadow-first]]"
  - "[[2026-06-23-parte-2-F1-auto-sync-capital-PR-100-en-progreso]]"
---

# 2026-06-28 — Deploy shadow Motor 3 + reanudación + capital dinámico operativo

## TL;DR

Deploy de `main` (#104-#107) → variables de Motor 3 en modo shadow (**TP=62¢**, trailing OFF,
execution OFF) → bot **reanudado y operando** con **capital dinámico** ($270 efectivos de $300
reales). **El F1 del roadmap quedó CERRADO operativamente — capital dinámico activo, ya no
depende de `ACTIVE_CAPITAL_USD`.** Falta: juntar logs shadow `net=` y compararlos vs **+$761
del backtest** antes del go-live de venta real.

---

## Estado actual del bot

- **Operando:** `is_paused=false`, `capture_running=true`, `trading_enabled=true`
- **Capital (dinámico):** balance real **$300.50** → opera con **$270.45 efectivos** (colchón ~10%)
- **Ya NO depende** de `ACTIVE_CAPITAL_USD` (obsoleta). Al depositar, el bot lo detecta solo.
- **Motores activos:** Motor 1 (arbitraje), Motor 2 (sportsbook), Motor 3 (CLV)
- **Stop-loss diario activo:** `MAX_DAILY_LOSS_PCT=3.0` (≈ −$8 sobre $270) → se auto-pausa si lo supera
- **Commit desplegado:** `f9d8e11…` (main, incluye #104/#105/#106/#107)
- **Container:** `kalshi-bot-rzd9wh8oyf0l2ds7l6vicjsb-031545437559` — Running (healthy)

---

## Cambios aplicados hoy

### Env vars Motor 3 (Coolify → Production)

| Variable | Valor | Nota |
|---|---|---|
| `MOTOR_3_CLV_ENABLED` | `True` | ya estaba |
| `MOTOR_3_TAKE_PROFIT_ENABLED` | `true` | ya estaba |
| `MOTOR_3_TAKE_PROFIT_CENTS` | **62** | ⬅️ óptimo del backtest (antes 90 placeholder) |
| `MOTOR_3_TRAILING_ENABLED` | **false** | ⬅️ nueva, OFF (decidido) |
| `MOTOR_3_EXECUTION_ENABLED` | `false` | shadow: detecta y loguea, NO vende |

### Acciones

- ✅ Redeploy sobre `main` → healthy
- ✅ `POST /admin/resume` → kill-switch persistente levantado (`{"status":"running"}`)

---

## Roadmap de PRs (todo en main)

| PR | Qué | Estado |
|---|---|---|
| #104 | take-profit + underdog + auditoría RiskEvent | ✅ merged (26-jun) |
| #105 | calibración take-profit + trailing | ✅ merged (26-jun) |
| #106 | **capital dinámico** (floor/cap + pausa + toggle + /status) | ✅ merged |
| #107 | **shadow PnL neto de fees en logs** | ✅ merged |

**#106 cierra F1 del roadmap operativamente.** El auto-sync de capital del 23-jun (PRs
#100/#103 con `refresh_capital_from_balance` + factor + alerta) se completó hoy con el toggle +
endpoint `/status` para verlo en vivo + floor/cap explícitos + pausa automática si el balance
cae bajo floor. **`ACTIVE_CAPITAL_USD` quedó OBSOLETA** — el bot detecta depósitos y retiros
solo, sin intervención del operador. Ese era el objetivo F1 desde el snapshot 21-jun.

**#107 cierra la pieza para validar Motor 3 shadow:** los logs ahora tienen
`[MOTOR 3 TP SHADOW] ... entry / gross / fees / net=$...` — el `net=` permite sumar y comparar
contra el +$761 del backtest sin tener que reconstruir fees manualmente.

---

## Validación pendiente — Shadow vs Backtest

- Motor 3 ahora loguea `[MOTOR 3 TP SHADOW] ... entry / gross / fees / net=$...`
- **Tarea:** dejar correr unos días → sumar los `net=` → comparar contra **+$761** (backtest
  TP=62¢ sobre 140 trades MLB)
- ⚠️ El shadow valida **trigger + PnL con fees**, NO la liquidez/fill real al bid (es un techo,
  igual que el backtest)
- **Go-live:** si el shadow confirma el número → `MOTOR_3_EXECUTION_ENABLED=true`,
  **arrancar chico** por el tema de fills

**Patrón meta aplicado:** *"validar contra realidad, no contra suposiciones"* — el backtest
es suposición (140 trades reproducidos sin liquidez/fill real); el shadow corriente es la
realidad operativa (con timing real, con orderbook real, sin ejecutar para no afectar precio).
**Si los dos números convergen → señal verde para go-live.** Si divergen → el backtest tenía
sesgo de algún tipo que el shadow destapa.

---

## Pendientes / Riesgos abiertos

- [ ] **WebSocket v2 ROTO** → `instance missing`, error code 15
- [ ] **Motor REST** viene perdedor (−$2.61, 10/11 trades). Dejado ON → **otro agente lo está
      arreglando**
- [ ] Bajar `ACTIVE_CAPITAL_USD` / `KALSHI_INITIAL_BANKROLL` (ya obsoletas por capital dinámico)
      — limpieza
- [ ] Motor 1 "action required" — revisar
- [ ] Juntar logs shadow y validar +$761 antes del go-live

---

## El WebSocket v2 bug — causa raíz identificada

**Síntoma:** `instance missing`, error code 15.

**Causa raíz:** el código envía `update_subscription` con `action="get_snapshot"`
(**action inválido** en Kalshi WS v2). **NO es problema de cuenta** → por eso Kalshi no muestra
alerta.

**Fix:** re-suscribir (`delete_markets`+`add_markets`) para forzar snapshot.

**Workaround actual:** `USE_ORDERBOOK_MANAGER_V2=False` → V2 dormant, V1 sigue capturando OK.

**Conexión con la saga V2:** este es exactamente el tipo de bug que el patrón meta de la saga
predijo. La asunción implícita era: *"`action=get_snapshot` es válido como acción en
update_subscription"*. La realidad: no lo es en v2. **Falla en silencio sin que Kalshi alerte
del lado de cuenta** — el cuarto de los "bugs de leer la realidad mal" identificados, después
de #75 (firma 401), #87 (position_fp), #54 (in-play vs Odds API).

**Sumá a la serie:**
1. #75 firma 401 — firmar path con querystring → 401
2. #87 position_fp — leer campo equivocado → todo aparecía 0
3. #54 in-play vs Odds API — comparar feeds no-comparables → fantasmas
4. **WS v2 action=get_snapshot — acción inválida silenciosa → `instance missing`**

Patrón común: todos fallan **en silencio** o con error críptico, todos requieren probar contra
la API real para descubrir.

---

## Hallazgos de la auditoría (contexto)

### Pérdida del 26-jun

Kill-switch por **Stop-Loss Diario** (`PnL=$-29.90` vs límite **−$24.31**). **Esto NO estaba
documentado en la sesión del 26-jun parte 1 sobre Motor 3** — era el día en que se mergeaban
los PRs del Motor 3, y el stop-loss disparó ese día. **El RiskEvent audit (FASE 0.2 del #104)
ya estaba en main cuando esto pasó** → la pausa quedó registrada en `risk_events` (antes
estaba vacío).

**Lección operativa:** el día que mergeás un fix de auditoría, la auditoría te empieza a dar
data sobre el día mismo. *"El primer dato del audit es del momento en que el audit empieza a
existir."*

### Motor 2 (consensus) en data fresca

- **+$130.95 en 129 trades settled**
- **48 perdedores**, de los cuales **23 iban ganando ≥8¢ antes de remontarse**
- **Picos típicos 56-62¢** antes del retroceso

**De ahí el TP=62¢** — no es número arbitrario, sale del análisis del comportamiento real de
los trades perdedores que en algún momento estuvieron ganadores.

### Backtest 140 trades MLB

- Baseline (sin TP) → **−$390**
- Con TP=62¢ → **+$761 sim** (cierra 107/140)
- **Trailing NO mejora sobre TP simple en béisbol** → trailing OFF

**Por qué trailing no mejora:** en béisbol los movimientos del bid son escalonados (cada
inning, cada out clave). Un trailing con drop=5¢ se dispara con cualquier movimiento natural
sin haber capturado el pico real. TP fijo a 62¢ es más simple y captura el pico estructural
del juego (cuando una racha favorable cruza el umbral psicológico de "casi seguro").

### Decisión de fondo: capital auto-detectado

> *"para no tener que editar variables (usuario no siempre frente a la PC)"*

✅ Implementado en #106. **Esta es la operacionalización del F1.** El bot ahora es
verdaderamente desatendido — el operador puede depositar y el bot detecta sin que nadie tenga
que editar `ACTIVE_CAPITAL_USD`. **Un punto menos de error humano.**

---

## Endpoints útiles (referencia)

- `GET /status` — dashboard completo
- `GET /ready` / `GET /health` — readiness / liveness
- `GET /admin/stats` — estadísticas operacionales
- `POST /admin/pause?reason=...` — pausar
- `POST /admin/resume` — reanudar
- Base: `http://104.236.211.240:18080`
- Coolify: `http://104.236.211.240:8000` (Terminal → container para queries SQLite read-only
  en `/app/data/trades.db`)

---

## Próximo paso

> Cuando tengas varios días de logs `[MOTOR 3 TP SHADOW]`, recopilarlos y sumar los `net=`
> para confirmar el **+$761** → recién ahí evaluar `EXECUTION_ENABLED=true` arrancando con
> tamaño chico.

---

## Conexión con el patrón meta de la saga

### F1 cerrado operativamente

El F1 del roadmap (anticipado el 21-jun) que se manifestó como problema operativo el 23-jun
parte 1 (cap desactualizado bloqueando señales), implementado en draft el 23-jun parte 2
(PR #100), completado con C-02/C-03 el 26-jun (PR #103), **HOY ENTRÓ EN PRODUCCIÓN como
capital dinámico operativo (PR #106)**. **`ACTIVE_CAPITAL_USD` quedó obsoleta.**

**5 días desde "F1 es próximo hito" del snapshot 21-jun hasta "F1 cerrado operativamente"
del 28-jun.** Mismo patrón meta: el item del roadmap se acelera cuando el régimen real lo
reclama, y cuando se cierra, se cierra COMPLETAMENTE — no a medias, no en versión light.

### El WS v2 bug es el cuarto bug de "leer la realidad mal"

Identificado HOY como causa raíz: `action="get_snapshot"` inválido en v2, falla con
`instance missing` sin alerta de Kalshi del lado de cuenta. **Esto NO se cazaba en revisión de
código** — solo aparecía cuando interactuaba con la API real. Mismo patrón meta de todos los
bugs estructurales: probar contra la realidad.

### Coordinación multi-agente cuando hay rentabilidad

> *"Motor REST viene perdedor (−$2.61, 10/11 trades). Dejado ON → otro agente lo está
> arreglando."*

**Esto es nuevo en la saga.** Hasta ahora todo era trabajo serializado del operador con
agentes. Hoy aparece la división del trabajo: el operador atiende Motor 3 + capital dinámico
mientras otro agente arregla Motor REST. **Es signo de madurez del sistema** — múltiples
frentes en paralelo, cada uno con su contexto, sin colisión porque los frenos por motor
(#86/#88 del 18-jun parte 2) permiten trabajar en cada uno independientemente.

---

## Estado consolidado al cierre del 28-jun

| Frente | Estado |
|---|---|
| Bot | ✅ Operando, healthy, capital dinámico activo |
| Balance real Kalshi | $300.50 |
| Capital efectivo (con colchón 10%) | $270.45 |
| `ACTIVE_CAPITAL_USD` | 🗑️ OBSOLETA — capital dinámico la reemplaza |
| **F1 auto-sync capital** | ✅ **CERRADO OPERATIVAMENTE (PR #106)** |
| Stop-loss diario | `MAX_DAILY_LOSS_PCT=3.0` (≈ -$8 sobre $270) |
| **Motor 3 shadow desplegado** | ✅ TP=62¢ (calibrado del backtest), trailing OFF, execution OFF |
| **Logs shadow con net=** | ✅ PR #107 — sumar `net=` y comparar vs +$761 backtest |
| Motor REST | 🔴 Perdedor (-$2.61, 10/11), **otro agente lo arregla** |
| Stop-loss disparó 26-jun | ✅ Registrado en `risk_events` (FASE 0.2 del #104 ya estaba activa) |
| **WS v2 bug causa raíz identificada** | `action="get_snapshot"` inválido en v2 → `instance missing` |
| Workaround WS v2 | `USE_ORDERBOOK_MANAGER_V2=False` (V2 dormant, V1 captura OK) |
| Pendientes | Validar +$761 con días de shadow · limpiar env vars obsoletas · Motor 1 action required · revisar WS v2 fix |

---

## Frase del día

> **"F1 cerrado operativamente: el bot ya detecta capital solo. Motor 3 desplegado en shadow
> con TP=62¢ calibrado del backtest. Falta validar que el +$761 del backtest se sostenga en
> shadow real, recién ahí flip a live. Mientras tanto, otro agente arregla Motor REST en
> paralelo — primera vez que el sistema soporta multi-agent coordination en el mismo bot."**

---

## Para el próximo turno

1. **Esperar días de shadow** — juntar logs `[MOTOR 3 TP SHADOW]` y sumar `net=`
2. **Comparar shadow real vs backtest +$761** → si converge, señal verde para `EXECUTION=true`
3. Si flip a live: **arrancar chico** (por el tema de fills no probados)
4. Limpiar env vars obsoletas (`ACTIVE_CAPITAL_USD`, `KALSHI_INITIAL_BANKROLL`)
5. Decidir Motor 1 "action required" Kalshi
6. Revisar el fix WS v2 cuando esté listo (re-suscribir delete+add)
7. Confirmar con el otro agente el estado del fix Motor REST

---

## Links
- [[kalshi-bot]]
- **[[2026-06-26-Motor-3-salidas-inteligentes-take-profit-trailing-shadow-first]] — sesión de los PRs #104/#105 que esta sesión deploya en producción**
- [[2026-06-23-parte-2-F1-auto-sync-capital-PR-100-en-progreso]] — donde arrancó F1 (que hoy se cerró con #106)
- [[2026-06-21-botkalshi-arquitectura-completa-sistema-rentable]] — snapshot maestro donde F1 estaba en el roadmap
- [[2026-06-18-parte-2-flags-por-motor-bug-position_fp-escalado-Motor-2-Telegram]] — patrón de flags por motor que permite multi-agent coordination hoy
- [[2026-06-12-AUDITORIA-motores-gap-entre-infra-y-senal]] — la auditoría que ordenó el roadmap

### PRs
- #104: take-profit + underdog + RiskEvent audit
- #105: calibración take-profit + trailing
- #106: **capital dinámico (cierra F1)**
- #107: shadow PnL neto de fees en logs
