---
fecha: 2026-05-31
tipo: discovery-tecnico
proyecto: kalshi-bot
componente: OrderbookManagerV2
metodologia: lectura de código autoritativa (sin acceso al log preservado del attempt #3)
honestidad: log inaccesible, partes que requerían log marcadas explícitamente
tags:
  - discovery
  - kalshi-bot
  - v2
  - 2026-05-31
  - cuatro-preguntas
---

# Cuarto Discovery V2 (31-may) — Q1 a Q4 desde código

> **Nota de honestidad metodológica:** este discovery se ejecutó sobre el código fuente actualizado (read-only), NO sobre el log preservado del attempt #3 (`data/v2_attempt3_20260530_174849.log`) — el log está en volumen del host gitignoreado e inaccesible desde el agente. Las partes que requerían el log están **marcadas explícitamente** como `[requiere log — inaccesible]` y NO se inventan. Las preguntas que el código sí cierra son **autoritativas**.

## Las cuatro preguntas

### Q1 — El snapshot inicial y su seq

**Código consultado:**
- `_apply_snapshot_msg`: `seq = raw_msg["seq"]` (orderbook_manager_v2.py:339)
- `apply_snapshot`: `self._sequence = seq` (orderbook.py:253)

**Lo que el código garantiza:** el seq del snapshot sale del envelope WS y se fija como baseline del ticker.

**Lo que el código NO garantiza:** **no hay verificación de alineación entre snapshot y stream.** V2 procesa mensajes en orden de llegada y empieza a aplicar deltas apenas el ticker tiene snapshot, sin chequear que el snapshot esté sincronizado con el stream.

**Punto importante:** el seq es **global-por-sid** (orderbook.py:265-268, textual en el código), NO por-ticker. El snapshot es un punto en ese stream global; todo delta con `seq > snapshot.seq` debe aplicarse encima. No hay reordenamiento — si un delta llega antes del snapshot y su seq > snapshot.seq, **ese delta se descarta** (ver Q2).

`[requiere log — inaccesible]` Comparar los `V2 snapshot: ticker=... seq=N` iniciales vs el seq de los primeros deltas para ver si llegaron desfasados. NO se puede leer el log.

### Q2 — Por qué NO se buffereó durante bootstrap (EL HALLAZGO CENTRAL)

**Código consultado (contundente):**
- `handle_message:160` → `if sid in self._recovering:` bufferea en `_pending_deltas`
- `self._recovering` se puebla **solo** en `_start_recovery:273`
- `_start_recovery` se llama **solo** ante un gap de sid ya detectado (línea :163)

**Conclusión 1:** Durante el bootstrap inicial, antes de cualquier gap, `_recovering` está vacío → **los deltas no se bufferean**.

**Y peor — la detección de gap también tiene punto ciego en bootstrap:**
- `handle_message:160` corre `if sid in self._last_seq_by_sid:`
- Antes del primer apply exitoso, esa key **no existe**
- **No hay rama `else`** → los primeros mensajes del sid saltean la detección de gap por completo

**Conclusión 2:** Durante bootstrap, V2 no tenía ni buffering ni detección de gap.

**Lo que hacía el código pre-Part-A:**
1. Llega un delta para un ticker sin snapshot aún
2. Cae en `_apply_delta_msg`
3. `logger.warning("...skipping"); return`
4. **El delta se descarta silenciosamente**
5. Cuando el snapshot llega, el book está sub-construido
6. Los deltas siguientes (sobre book inicial incorrecto) producen `qty<0`

**Veredicto Q2:** **EL bug primario del attempt #3.** No hay buffer pre-snapshot, no hay detección de gap pre-inicialización, deltas pre-snapshot se descartan en silencio. → Book sub-construido → `qty<0`.

### Q3 — Por qué el recovery no convergió (`books_initialized=0` a T+6min) — LA BOMBA ACTIVA

**Código consultado:**
- `_recovering.add(sid)` → solo en `_start_recovery:273`
- `_recovering.discard(sid)` → solo en `_handle_recovery_snapshot:300`, **y únicamente cuando llegan los snapshots de TODOS los tickers** (`if not tickers_pending:`)
- **No hay timeout.** No hay retry. No hay limpieza ante error. (grep confirmó: cero timeout/retry en el manager.)

**El eslabón del `code 15`:**
- Un mensaje WS error se maneja en `:127-131` con **solo** `logger.error + record_error`
- **No toca `_recovering` ni `_pending_snapshot_requests`**
- `_start_recovery:274-278` pide el snapshot de recovery para **TODOS los tickers del sid de una sola vez** (`market_tickers: tickers` — en prod ~38)

**Veredicto Q3:** Si el `get_snapshot` masivo es rechazado por Kalshi (p.ej. `code 15`):
1. No llega ningún recovery snapshot
2. `_pending_snapshot_requests` nunca se vacía
3. `_recovering` nunca se limpia
4. Todos los deltas se bufferean indefinidamente
5. **Los books nunca se re-inicializan** → `books_initialized=0`
6. **V2 queda colgado permanentemente sin auto-recuperación**

**Implicación operativa:** **V2 tiene un modo de cuelgue permanente.** Cualquier recovery cuyo snapshot no vuelva deja a V2 muerto en silencio. **Es Lección 7 (WS zombie) en otra capa** — bot reporta "healthy" pero los books no se actualizan.

`[requiere log — inaccesible]` Confirmar la secuencia temporal exacta (que el `code 15` siguió al `_start_recovery`) necesita el log. NO se puede leer. PERO el mecanismo de cuelgue está en el código, sea cual sea el disparador específico.

### Q4 — El gap 184→186 (¿Kalshi saltó el 185, o V2 lo perdió?)

**LA PREGUNTA ESTABA MAL PLANTEADA A NIVEL TICKER.** Ver [[2026-05-31-CORRECCION-diagnostico-30may-no-falto-seq185]].

El seq es **global-por-sid** (orderbook.py:265-268). Para UN ticker (PHI), ir 184 → 186 NO implica que Kalshi saltó el 185 globalmente.

**Lo más probable:** seq=185 fue un delta de OTRO ticker del mismo sid. A nivel por-ticker, los huecos son normales (sparsos). El framing "falta el 185 = gap local" asume contigüidad por-ticker, **que no existe**.

**Dos escenarios:**
- **Si el stream de sid fue contiguo** (185 = otro ticker) → **NO hubo gap de Kalshi**; el bug es 100% interno (book de PHI sub-construido por el drop pre-snapshot de Q2)
- Si el stream de sid tuvo un hueco real → la detección de gap de sid debería haberlo cazado... salvo en la ventana de bootstrap donde está ciega (Q2)

**Veredicto Q4:** El framing "Kalshi saltó un seq" estaba mal planteado. El bug es 100% interno: ventana ciega de bootstrap + descarte silencioso de deltas pre-snapshot.

`[requiere log — inaccesible]` Saber si seq=185 llegó y con qué `market_ticker` requiere el stream crudo. Y la instrumentación solo loguea el delta que crashea (186), no el 185, así que probablemente ni el log de 390 líneas lo contiene.

## Veredicto consolidado — (d) combinación (a) + (b), NO (c)

| Opción | ¿Es el fix? | Por qué |
|---|---|---|
| (a) Buffering en bootstrap inicial | ✅ Sí | Cierra el drop pre-snapshot de Q2. Necesario. |
| (b) Arreglar recovery que no converge | ✅ Sí — y SIGUE ABIERTO | Q3: recovery huérfano sin timeout/retry/limpieza ante `get_snapshot` rechazado |
| (c) Manejar saltos de seq legítimos | ❌ No | Q4: los "saltos" por-ticker son normales (seq global-por-sid); no hay nada que "manejar" |

## Estado del frente V2 al cierre del cuarto discovery (31-may)

- ✅ **Causa raíz primaria identificada:** ventana ciega de bootstrap (Q2)
- ✅ **Bug secundario identificado:** recovery sin convergencia (Q3)
- ✅ **Framing corregido:** seq global-por-sid (Q4 — corrige diagnóstico del 30-may)
- ⏳ **Fix necesita ambas partes:** A (bootstrap buffering) + B (recovery robusto)
- 🔒 **V2 sigue dormant** (`USE_ORDERBOOK_MANAGER_V2=false` en main, verificado en config.py:70)

## El misterio que emerge del cuarto discovery

**Claude Code mencionó dos veces que "Part A ya está mergeada":**
> *"Esto es lo que la Part A ya mergeada corrige."*
> *"la Part A que mergeamos hoy ataca (a)"*

Pero el usuario **nunca aprobó ni revisó un fix de bootstrap buffering**. Ver [[2026-05-31-MISTERIO-part-a-commit-49231da-sin-review-adversarial]].

## Links
- [[2026-05-31-CORRECCION-diagnostico-30may-no-falto-seq185]] — corrección del framing del 30-may
- [[2026-05-31-MISTERIO-part-a-commit-49231da-sin-review-adversarial]] — el bug de proceso
- [[2026-05-31-brief-part-b-recovery-robusto-diseno-aprobado]] — Part B (la parte sin resolver de Q3)
- [[2026-05-31-sesion-31may-cuarto-discovery-correccion-y-misterio-part-a]] — sesión
- [[causa-raiz-v2-desync-secuencia-bootstrap-CAPTURADA]] — diagnóstico del 30-may (ahora CORREGIDO)
- [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]] — discovery del 30-may mañana (parsing limpio)
- [[kalshi-bot]]
