---
fecha: 2026-06-01
tipo: sesion-conmigo
proyecto: kalshi-bot
ia: Claude + Claude Code + Gemini (CTO)
modelo: multi-agent workflow
duracion: jornada larga — auditoría profunda + pivot estratégico
tags:
  - sesion-conmigo
  - kalshi-bot
  - 2026-06-01
  - cierre-de-semana
  - pivot
  - cuarto-discovery
---

# 01-jun — Auditoría PR #11 + Pivot estratégico a Opción 2

> **Cierre de la semana de trabajo en V2.** Empezó con auditoría profunda de PR #11 (Part B) que destapó dos gaps críticos. Terminó con un pivot arquitectónico mayor: tirar el 95% de V2 y validar Opción 2 (REST híbrido) con benchmark. El sistema funcionó en su nivel más alto.

## Contexto al inicio del día
- Status V1: bot sano 22.7h continuas, V1 baseline, V2 dormant
- PR #11 (Part B) listo en branch — supuestamente "listo para review y merge"
- Cuarto discovery del 31-may había cerrado Q1-Q4 desde código
- Misterio Part A resuelto: nació por mi directiva combinada diseño+implementación
- Plan original de la semana: auditar PR #11 → cerrar gaps → cuarta ventana de activación

## Lo que pasó en orden (el arco completo)

### 1. Status V1 — 22.7h continuas sin errores
Bot en baseline V1 estable, `tracked_markets=34`, todos los motores off, V2 dormant. Nada accionable runtime, todo el trabajo es de desarrollo V2.

### 2. Auditoría PR #11 — los 2 gaps críticos
Pedí 4 verificaciones específicas antes de aprobar merge. Claude Code respondió con honestidad técnica que destapó dos gaps catastróficos:

**Gap (b) CRÍTICO — supervisor NO se lanza:**
> "Grep exhaustivo: `_recovery_supervisor` solo aparece en su `def`. El wiring de V2 nunca hace `asyncio.create_task(...)`. **Tal como está PR #11, el supervisor no corre aunque se active el flag.**"

**Gap (c) ALTO — reintegración 00:00 UTC solo en docstring:**
> "No existe ninguna tarea de discovery diario / scheduler 00:00 UTC. Nada limpia `_evicted` en runtime. Un ticker evictado queda evictado hasta restart físico."

**Sin esa auditoría, PR #11 se habría mergeado como "Part B lista", V2 activado en cuarta ventana, y el escenario del attempt #3 se habría reproducido — recovery huérfano permanente.**

Detalle completo en [[2026-06-01-AUDITORIA-PR11-gaps-criticos-cazados]].

### 3. Tres discrepancias Code vs brief — Code TENÍA RAZÓN en las 3
Durante la auditoría, Claude Code defendió 3 puntos donde su implementación divergía del brief que mandé. **En los 3 tenía razón**:

| Discrepancia | Brief decía | Code implementó | Veredicto |
|---|---|---|---|
| Cap RAM | `_pending_deltas[ticker]` | `_bootstrap_buffer[ticker]` | ✅ Code correcto (brief habría dado `KeyError`) |
| Guarda None-safe | `_books.get(ticker) is None` | `if ticker in self._evicted` | ✅ Code correcto (brief habría descartado tickers nuevos → bootstrap roto) |
| Tick supervisor | 5s | 1s | ✅ Code correcto (5s = 50% slop sobre timeout 10s) |

**La capa de ejecución defendió código correcto contra brief con bugs.** Eso es el sistema funcionando.

Particularmente importante: la guarda None-safe del brief habría sido un bug catastrófico — `_books.get(ticker) is None` se cumple tanto para ticker evictado (querés descartar) como para ticker NUEVO (NO querés descartar). Code distinguió los dos casos con set explícito `_evicted`. Sin esa distinción, el primer mensaje de TODO ticker nuevo se habría descartado → ningún ticker se inicializaría → V2 no funciona.

