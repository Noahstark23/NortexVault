---
fecha: 2026-05-31
tipo: brief-arquitectura
proyecto: kalshi-bot
componente: OrderbookManagerV2 / recovery supervisor
estado: diseño-aprobado-pendiente-3-verificaciones
target: implementación POST-aclaración del misterio Part A
tags:
  - brief
  - arquitectura
  - kalshi-bot
  - v2
  - 2026-05-31
  - part-b
  - recovery
---

# Part B — Brief de arquitectura del recovery robusto (31-may, diseño aprobado)

> Diseño que cierra el bug Q3 del cuarto discovery (recovery sin convergencia, modo de cuelgue permanente). Diseño aprobado por la capa adversarial con 3 verificaciones obligatorias en el brief de implementación. **NO implementar hasta cerrar el misterio Part A.**

## El problema que Part B resuelve

El cuarto discovery confirmó:
- `OrderbookManagerV2` entra en estado `_recovering` y envía solicitud de snapshot por WS (con `req_id`)
- **Si Kalshi responde error (como `code 15`) o el mensaje se pierde:**
  - El manager queda atrapado en `_recovering` indefinidamente
  - Deltas se acumulan en buffer sin límite (fuga de memoria latente)
  - `books_initialized: 0` permanente
  - **V2 muerto silenciosamente** — Lección 7 zombie en otra capa

Ver [[2026-05-31-cuarto-discovery-v2-Q1-a-Q4-desde-codigo]] Q3 para evidencia de código.

## Diseño aprobado — las 3 Opción B

### Hueco 1 → Opción B: Circuit breaker de conexión (no retry ciego del snapshot)

**Tratar `code 15` como problema de conexión**, no de snapshot. Capturar a nivel global del cliente WS, gatillar refresco de credenciales RSA-PSS y reconectar el socket completo.

**El eviction por ticker queda reservado SOLO para timeouts locales** (`elapsed > 10s`) sin respuesta a un `req_id` específico.

**Por qué es la opción correcta:**
- El retry ciego (Opción A) reintentaría 3 veces sobre una sesión muerta
- Evictaría tickers sanos por un problema que no era de ellos
- **Reusa el `force_reconnect()` del watchdog ya validado 7h en producción**
- El code 15 → `ws_connected: False` → el watchdog/supervisor fuerza reconexión limpia

**Elegancia del diseño:** no construye un mecanismo nuevo de reconexión; conecta el detector de code 15 al que ya existe.

### Hueco 2 → Opción B: Degradación a V1 (definición honesta del "modo pasivo")

**Al evictar un ticker por falta de convergencia:**
1. `self._books[ticker] = None` (destruye book in-memory)
2. La data se sigue capturando en crudo a SQLite vía REST/snapshots tradicionales (**Fase 1 baseline**)
3. El ticker sale del hot-path de arbitraje de V2
4. El **discovery diario (00:00 UTC)** limpia `_recovering` y vuelve a meter el ticker al ciclo normal de inicialización

**Por qué es la opción correcta:**
- "Modo pasivo" ya no es indefinido: tiene mecanismo concreto
- El ticker evictado **NO se pierde** — sigue capturándose a DB
- Solo pierde su book in-memory hasta el reset
- Coherente con Fase 1 (objetivo es capturar data, captura REST sigue)

### Hueco 3 → Opción B: Cap por tamaño de buffer

**Estructura de control:**
```python
if len(self._pending_deltas[ticker]) > 1000:
    evict_inmediato(ticker)
```

**Cap concreto: 1000 mensajes.** Evict inmediato si se supera, **sin esperar timeout**.

**Por qué es la opción correcta:**
- Previene desborde de RAM bajo ráfagas pesadas (MLB live, horario central)
- Bajo alta volatilidad, 1000 deltas pueden acumularse rápido
- Cap protege antes de que `timeout 10s + 3 retries (hasta 30s+)` se cumpla
- **Tiempo Y tamaño, no solo tiempo**

**Nota: el 1000 es punto de partida calibrable.** Si en producción se ven evicciones por tamaño en tickers sanos → cap muy bajo. Empezar con 1000, observar, ajustar. **No es valor sagrado.**

## Las 3 verificaciones obligatorias para el brief de IMPLEMENTACIÓN

Estas son las verificaciones que el brief de implementación debe cerrar **antes** de tocar código:

### Verificación 1 — ¿`force_reconnect()` re-autentica o solo re-socket?

**Crítico.** Si el code 15 es expiración de sesión RSA-PSS:
- Reabrir el socket con credenciales viejas → falla otra vez
- El watchdog actual cierra el socket y deja que `run()` reconecte con backoff
- **¿`run()` re-autentica desde cero o reusa token?**
- Si reusa → Part B necesita forzar re-auth, no solo re-socket

