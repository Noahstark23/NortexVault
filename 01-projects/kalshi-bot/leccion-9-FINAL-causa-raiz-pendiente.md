---
fecha: 2026-05-28
tipo: leccion
proyecto: kalshi-bot
numero: 9
estado: commiteada-en-repo
version-doc: 1.5
sha-commit: 3a4b384
tags:
  - leccion
  - kalshi-bot
  - post-mortem
  - canonica
  - final
  - causa-raiz-pendiente
---

# Lección 9 FINAL — versión committeada al repo (SHA 3a4b384)

> **ESTA es la versión vigente.** Reemplaza el borrador previo en [[leccion-9-canonica-kalshi-bot-context-md]] (obsoleto — concluía erróneamente "size=0 era la causa").
>
> **Diferencia central:** cubre AMBOS attempts (25-may + 27-may). **Causa raíz marcada como NO RESUELTA prominentemente.** El tono crudo es feature, no defecto.
>
> Committeada en `KALSHI_BOT_CONTEXT.md` v1.5, SHA 3a4b384, pusheada a main.

---

## Por qué se corrigió el borrador anterior

El borrador del 26-may concluía: *"un segundo discovery dirigido reveló el bug size=0 filtering, que producía exactamente los mismos síntomas"* — implicando causa encontrada.

**El attempt #2 del 27-may refutó esa conclusión empíricamente:**
- El fix `ed7b7ac` (size=0 filter + seq order swap + dispatcher logging) se aplicó completo
- V2 se reactivó con el fix mergeado
- **El bug reapareció a T+2.7s del primer snapshot** — `KXMLB-26-ATL at 10c: qty=-3108`
- Solo el dispatcher logging fix funcionó (produjo stack traces completos)

Por eso la versión committeada cambia de *"encontramos la causa vía discovery"* a *"creímos haberla encontrado dos veces y nos equivocamos las dos veces, pero el sistema de contención nos protegió en ambas"*.

---

## Texto canónico en `KALSHI_BOT_CONTEXT.md` v1.5

### Lección 9 (Mayo 25-27, 2026): Dos activaciones fallidas de V2, dos diagnósticos prematuros, contención disciplinada en ambas

**Estado de causa raíz: NO RESUELTA al cierre de esta entrada.** Esta lección documenta dos intentos fallidos de activar OrderbookManagerV2 y dos hipótesis de causa raíz que resultaron incorrectas o incompletas. El diagnóstico real queda pendiente de un tercer discovery con la evidencia nueva (stack traces completos) capturada en el attempt #2.

**Contexto — Attempt #1 (25-may):** Activación de V2 siguiendo runbook 12.5. T+5min: ráfaga de 19 errores `delta produces qty<0` en 179ms. T+15min: segunda ráfaga de ≥8 errores, magnitudes hasta -6247, tickers distintos. Rollback a T+25min en ~6min. 87 errores totales en 27min. Stack traces perdidos (`NoneType: None`) por `return_exceptions=True` + `logger.exception` sin `exc_info` explícito.

**Contexto — Attempt #2 (27-may):** Tras fix ed7b7ac (size=0 filter + seq order swap + dispatcher logging fix), revisión sobria del diff, 4 tests verdes e inspección de paths de excepción confirmando cobertura. Re-activación. **Primer error a T+2.7s del primer snapshot** (`KXMLB-26-ATL at 10c: delta produces qty=-3108 < 0`), seguido de gap CRITICAL (38 tickers stale) y server error de Kalshi (`code 15 "Action required"`). Rollback en ~4min. El patrón estructural reapareció **con el fix aplicado**.

**Lo que cada diagnóstico afirmó vs. lo que la realidad mostró:**

| Diagnóstico | Afirmó | Refutado por |
|---|---|---|
| Post-attempt #1 (v1) | "Feed corruption de Kalshi, causa externa" | Segundo discovery encontró bug interno (size=0) |
| Discovery dirigido | "H1: size=0 filter es la causa, fix de ~5 líneas" | Attempt #2: el fix se aplicó y el bug reapareció |
| Estado actual | Causa raíz desconocida | (pendiente tercer discovery) |

**Causas técnicas identificadas (reales pero NO suficientes):**