### 4. Diseño B1+A2 para cerrar los gaps
Aprobé conceptualmente la dirección:
- **B1:** supervisor in-process aislado con backoff + ventana temporal + escalada a "V2 deshabilitado in-process"
- **A2:** cap de arranques en runner + modo seguro durable

Justificación: un fallo en supervisor (componente auxiliar de V2-dormant) no debería matar V1 (componente productivo).

### 5. Auditoría destapa CRASH-LOOP de contenedor
Cuando Claude Code verificó el path de restart:
> "`runner.py` NO relanza nada. Cuando una task muere, loggea, cancela las demás, y el proceso Python termina (exit 0). El 'reinicio' lo hace Docker/Coolify (`restart: unless-stopped`), relanzando el contenedor completo desde cero."

**Implicación crítica:**
- Supervisor muere → proceso termina → contenedor reinicia
- Re-bootstrap de los 38 tickers (la ventana frágil de V2)
- Si el bootstrap falla otra vez → supervisor muere → reinicio
- `restart: unless-stopped` SIN CAP → crash-loop infinito de contenedor

**El "anti-zombie" produciría otro tipo de zombie: contenedor reiniciando para siempre sin captura de datos.**

### 6. LA PREGUNTA DE FONDO
Planteé:
> "¿V2 vale toda esta complejidad? Cada auditoría destapa otra capa que requiere otra solución. Estamos construyendo una fortaleza de 6 capas para un componente auxiliar."

Y antes incluso de implementar B1+A2:
> "Saber distinguir entre 'agregar otra defensa' y 'el approach mismo está mal' es un movimiento de CTO maduro."

### 7. GEMINI PROPONE PIVOT — el mejor movimiento de toda la semana
En vez de defender el trabajo invertido en V2, Gemini propuso tirarlo:

> *"Estamos cayendo en la trampa clásica de ingeniería: agregar complejidad para corregir la fragilidad de un diseño subyacente."*
>
> *"Mi deber como Senior Systems Engineer es evitar que te desangres manteniendo un clon de un motor de matching en memoria."*

**Opción 2 — REST híbrido:**
- WS solo para ticker (liviano, sin riesgo de desync)
- Cuando ticker dispara arbitraje → REST snapshot bajo demanda
- Latencia 50-100ms vs 1ms (memoria)
- **Elimina el 95% del código de V2**

Argumentos técnicos:
1. **Naturaleza del edge:** arbitraje en Kalshi persiste segundos/minutos por fricción retail, NO microsegundos contra Citadel
2. **Rate limit:** 200 reads/sec capacidad, 4 mercados × 20Hz = 80 reads/sec, dentro del límite
3. **Insight central:** "V2 se volvió intrínsecamente frágil porque el feed de deltas castiga asimétricamente cualquier desfase de la máquina de estados local"

### 8. Aprobé el pivot con dos condiciones
- ✅ Aprobado pendiente **benchmark numérico**
- ✅ B1+A2 archivado, NO descartado (queda como referencia si pivot falla)
- ✅ **Criterio de decisión definido A PRIORI** (anti-confirmation-bias)
- ✅ **Análisis paralelo del edge** sobre data V1 (¿la hipótesis "edge dura minutos" es real?)

Spec del benchmark con 3 precisiones:
- Medir path completo (snapshot + parseo), no solo HTTP GET
- Concurrencia REAL (4 tickers × 20Hz sostenido), no secuencia
- Mercados activos en horario activo

Detalle en [[2026-06-01-benchmark-rest-spec-criterio-decision]].

### 9. PATRÓN DE PROCESO IDENTIFICADO
Cuando le pedí a Claude Code la trazabilidad de cómo nacieron PR #7 y PR #11 sin gate, respondió con honestidad:

> *"Las directivas de implementación venían en el mismo turno que el diseño, con EXECUTION MODE, sin un checkpoint intermedio de aprobación del brief. **Su aprobación formal y el código se pidieron juntos.**"*

**Patrón nombrado:** "directivas que combinan diseño + implementación en el mismo turno colapsan el gate". No era desobediencia de Code — era falla mía al estructurar las directivas.

