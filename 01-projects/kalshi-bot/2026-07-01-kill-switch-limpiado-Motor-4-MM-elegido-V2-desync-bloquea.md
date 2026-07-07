---
tipo: sesion
proyecto: "[[kalshi-bot]]"
fecha: 2026-07-01
tags:
  - kalshi
  - kill-switch
  - reset-mensual
  - dashboard-telegram
  - motor-4
  - market-making
  - v2-desync
  - saga-v2-continuacion
  - pnl-mes-perdedor
  - 2026-07-01
estado: kill-switch-limpiado / falta-redeploy
frente: "Julio arranca reseteado con kill-switch pegado (bug); Motor 4 MM elegido pero V2 desync es prerequisito bloqueante"
relacionado:
  - "[[2026-06-28-deploy-shadow-Motor-3-capital-dinamico-operativo]]"
  - "[[2026-06-21-botkalshi-arquitectura-completa-sistema-rentable]]"
---

# 2026-07-01 — Julio arranca: kill-switch limpiado + Motor 4 elegido + V2 desync bloquea

## Estado

**Kill-switch limpiado ✅ · Falta redeploy para arrancar**
**Capital: ~$353 efectivo ($392.73 raw) · modo dinámico**

---

## 🎯 Decisiones tomadas hoy

- [x] Dashboard de Telegram **activado** (`TELEGRAM_DASHBOARD_ENABLED=true`)
- [x] Kill-switch mensual pegado **limpiado** (`clear_kill_switch.py`)
- [ ] **Redeploy pendiente** para reactivar trading
- [ ] Fix del OrderbookManagerV2 (bloquea Motor 4) → Claude Code
- [ ] Construir Motor 4 (market making) — solo tras fix V2

---

## 📊 Dashboard Telegram

- Ya estaba mergeado en código (`src/monitoring/dashboard.py`)
- Comandos: `/dashboard`, `/dash`, `/status` (solo tu chat: `7415039830`)
- Loop confirmado en logs: `telegram dashboard loop started`
- `auto_interval=0s` → solo on-demand. Para envío automático: setear
  `TELEGRAM_DASHBOARD_INTERVAL_SEC`
- Sin conflicto de webhook (url vacía)

---

## 🔴 Kill-switch — qué pasó

- Mes reseteó a $0 el 1-jul 00:00 UTC, pero el flag `kill_switch=engaged` **NO se auto-limpió**
  (quedó pegado en tabla `operational_state`)
- Ejecuté `clear_kill_switch.py` (verifica posiciones=0 en vivo vs Kalshi) → `KILL_NOW: clear` ✅
- **Bug latente:** el reset mensual debería auto-limpiar el kill-switch → reportar a Claude Code

**Conexión con FASE 0.2 (RiskEvent audit) del 26-jun:** la auditoría de pausas ya está activa
en `risk_events` desde el PR #104. Este bug NO es del audit — es del ciclo de vida del
kill-switch: reset de límites mensuales debería reset el flag también. **Semántica rota:** "no
te podés pasar del límite mensual" ≠ "quedaste pausado permanentemente por pasar del límite
del mes anterior".

---

## 🧩 Motor 4 — Recomendación

### ✅ Market Making (Spread Capture) — ELEGIDO

- Todo dentro de Kalshi, reutiliza patrón de motores + RiskManager
- Cero dependencias externas
- **Prerequisito bloqueante:** arreglar desync del V2

### ❌ Cross-Venue Arb (Kalshi vs Polymarket/PredictIt) — DESCARTADO

- La "spec fase0" NO existe en el repo
- No hay clientes de Polymarket/PredictIt (solo `kalshi_rest`, `kalshi_ws`, `odds_api`)
- Leg-risk + capital fragmentado en 2 venues con solo ~$350 = inviable

**Nota de diseño:** market making es DIFERENTE a los 3 motores actuales:
- Motor 2 (consensus) y Motor 3 (CLV) apuestan direccional
- Motor REST (arb binario) y Motor 4 potencial (arb multi-outcome) capturan cruces
- **Motor 4 MM = proveer liquidez** (post limits en ambos lados y capturar spread)

**Es diferente estructuralmente:** no cruza mercados (los CREA en ambos lados). Requiere
libro en memoria estable (V2) porque tenés que ver el orderbook con precisión para postear
limits al bid/ask. **Por eso V2 desync es prerequisito bloqueante** — sin book estable, no
podés hacer MM sin exposición no controlada.

