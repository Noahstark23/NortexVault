---
fecha: 2026-05-26
tipo: implementacion
proyecto: kalshi-bot
componente: OrderbookManagerV2
estado: mergeable
commits: [ed7b7ac, b9abaa0]
tests: 282/282
tags:
  - implementacion
  - fix
  - kalshi-bot
  - v2
---

# Fix V2 Opción A — implementación con commits

> Record de implementación. Claude Code ejecutó el brief de Opción A. 282/282 tests verdes. Una desviación técnica documentada y justificada.

## Resumen
Tres bugs corregidos en `OrderbookManagerV2`:
1. `_parse_fp_levels` filtra `size=0` antes de que los levels lleguen a `apply_snapshot`
2. `_last_seq_by_sid[sid] = new_seq` movido a DESPUÉS del bloque apply — seq no avanza si `apply_delta` lanza `OrderbookDesyncError`
3. `_apply_snapshot_msg` agrega logs INFO/DEBUG antes del parsing para observabilidad

En `kalshi_ws._dispatch`, `logger.exception` reemplazado por `logger.opt(exception=r).error(...)` para emitir stack traces completos con Loguru.

## Commits

| SHA | Descripción |
|---|---|
| `ed7b7ac` | Cambios lógicos (los 3 bugs + observability) |
| `b9abaa0` | Correcciones de formato/tests vs brief |

Mensaje de commit prefijo: `fix(v2): resolve orderbook size=0 desync and seq order`

## Archivos modificados

| Archivo | Líneas | Cambio |
|---|---|---|
| `src/strategies/motor_1_arbitrage/orderbook_manager_v2.py` | 170-175 | Swap orden seq/apply en `handle_message` |
| ↑ | 343-348 | Logging INFO/DEBUG raw snapshot |
| ↑ | 415-416 | Filter `size=0` en `_parse_fp_levels` |
| `src/clients/kalshi_ws.py` | 320 | `logger.opt(exception=r).error(...)` |
| `tests/strategies/motor_1_arbitrage/test_v2_fixes.py` | nuevo | 4 tests del fix |

## Tests añadidos (4)

### Test 1 — Filter de `size=0` en parsing
```python
def test_parse_fp_levels_filters_size_zero():
    """Snapshot con [price, 0]: size=0 se filtra antes de apply_snapshot."""
    raw_levels = [["0.4500", "100"], ["0.5000", "0"], ["0.5500", "50"]]
    result = _parse_fp_levels(raw_levels, "KXTEST", "yes")
    prices = [lvl[0] for lvl in result]
    assert 50 not in prices  # price=50¢ (size=0) filtrado
    assert 45 in prices
    assert 55 in prices
```

### Test 2 — Delta negativo sobre price ausente → error sin avanzar seq
```python
async def test_delta_negative_on_absent_price_preserves_seq():
    """Después del filter, delta=-X sobre price ausente lanza error y NO avanza last_seq."""
    manager = OrderbookManagerV2(mock_ws)
    snapshot_msg = make_snapshot_msg(ticker="KXTEST", sid=1, seq=100, 
                                      yes=[["0.4500", "100"], ["0.5000", "0"]])
    await manager.handle_message(snapshot_msg)
    assert manager._last_seq_by_sid[1] == 100
    
    delta_msg = make_delta_msg(ticker="KXTEST", sid=1, seq=101, 
                                price="0.5000", delta=-200, side="yes")
    with pytest.raises(OrderbookDesyncError):
        await manager.handle_message(delta_msg)
    
    # CRÍTICO: last_seq NO avanzó
    assert manager._last_seq_by_sid[1] == 100  # NO 101
```

Este es el test más importante. Valida estructuralmente que la mitad operativa del bug está resuelta.

### Test 3 — Regresión con magnitudes reales de producción
```python
async def test_regression_production_magnitudes():
    """Reproduce magnitudes observadas durante incidente del 25-mayo."""
    manager = OrderbookManagerV2(mock_ws)
    snapshot_msg = make_snapshot_msg(ticker="KXMLB-26-ATH", sid=1, seq=1000,
                                      yes=[["0.0100", "0"]])
    await manager.handle_message(snapshot_msg)
    
    # Delta con magnitud real observada: -6247 sobre price=1¢
    delta_msg = make_delta_msg(ticker="KXMLB-26-ATH", sid=1, seq=1001,
                                price="0.0100", delta=-6247, side="yes")
    with pytest.raises(OrderbookDesyncError) as exc_info:
        await manager.handle_message(delta_msg)
    
    assert "qty" in str(exc_info.value).lower() or "desync" in str(exc_info.value).lower()
    assert manager._last_seq_by_sid[1] == 1000  # seq intacto
    
    state = manager._books["KXMLB-26-ATH"]
    assert state.sequence == 1000
```

