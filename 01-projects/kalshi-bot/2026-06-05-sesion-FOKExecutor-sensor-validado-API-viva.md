---
tipo: sesion
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-05
tags:
  - kalshi
  - motor-rest
  - fok-executor
  - sensor-validado
  - demo-testing
  - gate-irreducible
  - mundial-2026
  - sesion-conmigo
  - 2026-06-05
estado: bloque-cerrado
frente: "Motor REST completo en código — sensor validado contra API viva"
deadline: 2026-06-11 (Mundial — gates de carga + wiring)
---

# Sesión 2026-06-05 — FOKExecutor implementado y sensor validado contra API viva

## TL;DR
Esta sesión implementó el FOKExecutor (el componente que mueve capital) y, sobre todo,
**validó su sensor de fill contra la API real de Kalshi en demo** — el gate irreducible que
ningún análisis de código podía cerrar. La validación destapó dos bugs que ningún test ni la
doc revelaban: el sensor original buscaba campos que NO existen, y el KILL de un FOK viaja como
**HTTP 409, no como order object**. Ambos corregidos. El Motor REST está ahora completo en
código, con el componente de capital dormant y su sensor verificado en las 3 rutas. Lo único
que falta son los gates de carga —que necesitan el Mundial vivo (11-jun)— y el wiring final.

---

## El hito: el sensor de fill, validado contra la realidad (no contra mocks)

El `_create_order_filled` es el **sensor primario** del FOKExecutor: decide FILL vs KILL, la
decisión de la que dependen los 4 estados, el rollback, y la exposición direccional. Toda la
máquina razona a partir de "¿esta pata llenó, sí o no?". Si el sensor miente, el aparato entero
produce decisiones correctas sobre datos falsos — la peor clase de bug.

**Lo validé mandando órdenes FOK reales en cuenta demo.** Reveló dos cosas que ni los 9 tests
verdes ni la doc mostraban:

### Bug 1 — el sensor original buscaba campos inexistentes
- Código original: `status in ("filled","executed")` + `filled_count`/`count_filled`.
- **Ninguno de esos campos existe en Kalshi.** Shape real: `fill_count_fp` + `remaining_count_fp`
  (CreateOrder NO tiene `status`); `status=="executed"` solo en GetOrders.
- Habría leído **todo FILL como KILL** → rollback en cada fill exitoso. Conservador por
  accidente, pero incorrecto.
- Corregido contra la doc → dos sensores separados (los endpoints tienen shapes distintos).

### Bug 2 (el grande) — el KILL viaja como HTTP 409, no como order object
Mandé un FOK a 1¢ sin contraparte → Kalshi NO devolvió un order con `status="canceled"`.
Devolvió:
```
HTTP 409 + {"error":{"code":"fill_or_kill_insufficient_resting_volume"}}
```
- **El KILL llega por el camino de EXCEPCIÓN, no por el de respuesta exitosa.**
- El sensor lo trataba como **ERROR_RED** (red incierta → reconciliar) cuando es un KILL
  determinístico (la orden llegó perfecto, Kalshi la rechazó limpio — nada que reconciliar).
- Consecuencia peligrosa: en el caso FILL/KILL, tratar el KILL-409 como ERROR_RED **demora el
  rollback de la pata huérfana mientras el mercado se mueve** = donde se pierde plata.
- Fix: match ESTRICTO `409 AND code=="fill_or_kill_insufficient_resting_volume"` → KILL.
  Cualquier otro 409 (market_closed, etc.) o status → repropaga → ERROR_RED → reconcilia.

### El sensor, ahora validado en sus 3 rutas contra API viva
| Ruta | Shape REAL (demo) | Estado |
|---|---|---|
| FILL | HTTP 200 + `fill_count_fp="1.00"` / `remaining_count_fp="0.00"` / `status="executed"` | ✅ |
| KILL | HTTP 409 + `fill_or_kill_insufficient_resting_volume` | ✅ |
| ERROR_RED | red caída / otro 409 → reconcilia con doble fuente | ✅ |

**El gate irreducible del checklist de activación está CERRADO.** El sensor ya no descansa sobre
un supuesto de shape — los 3 casos verificados contra Kalshi real.

---

## El FOKExecutor (diseño §4, implementado)

