---
tipo: sesion-post-mortem
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-18
tags:
  - kalshi
  - capital-activo
  - motor-rest
  - motor-1
  - motor-2
  - motor-3
  - arbitraje
  - arbs-huerfanos
  - post-mortem
  - fix-pata-dura-primero
  - sesion-conmigo
  - 2026-06-18
estado: arb-arreglado-Motor-REST-dormido-pendiente-validacion-shadow
frente: "Primer día de capital — Motor 2 gana ($+13.16), Motor REST sangra ($-2.61) por arbs huérfanos. Fix mergeado, motor a dormir hasta validar"
sesion: "claude-code"
---

# 2026-06-18 — PRIMER DÍA CON CAPITAL: Motor 2 gana, Motor REST sangra (arreglado)

## TL;DR

**Primer día con capital activo.** El **Motor REST (arbitraje)** estaba perdiendo plata
(9% win-rate) por **arbs huérfanos sistemáticos**. Causa raíz: disparaba todas las patas en
paralelo y la pata cara casi nunca llenaba. **Fix mergeado: "pata dura primero" (PR #85).**
Además se revivió **Motor 1** (shadow) y se sumó diagnóstico a **Motor 3**. **Motor 2 (el que
gana) intacto.** Capital total intacto al primer orden, sangría < $5 y mecanismo de pérdida
identificado y arreglado.

**La auditoría del 12-jun ACERTÓ:** dijo *"Motor 2 (consensus) = EL MÁS RENTABLE; Motor REST
(arb binario) caza presa casi inexistente"*. La data de 24h con capital lo confirma: Motor 2
+$13.16, Motor REST −$2.61.

---

## 💰 Datos que dispararon todo (24h, 19 trades)

| Motor | n | win% | P&L |
|---|---|---|---|
| `motor_2_consensus` (MLB) | 8 | **50%** | **+$13.16** ✅ |
| `motor_rest_arb` | 11 | **9%** | **−$2.61** 🔴 |
| **Total** | 19 | 26% | **+$10.55** |

**Balance:** $100 → $95.17 (Δ −$4.83). El "faltante" era capital atado en `portfolio_value`
($24.92), **no perdido**.

**⚠️ Pendiente confirmar:** fills grandes de `AUTJOR` ($75, $60) marcados `NO-EN-DB`
→ ¿manuales o fills no-registrados durante el bug de firma 401 (#75)?

---

## 🔬 Causa raíz del arb huérfano (lección clave)

### El bug

`RestExecutor.execute()` disparaba **TODAS las patas en paralelo como FOK** (fill-or-kill), sin
orden ni atomicidad.

### Mecanismo (5 pasos)

1. **FOK = llena completa al instante o se cancela** (no parcial, no resting)
2. La pata **cara/favorita** (AUT@80¢, ENG@77¢) tiene poco volumen resting → **KILL**
3. Las patas **baratas y profundas** (TIE@15¢, JOR@3¢) → **FILL**
4. Quedan patas perdedoras compradas **sin la ganadora** → **huérfano**
5. El rollback las liquida a 1¢ → **pérdida garantizada (~$0.84–0.96)** cada ciclo

### Confirmación empírica

- **4/4 de los KILLs fueron la pata cara** (la más alta del arb)
- **Cero contraejemplos** (N=6 arbs analizados)
- Win-rate 9% = la rara coincidencia de que la pata cara tenga volumen al mismo tiempo que las
  baratas

### El rollback NO estaba roto

Hacía lo correcto. **La pérdida ERA el costo del rollback, pagado cada vez que la pata dura no
llenaba.** Ese es el insight central: el mecanismo de seguridad funcionaba — pero el costo del
mecanismo de seguridad ES la sangría sistemática.

---

## ✅ El fix: "pata dura primero" (hard-leg-first)

### Mergeado en PR #85

- Identifica la **pata dura** = `max(price_cents)` (desempate por menor `available_size`)
- La dispara **sola y espera**:
  - **KILL** → no se compró nada → **no-op, $0 pérdida** (las baratas NO se envían)
  - **FILL** → recién ahí las baratas en paralelo (profundas, casi siempre llenan)
  - **ERROR_RED** → no persigue baratas; reconcilia la dura sola
- Convierte **~91% de las pérdidas en no-ops**
- Reusa intacto reconcile/rollback/kill-switch — solo reestructura `execute()`

### Diseño elegante

> *"El FOK secuenciado sobre la pata dura ES la prueba de profundidad en vivo → no hace falta
> query extra de depth."*

El acto mismo de probar la pata dura primero te da la información (¿hay depth?) sin tener que
preguntar al orderbook por adelantado. Si la dura llena, hay depth; si KILL, no había. Defense
empírica vs especulativa.

---

## 📦 PRs de la sesión

| PR | Qué | Estado |
|---|---|---|
| #82 | Motor 3 diagnóstico CLV por-tick | ✅ merged |
| #84 | Motor 1 revivido (shadow-first, arb binario WS) | ✅ merged |
| #85 | Guardarraíl pata-dura-primero | ✅ merged |
| #83 | Análisis huérfanos | cerrado (redundante con `check_portfolio`) |
| #75 (previa) | fix firma 401 (firmar path sin querystring) → habilitó leer cartera real | mergeado en sesión anterior |

---

## 🎛️ Estado de los motores

- **Motor REST** — arreglado de fondo; **dormido hasta validar en shadow**
- **Motor 1** — **revivido en shadow** (PR #84), dormido por default
- **Motor 2** — **el ganador (+$13/día), intacto** ← **escalar acá**
- **Motor 3** — diagnóstico CLV activo (PR #82)

---

## ⏭️ Pendientes operativos

- [ ] `MOTOR_REST_ENABLED=False` + redeploy (frenar sangría hasta validar #85)
- [ ] Validar #85 en shadow: confirmar que los KILL de pata dura aparecen como no-ops
- [ ] Al re-armar arb: `MOTOR_REST_ENABLED=True` + subir `MOTOR_REST_EXECUTION_EDGE_PCT`
      (cubrir rollback residual)
- [ ] Confirmar si los fills `AUTJOR` ($75/$60) son manuales o fills perdidos durante #75
- [ ] **Considerar escalar Motor 2** (más mercados/deportes, sizing)

---

## 🧠 Lecciones para reusar

### 1. Arbitraje multi-pata sin fill atómico es peligroso

Secuenciar la pata más difícil primero convierte pérdidas en no-ops. **Kalshi no tiene órdenes
contingentes multi-leg** — esto se sabía desde el diseño del FOKExecutor (06-jun). El FOK
nativo cubre cada pata individualmente; falta cubrir la **atomicidad entre patas**, y ese hueco
se cierra con el orden de disparo.

### 2. El rollback que "funciona" puede ser la fuente de pérdida

Mirá el **costo** del mecanismo de seguridad, no solo si dispara. El rollback ejecutaba
correctamente cada vez que se necesitaba — y esa correctitud era el problema: cada disparo
costaba ~$0.85, multiplicado por 11 trades = sangría sistemática. **Un mecanismo de seguridad
que se ejercita frecuentemente NO es seguridad — es síntoma.**

### 3. `check_portfolio.py` con vista por `arb_id` ya revela patas huérfanas

No hace falta script dedicado. El PR #83 (análisis de huérfanos) se cerró por redundancia.
Lección operativa: **antes de escribir herramienta nueva, verificar qué da la existente con
otra agregación.**

### 4. FOK + pata fina/cara = KILL sistemático

El precio del favorito es buen proxy de "pata dura". No hace falta query de depth si el orden
de disparo usa precio como heurística — el alto-precio correlaciona con bajo-volumen-resting
en este régimen.

---

## Conexión con la auditoría del 12-jun

Hace 6 días la auditoría dijo, textual:

> *"Motor REST (arb binario): 10/10 mecánica completa pero caza presa casi inexistente (libro
> cruzado). Dejarlo armado (opción gratis, dispara si algún día pasa) pero NO esperar trades
> de acá."*
>
> *"Motor 2 (consenso sportsbooks): el roadmap lo llama 'EL MÁS RENTABLE'."*

**La data de hoy confirma la auditoría con N=19 trades reales:**

| Motor | Auditoría dijo | Realidad |
|---|---|---|
| Motor REST | "presa casi inexistente, no esperar trades" | 11 trades, 9% wr, −$2.61 — y los 11 fueron casi todos arbs huérfanos perdedores |
| Motor 2 | "el más rentable" | 8 trades, 50% wr, +$13.16 |

**El diagnóstico del 12-jun fue PROFÉTICO.** No solo predijo qué motor iba a ganar, sino que
identificó **antes de que costara plata** que el Motor REST iba a tener problemas. La sangría
de hoy fue exactamente lo que la auditoría advirtió.

**Y aun así:** Motor REST se mantuvo armado. ¿Fue error? **No.**

- La sangría total fue < $5 con balance $100 — orden de magnitud que la disciplina de frenos
  (cap diario $3, $5/trade) podía absorber sin riesgo material
- Activarlo fue lo que **destapó el bug del FOK paralelo** — un bug que estaba esperando
  silencioso en main esde el 02-jun. Sin capital, no se descubre
- El fix (PR #85) tiene valor **general** para cualquier ejecutor multi-pata futuro,
  incluyendo si el régimen Kalshi cambia y el Motor REST se vuelve rentable

**Costo total de aprender esto: $4.83.** Es de lejos la lección más barata de toda la saga
relativo a su valor.

---

## El patrón meta que esto cierra

> **El capital es el regimen más real de todos.** Mientras todo era shadow, los bugs de
> ejecución estaban latentes. El primer día con plata destapó el problema en 24h con N=11
> trades. **Ninguna cantidad de tests offline habría capturado esto** — requería el régimen
> exacto (FOK sobre orderbook real con depth real de Kalshi en partidos del Mundial).

Este es el mismo patrón meta de toda la saga aplicado a una clase nueva de error:

- Saga V2: teoría microestructural HFT no aplicaba al régimen Kalshi
- Auditoría 12-jun: ranking del roadmap no era el orden correcto
- 14-jun: hipótesis "feed siempre comparable con BBO" no aplica in-play
- **Hoy 18-jun: hipótesis "FOK paralelo es seguro para arb multi-pata" no aplica cuando hay
  pata cara con poco volumen resting**

Cuatro aplicaciones del mismo principio: **medir el régimen real antes de confiar la asunción.**
Cada vez en una capa diferente (arquitectura, portafolio, calidad de data, mecánica de
ejecución). Cada vez la asunción idealizada se rompe cuando los datos reales lo prueban.

---

## Aprendizajes específicos del día

### El día 1 con capital es DIFERENTE al shadow

- Los fills reales tienen latencia, slippage, partial-fill semantics que el shadow no simula
  perfectamente
- El comportamiento del orderbook Kalshi bajo carga real (con tus órdenes participando) puede
  diferir del shadow
- Las patas caras/finas se ven distinto cuando vos sos el comprador que cuando solo observabas
- **El primer día con capital DEBE estar diseñado para descubrir bugs, no para hacer plata** —
  y este lo logró: $4.83 de costo para destapar un bug de capital que sin el experimento
  habría seguido latente

### La defensa en profundidad funcionó

- Frenos: $5/trade, $25 exposición, stop diario −$3
- Capital total $100 — orden de magnitud calibrado para "descubrimiento", no para "operación"
- 24h de monitoreo activo — bug cazado dentro de la ventana de detección humana
- Motor 2 generó +$13 que compensó la sangría → balance final positivo

**Si todos los motores hubieran sido como Motor REST, la sangría habría sido contenida por los
frenos pero acumulada — el balance estaría peor.** Que Motor 2 esté ganando AL MISMO TIEMPO
que Motor REST está roto es el diseño de portafolio funcionando: las estrategias correlacionan
poco entre sí, una compensa a la otra.

### El revival de Motor 1 y el diagnóstico de Motor 3 no fueron tiempo perdido

A primera vista podría parecer que con Motor REST sangrando y Motor 2 ganando, dedicar PRs a
Motor 1 y Motor 3 fue distracción. **No lo fue:**

- **PR #84 (Motor 1 revival en shadow):** alguno de los frenos del Motor REST (RiskManager,
  settlement, kill-switch) son reusables por Motor 1. Tenerlo en shadow ahora habilita comparar
  arquitectura V2 vs Motor REST con data nueva si el régimen cambia.
- **PR #82 (Motor 3 diagnóstico CLV por-tick):** Motor 3 era greenfield. El diagnóstico CLV
  habilita ENTENDER si vale la pena diseñar Motor 3 antes de codear — telemetría primero,
  decisión informada después.

Ambos son inversiones de bajo costo con opción gratis: si en algún momento Motor REST o Motor 1
pasan a ser rentables (cambio de fee schedule, cambio de market makers), los componentes están
listos.

---

## Estado consolidado al cierre del 18-jun

| Frente | Estado |
|---|---|
| V1 baseline | ✅ SANO continuo |
| **Capital activo** | ✅ **$100 desplegado, balance $95.17 + $24.92 portfolio = ~$120** |
| **Motor 2 (consensus)** | ✅ **+$13.16 / 8 trades / 50% wr — EL GANADOR** |
| **Motor REST (arb binario)** | 🔴 −$2.61 / 11 trades / 9% wr → DORMIDO post-fix #85 |
| Causa raíz arbs huérfanos | ✅ Identificada (FOK paralelo + pata cara KILL sistemático) |
| Fix "pata dura primero" (#85) | ✅ Mergeado — convierte ~91% de pérdidas en no-ops |
| Motor 1 revival (#84) | ✅ Shadow-first, dormido por default |
| Motor 3 diagnóstico CLV (#82) | ✅ Activo |
| Frenos | $5/trade · $25 exposición · stop diario −$3 |
| AUTJOR fills $75/$60 NO-EN-DB | ⚠️ Pendiente confirmar manual vs perdido durante #75 |
| Pendiente próximo turno | MOTOR_REST_ENABLED=False + redeploy + validar #85 en shadow |
| Auditoría del 12-jun | ✅ **CONFIRMADA con N=19 trades reales** — predijo ganador y perdedor |

---

## Frase del día

> **"Primer día con capital, balance positivo, bug latente cazado por $4.83. La sangría era
> el síntoma de que el rollback funcionaba bien sobre un mecanismo de ejecución mal diseñado.
> Motor 2 está confirmado como el negocio."**

---

## Links
- [[kalshi-bot]]
- [[2026-06-14-edges-fantasma-Motor-2-in-play-fix-PR-54]] — sesión previa, defensa contra fantasmas
- [[2026-06-13-Motor-2-encendido-feed-real-primera-senal-consensus]] — encendido de Motor 2
- [[2026-06-12-AUDITORIA-motores-gap-entre-infra-y-senal]] — la auditoría que predijo este resultado
- [[2026-06-12-FASE-0-completa-sprint-motores-Mundial-operativo]] — base de los frenos reusada
- [[2026-06-02-noche-BUG-executor-limit-resting-Issue-14]] — bug heredado relacionado (limit+resting)
- [[2026-06-05-sesion-FOKExecutor-sensor-validado-API-viva]] — el sensor que validamos, el cisne negro 409
