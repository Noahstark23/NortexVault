---
fecha: 2026-05-26
tipo: decision
proyecto: kalshi-bot
estado: ejecutada
tags:
  - decision
  - kalshi-bot
  - pacing
  - leccion-9
---

# Decisión: NO reactivar V2 hoy — cierre disciplinado de sesión

## La decisión
Mergear Lección 9 al `KALSHI_BOT_CONTEXT.md`, mergear el PR del fix a main, y **cerrar sesión hoy sin reactivar V2**. Agendar revisión sobria del diff + segunda ventana de activación para mañana en horario de actividad normal.

## Contexto / problema
Tras 24h continuas operando el incidente del 25-may (activación V2, rollback, diagnóstico, redacción de Opción A, validación del fix de Claude Code, redacción de Lección 9 canónica), Claude Code planteó la pregunta de cierre:

> "¿Agendamos la nueva ventana de activación para V2 hoy o prefieres correr una batería adicional de tests E2E locales sobre el state manager primero?"

Ambas opciones tal como planteadas tienen problemas. La presión implícita es "ya tenemos el fix, validémoslo en producción ahora". Esa presión es exactamente el anti-patrón que [[leccion-9-canonica-kalshi-bot-context-md]] acaba de documentar.

## Razones

### Por qué NO reactivar hoy
1. **Fatiga acumulada (24h+ operativos).** El runbook 12.5 requiere 2–3h de supervisión activa atenta. La fatiga viola el espíritu del runbook que se validó empíricamente hace 6 horas. Lección 9 lo dice literalmente: "Runbook 12.5 se aplica literalmente, sin excepciones por contexto" — eso incluye el estado del operador.

2. **El fix no respiró.** Commits `ed7b7ac` y `b9abaa0` son de hace <2h. Sin revisión sobria del diff por mi parte. Sin tiempo para que se asienten efectos colaterales no anticipados. Es el mismo anti-patrón "el bug parece obvio, dame el fix" que Lección 9 acaba de formalizar — replicado en el otro extremo del workflow.

3. **V1 sano sin urgencia operativa.** 0 errores en 13h, 289K events capturados, multi-deporte funcionando (MLB + UCL + NHL), `TRADING_ENABLED=false`, sin capital trabajando. Motor 1 no se activa hoy ni mañana sin importar cuándo se valide V2. **No hay nada que la urgencia compre.**

### Por qué tampoco "más tests E2E"
Los 4 tests del fix cubren los 3 bugs validados. Tests E2E adicionales **sin un hallazgo nuevo que los motive** son trabajo de cobertura, no de validación. No es lo que falta.

### Lo que SÍ falta (revisión sobria mañana, no código)
**Tres puntos de revisión del diff que requieren cabeza fresca, ~20 min:**

1. **Swap seq/apply** se aplicó a `handle_message:170-175`, no a `_apply_delta_msg`. Vale releer con calma para confirmar que no afecta `_apply_snapshot_msg` (también invocado desde `handle_message` post seq update). Si el snapshot también puede fallar, el swap solo cubrió la mitad del problema.

2. **`logger.opt(exception=r).error(...)` en `kalshi_ws.py:320`** cambia el comportamiento del dispatcher. Tests verdes podrían enmascarar contrato divergente. Vale confirmar manualmente que el log nuevo es lo que queremos ver en Coolify, no solo lo que el test verifica.

3. **Test #2** valida `last_seq_by_sid[sid]` intacto post-`OrderbookDesyncError`. No valida que el siguiente delta (con seq válido continuando la secuencia correcta) se procesa OK. **Mitad estructural cubierta; falta validar mitad operativa.** No es bloqueante para mañana — pero vale considerarlo.

Ninguno requiere código nuevo. Son revisión humana del diff con cabeza descansada.

## Alternativas descartadas

### Alternativa 1: re-activar hoy con runbook estricto
**Razón de descarte:** "runbook estricto" + operador con 24h sin descanso = imposibilidad práctica de aplicar el runbook como diseñado. Las decisiones críticas de la ventana requieren claridad mental que no se tiene ya. Si surge un edge case en T+90min, la diferencia entre "decisión correcta" y "decisión cómoda" se desvanece por fatiga.

### Alternativa 2: batería de tests E2E adicionales hoy
**Razón de descarte:** sin un hallazgo nuevo que motivar tests específicos, es trabajo de cobertura genérica. No es lo que falta. Y agregar tests cuando hay fatiga produce tests mal escritos que dan falsa confianza.

### Alternativa 3: re-activar mañana sin revisión sobria
**Razón de descarte:** evita la lección de pacing pero conserva el riesgo del fix sin respirar. Mañana sin revisión = mismo riesgo que hoy + un día perdido.

## Cómo lo verifico (criterios de éxito de la decisión)

**Hoy:**
- ✅ Lección 9 merge al `KALSHI_BOT_CONTEXT.md` (header v1.5)
- ✅ Fix PR merge a main (si no está)
- ✅ Cierre de sesión sin tocar Coolify, sin re-activar flag

**Mañana:**
- [ ] Revisión sobria del diff (20 min, los 3 puntos)
- [ ] Si revisión limpia → agendar ventana V2 con 2–3h libres confirmadas
- [ ] Si revisión revela algo → ticket Claude Code antes de re-activar

**Segunda ventana V2 (cuando se ejecute):**
- [ ] Runbook 12.5 literal otra vez, sin "ya entendimos el bug, podemos relajar"
- [ ] Misma línea defensiva ("1 error no-SidGap → rollback")
- [ ] Mismo timeline T+5 / T+30 / T+2h
- [ ] Métrica de éxito nueva: **no solo "no falla", sino "no falla por la razón que arreglamos"** — si vuelven qty<0 → H1 no era único bug, reabrir con raw snapshot logging que ya está capturado

## Por qué importa esta decisión específicamente
Lección 9 documenta el anti-patrón **"vamos directo a activar, ya entendimos el bug"** como anti-patrón confirmado. Activar hoy invalida la lección en el primer test real de aplicarla.

La disciplina del runbook funciona porque no se relaja **especialmente cuando es inconveniente relajarla**. Hoy es inconveniente parar — tengo el fix listo, el momentum, los tests verdes, el equipo (yo + agentes) cargados con contexto fresco. Exactamente las condiciones donde la presión a "cerrar el loop" es máxima. Y exactamente donde Lección 9 dice que la disciplina importa más.

Esta decisión es el primer test empírico de Lección 9 aplicada después de redactada. Si la rompo aquí, la lección queda como teoría sin práctica.

## Consecuencias derivadas
- **Costo:** 1 día de delay en la segunda ventana de activación V2.
- **Beneficio:** revisión sobria del diff + segunda ventana ejecutada con operador fresco aplicando runbook literal.
- **Riesgo evitado:** segunda ventana fallida por fatiga del operador o por bug residual no detectado en review del diff.
- **Validación empírica de Lección 9** en el primer caso real post-redacción.

## Links
- [[sesion-2026-05-26-fix-merge-y-cierre-disciplinado]]
- [[leccion-9-canonica-kalshi-bot-context-md]] — lección aplicada por esta decisión
- [[fix-v2-opcion-a-implementado-commits]] — fix que NO se va a re-activar hoy
- [[decision-2026-05-25-fix-opcion-a]] — decisión anterior del scope del fix
- [[kalshi-bot]] — proyecto raíz
