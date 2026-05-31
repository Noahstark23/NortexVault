---
fecha: 2026-05-31
tipo: correccion-diagnostico
proyecto: kalshi-bot
componente: OrderbookManagerV2
corrige: diagnóstico del 30-may sobre attempt #3
motivo: cuarto discovery sobre código fuente refinó el framing
tags:
  - correccion
  - kalshi-bot
  - v2
  - 2026-05-31
  - diagnostico-refinado
---

# 🔧 CORRECCIÓN (31-may) — el diagnóstico del 30-may estaba parcialmente mal

> **IMPORTANTE para NotebookLM:** esta nota CORRIGE el diagnóstico que está en [[causa-raiz-v2-desync-secuencia-bootstrap-CAPTURADA]] y [[incidente-v2-attempt-3-2026-05-30-causa-capturada]]. El framing "Kalshi saltó el seq=185" estaba mal planteado. La causa real es más simple y más grave.

## Lo que el cuarto discovery (31-may, desde código) corrigió

### Lo que decíamos el 30-may (parcialmente mal)
> *"El book interno de V2 estaba en seq=184 cuando llegó un delta de seq=186 — falta el seq=185. V2 aplicó el delta adelantado sobre estado obsoleto."*

Implicaba que:
- Faltaba el seq=185 a nivel ticker
- V2 procesó 184 → 186 "saltando" el 185
- Era un gap o pérdida de mensaje

### Lo que el código demuestra (31-may)
**El framing estaba mal planteado.** El `seq` en el código de V2 es **global-por-sid** (orderbook.py:265-268, texto literal), **NO por-ticker**.

Que PHI vaya de 184 → 186 NO significa que falte el 185 globalmente. **El 185 fue casi con certeza un delta de OTRO ticker del mismo sid.** A nivel por-ticker, los huecos de seq son normales y esperados — no hay contigüidad por ticker.

## La causa real (más simple, más grave)

**No es "Kalshi saltó un seq" ni "V2 perdió un mensaje".** Es esto:

**Durante el bootstrap, V2 no tenía ni buffering ni detección de gap.** El código tenía dos ventanas ciegas:

1. **Buffering gateado por recovery:** `if sid in self._recovering:` (handle_message:160). Pero `_recovering` solo se puebla en `_start_recovery`, que se llama solo ante gap detectado. **Durante bootstrap inicial, `_recovering` está vacío → los deltas no se bufferean.**

2. **Detección de gap requiere key inicializada:** `if sid in self._last_seq_by_sid:` (handle_message:160). Antes del primer apply exitoso, esa key no existe → **no hay rama else → los primeros mensajes saltean la detección de gap por completo.**

**Resultado real:** V2 empezaba a aplicar deltas apenas llegaba el primer snapshot, sin esperar a estar sincronizado. Los deltas pre-snapshot (que existían y eran válidos) se descartaban silenciosamente con `logger.warning("...skipping"); return`.

**Por eso el book de PHI quedó sub-construido.** El `qty=-11` no vino de un delta corrupto ni de un gap real — vino de aplicar un delta válido sobre un book al que le faltaban actualizaciones que se tiraron a la basura durante el arranque.

## Bug interno puro

- ✅ El feed de Kalshi entregó secuencia válida (con saltos por-ticker normales)
- ❌ V2 descartaba deltas pre-snapshot en lugar de bufferearlos
- ❌ V2 no detectaba gaps en bootstrap (key no inicializada)
- ❌ El book quedó sub-construido al iniciar deltas reales

## El bug separado que sigue activo

El cuarto discovery también encontró un segundo bug **independiente** y **más serio**: **el recovery no converge.**

Detalle en [[2026-05-31-cuarto-discovery-v2-Q1-a-Q4-desde-codigo]] (Q3). Resumen:

- `_recovering.discard(sid)` solo se ejecuta cuando llegan snapshots de TODOS los tickers (`_handle_recovery_snapshot:300`)
- No hay timeout
- No hay retry
- No hay limpieza ante error
- Si Kalshi responde `code 15 "Action required"` al `get_snapshot` masivo → ningún recovery snapshot vuelve → `_recovering` queda atrapado permanentemente → todos los deltas se bufferean indefinidamente → books nunca se re-inicializan

**Implicación operativa:** V2, tal como está hoy, tiene un modo de cuelgue permanente bajo alta volatilidad o rate limiting de Kalshi. **Es Lección 7 (WS zombie) en otra capa.**

## Lo que cambia esto para el fix

| Antes (creíamos) | Ahora (sabemos) |
|---|---|
| Causa: gap o pérdida del seq=185 | Causa: ventana ciega de bootstrap (V2 descartaba deltas pre-snapshot) |
| Fix: manejar saltos de seq | Fix: bufferear deltas pre-snapshot hasta tener primer snapshot |
| Una sola causa | Dos bugs separados (bootstrap + recovery sin convergencia) |

## El sesgo hardcodeado en `orderbook.py:65` sigue confirmado erróneo
> *"new_qty < 0 indicates feed-level corruption"*

Esto **encubrió la causa real durante 5 días**. El bug era interno, el código asumía externo, los diagnósticos siguieron la asunción. **Eliminar este texto del mensaje del error sigue siendo acción derivada.**

## Diferencia con el 30-may para NotebookLM

**Si subes a NotebookLM AMBOS archivos (este + el del 30-may), priorizá este.** El del 30-may documenta el descubrimiento histórico y vale para el contexto del proceso, pero el diagnóstico técnico vigente es el de esta nota.

Marcador de fecha en el filename: `2026-05-31-CORRECCION-...` para que sea evidente cuál es el más reciente.

## Links
- [[2026-05-31-cuarto-discovery-v2-Q1-a-Q4-desde-codigo]] — análisis completo Q1-Q4 desde código
- [[2026-05-31-sesion-31may-cuarto-discovery-correccion-y-misterio-part-a]] — sesión
- [[causa-raiz-v2-desync-secuencia-bootstrap-CAPTURADA]] — diagnóstico del 30-may (parcialmente mal — CORREGIDO por esta nota)
- [[incidente-v2-attempt-3-2026-05-30-causa-capturada]] — post-mortem del 30-may (sigue válido en cronología, framing técnico ajustado por esta nota)
- [[update-leccion-9-v2-causa-raiz-resuelta-30may]] — update redactado el 30-may; necesita revisión a la luz de esta corrección
- [[kalshi-bot]]
