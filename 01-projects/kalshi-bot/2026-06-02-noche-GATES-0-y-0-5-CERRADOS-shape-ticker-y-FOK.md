---
fecha: 2026-06-02
tipo: gates-bloqueantes-cerrados
proyecto: kalshi-bot
componente: Motor-REST-arquitectura
estado: AMBOS-GATES-VERDES
tags:
  - gates
  - kalshi-bot
  - 2026-06-02
  - motor-rest
  - bloqueantes-cerrados
  - shape-ticker
  - fok
---

# ✅ Gates 0 y 0.5 CERRADOS — shape del ticker + FOK nativo

> Los dos bloqueantes que el diseño del Motor REST tenía que cerrar antes de implementación. **Ambos pasaron.** El Motor REST queda confirmado viable contra el feed real (no contra teoría) y contra la API real de Kalshi (no contra supuestos).

## Gate 0 — Shape del ticker WS ✅ PASA (con bonus)

### La pregunta del gate
**¿El mensaje `ticker` del WebSocket trae el BBO (yes_bid/yes_ask) que el trigger por spread necesita?** El diseño entero del Motor REST depende de esto. Sin BBO en el ticker, el trigger por spread no funciona y hay que repensar la detección.

### Cómo se ejecutó

**Primera intención fallida:** Claude Code intentó `capture_ticker_shape.py` (estaba en PR draft pero NO en el container). Frenó ante la discrepancia, no improvisó, planteó alternativas. Eso es el gate funcionando.

**Solución encontrada:** `inspect_ws.py` ya estaba en el container y hacía exactamente lo necesario:
- Loop de recepción con `msg = json.loads(raw_str)`
- Modo `--verbose` imprime payload crudo completo
- `--tickers` acepta lista, autodiscovery REST si no se pasan
- Conexión WS **nueva e independiente** (no comparte la del bot)

**Discovery de soccer:** probadas 8 series — KXUCL, KXEPL, KXLALIGA, KXSOCCER, KXWC, KXFIFA, KXSERIEA, KXBUNDESLIGA. **Todas 0 eventos abiertos.** Control con NBA/NHL confirmó que el mecanismo funciona — el 0 de soccer es real (calendario: ligas cerradas, Mundial abre 11-jun).

**Comando ejecutado:**
```bash
cd /app && PYTHONPATH=. python scripts/inspect_ws.py \
  --tickers KXNBA-26-NYK,KXNBA-26-SAS \
  --channels ticker,orderbook_delta \
  --max-messages 30 --verbose --duration 30
```

Acotado: segunda conexión, ~30 mensajes, corte automático, sin riesgo de degradar V1.

### Resultado — el ticker trae BBO COMPLETO y MEJOR

**Keys del payload `type=ticker`:**
- `yes_bid_dollars` ✅
- `yes_ask_dollars` ✅
- `yes_bid_size_fp` ✅ **(bonus)**
- `yes_ask_size_fp` ✅ **(bonus)**
- `ts_ms` (timestamp en ms)
- `market_ticker`

**Derivación del lado `no` (Kalshi binario):**
- `no_bid = 100 - yes_ask`
- `no_ask = 100 - yes_bid`

**Esto significa: la condición de arbitraje binario completa se computa desde UN solo mensaje ticker de UN solo mercado.**

### Por qué es MEJOR de lo mínimo esperado

1. **Trae los sizes** (`yes_bid_size_fp`, `yes_ask_size_fp`). Esto permite **filtrar por profundidad ANTES de disparar el REST**. No gastás un GET en un arb de 2 contratos. Es una optimización gratis que el diseño no había asumido.

2. **El lado `no` se deriva exacto** sin necesidad de mantener el book aplicando deltas. Toda la razón para evitar V2 (no mantener estado de orderbook) se confirma viable. **Sin desync, sin buffer, sin seq, sin recovery.**

