---
tipo: sesion
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-07
tags:
  - kalshi
  - motor-rest
  - shadow-mode
  - encendido-produccion
  - wal
  - sqlite-concurrencia
  - mundial-2026
  - sesion-conmigo
  - 2026-06-07
estado: shadow-encendido
frente: "Motor REST en SHADOW, corriendo en producción — falta confirmar que GRABA"
deadline: 2026-06-11 (Mundial)
---

# Sesión 2026-06-07 — Motor REST encendido en SHADOW para el Mundial

## TL;DR
El Motor REST está **encendido y corriendo en producción en modo shadow** (detecta y graba,
NO ejecuta — cero riesgo de capital). El camino hasta acá: confirmé ticker-only como decisión
firme, descubrí (gracias al pre-flight) un problema de concurrencia de SQLite que el shadow
habría destapado bajo la carga del Mundial, lo resolví con WAL, y encendí con pre-flight
completo + verificación post-deploy. El shadow está VIVO y validado sin locks. **Lo único que
falta confirmar: que VIVO = GRABANDO** (`edge_windows=0` por ahora — esperable recién encendido,
pero hay que distinguir "no hubo arb" de "camino roto" durante soccer en vivo antes del Mundial).

---

## La decisión de arquitectura, blindada: ticker-only se mantiene

Apareció la tentación de medir `orderbook_delta` "por completitud". La rechacé, y la razón es
ESTRUCTURAL, no de conveniencia:

- **El arb binario solo necesita el top-of-book.** Condición: `yes_ask + no_ask < 100`
  post-comisión. Se computa con el mejor ask de cada lado = lo que el ticker trae. Niveles más
  profundos no cambian SI hay arb, solo cuánto volumen.
- **El sizing a escala de $300 / ¼ Kelly / cap 5% nunca barre varios niveles** — son pocos
  contratos, muy por debajo del primer nivel.
- **Si alguna vez se necesitara profundidad para ejecutar, vendría del GET REST de ejecución**
  (diseño §4: ticker = campana, REST = verdad), NO de suscribir `orderbook_delta` por WS. Eso
  mantiene la línea ticker-only del feed intacta.
- Único escenario para reconsiderar: capital 10x + estrategia que barre niveles agresivamente.
  Con FOK (que no barre — llena al precio o cancela) y este capital, no aplica. Sería decisión
  de diseño explícita, vía REST, no vía WS.

→ **Medir orderbook_delta difuminaría la línea que tracé a propósito para matar los bugs de V2.
No entra.**

---

## El hallazgo del pre-flight: contención de SQLite (el fix de fondo)

Al preparar el pre-flight del encendido, descubrí que `get_engine` **NO seteaba `journal_mode`
(=delete) ni `busy_timeout` (=0 → falla al instante ante lock)**. Y el shadow **agrega un
segundo escritor permanente** (las escrituras de `edge_windows`).

**El problema:** dos escritores (V1 + shadow) + `journal_mode=delete` (lock exclusivo de
escritura) + `busy_timeout=0` (falla al instante) = **`database is locked` apenas las escrituras
se solapen.** Y bajo la carga del Mundial, ese solapamiento es frecuente, no excepcional.

**Por qué el "0 errores en 20h" era engañoso:** hoy NO hay dos escritores, por eso no hay locks.
El lock aparece *cuando enciendo el shadow* (2º escritor) Y *bajo carga* (Mundial). El pre-flight
lo cazó ANTES de encender — en vez de descubrir los locks en pleno Mundial con la data del evento
en juego.

**El fix (PR `fix/sqlite-wal-busy-timeout`):**
- Event listener `connect` (idiomático SQLAlchemy — aplica PRAGMAs a CADA conexión del pool, no
  solo la primera).
- `journal_mode=WAL` (lectores concurrentes + 1 escritor SIN lock exclusivo — ataca la RAÍZ) +
  `busy_timeout=5000` (espera el residual en vez de fallar) + `synchronous=NORMAL` (seguro con
  WAL, menos fsync, bonus de rendimiento para escritura intensa). Guard `is_sqlite`.
