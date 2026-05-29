---
fecha: 2026-05-30
tipo: brief-claude-code
proyecto: kalshi-bot
componente: V2-observabilidad
estado: listo-para-ejecutar
target: branch nueva PR #2
tags:
  - brief
  - claude-code
  - kalshi-bot
  - v2
  - instrumentacion
  - reusable
---

# Brief Claude Code — Instrumentación V2 asymmetric logging

> Brief operativo final con las correcciones del 30-may. Reusable como referencia. Para mandar a Claude Code cuando se cree la branch del PR #2.

## Bucket
🟢 (instrumentación, sin cambios de lógica, V2 dormant — el código nuevo no se ejecuta hasta tercera ventana de activación).

## Contexto

El error `qty<0` de V2 no se explica por el parsing (cuarto discovery lo confirmó: parsing limpio en ambos paths, ver [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]]).

Quedan **3 hipótesis vivas:**
- **(A)** Feed corruption real
- **(B)** Snapshot inicial parcial
- **(C)** Bug de V2 en la aplicación de deltas en ventana no logueada

Para distinguirlas necesitamos:
- El `raw_msg` completo en el momento del error, **persistido en nivel que sobreviva LOG_LEVEL=INFO**
- El `raw_msg` completo del snapshot inicial (sin truncar como hace el log INFO actual que muestra solo `sample_yes[:3]`)
- El estado del bucket en el momento del crash

## Prompt FINAL para Claude Code

```
Add defensive logging for V2 observability without altering production logic.

Step 1: Verification (Perform this first and show me the result before writing any code):

Analyze orderbook_manager_v2.py:
- How is OrderbookDesyncError currently handled when state.apply_delta() raises in
  _apply_delta_msg? Does it propagate directly to handle_message, or is it already
  wrapped in a try/except at any level?
- Does OrderbookState expose a public getter for a price/side bucket size, or only
  the private _yes_bids/_no_bids dicts?

Step 2: Implementation (After verification):

In _apply_snapshot_msg:
- Add a logger.debug statement to log the full raw_msg of the snapshot immediately
  before processing (full, NOT truncated to sample_yes[:3] like the existing INFO log).

In _apply_delta_msg:
- Wrap the state.apply_delta(...) call in a try/except OrderbookDesyncError block.
- Inside except, BEFORE re-raising:
  1. Log at ERROR level (must persist with LOG_LEVEL=INFO):
     - The full raw_msg of the delta
     - The current bucket state for that price/side
     - The seq metadata (seq / new_seq / previous_seq as available)
  2. For the bucket state: use the `state` variable already in scope (not a fresh
     self._books[ticker] lookup). Access defensively with .get(price) so it never
     raises if the key is missing. If OrderbookState exposes a public getter, use it.
  3. Wrap the entire logging block in its own try/except so a logging failure can
     NEVER mask the original OrderbookDesyncError.
- After the logging block, re-raise the original OrderbookDesyncError exactly as it was.

Constraints:
- The delta error log MUST be ERROR level. DEBUG is lost with LOG_LEVEL=INFO — this
  is the exact failure mode of the 25-may incident.
- Do not modify application logic or error flow. The log is purely additive; the
  exception re-raises identical.
- The diagnostic logging must NOT introduce any new exception path. If logging the
  bucket state could fail, it must fail silently without affecting the re-raise.
- V2 stays dormant: do not touch any flag, do not modify enabled state, do not
  change anything outside of the two _apply_*_msg functions and necessary imports.
- No rate detector, nothing from Fase 2 of the watchdog roadmap.

Deliverable:
1. The verification answer (current error handling + bucket access pattern).
2. The diff of the changes.
3. Confirmation that the error flow is identical (only logging added before an
   unchanged re-raise).

Tests if applicable. Commit to a new branch separate from PR #1 (watchdog).
```

## Decisiones de diseño explicadas

### Por qué snapshot DEBUG, delta ERROR
- **Snapshot inicial:** se procesa 1 vez por ticker al bootstrap. No inunda. DEBUG está bien y permite levantarlo a INFO temporalmente cuando se necesita investigar.
- **Delta normal:** ~200 deltas/min sobre 38 tickers. Loggear todos en cualquier nivel inundaría. Solo loggear cuando crashea = raro = no inunda + se persiste con LOG_LEVEL=INFO.

### Por qué la verificación previa es obligatoria
El 27-may, el brief original especificaba `exc_info=r` (patrón stdlib logging). Claude Code descubrió que el proyecto usa Loguru, donde `exc_info=` se ignora silentemente. Implementación literal habría reproducido el bug que estábamos arreglando.

La verificación previa fuerza a Code a confirmar el estado actual antes de escribir. Lección operacional del attempt #2.