1. **Discrepancia de convención `size=0`** entre `_parse_fp_levels` (no filtraba) y `OrderbookState.apply_snapshot` (filtraba con `if size > 0`). Bug real, corregido en ed7b7ac. **Pero no era la causa del incidente** — el attempt #2 falló igual con el filtro aplicado.

2. **Orden de operaciones invertido** en `handle_message`: `_last_seq_by_sid[sid]` se actualizaba antes de `state.apply_delta()`, convirtiendo un error puntual en cascada. Bug real, corregido. Contribuye a la propagación pero no es el origen del primer `qty<0`.

3. **Stack traces silenciados** en `kalshi_ws._dispatch`. `asyncio.gather(return_exceptions=True)` captura la excepción como objeto, vaciando `sys.exc_info()` en el contexto de `logger.exception`. Corregido con `logger.opt(exception=r)`. **Este fix SÍ funcionó** — el attempt #2 produjo stack traces completos que el attempt #1 no tuvo. Es la única pieza de los tres fixes que cumplió su propósito.

**La causa raíz que sigue abierta:** En el attempt #2, el primer error fue `KXMLB-26-ATL at 10c: qty=-3108` a T+2.7s. Pendiente de verificar en los logs preservados: ¿ese price (10c) tenía size>0 en el snapshot WS inicial? Si sí, H1 (size=0) está completamente refutada y el bug es otro. Si el snapshot tenía el level con size válido pero el delta posterior produjo qty negativo de todas formas, el problema está en cómo V2 aplica deltas sobre estado válido, no en cómo filtra snapshots. Logs preservados: `data/rollback_v2_attempt2_20260527_154809.log` (949 KB).

**Causa raíz arquitectónica (validada, esta sí):** El bot NO crashea ante estos errores — los trata como recoverable y sigue "vivo" con estado degradado. En attempt #2, `bot_runs.crash_reason=None` para el run de V2: 12min de errores, cero crash. Esto es el patrón estructural de Lección 7 ("el bot dice que está corriendo" ≠ "el bot está corriendo") aplicado a **estado mutable in-memory** en lugar de conexión WS. V2 introdujo el primer componente con state mutable en producción, y el sistema no distingue entre "handler independiente que falló" (tolerable) y "state machine que se corrompió" (no tolerable). Esta es la lección estructural más sólida del incidente.

**Decisiones derivadas:**

1. **Un diagnóstico no validado contra producción es una hipótesis, no una causa raíz — sin importar cuánto rigor lo respalde.** El fix de size=0 pasó 4 tests, revisión sobria del diff, inspección de paths de excepción, y aun así no era la causa. La única validación real de un fix de producción es la producción. Tests verdes ≠ bug resuelto.

2. **Operadores con estado mutable necesitan tratamiento de error distinto a handlers idempotentes.** `return_exceptions=True` es correcto para DB writers; para una state machine, un error debe marcar el estado como corrupto y forzar recovery, no tragarse silenciosamente y seguir operando.

3. **Runbook 12.5 + línea defensiva T+5min funcionan.** Dos activaciones, dos rollbacks limpios (<5min ambos), cero daño operativo, V1 intacto. El sistema de contención es sólido aunque V2 no lo sea.

4. **El logging fix se valida solo: el attempt #2 capturó lo que el attempt #1 perdió.** Mantener este patrón (`logger.opt(exception=r)`) para todo handler en contexto `gather`.

5. **La urgencia de "sprint/roadmap" es un fantasma en proyecto solo-founder sin capital trabajando.** Antes del attempt #2, la presión de "estamos atrasados con el sprint" casi salta la inspección de paths de excepción. No hay sprint real: no hay team, board, ni deadline contractual. Activar V2 hoy vs. en una semana cambia $0 de PnL. Cuando la métrica de urgencia empuja a peores decisiones técnicas, la métrica está mal calibrada.

**Anti-patrones confirmados:**

