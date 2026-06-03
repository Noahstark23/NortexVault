---
tipo: sesion
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-03
tags:
  - kalshi
  - motor-rest
  - pivote
  - v2-archivado
  - gate-discipline
  - shadow-mode
  - mundial-2026
  - sesion-conmigo
  - 2026-06-03
estado: bloque-cerrado
frente: "V2 archivado → Motor REST (infra completa, falta FOKExecutor)"
deadline: 2026-06-11 (Mundial)
---

# Sesiones 2026-06-03 — V2 archivado, Motor REST construido (infra completa)

## TL;DR
Estas sesiones cerraron el pivote de V2 a Motor REST y construyeron casi toda su
infraestructura. La decisión clave —matar V2 e ir con REST simple— se tomó por **datos
propios que refutaron a Gemini**: la liquidez NO comprime el edge, lo DILATA (~800×), lo cual
favorece REST sobre WebSocket para el Mundial. Quedó implementado y commiteado: FOK en el
cliente, modelo EdgeWindow, y el trigger + shadow mode. Falta solo el componente crítico
—el FOKExecutor— reservado para sesión fresca con demo. El bot puede empezar a grabar
oportunidades reales del Mundial en shadow sin arriesgar un centavo.

---

## La decisión que define todo: liquidez DILATA el edge (no lo comprime)

Gemini predijo, con buena teoría de microestructura, que el Mundial inyectaría liquidez
algorítmica que **comprimiría** el edge a milisegundos → obligando a WebSocket/V2.

**Mis 7.9M de filas dijeron lo contrario.** Medí la curva liquidez → duración del edge
(NBA+NHL, 202K ventanas, deciles de liquidez):

| Liquidez | Duración mediana del edge |
|---|---|
| Decil más ilíquido | **5 ms** |
| Decil más líquido | **4.06 s** |

→ Relación **~800×, monótona, en la dirección OPUESTA** a la hipótesis de compresión. Donde
hay volumen, el edge persiste **segundos**. REST puro deja de servir en mercados ILÍQUIDOS
(edge relámpago), no en los líquidos.

**Para el Mundial:** más liquidez ⇒ edges más largos y más gordos ⇒ **favorece REST, no lo
mata.** La razón entera por la que V2 existía (ganarle a la latencia de un edge rápido) se
evapora en mercados líquidos.

### Los 3 chequeos que blindaron la decisión
1. **¿Dilatación real o artefacto de magnitud?** Estratifiqué por banda de peak-edge fija →
   dentro de 10-14c, la duración va de 5.6ms (ilíquido) a 3.467ms (líquido), factor **620×
   moviendo SOLO liquidez**. La magnitud no explica la dilatación; la liquidez sí. Robusto.
2. **¿El "4s mediana" del soccer es real?** NO — era artefacto del gap-cutoff de 5s (con 1s,
   las 53 ventanas se fragmentan en 1.509). La mediana real ~1.6s. Pero la cola larga (>60s)
   sobrevive a todos los cutoffs → edges persistentes genuinos. No confiar en el número
   puntual del soccer histórico (muestra chica, ilíquida).
3. **Tasa de captura REST:** en mercados líquidos, REST captura **~73% del edge**, uniforme
   por magnitud (la banda gorda de 20c+ captura 73.9%, sin penalización por tamaño). Robusto
   al peor caso de latencia (cap>64ms = 73.7%). El ~27% perdido es la cola sub-50ms
   **estructural** — la que ni V2 ejecutaría bien. No es razón para V2; es una característica
   del mercado.