### Por qué bucket state defensivo
Si `ticker` no está en `self._books` cuando se levanta el `OrderbookDesyncError`, un acceso ingenuo `self._books[ticker]._yes_bids` lanza `KeyError` **dentro del bloque de logging**. Ese `KeyError` enmascararía el `OrderbookDesyncError` original → perdés exactamente la evidencia que querés capturar.

Patrón correcto: usar `state` (ya en scope) + `.get(price)` + bloque de logging envuelto en try/except que silencia su propio fallo.

### Por qué snapshot SIN truncar a 3 levels
El log actual en INFO ya muestra:
```
V2 snapshot: ticker=KXMLB-26-ATL seq=2 num_yes=34 num_no=74
sample_yes=[['0.0010','1607903.00'],['0.0040','44444.00'],['0.0100','31848.91']]
sample_no=[['0.0010','2000.00'],['0.0100','4838704.35'],['0.0200','4330.00']]
```

**Solo los primeros 3 levels.** Para la hipótesis B (snapshot parcial), necesitamos el snapshot completo — los 34 yes_levels y 74 no_levels — para poder comparar el bucket 10c (o cualquier otro) entre lo que llegó del feed y lo que V2 cargó.

## Criterios de aceptación del diff

Cuando Code entregue:

1. **Solo logging.** Cero cambios de lógica. El árbol de control de errores idéntico.
2. **Delta ERROR.** No DEBUG ni WARNING. Confirma con LOG_LEVEL=INFO en Coolify.
3. **Re-raise idéntico.** El `raise` del except levanta la **misma** excepción original, no una nueva ni modificada.
4. **Bloque de logging no puede tapar.** El try/except interno del logging está confirmado por inspección o test.
5. **Acceso defensivo a bucket.** `.get(price)` o getter público, no `[price]` directo.
6. **Snapshot sin truncar.** El raw_msg completo en DEBUG, no solo los primeros 3 levels.
7. **No toca flag.** `USE_ORDERBOOK_MANAGER_V2` no aparece en el diff.

Si alguno falla → rechazar y pedir corrección.

## Riesgos a vigilar

### Riesgo 1: logging del raw_msg expone datos sensibles
**Análisis:** `raw_msg` contiene precios y sizes públicos de un mercado público. No hay PII ni secrets. Riesgo nulo.

### Riesgo 2: el raw_msg es muy grande y satura disco
**Análisis:**
- Snapshot completo: ~5-50 KB por ticker, 38 tickers en bootstrap = ~2 MB una vez. Insignificante.
- Delta error log: solo cuando hay crash. El crash del attempt #2 fue 4 errores en 12 min = ~50 KB total. Insignificante.

**Riesgo nulo en operación normal.** Si V2 entra en cascada de crashes en producción otra vez, los logs ERROR del delta serían 100s de KB en minutos — pero eso ya dispararía rollback por el runbook, así que el problema operativo es el cascade, no el log.

### Riesgo 3: el cambio se compila pero rompe tests
**Mitigación:** brief pide que Code corra tests post-cambio y reporte. Si los hay rojos, no mergear.

## Disciplina post-merge

**Después de mergear el PR #2:**

❌ **NO encadenar otra tarea V2.** Frente sellado.
❌ **NO activar V2 "para probar la instrumentación."** La tercera ventana es decisión de gestión separada (cuando haya 2-3h continuas), no extensión del momentum del fix.
✅ **V1 watchdog y V2 instrumentación = dos PRs limpios cerrados.** Estado del repo refleja lo que sabemos hoy.
✅ **La cámara queda apagada esperando la tercera ventana.** El valor real llega cuando la cámara captura.

## Anti-patrón a evitar — "ya tenemos la cámara, activemos"

El próximo paso después de mergear el PR #2 es **agendar la tercera ventana de V2 cuando convenga**, no activarla por momentum. Lección 9 lo dice: "la urgencia de sprint es un fantasma en proyecto solo-founder sin capital trabajando".

Si la sesión queda con energía después del merge, **no es para activar V2**. Es para cerrar lo que esté abierto en otros frentes o cerrar la sesión.

## Links
- [[decision-2026-05-30-branch-separada-v2-instrumentacion-asimetrica]] — decisión de branching
- [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]] — discovery que justifica este brief
- [[update-leccion-9-29may-tercer-discovery-cerrado]] — update que va en el mismo PR
- [[sesion-2026-05-30-cuarto-discovery-v2-instrumentacion-plan]] — sesión
- [[fix-v2-opcion-a-implementado-commits]] — fix anterior (referencia: una pieza cumplió, dos no)
- [[cheatsheet-runbook-12.5-v2-activacion]] — runbook que se aplicará en la tercera ventana
- [[kalshi-bot]]
