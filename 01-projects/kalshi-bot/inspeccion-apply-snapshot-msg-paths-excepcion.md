---
fecha: 2026-05-27
tipo: inspeccion-tecnica
proyecto: kalshi-bot
componente: OrderbookManagerV2._apply_snapshot_msg
fix-relacionado: ed7b7ac
estado: validado
tags:
  - inspeccion
  - kalshi-bot
  - v2
  - validacion
---

# Inspección técnica — `_apply_snapshot_msg`: paths de excepción

> Validación de 3 min ejecutada antes de la segunda ventana de activación (27-may). Confirma que el swap seq/apply de `ed7b7ac` cubre todas las excepciones posibles del path snapshot y que `apply_snapshot` es estructuralmente atómica.

## Resultado
✅ **Path snapshot cubierto por el swap.** Todas las excepciones posibles se levantan antes de que `_last_seq_by_sid[sid]` se actualice. `apply_snapshot` es atómica (8 setattr sin await ni raise entre ellos). **Cero corrupción posible.**

## Código verbatim — `_apply_snapshot_msg` post-fix ed7b7ac

```python
def _apply_snapshot_msg(self, raw_msg: dict) -> None:
    """Apply WS orderbook_snapshot to state. Creates state entry if missing."""
    msg = raw_msg["msg"]                                           # L336
    ticker: str = msg["market_ticker"]                            # L337
    seq: int = raw_msg["seq"]                                     # L338
    yes_raw = msg.get("yes_dollars_fp") or msg.get("yes") or []  # L340
    no_raw = msg.get("no_dollars_fp") or msg.get("no") or []     # L341
    logger.info(                                                   # L343-347
        f"V2 snapshot: ticker={ticker} seq={seq} "
        f"num_yes={len(yes_raw)} num_no={len(no_raw)} "
        f"sample_yes={yes_raw[:3]} sample_no={no_raw[:3]}"
    )
    logger.debug(f"V2 snapshot raw: ticker={ticker} payload={msg!r}")  # L348
    yes_levels = _parse_fp_levels(yes_raw, ticker, "yes")         # L350
    no_levels = _parse_fp_levels(no_raw, ticker, "no")            # L351
    if ticker not in self._books:                                  # L353
        self._books[ticker] = OrderbookState(ticker)              # L354
    self._books[ticker].apply_snapshot(                           # L356
        {"seq": seq, "yes": yes_levels, "no": no_levels}
    )
```

## Código verbatim — bloque atómico en `apply_snapshot` (orderbook.py:215-256)

```python
# --- fase de parsing (build local) ---
seq = snapshot.get("seq")
if not isinstance(seq, int):
    raise ValueError(...)          # ANTES de toda mutación

new_yes_bids = {}
for lvl in yes_levels:
    price, size = _parse_level(lvl, "yes bids")  # puede raise ValueError
    if size > 0: new_yes_bids[price] = size
# ... idem no_bids, yes_asks, no_asks ...

# --- "Atomic replace" (8 setattr simples, sin await ni raise posible) ---
self._yes_bids = new_yes_bids
self._no_bids  = new_no_bids
self._yes_asks = new_yes_asks
self._no_asks  = new_no_asks
self._sequence = seq
self._last_ts_ms = None
self._is_stale = False
self._initialized = True
```

## Tabla de excepciones del path snapshot

| Operación | Línea | Tipo | Condición | Protegida por swap | Muta estado |
|---|---|---|---|---|---|
| `raw_msg["msg"]` | 336 | KeyError | campo ausente en payload WS | SÍ | NO |
| `msg["market_ticker"]` | 337 | KeyError | campo ausente | SÍ | NO |
| `raw_msg["seq"]` | 338 | KeyError | campo ausente | SÍ | NO |
| `_parse_fp_levels(yes_raw, ...)` | 350 | no raise | errores → `logger.warning` + continue | SÍ (N/A) | N/A |
| `_parse_fp_levels(no_raw, ...)` | 351 | no raise | ídem | SÍ (N/A) | N/A |
| `OrderbookState(ticker)` | 354 | improbable | constructor sin validación | SÍ | NO* |
| `apply_snapshot` — seq check | 356 | ValueError | seq no es int (p.ej. string WS) | SÍ | NO |
| `apply_snapshot` — `_parse_level` | 356 | ValueError | precio fuera de [0, 100] cts | SÍ | NO (pre-bloque atómico) |
| "Atomic replace" (L249-256) | 356 interno | no raise | 8 setattr simples, sin await | N/A | ALL-or-nothing |