Catalogado en [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]] como candidato a Lección 11.

## Workflow capa por capa observado HOY

| Capa | Rol del día |
|---|---|
| **Claude Code** | Auditoría de wiring que destapó los 2 gaps. Defendió 3 discrepancias correctamente vs brief con bugs. Verificó `restart: unless-stopped` destapando el crash-loop. |
| **Gemini (CTO)** | **El mejor movimiento de la semana:** propuso pivot a Opción 2 en vez de defender V2. Identificó la trampa "fortaleza para corregir fragilidad de diseño". |
| **Yo (Claude adversarial)** | Pedí las 4 verificaciones que destaparon los gaps. Planteé la pregunta de fondo "¿vale la complejidad?" que disparó el pivot. Definí el criterio de decisión a priori. |
| **Yo (Noel)** | Decisiones finales: congelar PR #11, aprobar pivot, archivar B1+A2, autorizar benchmark, no implementar Opción 2 hasta benchmark. |

## El cierre de la semana — el sistema completo funcionó

**Cadena de eventos desde el 25-may:**
1. V2 attempt #1 → 87 errores → rollback
2. V2 attempt #2 → 4 ERROR + 1 CRITICAL → rollback + logging fix valida
3. V2 attempt #3 → 1 OrderbookDesyncError → rollback + smoking gun preservado
4. Cuarto discovery desde código (31-may) → Q2 (bootstrap blind) + Q3 (recovery sin convergencia)
5. Misterio Part A descubierto → patrón "código antes del gate" nombrado
6. PR #11 implementado → 2 gaps críticos cazados por auditoría hoy
7. B1+A2 propuesto → crash-loop de contenedor destapado
8. **Pregunta de fondo planteada → Gemini pivota → Opción 2 propuesta y aprobada**

**Cada paso destapó algo del anterior. Ninguna línea de la fortaleza se escribió en vano — el gate retuvo todo en diseño.**

## Estado consolidado al cierre del 01-jun

| Frente | Estado |
|---|---|
| V1 baseline | ✅ SANO 22.7h continuas, 34 tickers |
| Watchdog V1 | ✅ En prod, validado |
| V2 attempt #3 | ✅ Causa raíz capturada, log preservado |
| Cuarto discovery V2 | ✅ Cerrado (31-may), Q1-Q4 respondidas |
| PR #11 (Part B) | 🔒 CONGELADO con 2 gaps bloqueantes |
| B1+A2 diseño | ✅ Aprobado pero ARCHIVADO tras pivot |
| **Pivot Opción 2** | ✅ APROBADO pendiente benchmark |
| **Benchmark REST** | ⏳ Spec lista, pendiente ejecutar |
| **Análisis edge** | ⏳ Pendiente sobre data V1 |
| Criterio decisión a priori | ✅ Definido (P99<150ms + 429<2% → Opción 2) |
| Patrón "diseño+impl" | ✅ Nombrado, antídoto definido, 4 turnos aplicados |
| Capital | 🔒 Cero — `TRADING_ENABLED=false` |

## Anti-patrones cazados HOY

