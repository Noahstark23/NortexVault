---
fecha: 2026-05-29
tipo: decision
proyecto: kalshi-bot
estado: tomada-pendiente-proximo-discovery
tags:
  - decision
  - kalshi-bot
  - v2
  - pivot-hipotesis
---

# Decisión: pivotar el espacio de hipótesis V2 — abandonar variantes de size=0

## La decisión
**Abandonar la búsqueda de variantes del filtro size=0** como causa raíz de los errores `qty<0` en V2. Pivotar el análisis al **dispatcher de deltas / ordenamiento de mensajes / interpretación del snapshot**. NO proponer fix V2 hasta tener evidencia adicional sobre H2/H3/H4 que cubra el caso real del forense.

## Contexto / problema
El tercer discovery (29-may, forense del log preservado attempt #2) reveló que **el bucket 10c de KXMLB-26-ATL tenía size válido en ambos lados** (YES=1114.07, NO=500.00) cuando llegó el delta que produjo `qty=-3108`. Ver [[discovery-forense-v2-attempt2-h1-refutada]].

H1 (size=0 filter) era la hipótesis dominante desde el 26-may. Sustentaba:
- El fix Opción A (`ed7b7ac`)
- 4 tests verdes
- La revisión sobria del diff
- La inspección de paths de excepción
- La decisión de activar segunda ventana (27-may)

**El forense la refuta empíricamente.** El filtro no era el problema porque el bucket tenía size válido.

## Razones para pivotar

1. **El forense es definitivo dentro de su alcance:** snapshot inicial mostró 1114.07 y 500.00 en bucket 10c (líneas 7703-7704 del log). No hay ambigüedad sobre la pregunta binaria "size > 0?".

2. **Buscar variantes de size=0 sería confirmation bias.** Lección 9 lo documenta explícitamente como anti-patrón: *"Confianza prematura en un fix no validado en producción"*. Continuar buscando "casos especiales del filtro" después de evidencia en contra repetiría el patrón.

3. **El log apunta a otras direcciones:**
   - Gap de seq=40 correlacionado temporalmente con el error
   - 37 deltas exitosos entre snapshot seq=2 y el error
   - Magnitud del delta inferida (~-4222 o -3608) desproporcionada al bucket actual

4. **Persistir en H1 retrasaría el avance del frente V2.** El roadmap a Motor 1 depende de tener V2 sano. Seguir tocando el filter sin tracción no acerca al objetivo.

## Nuevo espacio de hipótesis (a contrastar en próximo discovery)

### H2 — Dispatcher / aplicación de deltas defectuosa
- El delta llegó a estado válido y produjo `qty<0` al aplicarse
- Posible bug en cómo `apply_delta` calcula el resultado
- Magnitud aparentemente desproporcionada al bucket actual

### H3 — Ordenamiento de mensajes / out-of-order
- El gap de seq=40 sugiere delta out-of-order o mensaje perdido
- Si el delta -4222 era válido pero llegó "tarde" después de otros que ya redujeron el size → resultado negativo
- Hipótesis fuerte: el bug es de coordinación, no de cálculo

### H4 — Interpretación del snapshot inicial
- `yes_dollars_fp` se interpreta como cents, dollars, o algo más?
- Que 1114.07 y 500.00 sean los valores "correctos" depende del shape de parseo asumido
- Posible mismatch entre la unidad del snapshot y la unidad del delta

## Alternativas descartadas

### Alternativa: forzar otra activación V2 para "ver qué pasa"
**Descartada.** Sin causa raíz validada, sería el mismo patrón del attempt #2. Lección 9 lo prohíbe explícitamente.

### Alternativa: empezar Opción B (rediseño) ahora
**Descartada por prematura.** Rediseño tiene scope grande (cross-validation, invariantes, etc.). Antes de invertir 1-2 semanas en rediseño, querer saber si H2/H3/H4 admiten parche puntual como hizo Opción A.

### Alternativa: continuar V1 indefinidamente (Opción C definitiva)
**No descartada pero no preferida.** V1 sano (validación 7h del fix watchdog). Pero V2 sigue siendo prerequisito para Motor 1. C indefinida congela roadmap sin causa técnica.

## Plan de acción (orden estricto)

1. **NO tocar producción.** V2 dormant, fix Opción A mergeado pero no se reactiva sin causa nueva validada.
2. **NO escribir fix V2 sin más evidencia.** Cualquier hipótesis H2/H3/H4 necesita validación contra log preservado antes de implementación.
3. **Próximo discovery (cuando se retome el frente V2):**
   - Brief para Claude Code: read-only sobre `_apply_delta_msg` con foco en H2 (¿qué hace exactamente apply_delta con un delta negativo grande sobre size válido? ¿hay edge case?)
   - Brief paralelo: ¿qué deltas se aplicaron entre seq=2 y seq=39? ¿alguno también produjo error similar?
   - Brief: ¿el shape de parseo del `yes_dollars_fp` está documentado en algún sitio?
4. **Reabrir Lección 9 cuando el tercer discovery cierre causa raíz.** Por ahora sigue "NO RESUELTA" prominente, pero ahora con menos hipótesis vivas.

## Cómo lo verifico (criterios de éxito de la decisión)

**Decisión correcta retroactivamente si:**
- El próximo discovery identifica una de H2/H3/H4 como causa con evidencia
- El fix derivado pasa los 4 criterios de Lección 9 (tests + revisión + inspección + **validación en producción**)
- Una segunda activación V2 (en el futuro) no reproduce el bug

**Decisión retroactivamente errada si:**
- El próximo discovery encuentra que el snapshot 1114.07/500.00 estaba mal-parseado y H1 sí era correcto en su esencia (improbable dada la evidencia, pero posible)
- O si H2/H3/H4 también son refutadas y aparece H5 inesperada

## Consecuencias derivadas
- **Fase 2 sigue bloqueada** hasta tener fix V2 válido
- **Motor 1 sin fecha** hasta que V2 pase ventana de validación real
- **Opciones A2 (parche puntual) vs B (rediseño) NO se deciden ahora** — dependen del próximo discovery
- **El fix Opción A queda en main** porque arregla 3 bugs reales (incluyendo el que sí funcionó: logging). Solo el bug primario sigue abierto.

## Lecciones derivadas (para Lección 9 cuando se cierre)

Esta decisión es un caso concreto del anti-patrón **"confianza prematura en fix no validado en producción"** de Lección 9 — pero **aplicado a tiempo, no después de un tercer incidente**. El forense del log preservado funcionó como validación retroactiva del fix Opción A: lo refutó sin necesidad de re-activar V2.

Esto valida una decisión derivada implícita de Lección 9: **logs preservados de incidentes pasados son insumo de validación que evita repetir incidentes futuros**.

## Links
- [[discovery-forense-v2-attempt2-h1-refutada]] — evidencia que sustenta esta decisión
- [[leccion-9-FINAL-causa-raiz-pendiente]] — lección que predijo este escenario
- [[diagnostico-v2-size-zero-bug]] — diagnóstico original (refutado por evidencia)
- [[fix-v2-opcion-a-implementado-commits]] — fix mergeado que NO resuelve el bug primario
- [[decision-2026-05-25-fix-opcion-a]] — decisión original del fix (válida en su contexto pero hipótesis errada)
- [[incidente-v2-attempt-2-2026-05-27]] — incidente que generó el log
- [[sesion-2026-05-29-fix-v1-mergeado-y-tercer-discovery-v2]] — sesión de esta decisión
- [[kalshi-bot]]