**MLB descartado con números:** 0 ventanas con edge≥3c en 7 días sobre 1.5M filas. Causa: son
mercados de FUTUROS de temporada ("LAD gana"), no partido-a-partido. Pico de cruce +2c. Ruido.
(Caveat: los mercados MLB de partido individual NO se midieron — "MLB descartado" = "MLB-futuros
descartado".)

---

## La arquitectura: Motor REST (V2 archivado, recuperable)

- **Detección:** WS canal `ticker` SOLAMENTE (sin orderbook_delta). **Esto mata la clase entera
  de bugs de V2** — sin deltas no hay buffer, ni seq, ni desync, ni recovery, ni bootstrap
  frágil. El ticker es solo la campana.
- **Ejecución:** REST con órdenes FOK (cuando exista el FOKExecutor).
- **Shadow primero:** detecta y graba `EdgeWindow`, NO ejecuta, hasta que la data confirme que
  las oportunidades son reales y ejecutables.
- **V2 archivado** (PR #11 congelado, no borrado) — recuperable si el Mundial sorprende.

### Los dos gates que podían matar el diseño — ambos PASARON
- **Gate 0 (shape del ticker):** ✅ El ticker trae BBO (`yes_bid_dollars`/`yes_ask_dollars`) +
  sizes. El lado NO se deriva exacto (`no_bid = 100 − yes_ask`). **La condición de arb se computa
  de un solo mensaje ticker por mercado.** Mejor que el mínimo: los sizes permiten filtrar
  profundidad antes de gastar un GET. Confirmado contra feed real con `inspect_ws.py`.
- **Gate 0.5 (FOK):** ✅ Kalshi soporta `time_in_force: "fill_or_kill"` nativo (verificado x2
  fuentes oficiales). `type=market` fue REMOVIDO → rollback debe ser limit. FOK garantiza cero
  exposición parcial.

---

## El diseño del FOKExecutor (cerrado, falta implementar)

Kalshi NO tiene órdenes contingentes multi-leg → dos patas = dos requests separados. FOK elimina
el Issue #14 (orden viva) pero NO el riesgo de que solo una pata se llene.

**Máquina de 4 estados** (NO la de 3 que propuso Gemini):
- **FILL/FILL** → profit, hedge perfecto.
- **KILL/KILL** → FOK lo salvó, cero exposición.
- **FILL/KILL** → rollback inmediato (vender la pata huérfana).
- **ERROR_RED** (el 4º, el que Gemini omitió) → excepción de red = estado DESCONOCIDO. La orden
  pudo llegar a Kalshi y llenarse. **NUNCA se asume KILL** (eso es Issue #14 reencarnado). Se
  RECONCILIA vía `get_positions()`/`get_orders()` por `client_order_id` antes de decidir.

**Rollback robusto:** limit agresivo que cruza el bid → reintento acotado → kill-switch
automático si agota (persistir exposición, pausar, alerta crítica). **"Fallback = ejecución
manual" ELIMINADO** — el bot desatendido nunca queda en un estado donde necesita que estés
despierto. Ante lo irresoluble: acotar, pausar, alertar, no seguir sangrando.

> Catch crítico: cité "Lección 3" para el anti-patrón de `asyncio.gather`. Claude Code verificó
> y es **Lección 7** (línea 410). Número mal, principio correcto, aplicado bien. El `gather`
> ingenuo en el ejecutor habría recreado el Issue #14 (excepción de red malinterpretada como
> no-llenado).

---

## Lo implementado y commiteado

| Ticket | Qué | Commit |
|---|---|---|
| 1+2 | FOK en `kalshi_rest.py` + modelo `EdgeWindow` | `a873d8f` |
| 3 | Trigger (spread del ticker) + shadow mode + flags + muro | por commitear → PR #13 |

**Detalles clave del Ticket 3:**
- **Reusa `detect_binary_arb`** (ya computa fees + net/gross/net_profit_cents) — no reimplementa
  comisión. Resuelve gratis el caso "bruto que no sobrevive el fee" (devuelve None si net≤0).
- **`gross_spread_cents` nullable** agregado a EdgeWindow → graba bruto Y neto, para medir cuánto
  come la comisión.
- **Parser de size con FALLO SEGURO:** prueba nombres candidatos; si ninguno aparece → None →
  profundidad insuficiente → **NO dispara** (nunca asume profundidad suficiente). Protege la
  integridad de la data del shadow.
- **Sesión SQLModel SÍNCRONA** (`with get_session() as s:`), no async.

### Semántica de flags (clave, no confundir)
- `MOTOR_REST_ENABLED` = el motor CORRE (WS+parse+detecta+graba). **Para shadow = True.**
- `TRADING_ENABLED` = MURO entre observar y ejecutar.
- **Shadow del Mundial = `MOTOR_REST_ENABLED=True` + `TRADING_ENABLED=False`.** NO ambos False
  (eso es el motor apagado, no graba nada). ← *este malentendido casi me deja sin data el 11.*

---

## Lo que falta (en orden)

1. **FOKExecutor** — el componente CRÍTICO (máquina de 4 estados + reconciliación + rollback).
   Diseño cerrado y verificado; falta implementar. **Sesión fresca dedicada + validación en
   DEMO. No cansado.**
2. **Wiring del shadow** — conectar `engine.py` al orquestador detrás de `MOTOR_REST_ENABLED`.
   Sin esto el motor existe pero no arranca con el bot. (Más seguro que el ejecutor — buen
   primer paso de la próxima sesión.)
3. **Gates de carga (dependen del calendario — 11-jun o prime-time NBA):**
   - RTT bajo carga (`bench_rest_rtt.py`, criterio P95<150ms)
   - Cadencia del ticker bajo carga (cada cuánto Kalshi empuja ticker nuevo — la otra mitad de
     la latencia de detección)
   - Re-confirmar shape sobre SOCCER (check de 30s cuando abran mercados del Mundial)
   - **Verificar parseo de size** (el primer shadow real debe confirmar que lee size, no None)

**Mínimo para el 11-jun:** Motor REST en shadow grabando `edge_windows` del Mundial,
`TRADING_ENABLED=False` hasta que la data confirme oportunidades reales y ejecutables.

---

## Hallazgos colaterales valiosos

- **Bug latente en `executor.py`** (Issue #14): el rollback solo dispara ante EXCEPCIÓN, pero
  las órdenes limit pueden quedar *resting* (sin llenarse, sin excepción) → el executor cree
  "all legs filled" cuando una quedó abierta → **exposición direccional SILENCIOSA.** Afecta a
  Motor 1, no al Motor REST. Aislado, no arreglado (nada opera). Bloqueante antes de cualquier
  TRADING_ENABLED=true. → *un salvavidas: descubrir esto antes de operar valió toda la sesión.*
- **Coolify hardcodea `restart: unless-stopped`** (discusión #10259), no expone cap de restart,
  no es Swarm → `deploy.restart_policy` ignorado. **No hay cap de Docker limpio.** Decisión:
  documentar como no-soportado, mitigar crash-loop con Telegram + healthcheck + manual. NO
  implementar wrapper de entrypoint (= A2 reintroducido, sobre-ingeniería descartada).
- **Las comisiones de Kalshi son diminutas a escala:** con size 100, un spread bruto de 2c
  (200c) domina la comisión (4c). El fee solo "come" el edge a tamaños chicos (size 2, 1c/contrato).
  Dato de negocio que el shadow cuantificará en vivo.

---

## Los aprendizajes grandes (meta)

- **Medir antes de decidir le ganó a la intuición en CADA bifurcación.** Gemini, que es bueno,
  predijo compresión con teoría sólida. Mis datos mostraron dilatación. Si construía V2 sobre la
  intuición de Gemini sin medir, construía la fortaleza para un problema que no existe en mercados
  líquidos. **Dos variables medidas (RTT real + curva de dilatación) valieron más que toda la
  teoría de microestructura.**

- **El "Paso 0" de verificación es el patrón más valioso de toda la saga** (después de separar
  diseño/implementación). En CADA brief de implementación cazó suposiciones mías equivocadas
  contra el código real:
  - Endpoint `/portfolio/orders` (no `/markets/{ticker}/orders`)
  - `created_at` timezone-AWARE (mi brief pidió naive — contradecía los 6 modelos del proyecto)
  - Sesión SQLModel SÍNCRONA (no async)
  - `detect_binary_arb` ya computa fees (no había que reimplementar)
  - Nombres de size no documentados (el brief los daba como ciertos)
  **Mis briefs los escribo de memoria, y la memoria se desactualiza. El Paso 0 convierte mis
  suposiciones en preguntas verificadas, antes de que sean bugs.**

- **La dirección de control funciona en TODAS las capas, incluso sobre mí.** Claude Code corrigió
  mi número de lección (3→7), mi endpoint, mi timezone, mi premisa de async. La capa de ejecución
  verifica lo que las capas de arriba afirman —incluido yo— en vez de obedecer. Eso es el gate
  funcionando, no fallando.

- **La complejidad correcta es función de la escala.** V2 + fortaleza B1/A2 eran para 38 mercados.
  A escala de 4-8 (NBA) o soccer-del-Mundial, esa complejidad es sobre-ingeniería. **Reducir el
  universo de mercados desinfló el problema en vez de resolverlo con más código.**

- **Mis briefs evolucionaron de "ZERO DEBATE, implementá todo" a briefs acotados con "NO
  implementes el crítico todavía, verde antes de avanzar, Paso 0 primero, detente y reportá."**
  Aprendí a darle a la capa de ejecución instrucciones que la mantienen segura, en vez de
  instrucciones que apagan su criterio. Ese es el aprendizaje real, más que cualquier decisión
  técnica puntual.

- **El componente crítico se construye fresco.** El FOKExecutor maneja capital; un error de
  cansancio ahí se paga en dólares, no en un test rojo. El shadow no necesita el ejecutor para
  empezar a juntar data → no hay presión de calendario que justifique escribirlo cansado. "El
  cansancio del operador no se compensa apagando el gate."

---

## Notas operativas para el "yo futuro" cuando retome

**El bloque que más vale releer antes de retomar es "Lo que falta (en orden)".** Te dice
exactamente dónde parar y por qué: el wiring del shadow primero (seguro, te deja grabando data
del Mundial), el FOKExecutor después (crítico, sesión fresca + demo). Y "Shadow = ambos flags
en su estado correcto, NO ambos False" está marcado fuerte porque es el malentendido que casi
deja al bot sin data el 11 — es justo el tipo de detalle que se pierde entre sesiones y cuesta
caro.

**Recomendación para cuando retomes:** wiring del shadow antes que el ejecutor. Te pone a
grabar oportunidades reales del Mundial con riesgo cero, y el FOKExecutor —el que toca capital—
lo hacés con cabeza descansada y validación en demo, sin la presión del calendario encima.

---

## Links
- [[kalshi-bot]]
- [[2026-06-02-noche-sesion-gates-cerrados-cierre-disciplinado]] — sesión inmediatamente previa
- [[2026-06-02-noche-GATES-0-y-0-5-CERRADOS-shape-ticker-y-FOK]] — los dos gates verdes
- [[2026-06-02-noche-DISENO-motor-REST-PR-13-revision-adversarial]] — diseño que ahora está implementado
- [[2026-06-02-noche-BUG-executor-limit-resting-Issue-14]] — bug aislado, relevante para futuro
- [[2026-06-02-noche-GATE-pendiente-validacion-bajo-carga-mundial]] — gates de carga pendientes
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — la decisión arquitectónica
- [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]] — el dato que destrozó la premisa de Gemini
- [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]] — Lección 11 candidato (proceso)
