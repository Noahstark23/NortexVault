---
fecha: 2026-06-01
tipo: diseno-archivado
proyecto: kalshi-bot
componente: anti-zombie supervisor + cap restarts
estado: APROBADO-pero-ARCHIVADO-tras-pivot
razon-archivo: pivot a Opción 2 (REST híbrido) torna obsoleta la fortress de V2
tags:
  - diseno
  - kalshi-bot
  - v2
  - archivado
  - 2026-06-01
  - referencia-historica
---

# 🏰 Diseño B1+A2 (archivado) — la fortress de V2 que no se construyó

> Diseño completo y aprobado para cerrar los gaps (b) y (c) de PR #11. **Archivado sin implementar** después del pivot estratégico a Opción 2 (REST híbrido). Se preserva como referencia: si el benchmark REST falla y se vuelve a V2, este es el diseño listo para retomar.

## Por qué este diseño existió

PR #11 (Part B) tenía 2 gaps críticos:
- **Gap (b):** supervisor no wireado al runtime → con V2 activo, el supervisor no corre
- **Gap (c):** reintegración de evictados solo en docstring → tickers evictados pierden hasta restart manual

**B1+A2 era la solución correcta a esos gaps** dentro del paradigma V2 (orderbook in-memory con deltas).

## Por qué se archivó

Después de aprobar B1+A2, la auditoría destapó otro hueco: el "fail-loud" de B1 produciría restart de contenedor entero por Docker (`unless-stopped` sin cap), lo que podría entrar en **crash-loop de contenedor** porque el bootstrap (que es justamente la ventana frágil) se repetiría cada reinicio.

Eso disparó la pregunta de fondo: *"¿V2 vale toda esta complejidad?"*

Gemini propuso pivot a Opción 2 (REST híbrido). Aprobado pendiente benchmark — ver [[2026-06-01-PIVOT-opcion-2-rest-hibrido]].

**Si el benchmark confirma Opción 2, este diseño queda archivado permanentemente.**
**Si el benchmark sale mal y volvemos a V2, este diseño es el camino para retomar.**

---

## DISEÑO (b) — Cableado anti-zombie del supervisor (texto completo)

### Objetivo
Que el supervisor de recovery viva dentro del mismo bloque cooperativo de `data_capture.py:508-527` que `ws_task`/`snap_task`, de modo que su muerte tire abajo el runner de forma controlada (Lección 7: fail-loud sin tragar excepciones).

### Estructura propuesta (texto, sin código)

**1. Wrapper supervisado**, gemelo de `_run_ws_supervised`/`_run_snapshots_supervised`: un nuevo `_run_recovery_supervised(self)` que:
- `await self._v2_manager._recovery_supervisor()`
- En `except asyncio.CancelledError: raise` (shutdown limpio)
- En `except Exception as e:` → `BotState.record_error(f"recovery_supervisor crashed: ...")` + `logger.exception(...)` + re-raise (fail-loud, igual que los otros dos wrappers)

**2. Creación condicional de la task**, junto a `ws_task`/`snap_task` (líneas 509-511), solo si V2 está activo:

```python
tasks = [ws_task, snap_task, stop_task]
if self._v2_manager is not None:
    recovery_task = asyncio.create_task(
        self._run_recovery_supervised(),
        name="recovery_supervisor"
    )
    tasks.append(recovery_task)
```

(Con flag en False, `self._v2_manager is None` → la task no se crea; cero impacto en V1.)

**3. Integración al `asyncio.wait(FIRST_COMPLETED)`** (línea 514): pasar `tasks` en vez de la lista fija. Así, si `recovery_supervisor` termina (crash o fin), `FIRST_COMPLETED` despierta, se cancelan las pendientes, y el bloque `for t in done` ya existente loggea el crash.

**4. Por qué no `add_done_callback` suelto:** el `asyncio.wait` cooperativo ya implementado es superior — un callback solo loggearía; el wait tira abajo el ciclo para que el restart ocurra arriba. Reusar el patrón existente es más simple y consistente.

### Bloqueante 1 cerrado en auditoría
**Hallazgo:** `runner.py` NO relanza nada. Tras la muerte de cualquier task, `run()` retorna y el proceso Python termina (exit 0). El "reinicio" lo hace **Docker/Coolify** (`restart: unless-stopped`), relanzando el contenedor completo desde cero.

**Implicación:** el comportamiento (A) "reinicio limpio" sí se cumple, pero vía restart de contenedor por Docker, NO por runner. Es reinicio pesado, no in-process.

**El wording correcto del diseño:** *"fail-loud propaga → proceso termina → Coolify reinicia contenedor"*, NO *"runner.py reinicia la task"*.

