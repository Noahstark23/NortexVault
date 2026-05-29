---
fecha: 2026-05-30
tipo: decision
proyecto: kalshi-bot
estado: tomada
tags:
  - decision
  - kalshi-bot
  - v2
  - workflow
  - branch-strategy
---

# Decisión: branch separada para V2 instrumentación + Lección 9 update

## La decisión

**Branch nueva separada para el frente V2** (instrumentación asimétrica + update de Lección 9). El PR del watchdog V1 (commit `21fe6fd`) se mantiene en su branch independiente y se mergea a su tiempo. **Dos PRs limpios, dos frentes desacoplados.**

## Contexto / problema

Después del cuarto discovery V2 (30-may), quedan dos cambios pendientes en el código:
1. **Update de Lección 9** al `KALSHI_BOT_CONTEXT.md` (texto redactado, ver [[update-leccion-9-29may-tercer-discovery-cerrado]])
2. **Instrumentación asimétrica** en `_apply_snapshot_msg` y `_apply_delta_msg` (brief listo, ver [[brief-instrumentacion-v2-asymmetric-logging]])

Y un cambio ya mergeado pero en branch diferente:
3. **Fix watchdog V1** (commit `21fe6fd`, validado 7h en producción)

Opciones de wiring:
- **Opción 1:** branch separada para V2 (commits 1+2 juntos), branch existente para V1 (commit 3)
- **Opción 2:** todo en la misma branch — V1 + V2 + update
- **Opción 3:** todo a main directo, sin branches separadas

## Razones para Opción 1 (separada)

1. **Frentes técnicos genuinamente distintos:**
   - V1: WS feed que está corriendo. Fix activo, listo para producción.
   - V2: instrumentación de código dormant. No se activa hasta tercera ventana.

2. **Independencia de timing:**
   - V1 watchdog: **mergeable HOY** (validado 7h en producción).
   - V2 instrumentación: **no mergeable hoy** sin riesgo, porque aunque V2 está dormant, mergear cambios a V2 cuando no se va a activar = código que vive sin validación.
   - Si se acoplan, el merge de V1 (urgente y validado) queda atado al timing de V2 (no urgente, sin tercera ventana planeada).

3. **Diff legible:**
   - V1 watchdog está limpio: `force_reconnect()` + watchdog reactor + TTL `last_error`. **Auditable.**
   - V2 instrumentación es solo logging + Lección 9 update. **Auditable.**
   - Si los mezclás, el diff es ruido y el code review es más débil.

4. **Disciplina ya establecida:**
   - El propio workflow venimos aplicando: **un frente, una decisión, un commit/PR.**
   - Mezclar frentes contra ese principio sin razón fuerte sería relajar disciplina por momentum.

5. **Claude Code cazó hallucination risk al pedirle el update sin pasarle texto** — separar branches deja explícito qué texto va a qué archivo en qué branch. Más claro, menos error.

## Razones contra Opción 2 (todo junto)

- Mezcla V1 (urgente, listo) con V2 (no urgente, esperando tercera ventana)
- Acopla mergear V1 con tener instrumentación V2 lista
- Pierde la independencia de timing entre los dos frentes

## Razones contra Opción 3 (todo a main directo)