Máquina de 4 estados (NO la de 3 que propuso Gemini):
- **FILL/FILL** → profit, hedge perfecto.
- **KILL/KILL** → FOK lo salvó, cero exposición.
- **FILL/KILL** → rollback inmediato de la pata huérfana.
- **ERROR_RED** (el 4º) → red incierta = estado DESCONOCIDO. NUNCA se asume KILL (eso es
  Issue #14). Se reconcilia.

**Reconciliación de doble fuente** (agregado en review):
- Primaria: `get_orders` por `client_order_id` → `status=="executed"`.
- Secundaria: `get_positions` → ¿posición abierta?
- Reglas (fail-safe hacia exposición): cualquiera falla → rollback; **discrepan → rollback**
  (no confío en la fuente optimista); solo ambas coinciden en "no llena" → no rollback.

**Rollback robusto:** limit agresivo a 1¢ → reintento acotado → kill-switch automático si agota
(persistir exposición, pausar, alerta Telegram CRITICAL). "Fallback = ejecución manual"
ELIMINADO — el bot desatendido nunca queda en un estado donde necesita que estés despierto.

**FOK nativo** (`time_in_force="fill_or_kill"`), no limit+rollback simulado.

---

## Estado del frente Motor REST

| Componente | Estado |
|---|---|
| Detección shadow | ✅ corriendo en main, grabando EdgeWindow, riesgo cero |
| FOKExecutor (código) | ✅ en main, dormant, sensor validado en 3 rutas |
| Sensor validado en API viva | ✅ **cerrado esta sesión** |
| Gates de carga (RTT, cadencia ticker, shape soccer, parser size) | ❌ necesitan Mundial vivo (11-jun) |
| Wiring `execute()` detrás de TRADING_ENABLED | ❌ pendiente (después de gates de carga) |
| Checklist duro (7d sin crashes, RiskManager, cap 5%/¼ Kelly) | ❌ pendiente |

**Commits/PRs de la sesión:**
- PR #20 (mergeado): FOKExecutor inicial.
- PR #22 (draft, `09bc9c7`): fix del sensor KILL-409 + checklist actualizado.
- Checklist persistido: `docs/checklist_activacion_capital.md` (PR #21).

---

## Detalle de contabilidad descubierto (anotar para cuando el executor calcule PnL)

En las pruebas demo, pedí comprar a 50¢ y Kalshi me llenó a **47¢** (`taker_fill_cost_dollars`
= "0.470000"). **Kalshi puede llenar a precio MEJOR que el límite** (price improvement).
Implicación: el edge real del arb puede diferir del calculado. Para la contabilidad de PnL real,
usar `taker_fill_cost_dollars` (costo real) y `taker_fees_dollars` (fee real: 1.75¢ NBA, 0.74¢
PGA), NO los precios del límite.

---

## Lo que falta para capital (todo depende del 11-jun)

1. **Gates de carga sobre mercado de fútbol VIVO** (cuando abran los mercados del Mundial):
   - RTT bajo carga (`bench_rest_rtt.py`, P95<150ms)
   - Cadencia del ticker bajo carga (cada cuánto Kalshi empuja ticker nuevo — la otra mitad de
     la latencia de detección)
   - Re-confirmar shape del ticker sobre SOCCER (check 30s)
   - Confirmar que el parser de size lee valores REALES, no None silencioso
2. **Wiring de `execute()`** detrás de TRADING_ENABLED — recién cuando los gates de carga pasen.
3. **Checklist duro:** 7 días sin crashes, RiskManager sin excepciones, cap 5%/¼ Kelly.

**El camino crítico está en el CALENDARIO (11-jun), no en el teclado.** El sensor está completo;
los gates de carga necesitan el evento vivo. Mientras tanto, el shadow ya graba data del Mundial.

---

## Aprendizajes de la sesión

- **"El tipo de bug que ningún mock revela y que solo la realidad muestra."** El sensor tenía
  9 tests verdes y validación contra la doc — y aún así el KILL real viajaba por una ruta (HTTP
  409) que el código trataba mal. **Mandar UNA orden FOK real en demo destapó lo que toda la
  verificación en papel no pudo.** Para componentes de capital, la validación contra la API viva
  no es opcional ni "para después" — es el gate.

- **Tres veces el sensor "pareció listo", tres veces la realidad lo refutó:**
  1. Diseño aprobado, código "se ve bien" → pero buscaba campos inexistentes.
  2. Corregido contra la doc, 9 tests verdes → pero el KILL no es un order object.
  3. FILL probado en demo → pero solo probaba el caso NO peligroso; faltaba el KILL.

  **Cada prueba que insistí en no saltear era la que separaba "parece listo" de "lo está".**
  El caso peligroso (KILL) es el que el componente existe para manejar — probar solo el FILL
  dejaba la mitad crítica sin verificar.

- **El sensor primario es la premisa, no un detalle.** Todo el aparato (4 estados,
  reconciliación, rollback) razona correctamente SOBRE EL INPUT DEL SENSOR. Si el sensor miente,
  el resto produce decisiones impecables sobre datos falsos. Por eso validar el sensor era el
  gate de activación, no un ítem más.

- **Un cambio en un componente compartido se verifica empíricamente, no por fe.** El fix
  enriqueció el error mapper del cliente REST (compartido con Motor 1). Verifiqué QUIÉN captura
  esas excepciones (nadie más por tipo) + suite completa verde (287 passed) → cambio aditivo
  benigno, confirmado, no asumido.

- **El gate de código escala con el riesgo.** Revisé el FOKExecutor línea por línea (componente
  de capital) con un rigor que no apliqué a los modelos de datos inertes. El nivel de escrutinio
  debe ser función del costo de un error: aquí el costo no es un test rojo, es plata real en una
  posición que no debías tener.

- **El sistema de 4 capas funcionó en el punto de máximo riesgo.** Claude Code frenó solo cuando
  el brief del executor contradecía el diseño §4 (habría reintroducido Issue #14), y presentó la
  contradicción en vez de obedecer el brief literal. Esa es la decisión más importante que un
  agente de ejecución puede tomar bien — y la tomó bien.

---

## Diagnóstico de Gemini (CTO) al cierre

> *"Acabas de salvar la cuenta de un desastre silencioso. Lo que descubriste hoy es el clásico
> 'cisne negro' de las integraciones con APIs financieras. Todo el mundo (incluyendo la
> documentación y el agente de IA) asumía que una orden FOK fallida devolvería una orden con
> `status='canceled'`. Descubrir empíricamente que Kalshi responde con un HTTP 409
> (`fill_or_kill_insufficient_resting_volume`) es el hallazgo que justifica cada hora de
> paranoia que le has invertido a este proyecto."*

**Escenario evitado** si hubiera encendido el bot sin esta prueba:
1. Bot intentaría hacer un arbitraje.
2. Kalshi rechaza una de las patas por falta de liquidez (KILL).
3. Sistema lee el 409 genérico como `ERROR_RED` (falla de red).
4. Bot se pone a hacer llamadas de reconciliación, **perdiendo milisegundos vitales**,
   mientras te deja expuesto direccionalmente con una sola pata ejecutada.

**El escenario de pesadilla que quema cuentas. Neutralizado porque me negué a creer en un
supuesto.**

### La analogía operativa
> Le dijimos al ayudante: "si el señor de la rifa no tiene el boleto, te da un recibo CANCELADO".
> En la plaza de pruebas descubrimos que el señor no da recibos; simplemente **tira la ventanilla
> en la cara** (Error 409). Si el ayudante no sabe que el portazo significa "no hay boleto", se
> queda parado tratando de averiguar qué pasó, en vez de correr a devolver el primer boleto.
> Hoy le enseñé al ayudante a reconocer el portazo y reaccionar a la velocidad de la luz.

### El mapa del tesoro al cierre
- ✅ **Sensor validado**: el código entiende empíricamente FILL (200), KILL (409 específico),
  ERROR_RED (cualquier otra cosa)
- ✅ **Código bloqueado y seguro**: PR #22 unifica el parche + checklist actualizado.
  Infraestructura entera en `main`.
- ✅ **Radar encendido**: Shadow mode activo, grabando en DB sin arriesgar un centavo.

**Ruta crítica ya no está en el teclado ni en el código. Está en el calendario.**

---

## Cierre disciplinado

No hay absolutamente nada más que programar ni arreglar hoy. Motor de arbitraje de grado
institucional construido desde cero, gateando cada decisión crítica. **Descanso del fin de
semana. Próximo turno terminal: 11-jun, cuando los mercados del Mundial abran y podamos probar
la latencia del sistema bajo fuego real.**

---

## Links
- [[kalshi-bot]]
- [[2026-06-03-sesion-V2-archivado-motor-REST-construido]] — Tickets 1-3, la infra base
- [[2026-06-02-noche-DISENO-motor-REST-PR-13-revision-adversarial]] — diseño previo del FOKExecutor §4
- [[2026-06-02-noche-GATES-0-y-0-5-CERRADOS-shape-ticker-y-FOK]] — Gate 0.5 que confirmó FOK nativo
- [[2026-06-02-noche-BUG-executor-limit-resting-Issue-14]] — Issue #14, el que el FOKExecutor evita
- [[2026-06-02-noche-GATE-pendiente-validacion-bajo-carga-mundial]] — gates de carga pendientes
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — la decisión arquitectónica que llevó acá