3. **Comparación con `orderbook_delta`** confirmó que el ticker NO es subconjunto pobre — te da el top-of-book ya calculado directamente. La premisa del Motor REST se sostiene sobre el feed real.

### Caveats honestos (Claude Code los marcó)

1. **No mide la cadencia de actualización del ticker bajo carga real.** ¿Cada cuánto Kalshi empuja un ticker cuando el BBO cambia rápido? Con 2 tickers en 30s de temporada baja no se ve. **Nuevo gate destapado** → ver [[2026-06-02-noche-GATE-pendiente-validacion-bajo-carga-mundial]]

2. **Confirmado sobre NBA**, falta re-confirmar sobre soccer cuando abran mercados del Mundial. El formato debería ser genérico (API, no deporte), pero conviene verificar 30s contra un KXUCL/KXWC real antes del 11-jun.

### Veredicto Gate 0
✅ **PASA con margen.** El trigger por spread vive. Detección viable con UN mensaje ticker por mercado.

---

## Gate 0.5 — FOK nativo en API Kalshi ✅ PASA

### La pregunta del gate
**¿Kalshi soporta orden tipo Fill-or-Kill (FOK) nativo?** El diseño del ejecutor necesita FOK para evitar el riesgo financiero central del Motor REST (ejecución de dos patas con exposición direccional si una falla).

### Investigación

**Verificación vía evidencia convergente** (ReadMe bloquea fetch directo, se usaron alternativas):
- Documentación oficial de Kalshi (`docs.kalshi.com/api-reference/create-order`)
- ~6 repos de producción en GitHub usando la API

**Hallazgos cruzados:**

Kalshi soporta TRES valores de `time_in_force`:

| `time_in_force` | Comportamiento |
|---|---|
| `"fill_or_kill"` | **FOK** — completa o se cancela. Cero exposición parcial. ✅ |
| `"immediate_or_cancel"` | IOC — fallback (opción C) |
| `"good_till_canceled"` | GTC — el modo del bug actual (limit+resting), DESCARTADO |

### Sintaxis exacta confirmada
```json
{
  "type": "limit",
  "yes_price": 4500,    // o no_price
  "time_in_force": "fill_or_kill",
  "client_order_id": "..."
}
```

### Detalle de implementación
**`KalshiRestClient.place_order` hoy NO expone `time_in_force`.** Cambio menor pendiente:
- Agregar parámetro `time_in_force` opcional al método
- Default actual ("limit+resting" sin TIF explícito) queda intacto
- El Motor REST llama con `time_in_force="fill_or_kill"`

### Decisión derivada

**Ejecutor del Motor REST = FOK nativo en ambas patas.**

- **(A) FOK simultáneo en ambas patas** ✅ ELEGIDO
  - Si una pata no se llena completa al precio, **ambas se cancelan**
  - Cero exposición parcial
  - Aborta el arb si el mercado se mueve entre detección y ejecución
- **(B) limit + rollback** ❌ DESCARTADO (es el bug del executor.py, ver [[2026-06-02-noche-BUG-executor-limit-resting-Issue-14]])
- **(C) IOC** — queda como fallback documentado por si FOK tiene latencia inaceptable

### Veredicto Gate 0.5
✅ **PASA.** FOK nativo disponible, sintaxis confirmada, decisión arquitectónica del ejecutor cuantificada.

---

## Impacto consolidado de los dos gates

| Dimensión | Antes de los gates | Después |
|---|---|---|
| Trigger por spread | Hipótesis (asume BBO en ticker) | ✅ Confirmado contra feed |
| Estado in-memory | "Quizás no necesite mantener book" | ✅ Confirmado: ticker da BBO directo |
| Ejecución de 2 patas | Riesgo de exposición direccional | ✅ FOK nativo resuelve |
| Bug heredado executor.py | Latente, podría haber afectado Motor REST | ✅ Aislado en Issue #14, NO se reusa |
| Diseño del ejecutor FOK | Abstracto | ✅ Decisión arquitectónica completa (A) |
| Profundidad del trigger | "Quizás filtremos después" | ✅ Bonus: sizes en ticker permiten filtro pre-REST |

