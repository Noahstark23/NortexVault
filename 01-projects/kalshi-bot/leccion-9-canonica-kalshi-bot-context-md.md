---
fecha: 2026-05-26
tipo: leccion
proyecto: kalshi-bot
numero: 9
estado: canonica-para-repo
target: KALSHI_BOT_CONTEXT.md
version-doc: 1.5
tags:
  - leccion
  - kalshi-bot
  - post-mortem
  - runbook
  - canonica
---

# Lección 9 — versión canónica para KALSHI_BOT_CONTEXT.md

> Texto final aprobado para mergear al documento de arquitectura del repo. Estructura paralela a Lecciones 4, 6, 7, 8. Esta es la versión "oficial". Mi versión más conceptual/operativa vive en [[leccion-9-runbook-literal-vs-interpretacion]] como complemento.

---

## Header del archivo a actualizar

```markdown
**Versión:** 1.5
**Última actualización:** Mayo 26, 2026
**Owner:** Noel Pineda (sole founder)
**Repo:** kalshi-bot (privado, GitHub — Noahstark23/botkalshi)

**Cambios v1.4 → v1.5 (2026-05-26):**
- **Lección 9 NUEVA:** V2 activación fallida (25-may), rollback disciplinado, 3 bugs corregidos (commit ed7b7ac + b9abaa0), atribución externa prematura como anti-patrón confirmado.
- Sección 11 actualizada: deuda técnica viva — pendiente segunda ventana de activación V2 con fix aplicado.
- Sección 12.5 sin cambios (runbook validado empíricamente, se mantiene).
```

## Texto a pegar al final de la sección 9 (Lecciones Aprendidas)

```markdown
### Lección 9 (Mayo 25-26, 2026): V2 activación, rollback disciplinado y atribución externa prematura

**Contexto:** Activación de OrderbookManagerV2 en producción siguiendo runbook 12.5. T+5min: ráfaga de 19 errores `delta produces qty<0 (feed corruption)` en 179ms durante bootstrap, interpretada tentativamente como "ráfaga aislada de arranque". T+15min: segunda ráfaga de ≥8 errores con magnitudes hasta -6247, en tickers distintos, sin trigger aparente. Rollback ejecutado a T+25min en ~6min, sin daño operativo. 87 errores totales en 27min de V2 activo. V1 recuperado limpio inmediatamente. 13h+ post-rollback con 0 errores.

**Causa raíz técnica (3 componentes validados por discovery empírico):**

1. **Discrepancia silenciosa de convención `size=0` entre capas del mismo dominio.** `_parse_fp_levels` en `orderbook_manager_v2.py` aceptaba levels con `size=0` y los pasaba a `OrderbookState.apply_snapshot`, que los filtraba silenciosamente con `if size > 0`. Cuando Kalshi enviaba un snapshot con `[price, 0]` legítimo (que significa "ese level está vacío en este momento"), V2 perdía el price en su book interno. Un delta posterior con `delta=-X` sobre ese price producía `book.get(price, 0) + (-X) = -X < 0` → `OrderbookDesyncError`.

2. **Orden de operaciones invertido en `handle_message`.** `_last_seq_by_sid[sid] = new_seq` se actualizaba ANTES de `state.apply_delta()`. Cuando `apply_delta` lanzaba `OrderbookDesyncError`, el sid avanzaba el seq sin avanzar el state. El siguiente delta pasaba el gap check (`new_seq == last_seq + 1`) y el monotonicity check (`new_seq > state.sequence`) pero operaba sobre estado stale → cascada. Un error puntual se convertía en ráfaga de N errores consecutivos hasta que el siguiente snapshot lo recuperaba.

3. **Stack traces silenciados en `kalshi_ws._dispatch`.** `asyncio.gather(return_exceptions=True)` captura excepciones como objetos en `results`, lo que vacía `sys.exc_info()` en el contexto donde se ejecuta `logger.exception(...)`. Resultado: 87 errores con stack trace `NoneType: None` durante todo el incidente. Sabíamos que algo fallaba, no sabíamos dónde se originaba.

**Causa raíz arquitectónica (la lección estructural):**

Los tres componentes arriba comparten una propiedad común: cada uno por separado era benigno o parecía una decisión razonable. La discrepancia `size=0` era una optimización defensiva en `apply_snapshot`. El orden seq-antes-de-apply era natural cuando se lee linealmente. `return_exceptions=True` es la forma correcta de aislar handlers independientes. Pero **al combinarse**, producían un bot que aceptaba estado corrupto silenciosamente y operaba sobre él durante minutos.

V1 (path estable de data capture) no exhibía ninguno de estos problemas no porque fuera "más robusto" sino porque **no tenía estado mutable in-memory para corromper**. V1 escribe deltas a DB y olvida. V2 introdujo el primer componente con state mutable en producción, y el resto del sistema (dispatch, logging, error handling) no estaba preparado para tratarlo distinto a los handlers idempotentes.

**Causa raíz de proceso (igual de importante):**

El primer diagnóstico empírico atribuyó el origen del incidente a "feed corruption de Kalshi" basándose en evidencia consistente (deltas duplicados con qty idéntico, self-tag del código "(feed corruption)", tickers fallando en su primer delta). Esa atribución era **plausible pero no probada**. Un segundo discovery dirigido reveló el bug `size=0` filtering, que producía exactamente los mismos síntomas sin necesidad de asumir un exchange que miente.

**Decisiones derivadas:**

1. **Invariantes de dominio deben ser consistentes entre todas las capas que tocan ese dominio.** Si `OrderbookState` invariante es "size > 0 siempre", esa invariante debe respetarse en TODA la cadena de construcción, no relajarse en un lado y reforzarse en el otro. El filtrado pertenece a la capa que conoce el wire format (`_parse_fp_levels`), no a la capa de modelo puro.

2. **Operadores con estado mutable en el WS dispatch necesitan tratamiento diferente a handlers idempotentes.** El patrón `asyncio.gather(return_exceptions=True)` es funcional para handlers independientes (DB writers, métricas) pero esconde errores que requieren recovery. V2 necesita observabilidad explícita de sus propias fallas.

3. **Logging con `logger.exception` requiere contexto con excepción activa.** Con `return_exceptions=True`, la excepción es un objeto, no un estado del intérprete. El logging requiere pasar la excepción explícita (`logger.opt(exception=r)` en loguru). Olvidar esto durante 27min de incidente nos costó toda la evidencia de stack trace.

4. **Runbook 12.5 se aplica literalmente, sin excepciones por contexto.** El criterio "más de 3 errores no-SidGap en 10min" se activó con la primera ráfaga. La línea defensiva disparó el rollback disciplinado a T+25min, evitando horas adicionales de operación con estado corrupto.

5. **Atribución externa requiere refutar las hipótesis internas primero.** Cuando un sistema falla, "el feed/exchange tiene la culpa" es la conclusión cómoda. Antes de aceptarla, hay que ejecutar un segundo discovery dirigido contra el propio código. Aquí, H1 (bug interno) se validó en 30min de inspección.

**Anti-patrones confirmados:**

- **"El feed/exchange tiene la culpa" sin discovery profundo primero.** La hipótesis externa siempre debe ser la última en aceptarse. Validar antes de creer.
- **Interpretar criterios de runbook con discreción en mitad del incidente.** El primer reporte post-flip clasificó la ráfaga erróneamente usando argumentos ad-hoc fuera del runbook. Si el criterio numérico se cumple, el rollback se ejecuta.
- **"El bug parece obvio, dame el fix" sin validación de hipótesis.** El primer diagnóstico propuso un fix de 35 líneas basado en una carrera REST↔WS no validada. La segunda iteración refutó esto, previniendo arreglar el síntoma equivocado.
- **Mezclar fix de bug + refactor + feature en el mismo PR.** La primera iteración mezcló la corrección de secuencia con un recovery automático de semántica nueva y métricas. Cada uno requiere revisión y despliegue separados.

**Lo que sí funcionó (Preservar):**

1. **Runbook 12.5 con criterios literales.** Detectó la degradación empírica, disparó el rollback seguro en 6min y protegió el entorno productivo.
2. **Pipeline de escalación de 3 layers.** Claude Code escaló la incompatibilidad de logs en lugar de ignorar la falla (validando el workflow de la Sección 14).
3. **Discovery pre-planning.** Validar el estado real antes de escribir el fix (Lección 8) previno aplicar código erróneo a master.
4. **V1 como baseline fallback.** No deprecamos destructivamente V1 durante el dev de V2. Esto permitió volver a un estado funcional conocido sin downtime del motor de recolección de datos.
```