**Acción:** Claude Code lee el código de `run()`/auth **antes** de implementar Part B. Read-only.

### Verificación 2 — Comportamiento del manager ante ticker evictado

Si otro código asume `self._books[ticker]` siempre válido y hace `self._books[ticker].apply_delta(...)`:
- Un `None` lanza `AttributeError`
- La evicción rompe el manager al próximo delta

**Especificar en el brief:**
> *"Deltas de un ticker evictado se descartan silenciosamente (no se buffearean, no se aplican) hasta el reset diario."*

### Verificación 3 — Confirmar que el 1000 es calibrable, no sagrado

Documentar en comentario del código:
```python
# CALIBRACIÓN: 1000 es punto de partida. Si en prod se observan
# evicciones por tamaño en tickers sanos, reducir o aumentar
# según observación. NO valor fijo.
BUFFER_CAP_PER_TICKER = 1000
```

## El encuadre que ninguna Opción B resuelve

**Part B implementada ≠ V2 listo.**

Aun con A+B mergeadas en main, V2 sigue dormant. La única forma de validar que el bug del attempt #3 está realmente resuelto:

- **Cuarta ventana de activación de V2**
- Con instrumentación activa (PR #2)
- Con A+B aplicados
- Runbook 12.5 literal + línea defensiva T+5→T+30
- 2-3h de supervisión

Los tests unitarios pueden simular timeout de snapshot y verificar retry/evict. Pero **no pueden reproducir el code 15 real de Kalshi ni la dinámica de bootstrap en producción**.

## Orden estricto para llegar a la cuarta ventana

1. **Resolver misterio Part A** ([[2026-05-31-MISTERIO-part-a-commit-49231da-sin-review-adversarial]])
2. **Si Part A existe y está OK:** auditoría retroactiva del diff (gate post-mortem)
3. **Claude Code verifica el código de `run()`/auth** para Verificación 1
4. **Consolidar brief definitivo de Part B** con las 3 Opción B + 3 verificaciones cerradas
5. **Brief definitivo pasa por review adversarial otra vez**
6. **Recién entonces: implementar Part B** con review del diff antes de merge
7. **Tests unitarios:** (a) deltas pre-snapshot, (b) timeout de snapshot que dispara retry+evict
8. **Cuarta ventana de activación** con runbook 12.5 y supervisión

## Lo que NO se hace

❌ Implementar A+B en una sola corrida (mezcla diseño con implementación — patrón que rompe disciplina)
❌ Mandar a Code "implementar Part B" antes de resolver Part A y verificar re-auth
❌ Saltarse el review del brief definitivo
❌ Activar V2 sin tener A+B implementados Y validados con tests

## Risks y mitigaciones (del diseño aprobado)

| Riesgo | Mitigación |
|---|---|
| `code 15` no trae `req_id` original | Loop supervisor por timestamp actúa como fallback al pasar 10s |
| Re-socket sin re-auth (si así es como funciona hoy) | Verificación 1 cierra este punto antes de implementar |
| `None` en `self._books[ticker]` rompe el manager | Verificación 2 lo cubre con descarte silencioso |
| Cap de 1000 muy bajo en prod | Calibrable, observar y ajustar (Verificación 3) |
| Tests unitarios no reproducen condiciones reales | Cuarta ventana de activación cubre validación en vivo |

## Lo que apruebo y lo que no (revisión adversarial cerrada)

**Apruebo:** dirección de Part B (Opción 2, supervisor con retry + evicción por ticker). Las 3 Opción B son correctas. Rechazo de Opción 1 (hard reset que tira 38 mercados por un fallo en uno), correcto.

**NO apruebo todavía:** mandarlo a implementar. El diseño necesita cerrar las 3 verificaciones primero. Y el bloque de instrucciones a Claude Code debe separar "implementar Part B" en su propio paso con review del código, no pegado a la documentación.

## Links
- [[2026-05-31-cuarto-discovery-v2-Q1-a-Q4-desde-codigo]] — discovery que motivó este brief
- [[2026-05-31-MISTERIO-part-a-commit-49231da-sin-review-adversarial]] — bloquea implementación
- [[fix-v1-watchdog-21fe6fd-validado-produccion]] — `force_reconnect()` que Part B reutiliza
- [[2026-05-31-sesion-31may-cuarto-discovery-correccion-y-misterio-part-a]] — sesión
- [[brief-instrumentacion-v2-asymmetric-logging]] — patrón de brief que se siguió
- [[leccion-9-FINAL-causa-raiz-pendiente]] — disciplina que se aplica
- [[kalshi-bot]]