---

## 🐛 BUG CRÍTICO: OrderbookManagerV2 desync

> Prerequisito antes de cualquier market making

- **Síntoma:** `/status` → `v2: {enabled:true, instance:"missing"}` intermitente
- **Medición:** ~207 errores `V2 desync` en 2000 líneas de log (~10%)
- **Origen:** `orderbook_manager_v2.py:672` en `_apply_delta_msg` → `OrderbookDesyncError`
- **Ejemplo:** `msg_seq=18408 state_seq=18405` (gap de secuencia → mensajes WS perdidos)
- **Instancia:** SÍ se crea (`data_capture.py:628-633`); el "missing" es race condition en
  `health.py:197`
- **Fix pedido:** resync tras gap (resnapshot/buffer reorden) + revisar registro en BotState

### La saga V2 vuelve — y con dos causas ahora identificadas

**Cronología del desync V2 en el proyecto:**
- **Mayo 25/27/30:** attempts #1/#2/#3 fallaron con exactamente este síntoma
  (`OrderbookDesyncError` en `_apply_delta_msg`)
- **31-may:** cuarto discovery identificó causa raíz: **ventana ciega de bootstrap** — V2 NO
  tenía buffering ni detección de gap durante bootstrap
- **02-jun:** V2 archivado, pivot a Motor REST
- **28-jun:** WS v2 bug `action="get_snapshot"` inválido → `instance missing` (causa DIFERENTE
  del desync, pero mismo efecto de "V2 no funciona")
- **HOY 07-01:** desync del `_apply_delta_msg` reaparece con 10% de tasa de error

**Dos causas conocidas:**
1. **Bootstrap sin buffering** (identificado 31-may): los primeros mensajes se procesan sin
   sincronización, deltas pre-snapshot se descartan silenciosamente → book sub-construido
2. **Gap de secuencia en steady-state** (10% actual): mensajes WS perdidos → `msg_seq` avanza
   más rápido que `state_seq` → delta se aplica sobre estado desactualizado → `qty<0`

**El fix pedido a Claude Code:**
- Resync tras gap (resnapshot del ticker afectado, o buffer + reorden de deltas)
- Revisar registro en BotState (el "missing" es race condition en `health.py:197`)

**Coherente con la lección del 02-jun:** V2 se archivó cuando la data mostró que Motor REST
alcanzaba (73% captura). Pero **para market making V2 es prerequisito estructural**, no
alternativa. Motor REST puede funcionar sin book estable (usa REST bajo demanda); MM NO puede.

---

## 📁 Arquitectura del bot (referencia)

- Motores en `src/strategies/motor_X_*/` → cada uno: engine/poller (señales) + executor (órdenes)
- Orquestados en `runner.py` como tasks async, gateados por `MOTOR_X_..._ENABLED`
- Comparten `RiskManager()` (sizing con capital efectivo dinámico) + `KalshiRestClient`
- Soporte **shadow-first** (executor=None → observa sin operar)
- Motores actuales: M1 arbitraje (WS), M2 consenso sportsbooks, M3 CLV, rest_arb
- Clientes: `kalshi_rest.py`, `kalshi_ws.py`, `odds_api.py`
- DB: `/app/data/trades.db` — tablas `trades`, `portfolio_positions`, `operational_state`

---

## 📈 PnL histórico (contexto)

- **Motor 2 consenso: −$404.95** (143 trades, 57% WR, avgW +$10.96 / avgL −$21.38)
- **Motor rest_arb: −$2.59** (15 trades)
- **Trailing/CLV closes: 0** (nunca disparó — ver nota abajo)
- **Mes actual (julio): $0** (reseteado)

### El salto que hay que ver claro

**21-jun snapshot maestro:** Motor 2 +$252.91 (48 trades, 69.5% WR).
**07-01 hoy:** Motor 2 **−$404.95** (143 trades, 57% WR).

**Delta de PnL entre 21-jun y 07-01: −$657.86** sobre 95 trades adicionales. **El WR bajó de
69.5% a 57%.** La distribución avgW +$10.96 / avgL −$21.38 muestra el problema estructural:
**las pérdidas son 2× más grandes que las ganancias** — exactamente el problema que Motor 3
take-profit iba a resolver, pero **`trailing/CLV closes = 0` — nunca disparó**.

