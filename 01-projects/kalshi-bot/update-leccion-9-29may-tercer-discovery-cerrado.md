---
fecha: 2026-05-30
tipo: leccion-update
proyecto: kalshi-bot
numero: 9
estado: redactado-pendiente-merge-en-PR2
target: KALSHI_BOT_CONTEXT.md (via PR #2 branch V2)
tags:
  - leccion-update
  - kalshi-bot
  - tercer-discovery
  - pr-2
---

# Update Lección 9 — texto a pegar al final de la lección existente

> Párrafo de actualización a `KALSHI_BOT_CONTEXT.md` después del texto de Lección 9 existente. Va en la **branch del PR #2 (V2 instrumentación + update)**, no en main directo. Junta con la branch de instrumentación porque son del mismo frente: preparación para tercera ventana V2.

## Contexto del update
La Lección 9 original (commit `3a4b384`, v1.5) dice "causa raíz NO RESUELTA, pendiente tercer discovery". Ese tercer discovery ocurrió (29-may) seguido del cuarto cross-check con código (30-may). El resultado refina sustancialmente lo que sabemos, pero la causa SIGUE abierta — solo el espacio de hipótesis se acota.

**La trampa que casi cazo:** Claude Code propuso cerrar la lección con "V2 exculpado, es feed corruption". Eso sería atribución externa **otra vez** — el mismo anti-patrón que Lección 9 documenta. Lo cacé en el chat y corrigí.

El update debe ser **honesto sobre lo que se cerró y lo que sigue abierto**, sin caer en confirmation bias.

## Texto del update (para pegar literal)

```markdown
**Update (29-30 may, tercer y cuarto discovery):** Auditoría forense lado a lado del
pipeline Snapshot vs Delta en código fuente real. Resultado:

- **Parsing idéntico y correcto:** `parse_price_to_cents` y `parse_size` se usan en
  ambos paths con mismo rounding. No hay mismatch de escala, conversión, ni
  routing bids/asks. Filtro `size==0` asimétrico (snapshot lo filtra, delta no),
  pero no aplica al caso del crash de ATL: el bucket 10c tenía 1114 (yes) y 500 (no),
  no cero.

- **H1 (filtro size=0) definitivamente refutada** para este error. Bucket existía
  con estado válido cuando llegó el delta.

- **Corrección de hallazgo previo:** el "gap seq=40 → 41" observado en el log NO es
  una señal independiente sino un artefacto del manejo de error. Cuando
  `_apply_delta_msg` lanza OrderbookDesyncError, `self._last_seq_by_sid[sid]` no
  avanza (línea 174 nunca se ejecuta). El siguiente frame con seq=41 produce el
  "gap" expected=40, got=41. **Message-loss / out-of-order eliminados como causa.**

- **El estado del bucket pre-delta sigue siendo punto ciego:** `_apply_delta_msg`
  solo loggea errores, no aplicaciones exitosas. Entre seq=2 (snapshot) y seq=40
  (delta que crashea) pasaron 37 deltas no logueados. La inferencia "el bucket
  estaba en 1114" asume estado que el log no respalda.

- **Tres dominios de seq coexistiendo:** batch snapshot index, Sid global del WS,
  per-delta seq del feed. El código no comete error obvio de mezclar dominios.
  Pero **amplifica el blast radius:** un único qty<0 en un ticker dispara
  `_start_recovery(sid)` que marca 38 tickers stale.

- **Sesgo de atribución hardcodeado:** `orderbook.py:65` literalmente dice
  `"new_qty < 0 indicates feed-level corruption"`. La excepción se llama
  `(feed corruption)`. **El código pre-juzga causa externa.** Cualquier
  diagnóstico futuro se contamina con esa palabra antes de pensar.

- **V2 NO está exculpado.** El parser está limpio; la aplicación de deltas y la
  sincronización del snapshot inicial siguen bajo sospecha. Caer en
  "indiscutiblemente es el feed" sería repetir el anti-patrón de atribución
  externa del 25-may, más sofisticado pero mismo patrón.

- **Hipótesis residuales vivas (post-cuarto discovery):**
  - (A) Feed corruption real — Kalshi mandó delta_fp mayor al qty disponible
  - (B) Snapshot inicial parcial — el bucket real en exchange divergía del
    cargado por V2 (timing/sync issue del snapshot)
  - (C) Bug en V2 en la ventana de ~2.7s entre snapshot y crash —
    `_apply_delta_msg` procesó deltas no logueados que dejaron el bucket
    divergente, próximo delta crashea

- **Causa raíz sigue NO RESUELTA.** La desambiguación A/B/C requiere
  **capturar el evento en vivo**, no más discovery sobre logs actuales. Decisión:
  instrumentar raw_msg en ambos paths (delta en nivel ERROR para que persista
  con LOG_LEVEL=INFO; snapshot completo en DEBUG) antes de la próxima
  activación. Fase de activación (tercera ventana V2) **desacoplada**, pendiente
  de decisión de gestión (cuando haya 2-3h continuas), no de proceso técnico.

- **El logging fix del attempt #2 (`logger.opt(exception=r)`) sigue siendo la
  única pieza de Opción A que cumplió su propósito en producción.** Es el que
  hace posible este discovery sobre logs preservados.
```

## Por qué este update es importante

1. **Cierra lo que se cerró**: H1 refutada definitivamente, message-loss eliminado, parsing exculpado.
2. **Mantiene abierto lo que sigue abierto**: B y C son hipótesis vivas no atribuibles al feed.
3. **Nombra el siguiente paso real**: instrumentación, no más discovery.
4. **Desacopla activación de preparación**: tercera ventana es decisión de gestión separada.
5. **Documenta el anti-patrón cazado**: "indiscutiblemente es el feed" como trampa que casi pasa.

## Decisiones derivadas del update (que entran en PR #2 junto con el código)

| Cambio | Destino | Estado |
|---|---|---|
| Update Lección 9 al `KALSHI_BOT_CONTEXT.md` | Branch PR #2 (V2) | Texto listo, este archivo |
| Instrumentación `_apply_snapshot_msg` (DEBUG full) | Branch PR #2 | Brief listo → [[brief-instrumentacion-v2-asymmetric-logging]] |
| Instrumentación `_apply_delta_msg` (try/except + ERROR) | Branch PR #2 | Brief listo |
| Acceso defensivo a `_yes_bids` / `_no_bids` con `.get()` | Branch PR #2 | En brief |
| Bloque de logging envuelto en su propio try/except | Branch PR #2 | En brief |

## Lo que el update NO incluye (deuda catalogada separada)

- **Eliminar `(feed corruption)` del mensaje del error** — el sesgo hardcodeado debería removerse, pero es cambio de código de Opción A2/B, no de instrumentación.
- **Reducir blast radius del cascade Sid-wide** — `_start_recovery` marca 38 tickers por un crash de 1. Es deuda arquitectónica, no parche.
- **Cubrir asimetría del filtro size=0 en deltas** — bug latente para tickers futuros con snapshots que sí tengan ceros. No aplica al caso ATL.

Todas estas quedan como tickets aparte cuando V2 entre a la fase de fix real (post-instrumentación + tercera ventana + diagnóstico definitivo).

## Estado de Lección 9 después del update

| Pieza | Estado |
|---|---|
| Causa raíz V2 | **SIGUE NO RESUELTA** (3 hipótesis vivas: A, B, C) |
| H1 (size=0) | **DEFINITIVAMENTE REFUTADA** |
| Causas técnicas identificadas (3 originales) | Sigue válida — 2 eran bugs reales, no de causa |
| Causa arquitectónica (state mutable sin distinción) | Sigue válida |
| Decisión derivada #1 (validación en producción) | **REFORZADA** — los logs preservados validaron retroactivamente la hipótesis errada |
| 5 decisiones derivadas + 4 anti-patrones | Vigentes |
| "Lo que sí funcionó" #4 (logging fix) | **CONFIRMADA EMPÍRICAMENTE** — habilitó este discovery |

## Próximo update esperado de Lección 9

Cuando se ejecute la tercera ventana V2 con instrumentación activa y se capture el raw_msg del próximo crash:
- Si A confirmada → adicional update: "feed corruption real validada, requiere defensa explícita ante deltas inconsistentes"
- Si B confirmada → update: "snapshot inicial parcial, requiere validación post-snapshot vs REST"
- Si C confirmada → update: "bug en aplicación de deltas, requiere fix de lógica de apply"

Pero eso es para otra ventana. Por ahora, este update cierra el ciclo de "discovery sobre logs preservados" en su límite informacional real.

## Links
- [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]] — discovery técnico que sustenta este update
- [[leccion-9-FINAL-causa-raiz-pendiente]] — lección que se actualiza
- [[decision-2026-05-30-branch-separada-v2-instrumentacion-asimetrica]] — decisión del PR #2
- [[brief-instrumentacion-v2-asymmetric-logging]] — brief operativo de instrumentación
- [[sesion-2026-05-30-cuarto-discovery-v2-instrumentacion-plan]] — sesión
- [[kalshi-bot]]