- Test clave: dos escritores concurrentes sin `database is locked` (simula V1 + shadow). 2/2 +
  suite 275 passed.

**Por qué WAL y no solo busy_timeout:** la opción "solo busy_timeout" parchea el síntoma (esperar
en vez de fallar) pero deja el lock exclusivo de `delete` → los escritores se siguen serializando.
WAL ataca la raíz (sin lock exclusivo) Y el síntoma. Para dos escritores permanentes bajo la carga
más alta del año, la solución de raíz.

---

## El encendido: con pre-flight completo (la disciplina de V2)

El plan inicial de Gemini era ligero ("flag, redeploy, mirá logs"). Lo rechacé — el encendido
del shadow es un cambio de producción y va con el pre-flight que le di a V2, escalado al riesgo
REAL aquí: **operativo, no financiero** (reiniciar la captura sana de V1 a 5 días del Mundial).

**Secuencia ejecutada:**

1. Backup FRESCO vía `.backup()` + integrity_check (NO `cp` crudo — DB en uso; NO el de hace
   horas — la migración a WAL ocurre en el redeploy, el backup debe ser inmediatamente previo al
   estado que se migra).
2. Baseline de V1 capturado (`/status` + conteo `orderbook_events`) para comparar después.
3. Merge de **PR #23 (WAL)** = commit `f6ba2c4` + **PR #22 (sensor 409)** = commit `1b35b4a`
   juntos a main → UN solo redeploy (no dos). Sin conflicto (tocan archivos distintos:
   `src/storage/models.py` vs `kalshi_rest.py` + `executor.py`).
4. `MOTOR_REST_ENABLED=true` + `TRADING_ENABLED=false` → redeploy host-side (Coolify).

**Baseline congelado (pre-shadow, 2026-06-07 20:43):**
- Backup: `/app/data/trades.db.bak-20260607-204348` · integrity OK · 1.16 GB
- `orderbook_events = 9,951,361`
- `edge_windows = 0`
- `market_snapshots = 277,604`

**Decisiones de orden tomadas:**

- **#22 NO era bloqueante del shadow** (el shadow no ejecuta → no usa el sensor). Pero se mergeó
  en el MISMO redeploy por higiene (un solo reinicio de V1), no en dos separados.
- **NO bajar `HEARTBEAT_EVERY`** — una cosa a la vez; no meter un cambio de comportamiento del
  heartbeat justo cuando enciendo el motor por primera vez. El heartbeat normal ya da la señal de
  vida (N creciente).

**Nota sobre el rollback:** apagar `MOTOR_REST_ENABLED` NO revierte WAL (la DB ya migró de
formato). Está bien — WAL es seguro de mantener con un solo escritor (mejor que delete). Dos
redes distintas para dos riesgos: el flag cubre "shadow se porta mal"; el backup fresco cubre "la
migración a WAL salió mal".

---

## Verificación post-deploy — encendido limpio

| Check | Resultado |
|---|---|
| Deployment | healthy, commit `1b35b4a` |
| Flags | `MOTOR_REST_ENABLED=true`, `TRADING_ENABLED=false`, `MOTOR_1=false` ✅ |
| WAL migrado | `journal_mode=wal`, archivos `-shm`/`-wal` presentes ✅ |
| Motor REST registrado | log `Motor REST registered (SHADOW...)` + polling REST activo ✅ |
| Captura viva + sin locks | +262 eventos en 6s, lectura concurrente bajo WAL, **cero `database is locked`** ✅ |
| `edge_windows` | **0** — ⚠️ pendiente confirmar que graba (ver abajo) |