## Nota técnica importante — `parse_price_to_cents` no valida rango

**Hallazgo colateral durante inspección:** `parse_price_to_cents` NO valida el rango [0, 100] cents. "1.5000" produce 150. Ese level pasa `_parse_fp_levels` sin warning y llega a `apply_snapshot`, donde `_parse_level` lo rechaza con `ValueError`.

**El swap protege el seq** en ese caso teórico. **En la práctica Kalshi nunca emite precios fuera de [0, 100] cts**, pero es un path teórico silencioso: no hay log en `_parse_fp_levels` para out-of-range, solo para parse-error.

**Acción futura (no bloqueante):** ticket de hardening defensivo → agregar log de warning en `_parse_fp_levels` para precios fuera de rango. Permitiría diagnosticar antes si el feed cambiara comportamiento.

## Caso especial — ticker nuevo (L353-354 antes de L356)

Si `apply_snapshot` lanza para un ticker recién creado, la entrada queda en `_books` como `OrderbookState` **NO inicializado** (`_initialized=False`).

Los deltas subsiguientes para ese ticker leen `state.is_initialized == False` → `logger.warning` + `return`. El seq NO avanza. **Comportamiento seguro:** no hay crash ni corrupción del state porque nunca llegó a ser estado válido.

## Atomicidad de `apply_snapshot`

**Garantía estructural:**
1. Todos los builds (`new_yes_bids`, `new_no_bids`, etc.) ocurren en **variables locales** antes del bloque de asignación.
2. Si cualquier `_parse_level` lanza durante los loops → la función sale sin tocar `self._*`. El estado queda tal cual estaba (no-inicializado o con snapshot anterior).
3. El bloque "Atomic replace" (8 líneas de setattr) es atómico en asyncio de un solo thread: **no hay puntos de preemption entre esas 8 asignaciones**. Sin `await`, no hay punto donde otra corutina pueda observar estado parcial.

## Veredicto final
**El path snapshot está cubierto por el swap.** Todas las excepciones posibles se levantan antes de que `_last_seq_by_sid[sid]` se actualice, y `apply_snapshot` es efectivamente atómica: **nunca muta el estado parcialmente**.

Esto desbloquea la segunda ventana de activación con confianza estructural validada. Los riesgos restantes (sink Loguru en Coolify, test #2 operativo extendido, ticker count drift) son cobertura post-activación, no bloqueantes.

## Tickets derivados (deuda técnica, no bloqueantes)

1. **Hardening defensivo en `parse_price_to_cents`:** agregar log warning para precios fuera de rango [0, 100]
2. **Test extendido del swap seq:** post-`OrderbookDesyncError`, validar que delta siguiente con seq válido se procesa OK (no solo que seq quedó intacto)
3. **Sink Loguru en Coolify:** forzar excepción no-orderbook en ventana corta para confirmar que stack traces emergen en logs reales (no solo en pytest)

## Links
- [[fix-v2-opcion-a-implementado-commits]] — fix que esta inspección valida
- [[diagnostico-v2-size-zero-bug]] — causa raíz que motivó el fix
- [[decision-2026-05-27-activar-v2-segunda-ventana]] — decisión que se sustenta en esta inspección
- [[sesion-2026-05-27-segunda-ventana-v2-preflight]] — contexto de la inspección
- [[cheatsheet-runbook-12.5-v2-activacion]] — runbook que se aplicará
- [[kalshi-bot]]