### Riesgo destapado por bloqueante 1: CRASH-LOOP DE CONTENEDOR
Si el supervisor muere → contenedor reinicia → re-bootstrap de los 38 tickers → si el bootstrap falla otra vez (que es la ventana frágil de V2) → supervisor muere de nuevo → reinicio infinito.

`restart: unless-stopped` NO tiene cap → crash-loop sin freno.

**Esto disparó la pregunta de fondo y el pivot.**

---

## DISEÑO (c) — Cooldown determinista (texto completo)

### Decisión
Se descarta el "00:00 UTC" del docstring original. **Mecanismo:** cooldown determinista de **3600s por ticker**, controlado por `time.monotonic()`, gestionado dentro del tick de 1s del supervisor (`_check_recovery_timeouts`). **Sin cron ni scheduler externo.**

### Por qué es superior al "00:00 UTC"
- El horario fijo dejaría un ticker evictado a las 00:01 inutilizado ~24h
- El cooldown reintegra cada ticker 1h después de SU propia evicción, no en horario global arbitrario
- Reusa el supervisor loop que Gap (b) ya pondría a correr (mismo tick de 1s) → cero infraestructura nueva
- Es exactamente el patrón del TTL de `last_error` ya validado en el watchdog (PR #1)

### Flujo de 4 pasos

**1. Estructura del dict.** Reemplazar `self._evicted: set[str]` por:
```python
self._evicted_cooldowns: dict[str, float]  # ticker → monotonic deadline
```
- key presente = ticker actualmente evictado
- value = instante (`time.monotonic()`) a partir del cual puede reintegrarse

**2. Penalización en `_evict_ticker`.** Al evictar:
```python
EVICTION_COOLDOWN_SEC = 3600.0  # constante de clase

def _evict_ticker(self, ticker):
    self._books[ticker] = None
    self._evicted_cooldowns[ticker] = time.monotonic() + self.EVICTION_COOLDOWN_SEC
    self._bootstrap_buffer.pop(ticker, None)
    logger.critical(...)
```

`monotonic()` (no `time()`/`datetime`) porque es inmune a saltos del reloj del sistema (NTP, DST).

**3. Guarda en `handle_message`** que protege a tickers nuevos:
```python
if ticker in self._evicted_cooldowns:
    return  # ticker en penalización → descartar delta (REST sigue capturando en SQLite)
```

**Crítico:** chequea membresía explícita en el dict, NO `_books.get(ticker) is None`. Un ticker nuevo (nunca visto) no está en `_evicted_cooldowns` → pasa al flujo normal de bootstrap. **Esto preserva la corrección de Part B contra tickers nuevos.**

**4. Limpieza en el tick de 1s.** Dentro de `_check_recovery_timeouts`:
```python
now = time.monotonic()
ready = [t for t, deadline in self._evicted_cooldowns.items() if now >= deadline]
for ticker in ready:
    del self._evicted_cooldowns[ticker]  # sale de penalización
    self._books.pop(ticker, None)         # borra el book None → vuelve a "nunca visto"
    # OBLIGATORIO: forzar get_snapshot del ticker (reintegración ACTIVA)
```

### Bloqueante 2 cerrado en auditoría: REINTEGRACIÓN ACTIVA OBLIGATORIA
**Hallazgo:** el "opcional: forzar get_snapshot" del diseño inicial dejaba ambiguo quién reconstruye el book. La pasiva degenera en flapping garantizado:
- Pasiva (esperar): Kalshi NO manda snapshots espontáneos. El ticker reintegrado encolaría deltas en `_bootstrap_buffer` indefinidamente → desborda → re-evicta a la hora → loop
- Activa (forzar `get_snapshot`): reusa `_start_recovery` con su deadline → snapshot llega o re-evict por timeout

**Definición:** reintegración **ACTIVA obligatoria**, no opcional. Reusa maquinaria existente, no agrega superficie nueva.

### Bloqueante 3 cerrado en auditoría: cooldowns NO persisten
**Hallazgo:** restart de contenedor reconstruye `_evicted_cooldowns` vacío → todos los tickers evictados se reintegran de golpe al reiniciar.

**Decisión:** NO persistir. Razones:
- El restart es "reset duro" tras anomalía — reconstruir todo desde cero es correcto
- Flapping acelerado acotado: ticker roto se reintegra → falla → re-evicta en segundos → cae 1h más
- Persistir = serializar a SQLite + rehidratar = sobre-ingeniería con beneficio marginal

---

## B1 — Aislamiento in-process del supervisor (post-crash-loop discovery)

### Por qué B1 emergió
Tras descubrir el riesgo de crash-loop de contenedor (bloqueante 1 de Diseño b), apareció la decisión de fondo: **¿es aceptable que un fallo en el supervisor de recovery reinicie el bot ENTERO?**

**Opción A (mantener fail-loud → proceso muere → Docker reinicia):** requiere cap de restarts.
**Opción B (aislar el supervisor — su muerte NO mata el proceso):** maneja in-process.

### Decisión: B1 (recomendado)
**B1 — Relanzar el supervisor in-process con backoff dentro del wrapper:**
- Ante crash del supervisor, NO re-leva al runner
- En su lugar: `logger.exception` + `BotState.record_error` + espera con backoff exponencial (1s, 2s, 4s, 8s, cap a 30s)
- Solo tras N relanzamientos fallidos en M minutos → escala: **deshabilita V2 in-process** (evicta todo / deja de procesar V2, V1 sigue) + alerta Telegram

### Razones
1. **Aislamiento de fallos correcto:** un auxiliar de V2-dormant no debe poder matar V1-productivo
2. **Sin crash-loop:** el fallo se absorbe in-process; no hay re-bootstrap repetido ni reinicios de contenedor en cascada
3. **Respeta Lección 7 sin sobre-aplicarla:** fail-loud = "reportar y escalar visiblemente", NO "matar el proceso por cualquier cosa". B1 reporta a BotState + Telegram + escala a deshabilitar V2; nada se traga

### 4 puntos de diseño abiertos en B1 (pendientes)
Si se retoma este diseño:
- **Backoff exacto:** ¿1-2-4-8s con cap a 30s? Definir explícito.
- **Contador de fallos con ventana temporal:** ¿N=5 fallos en M=10 minutos dispara escalada?
- **¿Qué significa "V2 deshabilitado in-process"?** ¿Evicta los 38 tickers? ¿Deja de procesar orderbook pero sigue el resto? Especificar.
- **¿Cómo se re-habilita V2?** ¿Requiere restart manual? ¿Hay camino in-process?

---

## A2 — Cap de arranques (backstop, complementa B1)

### Mecanismo
Estado durable en el volumen (`/app/data`, timestamps de últimos N arranques). Al boot, runner lee el contador. Si hay ≥N arranques en M minutos → arranca en **modo seguro**:
- V1 normal
- V2 deshabilitado (no instancia el manager ni el supervisor, ignora el flag `USE_ORDERBOOK_MANAGER_V2`)
- El bot sigue vivo y capturando; solo V2 inhibido hasta intervención

### 2 puntos de diseño abiertos en A2 (pendientes)
- **Fail-open si el contador no se puede leer:** archivo corrupto/ausente → arranca normal, NO falla. Robustez del contador no debe ser nueva superficie de fallo.
- **`/status` distingue:** "V2 off por flag manual" vs "V2 off por modo seguro automático". Sin distinción, no sabés si es intencional o síntoma.

---

## Status de este diseño

| Aspecto | Estado |
|---|---|
| Diseño conceptual (b + c) | ✅ Cerrado, completo |
| Auditoría de bloqueantes | ✅ 3 bloqueantes resueltos en diseño |
| B1+A2 (anti-crash-loop) | ✅ Aprobado conceptualmente |
| 6 puntos de detalle pendientes | ⏳ No cerrados (4 de B1, 2 de A2) |
| **Implementación** | ❌ **ARCHIVADA — pivot a Opción 2** |
| Validable como diseño | ✅ Si V2 se retoma, este es el punto de partida |

## Cuándo se desarchiva este diseño

**Condición para retomar V2 con B1+A2:**
- Benchmark REST sale mal (P99 > 300ms o 429 > 10%) → Opción 2 descartada
- O: front-running real aparece como problema en demo con Opción 2 → necesita latencia sub-50ms
- O: cualquier cambio de mercado que invalide el supuesto "edge persiste segundos/minutos"

**Si esas condiciones ocurren:** desarchivar, cerrar los 6 puntos pendientes, pasar por review adversarial otra vez, implementar (b) primero por dependencia, (c) después.

## Lo que esto enseña

**Saber distinguir entre "agregar otra defensa" y "el approach mismo está mal" es un movimiento de CTO maduro.**

B1+A2 era la respuesta técnicamente correcta a los gaps de PR #11. Pero la respuesta correcta a 4 gaps consecutivos en el mismo componente puede no ser "5ta capa de defensa" — puede ser "rediseñar el approach".

**El diseño se preserva por completo. No se pierde el aprendizaje técnico. Solo se reconoce que el problema podría no necesitar esa solución.**

## Links
- [[2026-06-01-PIVOT-opcion-2-rest-hibrido]] — pivot que archivó este diseño
- [[2026-06-01-AUDITORIA-PR11-gaps-criticos-cazados]] — gaps que motivaron este diseño
- [[2026-06-01-sesion-01jun-auditoria-pr11-pivot-opcion-2]] — sesión
- [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]] — patrón que produjo los gaps originales
- [[2026-05-31-cuarto-discovery-v2-Q1-a-Q4-desde-codigo]] — discovery que identificó Q2 (bootstrap) y Q3 (recovery)
- [[kalshi-bot]]