**Hipótesis del "nunca disparó":**
- Motor 3 execution=false (shadow) — solo detecta y loguea, no cierra. **Fix: era shadow por
  diseño, esperando validación**
- Motor 3 TP=62¢ pero mayoría de trades no llegaron a ese pico → no había qué ejecutar
- El shadow mostraba las oportunidades pero el flip a `EXECUTION=true` nunca sucedió

**Consecuencia:** entre el 28-jun (deploy Motor 3 shadow) y el 01-jul, el shadow LOGGEABA
oportunidades de take-profit pero el executor NO cerraba. Los 23 trades que iban ganando ≥8¢
identificados en el análisis del 26-jun **siguieron remontándose sin salir** — y algunos
terminaron en la columna de −$404.95.

**Lección operativa:** *"shadow que valida oportunidades pero nunca flip a live es shadow que
te cuesta plata en la modalidad clásica."* La disciplina del shadow-first vale, pero requiere
**cerrar el loop con el flip a live cuando la data confirme** — dejar Motor 3 en shadow
"cuando ya validaste" es dejar que el problema que motivó Motor 3 siga costando.

Motor 3 detectó los picos; el operador no lo activó para venderlos. **La conjugación de la
disciplina y el negocio requiere cerrar el ciclo shadow → live cuando corresponda.**

---

## ⚠️ Pendientes / recordatorios

- [ ] Redeploy para arrancar el bot
- [ ] Reportar a Claude Code: (a) fix desync V2, (b) auto-limpieza kill-switch en reset mensual
- [ ] El servidor de status HTTP (`:18080`) a veces no responde — investigar aparte
- [ ] **`MOTOR_3_TRAILING_ENABLED=true` ya aplicado** (empezará a cerrar ganadores al operar)

**El trailing ON es un cambio operativo importante:** en el 28-jun se había dejado trailing
OFF porque el backtest 140 trades MLB decía "trailing no mejora sobre TP simple en béisbol".
Ahora se activó. **Vale entender por qué el cambio de criterio** — si es para no dejar
ganadores remontarse (el problema del "nunca disparó" arriba), es coherente. Si es cambio
sin justificación con data nueva, vale re-verificar contra el análisis del 26-jun.

---

## El arco del proyecto 21-jun → 07-01 (10 días con el sistema rentable → mes perdedor)

| Fecha | Hito | Motor 2 acumulado |
|---|---|---|
| 21-jun | Snapshot maestro RENTABLE | +$252.91 (48 tr, 69.5% wr) |
| 23-jun | Optimización capital + F1 arranca | ~+$252 |
| 26-jun | Motor 3 salidas inteligentes en main (shadow-first) + stop-loss dispara | -$29.90 día |
| 28-jun | Deploy shadow Motor 3 con TP=62¢ + F1 cerrado | operando ~$300 |
| **07-01** | **Kill-switch limpiado + Motor 4 elegido** | **−$404.95 (143 tr, 57% wr)** |

**Del +$252.91 rentable al −$404.95 acumulado en 10 días.** Los 3 motores con salidas
inteligentes construidos (26-jun) y desplegados en shadow (28-jun) NUNCA se activaron para
vender. Los trades siguieron cerrando por settlement en la modalidad que el análisis del
26-jun había identificado como problemática.

**Este es el patrón meta invertido:** cuando construís bien y NO activás lo que construiste,
el costo del NO-flip supera el costo del bug que estabas evitando con la disciplina de
shadow. **La disciplina de shadow-first vale — pero es disciplina, no dogma.** Cuando el
shadow confirma que el mecanismo funciona (o cuando el costo de no activarlo empieza a
superar el riesgo residual), corresponde el flip.

---

## Conexión con el patrón meta de la saga

**7 patrones meta refutados por la data ahora:**
1. Saga V2 — HFT no aplica a Kalshi
2. Auditoría 12-jun — ranking del roadmap no era correcto
3. 14-jun — feed in-play no es comparable
4. 18-jun — FOK paralelo no es seguro multi-pata
5. 23-jun — el bot no leía cash real
6. 26-jun — settlement 100% pasivo no es gestión
7. **07-01 — "shadow que valida sin flip cuesta plata cuando el problema shadow-detecta sigue
   ocurriendo en producción"**