**El falso positivo de los `database is locked` (bien debuggeado):** el `awk` contó 4 matches
como "post-encendido". Investigué: son 2 eventos (cada error = 2 líneas: causa + wrapper), AMBOS
PRE-redeploy (timestamps `20:46`/`20:48`, durante el baseline en modo `delete`). El awk los metió
en rango porque las líneas de continuación del traceback no empiezan con timestamp. **Verificado
contra timestamps reales: cero locks tras WAL.** (Si hubiera tomado el conteo del awk al pie de la
letra, habría creído que WAL falló cuando funcionó.)

---

## ⚠️ Lo único que falta: confirmar que VIVO = GRABANDO

`edge_windows=0`. El shadow está **registrado, escuchando, procesando ticks** (vivo, confirmado).
Pero **todavía no grabó una sola `edge_window`.** Dos explicaciones que NO puedo distinguir con
`edge_windows=0` solo:

- **(a) Benigno:** no hubo arb que cruce el umbral aún (el arb es esporádico). Shadow perfecto,
  esperando.
- **(b) A descartar:** el camino detección→grabado está roto (trigger no dispara, grabado falla
  en silencio, o **el parser de size devuelve None → filtro de profundidad descarta TODO** →
  `edge_windows` se queda en 0 aunque haya arbs).

**Conecta con el `[verificar contra captura real]` pendiente:** el gate sobre amistosos confirmó
que el parser PUEDE leer size (`yes_bid_size_fp: "2033.43"`) — pero con `inspect_ws.py`, NO con
el código del Motor REST en producción. Falta confirmar que el Motor REST corriendo parsea real.

**Próximo chequeo (durante soccer en vivo, antes del Mundial)** — debe distinguir (a) de (b), no
solo "edge_windows creció":

1. Heartbeat del Motor REST sigue creciendo (motor vivo, no colgado).
2. ¿Logs de ticks de soccer procesados? ¿Recibe y parsea mensajes ticker?
3. **Crítico: ¿el parser de size lee valores REALES en producción (no None)?** Si lee None, el
   filtro descarta todo y edge_windows queda en 0 aunque haya arbs.
4. ¿Hubo `edge.detected` SIN `EdgeWindow` grabada? = grabado roto.
5. `edge_windows` creciendo, interpretado con 1-4: crece = graba bien; no crece pero 1-3 sanos =
   "no hubo arb" (benigno), no "roto".