- Sin PR no hay revisión sobria del diff (la misma que validó la calidad del fix Opción A pre-attempt #2)
- El update de Lección 9 sin estar en una branch significa que cualquier cambio paralelo a `KALSHI_BOT_CONTEXT.md` produce conflicto sin razón

## Decisión

**Opción 1: branch separada.**

### Branch V1 (existente, watchdog)
- Commit `21fe6fd` + correcciones format/tests
- Estado: mergeable HOY (validación 7h en producción ya hecha)
- Acción: mergear cuando esté listo

### Branch V2 nueva (PR #2)
**Contenido:**
1. Update de Lección 9 al `KALSHI_BOT_CONTEXT.md` (texto en [[update-leccion-9-29may-tercer-discovery-cerrado]])
2. Instrumentación `_apply_snapshot_msg`: `logger.debug` con `raw_msg` completo (sin truncar)
3. Instrumentación `_apply_delta_msg`: try/except + `logger.error` con `raw_msg` + bucket state defensivo + re-raise idéntico

**Acción:** crear, revisar diff, esperar tercera ventana de V2 para mergear (o mergear antes si el código compila limpio y los tests pasan — es seguro porque V2 sigue dormant).

## Consecuencias derivadas

- **Update de Lección 9 vive en branch V2 hasta merge.** Si querés el update en main antes del merge de V2, habría que ponerlo en su propio commit. Decisión: dejarlo en branch V2 porque el update y la instrumentación son del mismo frente (preparación para tercera ventana).
- **Frente V1 cierra completamente al mergear PR #1.** No queda nada pendiente en V1 después de eso (salvo deuda catalogada no urgente).
- **Frente V2 queda en pausa hasta tercera ventana.** Después del merge del PR #2, no hay nada más que hacer en V2 hasta que se ejecute la activación con instrumentación puesta.

## Una decisión que se está tomando sin nombrarla

**Al poner el update de Lección 9 en la branch de V2**, ese update **NO está en main hasta que se mergee la branch de V2**. Eso está bien porque:
- El update y la instrumentación son del mismo frente narrativo ("preparamos V2 para tercera ventana")
- No hay urgencia de tener el update en main independientemente
- Mergear ambos juntos es coherente con el propósito común

**Pero hay que tenerlo claro:** si decidimos no abrir tercera ventana en el corto plazo, el update se queda en branch indefinidamente. Si pasa más de 1-2 semanas sin tercera ventana, vale la pena mergear el update de Lección 9 a main por separado (commit administrativo solo de docs) para que el repo refleje el estado real del conocimiento, aunque la instrumentación siga en branch.

## El brief de instrumentación tiene dos correcciones que NO son negociables

Ver [[brief-instrumentacion-v2-asymmetric-logging]] para el brief completo. Resumen de las correcciones:

### Corrección 1 — Logging asimétrico (snapshot DEBUG full, delta ERROR on failure)
Si solo instrumentás el delta, la hipótesis B (snapshot inicial parcial) queda ciega. **Hay que instrumentar AMBOS paths.**

Y `logger.debug` durante operación normal inundaría logs. Pero `logger.debug` con LOG_LEVEL=INFO en Coolify **no se persiste** — es el mismo error que tuvo el attempt #1 del 25-may (`NoneType: None`). Por eso:
- **Snapshot: DEBUG** (es 1 por ticker en bootstrap, no inunda; útil cuando se sube LOG_LEVEL para investigación)
- **Delta: ERROR** (solo cuando hay crash, se persiste con LOG_LEVEL=INFO)

### Corrección 2 — Acceso defensivo al bucket
El brief original le pedía a Code loguear `self._books[ticker]._yes_bids.get(price)`. Pero:
- `_yes_bids` es atributo privado de `OrderbookState` (acceso frágil)
- Si `ticker` no está en `self._books`, lanza `KeyError` **dentro del bloque de logging** → enmascararía el `OrderbookDesyncError` original

**Solución:** usar `state` (variable ya en scope) + `.get(price)` + envolver TODO el bloque de logging en su propio try/except que silencie cualquier fallo del logging.

### Verificación previa antes de escribir
El brief incluye un paso de verificación: ¿`state.apply_delta()` ya está dentro de algún try/except en código actual? Si sí, no duplicar manejo. Si no, agregar try/except limpio.

Esto previene el patrón que cacé el día 27-may con `logger.opt(exception=r)` vs `exc_info=r` — verificar antes de escribir.

## Workflow capa por capa observado HOY

| Capa | Rol |
|---|---|
| **Claude Code** | Cuarto discovery cruzando log + código, propuso "V2 exculpado" prematuramente |
| **Yo (Claude adversarial)** | Cacé "indiscutiblemente" como atribución externa, corregí brief de instrumentación (logging asimétrico + acceso defensivo + verificación previa) |
| **Claude Code (segunda iteración)** | Aceptó correcciones, preguntó por texto del update de Lección 9 (NO inventó — bien) |
| **Yo (Noel)** | Decisión de branch separada, contenido del PR #2, timing de mergeo |

**Anti-patrón cazado en tiempo real:** "V2 exculpado = es el feed" — el mismo salto del 25-may en forma más sofisticada. Lo cacé, lo nombré, lo corregí. Lección 9 funcionando como sistema de control en vivo.

## Próximos pasos

1. **Mergear PR #1 (watchdog V1)** cuando esté listo — validación 7h ya completa
2. **Crear branch nueva para PR #2 (V2)** con update Lección 9 + instrumentación asimétrica
3. **Revisar diff del PR #2** contra los criterios:
   - ¿Solo logging? ¿Cero cambios de lógica?
   - ¿Delta error log en nivel ERROR (no DEBUG)?
   - ¿Bloque de logging no puede tapar la excepción original?
   - ¿Re-raise idéntico?
   - ¿Acceso defensivo al bucket (`.get(price)`)?
4. **Si limpio → merge PR #2.** V2 queda preparado, dormant, esperando tercera ventana.
5. **Frente V2 queda en pausa.** Tercera ventana es decisión de gestión separada, cuando haya 2-3h continuas. No hay nada más que "avanzar" en V2 hasta entonces.

## Recordatorio de disciplina

**Después del merge del PR #2, el frente V2 está sellado y listo.**

NO encadenar otra tarea hoy en V2. NO sentir obligación de "seguir avanzando". La preparación queda hecha. La tercera ventana es cuando vos decidas, con runbook 12.5 literal otra vez.

## Links
- [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]] — discovery que motivó esta decisión
- [[update-leccion-9-29may-tercer-discovery-cerrado]] — texto del update que entra en PR #2
- [[brief-instrumentacion-v2-asymmetric-logging]] — brief operativo
- [[sesion-2026-05-30-cuarto-discovery-v2-instrumentacion-plan]] — sesión
- [[fix-v1-watchdog-21fe6fd-validado-produccion]] — fix V1 que está en branch independiente
- [[leccion-9-FINAL-causa-raiz-pendiente]] — lección que se actualiza
- [[kalshi-bot]]