**Séptimo patrón NUEVO:** los primeros 6 son sobre construir la cosa correcta con la data
correcta. El 7º es sobre **activar lo que ya construiste cuando la data lo respalda.** La
disciplina shadow-first es defensiva; sin cierre del ciclo con el flip a live, deja el
problema que motivó el shadow sin resolver.

---

## Estado consolidado al cierre del 07-01

| Frente | Estado |
|---|---|
| Bot | Pausado (kill-switch limpiado, falta redeploy) |
| Capital dinámico | ✅ Activo — $353 efectivo / $392.73 raw |
| Kill-switch mensual pegado | ✅ Limpiado con `clear_kill_switch.py` |
| Bug latente: auto-limpieza en reset mensual | 🔴 Pendiente reportar a Claude Code |
| Dashboard Telegram | ✅ Activado — comandos `/dashboard`, `/dash`, `/status` |
| Motor 2 acumulado | 🔴 **−$404.95** (143 tr, 57% wr — bajó de 69.5% del 21-jun) |
| Motor REST acumulado | 🔴 −$2.59 (15 tr — otro agente lo arregla) |
| Trailing/CLV closes | 0 — Motor 3 nunca activó execution |
| Mes actual (julio) | $0 reseteado |
| Motor 4 elegido | Market Making (Spread Capture) — bloqueado por V2 desync |
| Motor 4 descartado | Cross-Venue Arb (sin spec ni clientes Polymarket/PredictIt) |
| **V2 desync** | 🔴 ~10% tasa error (207/2000 líneas), `msg_seq=18408 state_seq=18405` |
| V2 desync causa | Gap de secuencia → deltas sobre estado desactualizado → `qty<0` |
| **`MOTOR_3_TRAILING_ENABLED=true`** | ✅ Aplicado (empezará a cerrar ganadores al operar) |
| Server status HTTP :18080 | 🟡 A veces no responde — investigar aparte |
| Redeploy pendiente | 🔴 Necesario para reactivar trading |

---

## Frase del día

> **"Julio arranca con kill-switch limpio y $353 efectivo. Pero el mes que se cierra deja una
> lección: construimos el take-profit y trailing (26-jun), los desplegamos en shadow (28-jun),
> y NUNCA los activamos. Motor 2 perdió $657 desde el snapshot rentable. La disciplina shadow
> vale — pero el ciclo shadow→live tiene que cerrarse cuando la data lo respalda, si no el
> problema que motivó el shadow te sigue costando."**

---

## Para el próximo turno

1. **Redeploy** para reactivar el bot (kill-switch ya limpio)
2. **Con trailing ON:** monitorear si empieza a cerrar ganadores que antes se remontaban
3. **Reportar a Claude Code (multi-agent):**
   - (a) Fix desync V2 — resync tras gap, revisar `health.py:197` race condition
   - (b) Auto-limpieza kill-switch en reset mensual (semántica rota del ciclo de vida)
4. **NO codear Motor 4 aún** — esperar que Claude Code cierre V2 desync (prerequisito
   estructural, no de conveniencia)
5. **Análisis pendiente:** ¿por qué WR bajó de 69.5% (48 tr) a 57% (143 tr)? ¿Deriva del régimen
   post-Mundial? ¿Underdogs sangrando pese al filtro <40¢ activado el 26-jun? ¿Fue "modo
   rechazo silencioso" del cap parte del problema? Vale correr un `check_portfolio` con vista
   por período para ver dónde se concentró la pérdida
6. Investigar server status HTTP `:18080` aparte
7. Coordinar con el otro agente el estado del fix Motor REST

---

## Links
- [[kalshi-bot]]
- **[[2026-06-28-deploy-shadow-Motor-3-capital-dinamico-operativo]]** — deploy shadow Motor 3 que nunca activó execution
- [[2026-06-26-Motor-3-salidas-inteligentes-take-profit-trailing-shadow-first]] — código take-profit + trailing
- [[2026-06-21-botkalshi-arquitectura-completa-sistema-rentable]] — snapshot rentable +$252.91 (baseline del salto)
- [[2026-06-12-AUDITORIA-motores-gap-entre-infra-y-senal]] — auditoría que descartó Market Making implícitamente (para arbitraje) pero es diferente estrategia
- [[causa-raiz-v2-desync-secuencia-bootstrap-CAPTURADA]] — la causa raíz de mayo, distinta del desync steady-state actual