### Test 4 — Stack trace logging
```python
async def test_dispatcher_logs_full_stack_trace(caplog):
    """Excepción en handler debe loggear con stack trace completo, no NoneType: None."""
    ws = KalshiWebSocket(...)
    async def failing_handler(msg):
        raise ValueError("test error")
    ws.on("test_msg", failing_handler)
    
    with caplog.at_level(logging.ERROR):
        await ws._dispatch({"type": "test_msg", "data": "x"})
    
    assert "NoneType: None" not in caplog.text
    assert "ValueError: test error" in caplog.text
    assert "Traceback" in caplog.text
```

## Suite completa: 282/282 ✓

Sin regresiones. Los 4 nuevos pasan, los 278 pre-existentes siguen verdes.

## Desviación técnica documentada (justificada)

### El problema con el brief literal
**Mi brief especificaba:**
```python
logger.error(f"Handler exception en {msg_type}: {r}", exc_info=r)
```

**El stack del proyecto usa Loguru** (declarado en `KALSHI_BOT_CONTEXT.md §2 "Logging: Loguru"`). En Loguru:
- `exc_info=` no es API válida en `.error()`
- Se ignora silentemente, sin warning ni error
- Resultado: log sin stack trace, **el mismo bug que estamos arreglando**

### Implementación correcta de loguru
```python
logger.opt(exception=r).error(f"Handler exception en {msg_type}: {r}")
```

Esto sí produce el traceback completo con la excepción capturada vía `return_exceptions=True`.

### Por qué Code aplicó esto bien (no scope creep)
1. **Identificó incompatibilidad de API**, no introdujo feature nuevo
2. **Aplicó la cláusula 6 (escalación)** del brief — paró y reportó
3. **Eligió cumplir intención del brief** (stack traces visibles) sobre la letra (kwarg específico)
4. **Documentó la desviación explícitamente** en el deliverable

Test #4 valida que `opt(exception=r)` recibe el objeto excepción real — condición que hace que loguru emita el traceback completo.

### Lección menor (para mí, no para el equipo)
Mi brief original reveló bias hacia stdlib logging. Para futuros briefs que toquen logging: confirmar primero qué librería usa el proyecto antes de especificar API.

## Verificación contra el brief

| Punto del brief | Implementado | Nota |
|---|---|---|
| 1a — filter size=0 en `_parse_fp_levels` | ✅ líneas 415-416 | Lado correcto del API |
| 1b — swap orden seq/apply | ✅ líneas 170-175 | Aplicado a `handle_message`, no a `_apply_delta_msg` (correcto según discovery) |
| 1c — comportamiento estricto ante delta neg sobre price ausente | ✅ implícito | No se relajó la semántica de `OrderbookDesyncError` |
| 2a — stack traces en dispatcher | ✅ línea 320 | Desviación técnica justificada (loguru) |
| 2b — raw snapshot logging INFO + DEBUG | ✅ líneas 343-348 | |
| Test 1 — filter size=0 | ✅ | |
| Test 2 — delta sobre price ausente preserva seq | ✅ | **Test más crítico** |
| Test 3 — regresión magnitudes reales | ✅ | |
| Test 4 — stack trace logging | ✅ | Valida `opt(exception=r)` |
| Suite completa | ✅ 282/282 | Sin regresiones |
| Commit con prefijo correcto | ✅ | `ed7b7ac` + `b9abaa0` |
| Restricciones (no recovery, no métricas, etc.) | ✅ respetadas | |

## Pendiente antes de mergear a main / re-activar

Tres puntos de revisión sobria (no requieren código nuevo, ~20 min con cabeza fresca):

1. **Swap seq/apply en `handle_message:170-175`** — confirmar que no afecta el path de `_apply_snapshot_msg` que también se invoca desde `handle_message` después del seq update. Si el snapshot también puede fallar, el swap solo cubrió la mitad del problema.

2. **Cambio `logger.opt(exception=r).error(...)` en `kalshi_ws.py:320`** — verificar manualmente que el log en Coolify es lo que queremos ver, no solo lo que pasa el test. Cambio del wrapper podría dejar tests verdes con contrato divergente.

3. **Test #2 cubre estructura, no operación** — valida que `_last_seq_by_sid[sid]` queda intacto post-error. Pero NO valida que el siguiente delta (con seq correcta) se procesa OK. Considerar agregar test #2b operativo después del review.

Ver: [[decision-2026-05-26-no-reactivar-hoy]] para por qué estos pasos son condición previa a la segunda ventana.

## Links
- [[sesion-2026-05-26-fix-merge-y-cierre-disciplinado]]
- [[decision-2026-05-25-fix-opcion-a]] — decisión arquitectónica que justificó este scope
- [[diagnostico-v2-size-zero-bug]] — causa raíz que motivó cada cambio
- [[leccion-9-canonica-kalshi-bot-context-md]] — lección aprendida
- [[kalshi-bot]]
