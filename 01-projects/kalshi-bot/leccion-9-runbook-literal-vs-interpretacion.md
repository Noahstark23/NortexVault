---
fecha: 2026-05-25
tipo: leccion
proyecto: kalshi-bot
numero: 9
tags:
  - leccion
  - aprendizaje
  - runbook
  - kalshi-bot
  - operacional
---

# Lección 9 — Runbook literal vs. interpretación clemente a mitad de incidente

> La disciplina del runbook literal funcionó. El rollback disparado por aplicar criterios numéricos sin clemencia evitó que un bug latente quedara oculto durante horas.

## La lección en una frase
**Los criterios numéricos del runbook se aplican literalmente. Las interpretaciones clementes se documentan como excepciones conscientes con razones explícitas, nunca como default silencioso de las capas operacionales (agentes, IA, scripts).**

## ¿Cómo la aprendí?
Activación de OrderbookManagerV2 en producción (25-mayo-2026). Tres momentos donde la disciplina se puso a prueba:

**Momento 1 — Pre-ventana.** El plan de Gemini (CTO) suavizaba 3 puntos del runbook 12.5: ventana de supervisión reducida (60–120 min vs 2–3h), criterios de éxito incompletos (omitida la métrica central de SidGapError sostenido), criterios de rollback incompletos (omitidos 2 de 5). La review adversarial restauró los 5 criterios literales antes de tocar el flag.

**Momento 2 — T+5min post-flip.** Claude Code reportó "Todos los criterios de aborto del CTO en VERDE" pese a que hubo 19 errores no-SidGap en 179ms — 6x el umbral del runbook (`>3 errores no-SidGap en 10 min`). La interpretación de Code: "ráfaga aislada de bootstrap, handler exceptions capturadas, no requiere rollback". La review adversarial flagueó la interpretación, exigió decisión consciente del operador (no del agente), y estableció línea defensiva: 1 solo error no-SidGap adicional en ventana T+30min = rollback inmediato sin réplica.

**Momento 3 — T+25min.** Segunda ráfaga (≥8 errores, magnitudes hasta -6247). La línea defensiva se disparó. Rollback ejecutado en ~6 min según runbook. Diagnóstico empírico posterior confirmó bug local en V2 (no era ráfaga aislada). De no haber sostenido la línea, el bot habría operado con state corrupto y nadie se entera hasta horas después.

**Resultado:** rollback disciplinado, cero daño operativo, V2 dormant detrás del flag, V1 estable 9h+ post-rollback (0 errores en 350K events capturados), causa raíz identificada con evidencia.

## ¿Qué hubiera hecho diferente?
Nada en el outcome. La lección NO es corregir un error sino consolidar el patrón.

Lo que sí queda formalizado para siguientes ventanas:
1. Antes de tocar cualquier flag de producción, abrir el runbook a la vista — no el plan del CTO, no el reporte del agente.
2. Los criterios numéricos del runbook se leen literal. Si un agente (Code, Cowork, etc.) reporta "todo verde" pero un criterio numérico se violó, el reporte está mal calibrado.
3. Cuando hay tentación de "interpretar con clemencia", esa interpretación se documenta explícitamente con razones, no se aplica en silencio.
4. La capa de decisión es el operador humano. Los agentes producen evidencia y proponen, no deciden.

## ¿Dónde aplica?
- Cualquier flip de feature flag en producción del [[kalshi-bot]]
- Activaciones futuras de Motor 1, Motor 2, motores adicionales
- Cualquier operación con runbook formal en otros proyectos ([[nortex]] cuando madure infraestructura)
- Multi-agent workflows en general — esta lección no es solo de trading

## Causas contribuyentes a documentar

**Cause #1 — Capas operacionales tienden a interpretación clemente.**
Claude Code reportó "criterios en verde" con 19 errores >> umbral 3. La hipótesis no es mala fe — es que las capas que asisten en ejecución optimizan para "completar la tarea sin alarmar" y eso sesga lectura de criterios numéricos. Anti-patrón conocido.

**Cause #2 — El plan original del CTO ya venía suavizado.**
Gemini propuso ventana 60–120 min vs 2–3h del runbook. Frasing: "Retrasar solo incrementa la deuda del roadmap". Exactamente lo que Lección 8 advirtió: la urgencia no es argumento técnico. La review previa la flagueó como riesgo conocido.

**Cause #3 — Atribución externa cómoda.**
Tras el rollback, primera hipótesis fue "feed corruption de Kalshi miente". Discovery posterior la refutó: el bug estaba en V2 (`_parse_fp_levels` no filtra `size=0` mientras `apply_snapshot` sí). Lección: validar causa raíz con evidencia propia antes de atribuir a sistema externo.

## Decisiones derivadas
- Runbook 12.5 se mantiene como está, ya validado empíricamente.
- Reportes de agentes que digan "todo verde" se cross-checkean contra el runbook literal antes de creer.
- Excepciones conscientes a criterios numéricos requieren documentación explícita en el commit/contexto, no se aplican en silencio.
- Pre-flight de ventanas futuras incluye review adversarial obligatoria del plan, sin importar la fuente (CTO, agente, propio).

## Anti-patrones confirmados
1. **"Softening del runbook a mitad de incidente"** — relajar criterios cuando se viola uno porque "tenemos contexto adicional". Falso: el contexto del momento es exactamente cuando los criterios se diseñaron para aplicarse sin discreción.
2. **"Es el feed/exchange/sistema externo el que falla"** — cómoda atribución externa sin discovery del propio código primero.
3. **"Es ráfaga aislada de bootstrap"** — interpretación post-hoc para no disparar rollback. El runbook no distingue ráfagas vs distribuidos; cuenta errores en ventana.
4. **"Retrasar incrementa la deuda del roadmap"** — presión retórica para acelerar decisiones técnicas. La urgencia operacional no es criterio técnico.

## Links
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — chronology completa
- [[decision-2026-05-25-rollback-v2]] — decisión formal del rollback
- [[diagnostico-v2-size-zero-bug]] — diagnóstico de la causa raíz
- [[kalshi-bot]] — proyecto raíz
- Lección 7 referenciada: WS muerto silenciosamente con bot "healthy" (precedente del patrón "todo verde + bug oculto")
- Lección 8 referenciada: "deuda del roadmap" como retórica vs argumento técnico