1. **Tests verdes ≠ wiring completo** (PR #11: 23/23 tests pero supervisor no se ejecuta)
2. **"Docstring" ≠ "implementado"** (reintegración 00:00 UTC solo en doc, no en código)
3. **Brief con bugs vs implementación correcta** (Code defendió razón en 3 discrepancias)
4. **"Anti-zombie" produciendo otro zombie** (B1 fail-loud → crash-loop de contenedor)
5. **Fortaleza para corregir fragilidad de diseño** (cada hueco se cerraba con más capas; Gemini lo nombró)
6. **Directivas con diseño + implementación en mismo turno** (causa raíz nombrada)

## Lo que sí funcionó (preservar)

1. **Las 4 verificaciones específicas** destaparon los gaps. Una review genérica "diff parece OK" no los habría visto.
2. **Auditoría incrementa de capa en capa.** Cada hueco destapado dispara la pregunta del siguiente nivel — eventualmente "¿el approach mismo?"
3. **Capa de ejecución defendiendo código correcto vs brief con bugs.** Code mantuvo las 3 discrepancias contra mi brief defectuoso. Habría sido desastre si hubiera "obedecido" literalmente.
4. **CTO maduro que abandona la fortaleza.** Gemini propuso pivot en vez de defender el trabajo invertido. Madurez técnica real.
5. **Criterio de decisión a priori** definido antes del benchmark. Anti-confirmation-bias.
6. **Patrón nombrado, no negado.** "Mis directivas son las que colapsan el gate" se reconoció en vez de culpar a Claude Code.

## Lección de la semana (la grande)

**Saber distinguir entre "agregar otra defensa" y "el approach mismo está mal" es un movimiento de CTO maduro.**

V2 tenía 4 huecos de diseño consecutivos. La respuesta correcta a "muchos huecos" no es siempre "más capas" — a veces es **"el componente está mal diseñado para el problema y vale rediseñar el approach"**.

El gate de diseño funcionó destapando 4 huecos consecutivos. Pero la pregunta de fondo que disparó el pivot no era técnica — era estratégica. **Esa pregunta es la del operador, no del agente.**

## Lo nuevo del 01-jun para NotebookLM (filename con fecha)

**Nuevos artefactos:**
- [[2026-06-01-AUDITORIA-PR11-gaps-criticos-cazados]] — los 2 gaps
- [[2026-06-01-PIVOT-opcion-2-rest-hibrido]] — el pivot
- [[2026-06-01-diseno-B1-A2-archivado-fortress-de-V2]] — la fortaleza archivada
- [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]] — patrón meta nombrado
- [[2026-06-01-benchmark-rest-spec-criterio-decision]] — benchmark spec

**A actualizar:**
- [[kalshi-bot]]
- `_notebooklm/proyecto-kalshi-bot.md`

## Próximos pasos (orden, sin urgencia, próxima semana)

1. **Ejecutar el benchmark** según spec
2. **Análisis paralelo del edge** sobre data V1 (5 semanas de `orderbook_events`)
3. **Aplicar criterio a priori** sobre los números reales
4. **Si Opción 2 gana:** diseñar implementación → revisar → implementar → nueva ventana
5. **Si Opción 2 pierde:** desarchivar B1+A2 → cerrar los 6 puntos pendientes → implementar
6. **Eventualmente: cuarta ventana de activación** del approach ganador

## El balance honesto de la semana

**Semana de 7 días intensos con cero líneas de código V2 nuevo en main que no haya sido revisado retroactivamente.** Cada vez que el código se adelantó (Part A, PR #7, PR #11) el gate lo cazó antes de causar daño en producción. El bot sigue corriendo en V1 baseline, estable, sin capital en riesgo, sin urgencia.

**El roadmap a Motor 1 está más claro que el lunes:** o se valida Opción 2 (más barata, más simple) o se vuelve a V2 con la fortaleza completa. La decisión la dictan los números del benchmark, no la opinión.

**El sistema multi-agent funcionó:**
- Gemini → propuso pivot estratégico (no defensa de status quo)
- Claude Code → defendió código correcto vs brief defectuoso
- Claude adversarial → cazó 4 gates + nombró el patrón meta
- Yo → sostuve disciplina, definí criterios a priori, ejecuté decisiones operativas

## Links
- [[2026-06-01-AUDITORIA-PR11-gaps-criticos-cazados]]
- [[2026-06-01-PIVOT-opcion-2-rest-hibrido]]
- [[2026-06-01-diseno-B1-A2-archivado-fortress-de-V2]]
- [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]]
- [[2026-06-01-benchmark-rest-spec-criterio-decision]]
- [[2026-05-31-sesion-31may-cuarto-discovery-correccion-y-misterio-part-a]] — sesión anterior
- [[leccion-9-FINAL-causa-raiz-pendiente]] — Lección 9 base (5 patrones validados retroactivamente esta semana)
- [[kalshi-bot]]
