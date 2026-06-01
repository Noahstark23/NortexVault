---
fecha: 2026-06-01
tipo: pivot-arquitectonico
proyecto: kalshi-bot
componente: estrategia Motor 1 (orderbook source)
estado: PIVOT-APROBADO-pendiente-benchmark
decision-trigger: V2 fragility pattern (3 attempts failed + 4 design gaps)
tags:
  - pivot
  - kalshi-bot
  - arquitectura
  - 2026-06-01
  - cto-decision
  - rest-hibrido
---

# 🔄 PIVOT a Opción 2 — REST híbrido (decisión arquitectónica)

> Después de 3 intentos fallidos de V2, 4 gaps de diseño cazados en auditoría, y al borde de implementar B1+A2 (supervisor del supervisor + cap de restarts), Gemini propuso **tirar el 95% de V2** y reemplazarlo con un approach REST híbrido. La decisión correcta. Aprobado pendiente benchmark numérico.

## El movimiento de Gemini (lo mejor de la sesión)

Cuando planteé la pregunta de fondo —*"¿V2 vale toda esta complejidad?"*— Gemini, **en vez de defender el trabajo invertido**, propuso un pivot:

> *"Estamos construyendo una 'fortaleza de software' (6 capas de supervisión y manejo de estado) para proteger un componente cuyo único fin es reconstruir localmente el libro L2. Estamos cayendo en la trampa clásica de ingeniería: agregar complejidad para corregir la fragilidad de un diseño subyacente."*

> *"Mi deber como Senior Systems Engineer es evitar que te desangres manteniendo un clon de un motor de matching en memoria."*

**Eso es exactamente lo que querés del CTO.** Madurez para abandonar una fortaleza a medio construir cuando los datos sugieren que la fortaleza es la respuesta equivocada al problema.

## La fortaleza que estábamos por construir

**V2 = clon de motor de matching local que requería:**

1. PR #11 (mergeado en branch, no en main): supervisor + timeout + retry + evicción + circuit breaker code 15
2. Gap (b): wireado anti-zombie del supervisor
3. Gap (c): cooldown determinista 3600s de reintegración
4. Reintegración activa (forzar `get_snapshot`)
5. B1: supervisor-del-supervisor in-process (backoff + ventana temporal + escalada)
6. A2: cap de arranques en runner + modo seguro durable

**6 capas de robustez para un componente auxiliar de V2-dormant.** Y cada nueva auditoría destapaba otro hueco que requería otra capa.

## La Opción 2 — REST híbrido

**Mecanismo:**
- WebSocket solo para **ticker** (muy liviano, sólo publica último precio/BBO sin riesgo de desincronización — no hay deltas que coser)
- Cuando el ticker detecta movimiento que rompa el umbral matemático del Motor 1 → REST request directo
- Saca el snapshot L2 fresco de Kalshi para validar y ejecutar

**Tradeoff:**
- Latencia ejecución sube de ~1ms (memoria) a ~50-100ms (HTTP RTT)
- **Eliminamos el 95% del código de V2:** sin supervisores, sin buffers de bootstrap, sin riesgo de `qty<0`, sin mantenimiento de estado en memoria

## Por qué la Opción 2 es genuinamente buena (no "más simple")

El argumento descansa en dos hechos sobre el mercado específico:

### 1. La naturaleza del edge (lo más importante)

**El arbitraje en Kalshi NO se disputa en microsegundos contra Citadel.** El descalce entre mercados correlacionados persiste **segundos o minutos** por la fricción del capital retail.

**Implicación:** toda la premisa de V2 (orderbook in-memory sub-milisegundo) estaba **sobre-diseñada para el problema**. Construyendo infraestructura HFT para capturar un edge que dura minutos. Un path REST de 50-100ms es de sobra.

**Gemini identificó que el requisito de latencia que justificaba V2 quizás nunca fue real.**

### 2. El rate limit lo permite

- 200 reads/sec capacidad
- 34-37 mercados activos
- WS escucha pasivo (ticker liviano)
- REST sólo se "bombardea" a los **3-4 mercados** que muestran desarbitraje real
- 4 × 20Hz = **80 reads/sec, dentro del límite**

**Matemáticamente cierra.**

## El insight que mata a V2

> *"V2 se volvió intrínsecamente frágil porque el feed de deltas de Kalshi castiga de forma asimétrica cualquier desfase de la máquina de estados local."*

**Exactamente lo que probaron los 3 attempts fallidos.** La fragilidad no era un bug a arreglar — era **inherente a coser deltas contra un feed que penaliza cualquier desync con qty<0**.

**La Opción 2 elimina la clase entera de problema** en vez de blindarse contra ella.

## Por qué confirmé el pivot

1. **Es reversible.** Si el benchmark sale mal, V2 sigue ahí con B1+A2 archivado, listo para retomar. No perdés nada.

2. **Es barato validar.** Un script aislado en `scripts/`, fuera del hot path, que mide latencia REST. No toca producción, no toca V2, no descarta nada.

3. **Reemplaza opinión por datos.** Toda la decisión depende de un número que nadie midió: ¿cuánto tarda realmente un snapshot REST de Kalshi, y cuántos 429 bajo ráfaga? Convierte una decisión de arquitectura en una medición.

4. **El patrón de fragilidad ya tiene 3 datos.** Tres activaciones fallidas en bootstrap es señal estructural, no estadística.

