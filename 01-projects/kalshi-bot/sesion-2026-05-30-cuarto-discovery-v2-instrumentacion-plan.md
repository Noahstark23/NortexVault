---
fecha: 2026-05-30
tipo: sesion-conmigo
proyecto: kalshi-bot
ia: Claude + Claude Code + Gemini (CTO)
modelo: multi-agent workflow
duracion: jornada larga con correcciones de hallazgos previos
tags:
  - sesion-conmigo
  - kalshi-bot
  - cuarto-discovery
  - leccion-9-update
  - workflow
---

# 30-may — Cuarto discovery V2 + plan de instrumentación asimétrica

> Jornada de profundización del discovery V2. Cruce de log con código fuente real. Tres correcciones importantes a hallazgos del 29-may. Anti-patrón "indiscutiblemente es el feed" cazado en tiempo real. Plan de instrumentación asimétrica + branch separada del watchdog V1.

## Contexto al inicio
- Frente V1: ✅ CERRADO LIMPIO (fix watchdog `21fe6fd` validado 7h en producción)
- Frente V2: H1 refutada (29-may), causa raíz pendiente con hipótesis amplias
- Lección 9: en repo con SHA `3a4b384`, "causa raíz NO RESUELTA" prominente
- Estado físico: descansado, mañana fresca, café + teanina

## Decisiones / conclusiones del día

### 1. Cuarto discovery — cross-check log + código fuente
A partir del tercer discovery (29-may), Claude Code cruzó la evidencia del log preservado contra el código real de V2 (`orderbook_manager_v2.py`, `orderbook.py`). Ver [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]].

**Tres correcciones a hallazgos del 29-may:**

**Corrección #1 — "Gap seq=40" NO era señal independiente.**
El código demuestra que cuando `_apply_delta_msg` lanza `OrderbookDesyncError`, la línea `self._last_seq_by_sid[sid] = new_seq` nunca se ejecuta. El siguiente mensaje con seq=41 produce el "gap" expected=40, got=41. **El gap es artefacto del manejo de error, no señal de mensaje perdido.** Message-loss/out-of-order eliminados como causa.

**Corrección #2 — "El bucket estaba en 1114 al momento del delta" era overreach.**
`_apply_delta_msg` solo loggea errores, no aplicaciones exitosas. Entre snapshot (seq=2) y error (seq=40), 37 deltas se aplicaron sin log. **El estado del bucket pre-seq=40 es punto ciego.** La inferencia "delta = -4222 = -3108 - 1114" del 29-may **no está establecida**.

**Corrección #3 — 3 dominios de seq coexistentes.**
Identificados: (a) batch snapshot index, (b) Sid global del WS, (c) per-delta seq del feed. Código NO comete error obvio de mezclar dominios. Pero **amplifica blast radius:** un único `qty<0` dispara `_start_recovery(sid)` marcando 38 tickers stale.

### 2. Comparación lado a lado del parsing (snapshot vs delta)
- `parse_price_to_cents`: idéntica en ambos paths, sin mismatch de rounding
- `parse_size`: idéntica
- Filtro `size==0`: **asimétrico** (snapshot lo filtra, delta no) → bug latente pero NO aplica al caso ATL (su bucket 10c tenía 1114/500, no cero)
- Side handling: consistente
- Routing: consistente (V2 nunca toca asks)

**Conclusión:** parsing limpio. NO hay mismatch lógico entre snapshot y delta que explique `qty=-3108` partiendo de bucket 1114 o 500.

### 3. Sesgo de atribución externa hardcodeado
Encontrado en `orderbook.py:65`:
```
"new_qty < 0 indicates feed-level corruption"
```
La excepción se llama literal `(feed corruption)`. **El código pre-juzga causa externa.** Cualquier diagnóstico futuro se contamina con esa palabra antes de pensar.

Esto es **el mismo anti-patrón de Lección 9 hardcodeado en el código**. Documentado para eventual eliminación cuando V2 entre a fase de fix real.

### 4. Anti-patrón "indiscutiblemente es el feed" CAZADO en tiempo real
Claude Code y Gemini concluyeron prematuramente:
> "El bot ha quedado exculpado."
> "El qty=-3108 es indiscutiblemente un síntoma de un dato de entrada."

**"Indiscutiblemente" es exactamente la palabra que Lección 9 enseña a desconfiar.**

El propio discovery, dos párrafos antes de esa conclusión, listaba **3 hipótesis residuales** — y **2 de las 3 NO son "el feed mintió":**

| Hipótesis | Atribución |
|---|---|
| (A) Feed corruption real | Externa ✓ |
| (B) Snapshot inicial parcial — bucket real en exchange divergía del cargado | Interna (sync issue) |
| (C) Bug de V2 en ventana 2.7s — deltas no logueados dejaron bucket divergente | Interna (apply logic) |