- **Atribución externa sin discovery propio primero** (attempt #1: "es el feed"). La hipótesis externa es la más cómoda y la menos verificable. Siempre la última en aceptarse. (Refuerzo de Lección 6.)
- **Confianza prematura en un fix no validado en producción** (attempt #2: "size=0 era la causa, fix de 5 líneas, listo"). Tercera confirmación del patrón "el diagnóstico limpio ≠ el sistema sano" (Lecciones 6, 8, 9).
- **Interpretar criterios de runbook con discreción en mitad de incidente** (attempt #1: clasificar la primera ráfaga como "no requiere rollback" con argumentos ad-hoc). Si el criterio numérico se cumple, el rollback se ejecuta.
- **Urgencia de roadmap como motor de decisión técnica** (pre-attempt #2). El "atraso" autoinfligido empujó a comprimir validación. La línea defensiva del runbook compensó, pero el patrón de decisión era el equivocado.

**Lo que sí funcionó (preservar):**

1. **Runbook 12.5 con criterios literales + línea defensiva T+5min.** Contuvo dos incidentes a <5min cada uno, cero impacto al capital.
2. **Capa adversarial (Claude Project) aplicando el runbook más estricto que el reporte operativo.** Frenó la activación apresurada del attempt #2 hasta cerrar la inspección.
3. **V1 como baseline no destructivo.** Mantener V1 corriendo durante el desarrollo de V2 permitió rollback instantáneo a estado conocido bueno, dos veces.
4. **Dispatcher logging fix.** Es el único de los tres fixes que cumplió: convirtió el attempt #2 de "ciego" (como attempt #1) a "con evidencia completa". Sin él, el tercer discovery arrancaría sin stack traces otra vez.

**Próximo paso (pendiente, NO ejecutar bajo presión):** Tercer discovery dirigido sobre los logs preservados del attempt #2, con foco en el primer error (`KXMLB-26-ATL at 10c`) y su snapshot WS correspondiente. El objetivo es responder la pregunta abierta: ¿el bug está en el parsing del snapshot (H1 parcial) o en la aplicación de deltas sobre estado válido (H nueva)? La evidencia nueva (stack traces + raw snapshot logging) lo hace respondible de forma definitiva esta vez.

---

## Header del archivo en repo (v1.5)

```markdown
**Versión:** 1.5
**Última actualización:** Mayo 27, 2026

**Cambios v1.4 → v1.5 (2026-05-27):**
- **Lección 9 NUEVA:** Dos activaciones fallidas de V2 (25-may, 27-may), dos
  diagnósticos prematuros, contención disciplinada en ambas. Causa raíz NO
  resuelta — pendiente tercer discovery con stack traces del attempt #2.
- Fixes ed7b7ac + b9abaa0 mergeados: size=0 filter, seq order swap, dispatcher
  logging. Solo el logging fix validado como efectivo en producción.
- Sección 11: deuda técnica viva — V2 sigue no apto para producción, causa
  raíz abierta.
- Sección 12.5 sin cambios (runbook validado empíricamente 2 veces).
```

## Confirmación del commit
- **SHA:** `3a4b384`
- **Estado:** en `main`, pusheado
- **Verificado:** sí, presente en el repo

## Diferencia clave con el borrador del 26-may
El borrador anterior asumía que el discovery había cerrado la causa raíz. **Esta versión NO hace esa asunción.** El tono crudo ("causa raíz NO RESUELTA" prominente) es feature, no defecto: previene confirmation bias hacia H1 en el próximo discovery.

Si en 3 meses se abre esta lección buscando contexto antes del tercer discovery, la conclusión NO va a empujar a buscar variantes de "size=0" — va a empujar a abrir hipótesis nuevas con la evidencia preservada.

## Links
- [[incidente-v2-attempt-2-2026-05-27]] — post-mortem del attempt #2 que motivó la corrección
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — attempt #1
- [[sesion-2026-05-27-segunda-ventana-v2-preflight]] — pre-flight del attempt #2
- [[sesion-2026-05-28-leccion-9-corregida-y-ws-zombie]] — sesión donde se redactó esta corrección
- [[leccion-9-canonica-kalshi-bot-context-md]] — versión OBSOLETA del 26-may (mantenida como historia del razonamiento, NO usar como referencia técnica)
- [[leccion-9-runbook-literal-vs-interpretacion]] — versión operativa/conceptual (complementaria, sigue vigente)
- [[diagnostico-v2-size-zero-bug]] — diagnóstico inicial que postuló H1 (ahora refutado)
- [[kalshi-bot]] — proyecto raíz
- [[cheatsheet-runbook-12.5-v2-activacion]] — runbook que validó 2 rollbacks