**También pendiente:** confirmar que el handler de orderbook que cambió de `:172` a `:136` en
este deploy es solo reubicación por el merge, no cambio funcional del camino de detección.
(WAL es del engine, #22 del executor dormant — ninguno DEBERÍA tocar el trigger.)

---

## Estado del frente Motor REST

| Componente | Estado |
|---|---|
| Detección ticker-only validada sobre soccer en vivo | ✅ (amistosos, sesión previa) |
| Sensor FOKExecutor (3 rutas, API viva) | ✅ + ahora en main (#22 mergeado) |
| SQLite concurrencia (WAL) | ✅ migrado y validado en vivo |
| Shadow encendido en producción | ✅ vivo, sin riesgo de capital |
| Shadow GRABANDO (edge_windows) | ⚠️ **pendiente confirmar** durante soccer en vivo |
| Gates de carga restantes (RTT bajo carga) | pendiente — mercado de alta liquidez |
| Wiring `execute()` + checklist capital | ❌ NO este Mundial (7d sin crashes no se cumple) |

---

## El cabo del 06-jun cerrado por el camino

El error `_on_orderbook_delta:172 Error procesando orderbook_delta` del 21:56:20 del 06-jun
quedó implícitamente cerrado: el handler cambió de `:172` a `:136` en este deploy por el merge,
y la captura continúa creciendo limpia. **Pendiente confirmar formalmente** que el cambio de
línea es solo reubicación, no cambio funcional. Pero el síntoma (errores recurrentes) NO
reapareció post-deploy — al menos no en la primera ventana de observación.

---

## Aprendizajes de la sesión

- **El pre-flight cazó un problema que el "todo sano, 0 errores/20h" escondía.** El 0/20h era
  real pero engañoso — no había locks porque no había 2 escritores. El shadow introduce el 2º
  escritor; el lock aparecería bajo carga del Mundial. **Verificar la config de SQLite ANTES de
  encender, en vez de descubrir locks en pleno Mundial, es la disciplina de pre-flight de V2
  pagando dividendos en un componente nuevo.**

- **WAL ataca la raíz; busy_timeout solo el síntoma.** Cuando hay opción de parche-vs-raíz para
  un sistema que va a estar bajo la carga más alta del año, la raíz. El parche (busy_timeout solo)
  habría dejado los escritores serializándose con esperas de hasta 5s, acumulando latencia.

- **"Vivo" no es "grabando".** Un componente puede arrancar, no crashear, parecer sano —y no
  hacer su trabajo (grabar) por un camino roto silencioso. `edge_windows=0` con el motor vivo no
  distingue "no hubo trabajo" de "trabajo roto". Hay que verificar el camino interno (parser lee
  real, ticks procesados, detected vs grabado), no solo el resultado final.

- **No tomar el conteo de una herramienta al pie de la letra.** El awk contó 4 locks
  "post-encendido"; verificar los timestamps reales mostró que eran pre-redeploy. Confiar en el
  conteo crudo habría hecho creer que WAL falló. Mismo principio de toda la saga: verificar contra
  la fuente real, no contra la inferencia/herramienta intermedia.

- **Una cosa a la vez al encender en producción.** Rechacé bajar el HEARTBEAT_EVERY en el mismo
  redeploy del encendido — meter un cambio de comportamiento justo cuando observás el arranque
  limpio confunde el diagnóstico si algo sale raro. Cambiá lo mínimo, observá limpio, ajustá
  después.

- **El riesgo del encendido del shadow es operativo, no financiero.** TRADING_ENABLED=false →
  cero riesgo de capital. Pero reiniciar la captura sana de V1 (la fuente de data) a 5 días del
  Mundial SÍ es riesgo. Por eso el pre-flight (backup + baseline + comparar V1 post-deploy), no
  un plan ligero.

---

## 🚨 Runbook de rollback — qué hacer si el redeploy sale mal

### Trigger 1 — Shadow NO levanta (Motor REST no se registra)

**Síntomas a las 30-60s del redeploy:**
- Sin log `Motor REST registered (SHADOW...)` en el arranque
- Heartbeat `REST Engine Heartbeat: N tickers evaluados` NO aparece
- Excepciones en loop del Motor REST en logs

**Acción inmediata:**
1. Coolify → `MOTOR_REST_ENABLED=false`
2. Redeploy
3. Verificar que vuelve al baseline: V1 captura corriendo, sin logs de Motor REST
4. Capturar logs completos para diagnóstico offline (`docker logs > /tmp/rollback_TIMESTAMP.log`)

**Lo que NO se hace en el rollback:**
- NO revertir WAL (la DB ya migró, es seguro mantener; WAL es persistente, irreversible por flag — por diseño)
- NO mergear PRs adicionales en caliente — diagnóstico primero, fix después en branch separada con review

### Trigger 2 — V1 se degrada post-deploy

**Síntomas (comparar contra baseline congelado):**
- `orderbook_events` se estanca o crece más lento que ~250 MB/día
- `capture_running=false` o `ws_connected=false` por más de 60s
- Errores nuevos en `data_capture` que NO estaban pre-deploy
- `tracked_markets` cae por debajo de 35

**Acción inmediata:**
1. Coolify → `MOTOR_REST_ENABLED=false`
2. Redeploy
3. Verificar contra baseline pre-shadow:
   - `orderbook_events` debe seguir creciendo (era 9,951,361 a las 20:43)
   - `capture_running=YES`, `ws_connected=YES`
   - 50/50 snapshots cada 5 min

**Si V1 sigue degradado después de apagar el flag:** problema más profundo — el flag NO es el causante. Investigar (¿migración a WAL afectó otra cosa? ¿el redeploy mismo introdujo un bug en V1?).

### Trigger 3 — `database is locked` aparece post-WAL

**Síntomas:**
- Errores `database is locked` en logs tras el redeploy (filtrar por timestamps post-deploy real, no por la inferencia del awk como cazamos en el debug)
- Verificar con grep estricto: `grep -E "^2026-06-07 (2[2-9]|2[1-9]:[5-9])" bot_*.log | grep "database is locked"`

**Posibilidades:**
- (a) WAL NO se migró (verificar: `ls -la /app/data/trades.db*` debe mostrar `-wal` y `-shm`)
- (b) WAL migró pero algo más causa contención (otro escritor desconocido, NFS sin querer)

**Acción:**
1. NO apagar el flag inmediatamente — primero verificar si WAL realmente está activo
2. `sqlite3 trades.db "PRAGMA journal_mode;"` debería retornar `wal`
3. Si NO está en WAL: el listener no se ejecutó al primer connect (raro pero posible) — el rollback es restaurar el backup pre-deploy y mergear el fix WAL aparte
4. Si SÍ está en WAL: investigar el escritor adicional (no es el flag de shadow el causante)

### Restauración desde backup (caso peor, raro)

**Cuándo:** solo si V1 está corrupto post-deploy Y restart no ayuda.

```bash
# Container parado
cp /app/data/trades.db.bak-20260607-204348 /app/data/trades.db
# Verificar integrity
python -c "import sqlite3; c=sqlite3.connect('/app/data/trades.db'); print(c.execute('PRAGMA integrity_check;').fetchone())"
# Esperado: ('ok',)
# Restart container con MOTOR_REST_ENABLED=false hasta diagnosticar
```

**Impacto:** se pierden las escrituras desde 20:43 hasta el momento del crash. Aceptable si la integridad estaba comprometida — peor es mantener la DB rota.

### SLA de rollback

- Detección de problema → flag false: **< 2 min**
- Redeploy → baseline confirmado: **< 5 min**
- Total: **< 7 min desde detección**

### Después del rollback (orden estricto)

1. Logs preservados en archivo (ANTES de cualquier debug en vivo).
2. Diagnóstico offline — NO reintentar el encendido sin causa raíz identificada (lección de V2: tres reactivaciones fallidas porque las primeras dos fueron sin análisis previo).
3. Si el problema es del Motor REST: fix en branch separada, review adversarial, test contra escenario reproducido, segunda ventana con runbook actualizado.
4. Si el problema es operativo (Coolify, container, env): documentar como deuda separada, NO mezclar con el Motor REST.

---

## Para el próximo turno (orden estricto)

1. **Durante soccer en vivo (9-jun o antes si hay otro evento):** correr los 5 chequeos de "VIVO
   = GRABANDO" — distinguir (a) benigno de (b) camino roto.
2. **Si el camino está roto** (parser devuelve None, trigger no dispara, grabado falla en
   silencio): diagnosticar y arreglar antes del Mundial.
3. **Si el camino está sano** y `edge_windows` empieza a crecer durante mercados con liquidez:
   shadow validado, listo para grabar el Mundial.
4. **Confirmar** que el cambio de `:172` a `:136` en el handler de `_on_orderbook_delta` es solo
   reubicación, no cambio funcional.
5. **Día 9-jun:** gates de carga reales (RTT bajo carga + cadencia ticker + parser size con
   valores reales en producción).

---

## Links
- [[kalshi-bot]]
- [[2026-06-06-sesion-fantasma-V2-shadow-listo-error-data-capture]] — pre-flight que cazó el problema de SQLite
- [[2026-06-05-sesion-FOKExecutor-sensor-validado-API-viva]] — sensor validado, ahora en main (#22)
- [[2026-06-03-sesion-V2-archivado-motor-REST-construido]] — infra del Motor REST
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — la decisión que llevó al shadow
- [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]] — el dato que cerró el ticker-only