**Discovery probó parsing limpio. NO probó V2 limpio. Son cosas distintas.**

Lo cacé en el chat:
> "Indiscutiblemente es exactamente la palabra que Lección 9 te enseña a desconfiar. El parser está limpio; la aplicación de deltas y la sincronización del snapshot inicial siguen bajo sospecha. Caer en 'es el feed' sería repetir el anti-patrón del 25-may, más sofisticado pero mismo patrón."

**Lección 9 funcionando como sistema de control en vivo.** Ese fue probablemente el momento más valioso del día — la capa adversarial cazó la trampa antes de que contaminara la decisión.

### 5. Update de Lección 9 redactado
Texto completo del párrafo de update en [[update-leccion-9-29may-tercer-discovery-cerrado]].

Pieza central:
- H1 (size=0) **definitivamente refutada**
- Parsing **idéntico y correcto** en ambos paths
- Gap = artefacto, no señal
- **V2 NO está exculpado** (decisión consciente de no caer en atribución externa)
- 3 hipótesis vivas A/B/C
- Decisión: instrumentar antes de tercera ventana
- Activación tercera ventana **desacoplada** (decisión de gestión, no técnica)

### 6. Decisión: branch separada para V2 instrumentación
Opción 1 escogida. Ver [[decision-2026-05-30-branch-separada-v2-instrumentacion-asimetrica]].

**Razones:**
- V1 watchdog está urgente y validado en producción → mergeable HOY
- V2 instrumentación es preparación dormant → no urgente
- Mezclar acoplaría timing de V1 al timing de V2
- Diff de cada branch queda limpio y auditable
- Disciplina ya establecida en el workflow

### 7. Brief de instrumentación asimétrica con 2 correcciones críticas
Ver [[brief-instrumentacion-v2-asymmetric-logging]].

**Corrección 1 — Logging asimétrico, no simétrico:**
- Snapshot DEBUG full (sin truncar a 3 levels como el log INFO actual) — para cubrir hipótesis B
- Delta ERROR on failure — porque DEBUG no se persiste con LOG_LEVEL=INFO (mismo error del 25-may con `NoneType: None`)

**Corrección 2 — Acceso defensivo al bucket:**
El brief original loggeaba `self._books[ticker]._yes_bids.get(price)`. Si `ticker` no está en `_books`, `KeyError` enmascararía el `OrderbookDesyncError` original.

Solución: usar `state` (ya en scope) + `.get(price)` + bloque de logging envuelto en su propio try/except que silencie cualquier fallo del logging.

**Verificación previa obligatoria:**
Pedirle a Code que confirme el estado actual del try/except y del acceso a buckets **antes** de escribir. Patrón que se aplicó el 27-may para evitar el `exc_info=r` que loguru ignora silentemente.

### 8. Claude Code cazó risk de hallucination
Cuando le pasé el brief con "el párrafo de actualización que redactamos", Code preguntó:
> "Mencionaste 'el párrafo de actualización que redactamos', pero en esta conversación no se redactó ninguno."

**Code tenía razón.** El texto del update lo redacté yo en este chat, pero Code no tenía acceso a esa conversación. Si hubiera inventado el párrafo, sería alucinación.

Solución: pasarle el texto explícito en el siguiente mensaje, no asumir contexto compartido. Igual que con el texto original de Lección 9 que tuve que verificar contra el repo seis veces.

## Workflow capa por capa observado

| Capa | Rol del día |
|---|---|
| **Claude Code** | Cuarto discovery con código verbatim, propuso "V2 exculpado" prematuramente, aceptó correcciones, identificó risk de hallucination del párrafo |
| **Gemini (CTO)** | Misma trampa de "indiscutiblemente es el feed" (más sofisticada), aceptó corrección post-señalamiento |
| **Yo (Claude adversarial)** | Cacé "indiscutiblemente" como atribución externa redux, corregí brief de instrumentación con asimetría + defensa + verificación previa, decidí branch separada |
| **Yo (Noel)** | Decisión final sobre branch + timing de PR #1 vs PR #2, sostuve disciplina de "preparación ≠ activación" |

## Anti-patrones cazados HOY

1. **"V2 exculpado, es el feed"** — atribución externa redux. Lo mismo del 25-may en forma más sofisticada. Cazado por la capa adversarial.
2. **"DEBUG para capturar deltas"** — DEBUG no persiste con LOG_LEVEL=INFO. Mismo fallo que producía `NoneType: None` el 25-may. Cazado al revisar el brief de instrumentación.
3. **"Acceso a `_yes_bids[price]` directo"** — atributo privado de otra clase + `KeyError` enmascararía la excepción real. Cazado al revisar acceso al bucket.
4. **"Assume Code tiene el contexto del chat"** — Code no tiene mi conversación. Si le pido el "párrafo redactado", o lo paso explícito o Code va a inventarlo o preguntar. Bien que preguntó. Para el futuro: nunca asumir contexto compartido entre sesiones.