## Riesgo principal de la Opción 2 (Gemini lo nombra honestamente)

> *"Si el mercado se vuelve ultra-competitivo en el corto plazo, los 50ms de latencia del request REST podrían causar front-running (órdenes rechazadas por precio expirado)."*

**Mitigación:**
- Bot opera en ambientes demo primero
- Tamaños de trade pequeños (5% de exposure cap)
- Si el front-running aparece como problema real, V2 sigue disponible (no se borra el código, se archiva)

## Decisión

✅ **APROBADO el pivot a Opción 2** pendiente benchmark numérico

✅ **B1+A2 ARCHIVADO** como "diseño aprobado, sin implementar" (ver [[2026-06-01-diseno-B1-A2-archivado-fortress-de-V2]])

✅ **PR #11 (Part B) CONGELADO** indefinidamente (no se borra; se archiva como referencia)

✅ **USE_ORDERBOOK_MANAGER_V2 sigue en `false`** indefinidamente

⏳ **PRÓXIMO PASO:** correr el benchmark REST con las precisiones del script (ver [[2026-06-01-benchmark-rest-spec-criterio-decision]])

⏳ **Criterio de decisión definido A PRIORI** (anti-confirmation-bias): ver el benchmark spec

## Las dos cosas que tengo que verificar yo (no Gemini, no Claude Code)

### 1. El criterio numérico ANTES de ver los números
Definir AHORA, antes del benchmark, qué número me haría elegir cada opción:
- Si P99 path completo < 150ms **AND** 429 < 2% bajo concurrencia → **Opción 2**
- Si P99 > 300ms **OR** 429 > 10% → **V2 (con B1+A2)**
- Zona gris en el medio → análisis adicional

**Razón:** si defino el umbral DESPUÉS de ver los números, voy a racionalizar hacia el que ya prefiero. Confirmation bias.

### 2. Validar el supuesto del edge
Gemini apoya toda la Opción 2 en "el edge persiste segundos/minutos". **Eso también es una hipótesis no medida.** Tengo 5 semanas de captura V1 en `orderbook_events` — puedo verificar empíricamente cuánto dura un desarbitraje real entre mercados correlacionados.

Si el edge realmente dura 200ms, ni REST ni V2 sirven — habría problema más profundo.

**Análisis pendiente paralelo al benchmark.**

## Lo que esto significa para el roadmap

| Antes del pivot | Después del pivot |
|---|---|
| Roadmap: implementar B1+A2 → cuarta ventana → desbloquear Motor 1 | Roadmap: benchmark REST → decidir V2 vs Opción 2 → implementar el ganador → Motor 1 |
| Trabajo estimado: 1-2 semanas más de V2 + cuarta ventana | Trabajo estimado: 1 día benchmark + 3-5 días implementar Opción 2 (si gana) |
| Riesgo residual: V2 sigue frágil incluso con todas las capas | Riesgo residual: front-running por latencia (mitigado por demo+tamaños chicos) |
| Componente final: 6 capas de robustez sobre máquina de estados | Componente final: ticker WS + REST snapshot bajo demanda (95% menos código) |

## La lección estratégica

**"Cada capa de robustez que agregás también es código que puede fallar."**

El gate de diseño funcionó destapando 4 huecos consecutivos de V2. Pero la respuesta correcta a "muchos huecos" no es siempre "más capas" — a veces es **"el componente está mal diseñado para el problema y vale rediseñar el approach"**.

**Saber distinguir entre "agregar otra defensa" y "el approach mismo está mal" es un movimiento de CTO maduro.** Gemini hizo ese movimiento. Lo aprobé.

## El sistema funcionó en su nivel más alto

Cadena completa de eventos esta semana:
1. Activación V2 attempt #1 → 87 errores → rollback
2. Activación V2 attempt #2 → 4 ERROR + 1 CRITICAL → rollback
3. Activación V2 attempt #3 → 1 OrderbookDesyncError → rollback + smoking gun preservado
4. Cuarto discovery desde código → Q2/Q3 destapadas
5. PR #11 implementado → 2 gaps críticos cazados por auditoría
6. B1+A2 propuesto → crash-loop de contenedor destapado
7. Pregunta de fondo planteada: ¿V2 vale toda esta maquinaria?
8. **Gemini propone pivot estratégico → Opción 2 REST híbrido**
9. **Aprobado pendiente benchmark + validación del edge**

**Cada paso destapó algo del anterior. Ninguna línea de código de la fortaleza se escribió en vano porque nunca se implementó — el gate retuvo todo en diseño.**

## Links
- [[2026-06-01-sesion-01jun-auditoria-pr11-pivot-opcion-2]] — sesión
- [[2026-06-01-AUDITORIA-PR11-gaps-criticos-cazados]] — los 2 gaps que dispararon la pregunta de fondo
- [[2026-06-01-diseno-B1-A2-archivado-fortress-de-V2]] — la fortaleza archivada
- [[2026-06-01-benchmark-rest-spec-criterio-decision]] — benchmark que decide
- [[2026-05-31-cuarto-discovery-v2-Q1-a-Q4-desde-codigo]] — discovery del 31-may
- [[incidente-v2-attempt-3-2026-05-30-causa-capturada]] — attempt #3 (la cuarta data del patrón)
- [[kalshi-bot]]
