---
tipo: sesion
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-18
tags:
  - kalshi
  - motor-2
  - motor-3
  - motor-rest
  - telegram
  - config-flags
  - bug
  - position_fp
  - escalado
  - post-mortem
  - sesion-conmigo
  - 2026-06-18
estado: en-validacion
frente: "Per-motor execution flags + bug position_fp arreglado + escalado Motor 2 + Telegram en apuestas"
sesion: claude-code
parte: 2
relacionado: "[[2026-06-18-PRIMER-DIA-CAPITAL-Motor-2-gana-Motor-REST-sangra-fix-pata-dura]]"
---

# 2026-06-18 (parte 2) — Flags por-motor, bug `position_fp`, escalado Motor 2, avisos Telegram

## TL;DR

Continuación del arreglo de los motores. Se descubrió que **`TRADING_ENABLED` es global**
(no hay control de ejecución por-motor) → se agregaron flags propios para poder **validar en
shadow sin apagar al ganador**. Se cazó un **bug de campo (`position_fp`)** que dejaba a
Motor 3 ciego y al dashboard mintiendo. Se escaló **Motor 2** (el ganador) y se sumó **aviso
de Telegram** en cada apuesta. **5 PRs mergeados (#85-#89).**

**Continúa de:** [[2026-06-18-PRIMER-DIA-CAPITAL-Motor-2-gana-Motor-REST-sangra-fix-pata-dura]]
— donde quedó documentado el descubrimiento del arb huérfano y el fix "pata dura primero".

---

## 🧱 Lección arquitectónica central: `TRADING_ENABLED` es GLOBAL

### No había control de ejecución por-motor

Un solo `TRADING_ENABLED` enciende/apaga la ejecución de **todos** los motores. Como Motor 2 ya
opera live, está en `True` → no se podía correr Motor 3 ni Motor REST en **shadow** para
validarlos sin (a) arriesgar plata real o (b) apagar a Motor 2.

**Esto era una restricción NO-evidente** hasta que el problema operativo lo destapó:
- Motor 2 ganando → no apagar
- Motor REST fix #85 mergeado → validar en shadow
- Motor 3 con bug `position_fp` → validar en shadow tras fix
- Pero `TRADING_ENABLED=True` (Motor 2) los ponía a TODOS en modo live → trampa

### Patrón de fix (reusable)

**Flag de ejecución propio por motor, en consenso con el global:**

- Motor 3 → `MOTOR_3_EXECUTION_ENABLED` (PR #86)
- Motor REST → `MOTOR_REST_EXECUTION_ENABLED` (PR #88)
- Regla: **ejecuta sólo si `TRADING_ENABLED AND MOTOR_X_EXECUTION_ENABLED`**

Con el propio en `False` → corre en shadow (detecta + loguea) aunque el global esté on.

**Por qué este patrón es importante para portafolio multi-motor:**

Una vez que tenés un motor ganador en producción, no podés "pausar todo para experimentar" sin
costo de oportunidad. El gate global como ÚNICO interruptor es lo que está bien para un solo
motor; cuando hay varios, cada uno necesita su gate propio AND con el global. **Mismo principio
que el muro de 3 capas: defense in depth con flags independientes.**

---

## 🐛 Bug `position_fp` (PR #87) — el bloqueador real de Motor 3

### Campo mal nombrado, falla en silencio

Kalshi devuelve la cantidad de posición como **fixed-point string en `position_fp`**
(ej. `"-1.00"`), NO en `position`. El código leía `position` → `None` → **descartaba TODAS las
posiciones como "cantidad cero"**.

### Afectaba 4 lectores

1. **`motor_3_clv/poller.py`** → `portfolio_positions` vacía → Motor 3 escaneaba **0 posiciones**
   (Motor 3 estaba ciego)
2. **`motor_rest_arb/executor.py` `_has_open_position`** → 2da fuente del reconcile real-money
   siempre decía "sin posición" (el guardián del reconcile estaba mintiendo)
3. **`scripts/check_portfolio.py`** → el **dashboard** mostraba todo como `position=0`
   (dashboard mintiendo)
4. **`scripts/clear_kill_switch.py`** → display + `int("-1.00")` rompía
   (kill-switch parcialmente roto)

### Fix

Leer `<campo>_fp` con fallback al plano (robusto ante ambos shapes). `_as_int` ya toleraba
`"-1.00"`.

**Patrón del fix:** *"primer intento con `_fp`, fallback al plano sin extensión"*. Esto es
forward-compatible (si Kalshi cambia el shape) y backward-compatible (con tests/fixtures
antiguos).

### ⚠️ Implicación retroactiva — AUTJOR

> El análisis de **AUTJOR** ("position=0 → settlement pendiente") salió de `check_portfolio`,
> que leía mal → **esas posiciones probablemente están abiertas de verdad.**

**Mismo espíritu que el bug de firma 401** (PR #75): un error de lectura/firma que contamina
decisiones aguas abajo. El "cabo abierto AUTJOR $75/$60 NO-EN-DB" de la parte 1 pivota — no
estaban necesariamente perdidos en DB; el dashboard mentía porque leía el campo equivocado.

**Tres bugs de "leer la realidad mal" identificados en la saga:**
1. **#75 (firma 401):** firmar path con querystring → 401 → no podía leer cartera real
2. **#87 (position_fp):** leer `position` en vez de `position_fp` → todo aparecía como 0
3. **#52 (throttle alertas) + #54 (in-play vs Odds API):** asunciones implícitas de tiempo y
   comparabilidad

**Patrón común:** todos fallan **en silencio** — no excepción, no log de error, solo decisiones
sesgadas aguas abajo. Por eso valen tanto los gates adversariales — son la única forma de
cazarlos.

---

## 💰 Escalado de Motor 2 (el ganador)

### El cuello NO era el size por-trade

`usable=$0.11` (lo que se podía apostar por señal) venía del **cap de exposición simultánea
(25%)** saturado por ~$24.92 ya atados.

**El pool es global** (compartido por todos los motores), no por-motor. Cuando Motor REST
tenía patas resting + Motor 2 con varias posiciones abiertas → exposición simultánea cerca del
cap → bet usable colapsaba.

**Lección operativa:** *"mirar dónde se satura el pool antes de subir números"*. Subir
`MAX_TRADE_SIZE_PCT` sin liberar exposición simultánea no habría cambiado nada — el cuello
estaba en otro cap.

### Decisión

- **Depósito → `ACTIVE_CAPITAL_USD=300`** (subir el flag sin agregar plata = over-betting; por
  eso primero el depósito)
- `MAX_SIMULTANEOUS_EXPOSURE_PCT` **25→50**
- `MAX_TRADE_SIZE_PCT` **5→10**
- Resultado a $300: exposición simultánea $150, bet Kelly ~$5/señal (3×), stop diario $9

### ⚠️ Caveat

8 trades / 1 día es **muestra chica** → escalar modesto, juntar track record antes de $1k+.

**Discipline check sobre el escalado:**
- N=8 trades con 50% wr y +$13.16 es señal positiva PERO ruido alto
- Si la varianza true del win-rate es 35-65% (probable con N=8), el P&L true podría ir de
  +$5 a +$25 con mismas condiciones
- Triplicar capital implica 3× la varianza del P&L
- $300 sigue siendo orden de magnitud "descubrimiento" — no $3k

---

## 🎰 Avisos de Telegram (PR #89)

### Motor 2 no avisaba nada

(ni importaba `telegram_alerts`). Solo Motor REST tenía `alert_trade`.

### Nueva función

`alert_bet_placed()` genérica → se dispara en el **fill** de Motor 2 (no en IOC-sin-fill, no
shadow).

**Best-effort aislado:** si Telegram cae, no rompe el loop. Esto es **principio operacional
reusable** — notificaciones nunca deben poder romper el loop de ejecución.

### Setup

Requiere `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` en Coolify (si ya llega el aviso de
arranque, ya están).

---

## 📦 PRs de esta parte

| PR | Qué |
|---|---|
| #85 | Motor REST guardarraíl pata-dura-primero (causa raíz del arb huérfano — documentado en parte 1) |
| #86 | `MOTOR_3_EXECUTION_ENABLED` (shadow desacoplado) |
| #87 | fix `position_fp` (4 lectores) |
| #88 | `MOTOR_REST_EXECUTION_ENABLED` (shadow desacoplado) |
| #89 | aviso Telegram en apuesta (Motor 2) |

---

## ⚙️ Estado objetivo en Coolify (env + redeploy)

```bash
# Motor 2 — escalar (tras acreditar depósito a $300)
ACTIVE_CAPITAL_USD=300
MAX_SIMULTANEOUS_EXPOSURE_PCT=50
MAX_TRADE_SIZE_PCT=10

# Motor REST — validar guardarraíl en SHADOW (Motor 2 sigue live)
MOTOR_REST_ENABLED=True
MOTOR_REST_EXECUTION_ENABLED=False

# Motor 3 — validar en SHADOW (poller ya ve posiciones tras #87)
MOTOR_3_CLV_ENABLED=True
MOTOR_3_EXECUTION_ENABLED=False

# Telegram (si no están ya)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

---

## ✅ Validación post-deploy (qué mirar)

- [ ] `[MOTOR 3 DIAG]`: `posiciones=0` → `posiciones=8` con `con_close_time` resolviéndose
- [ ] Motor REST shadow: en cruces huérfanos, log `rest_exec.hard_leg_kill → no se envían N patas`
      (el no-op de #85)
- [ ] `check_portfolio.py`: posiciones reales (no todo `position=0`) → ver estado verdadero de
      AUTJOR
- [ ] Llega un 🎰 a Telegram en la próxima apuesta de Motor 2

---

## ➡️ Flips a live (uno por uno, cuando shadow confirme)

1. `MOTOR_REST_EXECUTION_ENABLED=True` (+ subir `MOTOR_REST_EXECUTION_EDGE_PCT` para rollback
   residual)
2. `MOTOR_3_EXECUTION_ENABLED=True`

**Orden importa:** uno por uno, con monitoreo de la ventana de detección humana en cada flip.
**No flip simultáneo** — si algo sale raro, querés saber CUÁL motor fue.

---

## 🟡 Pendiente

- [ ] **AUTJOR ($75 + $60):** con el dashboard arreglado, ver estado real → mantener o cerrar
      (hay script disponible si se quiere)

Esta es la deuda del cabo abierto de la parte 1, pivoteada con el descubrimiento del bug
`position_fp`. La hipótesis original ("perdidos en DB durante #75") ahora es menos probable —
la hipótesis nueva es "están abiertas, el dashboard mentía".

---

## 🧠 Lecciones reusables

### 1. Un flag global de trading no alcanza

Para validar motores en shadow sin apagar a los que ganan, hace falta un **gate de ejecución
por-motor**. El gate global es OK para un solo motor; con varios motores, cada uno necesita su
gate propio AND con el global.

### 2. Bugs de nombre de campo de API fallan en silencio

`position_fp`, querystring de firma, `fill_count_fp` (cisne negro del 05-jun), etc. fallan en
silencio y contaminan decisiones aguas abajo (el dashboard, los reportes, el sensor del
executor). **Patrón de fix:** leer `_fp` con fallback al plano — robusto ante ambos shapes,
backward y forward compatible.

### 3. El cuello de capital era el cap de exposición global, no el size por-trade

**Mirar dónde se satura el pool antes de subir números.** Si subís el `MAX_TRADE_SIZE_PCT` sin
ver que el cuello es el `MAX_SIMULTANEOUS_EXPOSURE_PCT`, no cambia nada — el bet sigue
colapsando a $0.11.

### 4. Notificaciones = best-effort aislado

**Nunca deben poder romper el loop de ejecución.** Telegram down ≠ executor down. Try/except
amplio alrededor de cualquier llamada a notificación. Esto es principio operacional general,
no solo para este bot.

---

## Conexión con el patrón meta de la saga

Esta parte 2 agrega más matices al patrón meta de "medir el régimen real antes de confiar la
asunción":

**Las asunciones implícitas más peligrosas son las de ESTRUCTURA, no las de cálculo:**

- "El cálculo del edge está bien" ✅ (las 137 señales sanas del 14-jun lo prueban)
- "El campo se llama `position`" ❌ (es `position_fp`)
- "El gate global cubre todos los motores" ❌ (cuando hay varios)
- "El cap de exposición global es por-motor" ❌ (es compartido)
- "Telegram nunca cae" ❌ (puede)

**Cada una de estas es una asunción estructural** que el régimen real refuta cuando lo medís.
Y todas pasaron desapercibidas en revisión de código porque "el código corre bien" — solo
aparecen cuando interactúa con el régimen real y la decisión depende de la lectura correcta de
la estructura.

---

## Estado consolidado al cierre del 18-jun (parte 2)

| Frente | Estado |
|---|---|
| Per-motor execution flags (#86, #88) | ✅ Mergeados — Motor REST y Motor 3 pueden correr shadow sin apagar Motor 2 |
| Bug `position_fp` (#87) | ✅ Mergeado — 4 lectores corregidos |
| Motor 3 ya no ciego | ✅ Poller ve posiciones tras #87 |
| Dashboard `check_portfolio.py` | ✅ Muestra posiciones reales |
| Reconcile real-money del executor | ✅ 2da fuente ya no miente |
| AUTJOR retroactivo | 🟡 Probable que estén abiertas — verificar con dashboard arreglado |
| Escalado Motor 2 | 🟡 Decisión: depósito → $300 + caps subidos. Caveat: muestra chica |
| Telegram `alert_bet_placed` (#89) | ✅ Mergeado, best-effort aislado |
| Próximos flips a live | Uno por uno, con validación shadow primero |
| Tres bugs de "leer realidad mal" identificados | #75 firma 401, #87 position_fp, #54 in-play vs Odds API |

---

## Frase del día (parte 2)

> **"El régimen real no solo refuta asunciones de cálculo — refuta asunciones de estructura.
> Un flag global, un nombre de campo, un cap compartido. Cada uno es una decisión arquitectónica
> que el primer día con capital y multi-motor destapó."**

---

## Pregunta operativa al cierre

> *"¿Querés que lo fusione con la nota de la parte 1 en una sola nota maestra, o que lo parta
> en notas atómicas (una por bug/lección)?"*

**Recomendación:** mantener separadas con cross-link (como está ahora). Razones:
- Parte 1 cuenta el **descubrimiento del bug del arb** (post-mortem narrativo)
- Parte 2 cuenta los **arreglos arquitectónicos** (flags, position_fp, escalado)
- Son flujos distintos del mismo día — fusionar diluye el foco de cada uno
- NotebookLM las puede correlacionar por el frontmatter `relacionado`

Si en algún momento querés una "nota maestra" del día, vale más sumarizarla cuando esté la
validación de los flips a live confirmada — ahí sí se cierra el arco completo.

---

## Links
- [[kalshi-bot]]
- **[[2026-06-18-PRIMER-DIA-CAPITAL-Motor-2-gana-Motor-REST-sangra-fix-pata-dura]] — parte 1 (post-mortem narrativo)**
- [[2026-06-14-edges-fantasma-Motor-2-in-play-fix-PR-54]] — defensa contra fantasmas in-play
- [[2026-06-12-AUDITORIA-motores-gap-entre-infra-y-senal]] — la auditoría profética
- [[2026-06-05-sesion-FOKExecutor-sensor-validado-API-viva]] — cisne negro del 409 (similar al `position_fp`)