## Lo que sí funcionó (preservar)

1. **Logging fix del attempt #2 (`logger.opt(exception=r)`) sigue dando frutos.** Sin él no habría discovery sobre logs preservados. **Es la única pieza del fix Opción A que cumplió su propósito y sigue habilitando trabajo 3 días después.**
2. **Logs preservados como insumo de discovery.** Cuatro discoveries sobre el mismo log y cada uno encontró algo nuevo. Validación retroactiva de la decisión 1 de Lección 9.
3. **Capa adversarial cazó atribución externa en tiempo real.** Patrón documentado en Lección 9, aplicado el mismo día que casi se repite.
4. **Disciplina de branch separada.** Mantiene los frentes desacoplados como el workflow ya estableció.

## Estado de los tres frentes al cierre

| Frente | Estado |
|---|---|
| **V1 WS zombie** | ✅ CERRADO LIMPIO. PR #1 mergeable. |
| **Lección 10** | ✅ Redactada (texto en [[leccion-10-FINAL-ws-zombie-con-fix-validado]]). Pendiente commit al repo (puede ir junto al PR #1 o aparte). |
| **V2 instrumentación + Lección 9 update** | 🔵 **PREPARADO** — branch nueva PR #2 con brief listo + texto update. Pendiente revisión de diff post-implementación de Code. |
| **V2 tercera ventana de activación** | 🔒 **DESACOPLADO** — decisión de gestión, cuando haya 2-3h continuas. NO es el siguiente paso técnico. |

## Próximos pasos (en orden, ninguno urgente)

1. **Mergear PR #1 (watchdog V1).** Validación 7h ya completa. Sin razón para esperar.
2. **Crear branch PR #2.** Contenido: (a) update Lección 9, (b) instrumentación asimétrica.
3. **Pasar el brief a Claude Code** con el texto del update **explícito** en el mismo mensaje.
4. **Revisar diff del PR #2** contra los 7 criterios de aceptación.
5. **Si limpio → merge PR #2.** Frente V2 queda preparado, dormant, sellado.
6. **Cierre de sesión.** Tercera ventana V2 = otra sesión, otro día, decisión separada.

## Tres patrones meta validados (acumulando desde el 25-may)

1. **"Validación en producción ≠ tests verdes"** — Lección 9 #1. Aplicada ya 2 veces (V1 watchdog 7h ✓, V2 attempt #2 falló pese a tests verdes).
2. **"Atribución externa requiere refutar hipótesis internas con discovery arquitectónico"** — Lección 10 #5. Aplicada HOY al cazar "indiscutiblemente es el feed".
3. **"Logs preservados de incidentes pasados son insumo de validación que evita repetir incidentes futuros"** — implícita en Lección 9. Validada por 4 discoveries sobre el mismo log.

## Nota personal de cierre

5 días encadenados de trabajo intenso (25→26→27→28→29-may continuado a 30-may). Pero hoy fue cualitativamente distinto: **una corrección de hallazgos previos hecha con calma**, no una emergencia operativa.

El sistema (vault + lecciones + cheat-sheet + workflow capa por capa) está empezando a funcionar como sistema, no como secuencia de incidentes. La trampa de "indiscutiblemente es el feed" no se materializó porque la capa adversarial existe y opera. Hace 5 días eso no estaba.

**Cierre de sesión disciplinado.** Frente V1 termina hoy con PR #1. Frente V2 sellado en PR #2 (preparación, no activación). Tercera ventana V2 = decisión de otra sesión.

## Artefactos creados hoy

**Nuevos:**
- [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]] — discovery técnico completo
- [[update-leccion-9-29may-tercer-discovery-cerrado]] — texto del párrafo + contexto
- [[decision-2026-05-30-branch-separada-v2-instrumentacion-asimetrica]] — decisión de workflow
- [[brief-instrumentacion-v2-asymmetric-logging]] — brief operativo reusable

**A actualizar (pendiente):**
- [[kalshi-bot]] — nota raíz del proyecto
- `_notebooklm/proyecto-kalshi-bot.md` — consolidado para NotebookLM

## Links
- [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]]
- [[update-leccion-9-29may-tercer-discovery-cerrado]]
- [[decision-2026-05-30-branch-separada-v2-instrumentacion-asimetrica]]
- [[brief-instrumentacion-v2-asymmetric-logging]]
- [[sesion-2026-05-29-fix-v1-mergeado-y-tercer-discovery-v2]] — sesión anterior
- [[leccion-9-FINAL-causa-raiz-pendiente]]
- [[leccion-10-FINAL-ws-zombie-con-fix-validado]]
- [[fix-v1-watchdog-21fe6fd-validado-produccion]]
- [[kalshi-bot]]
