---
fecha: 2026-05-25
tipo: decision
proyecto: kalshi-bot
estado: en-ejecucion
tags:
  - decision
  - kalshi-bot
  - v2
  - fix
---

# Decisión: Opción A — fix puntual de OrderbookManagerV2

## La decisión
Proceder con fix puntual de los 3 bugs validados en V2 (size=0 inconsistencia + seq ordering + observability), con scope acotado de 5–8 líneas de código + 4 tests + observability fix, en lugar de rediseño con cross-validation REST↔WS (Opción B) o continuar indefinidamente con V1 (Opción C).

## Contexto / problema
Tras rollback de V2 (ver [[decision-2026-05-25-rollback-v2]]) y diagnóstico empírico cerrado (ver [[diagnostico-v2-size-zero-bug]]), las tres opciones evaluadas:

- **Opción A** — Fix puntual sobre V2 actual
- **Opción B** — Rediseño con cross-validation REST↔WS (~800–1500 líneas, 1–2 semanas)
- **Opción C** — Continuar V1 indefinido (data capture only, bloquea Motor 1)

## Razones para Opción A
1. **Bug raíz es local y testeable offline.** `_parse_fp_levels` no filtra `size=0` mientras `apply_snapshot` sí. Es un edge case de wire format, fix de 2–5 líneas, validable con test unitario que reproduce el bug.
2. **Bugs contribuyentes son igualmente locales.** Orden invertido `seq/apply` (2 líneas) y dispatcher logging (1 línea) son fixes contenidos sin cambio de semántica.
3. **Opción B se debilita con el discovery.** El argumento de B ("el feed miente, necesitamos verificación independiente") fue refutado. Cross-validation REST↔WS no soluciona un bug de parsing — solo lo detecta tarde.
4. **Costo bajo y reversible.** Días de implementación, no semanas. Si la segunda activación falla, rollback en <6 min ya probado funciona, y opción C queda disponible como fallback.
5. **C bloquea Motor 1 sin razón técnica suficiente.** V1 cumple Fase 1 (data capture) pero requiere V2 sano para Fase 2 (Motor 1 arbitraje). Postergar A indefinidamente es congelar el roadmap por miedo, no por evidencia.

## Razones para NO Opción B
- Estimación realista: 800–1500 líneas + 1–2 semanas + nuevos vectores de bugs (timing entre paths, divergencia tolerada, alertas), no las "~200–500 líneas" subestimadas por Claude Code.
- Cross-validation REST↔WS consumiría REST budget con 41 tickers cada N segundos — riesgo de 429s.
- Si la causa raíz es parsing de wire format, B la detecta pero no la resuelve.
- Overengineering contra un fantasma (la "feed corruption" que el discovery refutó).

## Razones para NO Opción C
- Bloquea Motor 1 sin causa técnica suficiente.
- "V2 es estructuralmente frágil" ya no es argumento defendible — el bug está identificado y es contenido.
- Postergar indefinidamente normaliza el flag dormant como steady state.

## Alternativas descartadas (variantes de A consideradas)
- **A+ scope expandido** (Claude Code anterior estimó ~35 líneas mezclando: fix + auto-recovery semantic change + métrica nueva + observability): descartado. Feature creep. Cada componente decidible separadamente, no como bundle silencioso.
- **Fix sin tests:** descartado. Sin tests que reproduzcan el bug original, no hay forma de saber si el fix fue el correcto.

## Scope ejecutable (brief enviado a Claude Code)

**Fix lógico (core):**
1. Filtrar `size==0` en `_parse_fp_levels` (orderbook_manager_v2.py). Mantener `OrderbookState.apply_snapshot` con filtro intacto. Razón: OrderbookState es modelo puro con invariante "size > 0"; el filtrado de wire format es responsabilidad de la capa que conoce el feed.
2. Invertir orden en `_apply_delta_msg`: `state.apply_delta(...)` antes de `_last_seq_by_sid[sid] = new_seq`.
3. Mantener comportamiento estricto ante delta negativo sobre price ausente: lanzar `OrderbookDesyncError`. El propósito de V2 es detectar desyncs reales.

**Observabilidad:**
- `exc_info=r` explícito en `_dispatch` de `kalshi_ws.py` para preservar stack traces.
- Logging raw snapshot WS: INFO con resumen (ticker, seq, num_levels, sample), DEBUG con payload completo.

**Tests requeridos:**
- Test 1: snapshot con `[price, 0]` → `_parse_fp_levels` filtra, `_yes_bids` no contiene entry
- Test 2: delta=-X sobre price ausente → `OrderbookDesyncError` + `_last_seq_by_sid` NO avanza
- Test 3: regresión con magnitudes reales observadas (-6247, -4887) sin corromper state
- Test 4: dispatch con excepción produce stack trace completo en log

**Criterios de completitud:**
- Tests nuevos pasan
- Suite completa sin regresiones
- Commit prefijo: `fix(v2): resolve orderbook size=0 desync and seq order`
- Diff completo en output final
- Cláusula de escalación: si descubre efectos colaterales, para y reporta, no improvisa scope

## Cómo lo verifico
**Criterios de éxito post-fix:**
- Suite de tests verde (4 nuevos + 0 regresiones)
- Code review del diff por mi parte antes de merge
- Segunda ventana de activación V2 aplicando runbook 12.5 literal (sin "ya entendimos el bug, podemos relajar")
- T+2h sin errores `delta produces qty<0` ni `OrderbookDesyncError` nuevos
- `books_initialized=40/40`, `sids_recovering=0`, `gaps_last_60s=0` sostenido

**Condición de invalidación:**
Si segunda ventana produce errores `delta produces qty<0` o cualquier criterio de rollback del runbook se viola → la decisión retroactivamente fue insuficiente. Pivot a Opción B con scope reajustado (invariantes internas, no cross-validation externa).

## Condiciones explícitas anexas
- Antes del fix, agregar logging del raw snapshot WS. Si la segunda activación produce errores, necesitamos el raw payload capturado para confirmar/refutar H1 (parsing) definitivamente.
- Segunda ventana de activación: 2–3h continuas de monitoreo activo, runbook abierto, no excepciones, no "ya sabemos qué pasa".

## Próximos pasos
- [ ] Claude Code ejecuta brief con scope acotado
- [ ] Code review del diff (yo, Noel)
- [ ] Merge a main
- [ ] Ventana programada para segunda activación con 2–3h continuas reservadas
- [ ] Lección 9 cerrada con causa raíz validada (ya hecha → [[leccion-9-runbook-literal-vs-interpretacion]])

## Links
- [[sesion-2026-05-25-v2-activacion-y-rollback]] — chronology de la sesión
- [[decision-2026-05-25-rollback-v2]] — decisión del rollback
- [[diagnostico-v2-size-zero-bug]] — causa raíz validada
- [[leccion-9-runbook-literal-vs-interpretacion]] — lección operativa
- [[kalshi-bot]] — proyecto raíz