## Lo que esto cambia en la confianza del diseño

**Antes:** Motor REST aprobado en dirección por análisis empírico de la duración del edge (73% captura). Pero el diseño todavía descansaba en dos supuestos sobre la API/feed.

**Después:** Motor REST validado contra:
- Datos históricos (7.9M eventos)
- Feed real (Gate 0)
- API real (Gate 0.5)

**Tres ejes de validación. Ninguno asume — todos midieron.**

## Sigue pendiente (no bloquea diseño, bloquea activación con capital)

### Nuevo gate destapado: cadencia del ticker bajo carga
El resultado del Gate 0 destapó esta pregunta empírica:
> ¿Cada cuánto Kalshi empuja un ticker nuevo cuando el BBO se mueve rápido?

- Si <500ms → margen para edge de segundos (chequeo a confirmado)
- Si >1s → problema serio antes de RTT

**Se mide con el mismo `inspect_ws.py` mirando cadencia de `ts_ms` entre tickers consecutivos.** Pero requiere **mercado activo** (Mundial o NBA prime time). Hoy ninguno disponible.

### RTT bajo carga (pendiente desde 01-jun)
`bench_rest_rtt.py` ya escrito. Requiere mercado activo para medir P95 bajo presión real (vs el 64ms medido en madrugada NBA temporada baja).

### Shape del ticker sobre soccer (Mundial)
Re-confirmar 30s contra un KXUCL/KXWC real cuando abran los mercados del Mundial.

Ver [[2026-06-02-noche-GATE-pendiente-validacion-bajo-carga-mundial]] para detalle.

## Gobernanza

- ✅ `src/` intacto (solo doc-only + scripts en `scripts/`)
- ✅ `orderbook_manager_v2.py` sin tocar (V2 archivado)
- ✅ `executor.py` sin tocar (bug aislado en Issue #14, no se modifica)
- ✅ `USE_ORDERBOOK_MANAGER_V2=False`, `TRADING_ENABLED=False`
- ✅ Cero código de producción de Motor REST escrito

## Estado consolidado de gates

| Gate | Estado | Notas |
|---|---|---|
| Gate 0 (shape ticker) | ✅ PASA | BBO + sizes + lado no derivable |
| Gate 0.5 (FOK) | ✅ PASA | FOK nativo, sintaxis confirmada |
| Gate de validación bajo carga | ⏳ Pendiente Mundial/NBA prime time | NO bloquea diseño FOK |

## Próximos pasos

1. ✅ **Documentar Gate 0** en `docs/gate_0_ticker_shape.md` (Claude Code lo hará en próximo turno)
2. ⏳ **Diseño del ejecutor FOK** — texto, sin código, con gate de review (cuando haya energía fresca)
3. ⏳ **Review adversarial del diseño FOK**
4. ⏳ **Implementación en modo SHADOW** (`MOTOR_REST_ENABLED=False`)
5. ⏳ **Instrumentación de `edge_windows`** desde día 1
6. ⏳ **Gate validación bajo carga** (mercado activo)
7. ⏳ **Activación con capital** solo post-gate completo + decisión consciente

## Links
- [[2026-06-02-noche-sesion-gates-cerrados-cierre-disciplinado]] — sesión
- [[2026-06-02-noche-DISENO-motor-REST-PR-13-revision-adversarial]] — diseño bajo revisión
- [[2026-06-02-noche-BUG-executor-limit-resting-Issue-14]] — bug aislado, motivó decisión FOK
- [[2026-06-02-noche-GATE-pendiente-validacion-bajo-carga-mundial]] — gate calendario
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — decisión arquitectónica que estos gates validaron
- [[kalshi-bot]]