---

## Notas sobre la versión final

**Cambios vs borrador previo (Claude review adversarial sugirió, ambos aprobados):**
- Mantener los 4 anti-patrones separados (no consolidar el #3 y #4 — son fallas distintas en capas diferentes: error de diagnóstico vs error de control de versiones/CI)
- Mantener la sección "Lo que sí funcionó" — práctica estándar de SRE, documentar guardrails que evitaron impacto

**Cambios menores aplicados:**
- Eliminadas comparaciones cruzadas implícitas (e.g., "(Reforzamiento de Lección 6...)") para mantener cada lección autocontenida
- Pulido de redacción en causa raíz arquitectónica
- Simplificación de la decisión derivada #2 (eliminado "métricas" como ejemplo de handler idempotente, mantenido foco en DB writers)

**Lo que NO entra en esta lección (queda para otros docs):**
- Detalles del fix (commits, archivos, tests) → vive en [[fix-v2-opcion-a-implementado-commits]] y en el changelog del PR
- Decisión de pacing (no reactivar hoy) → vive en [[decision-2026-05-26-no-reactivar-hoy]]
- Cronología minuto-a-minuto de la ventana → vive en [[sesion-2026-05-25-v2-activacion-y-rollback]]

## Links
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — chronology del incidente
- [[sesion-2026-05-26-fix-merge-y-cierre-disciplinado]] — sesión de hoy donde se redactó esta versión
- [[diagnostico-v2-size-zero-bug]] — causa raíz técnica detallada
- [[fix-v2-opcion-a-implementado-commits]] — implementación
- [[decision-2026-05-26-no-reactivar-hoy]] — decisión de pacing
- [[leccion-9-runbook-literal-vs-interpretacion]] — versión operativa/conceptual previa
- [[kalshi-bot]] — proyecto raíz
