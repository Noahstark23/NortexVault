---
fecha: 2026-06-02
tipo: gate-pendiente-calendario
proyecto: kalshi-bot
componente: validacion-Motor-REST-pre-capital
estado: PENDIENTE-mercado-activo-requerido
bloquea: activacion-TRADING_ENABLED-no-diseno
tags:
  - gate-pendiente
  - kalshi-bot
  - 2026-06-02
  - mundial
  - validacion-bajo-carga
---

# ⏳ Gate de validación bajo carga — pendiente del calendario

> Tres mediciones que requieren mercado activo (Mundial 11-jun o NBA prime time). **Bloquean activación con capital del Motor REST, NO bloquean el diseño**. El camino crítico ya no está en el teclado — está en el reloj de Kalshi.

## Las tres mediciones que faltan

### 1. Cadencia del ticker bajo carga (nuevo gate destapado por Gate 0)

**La pregunta:** ¿Cada cuánto Kalshi empuja un mensaje `ticker` nuevo cuando el BBO se mueve rápido?

**Por qué importa:**
- El trigger del Motor REST depende del ticker como señal
- Si Kalshi agrupa updates y empuja ticker cada 500ms+ → tu detección reacciona tarde
- Con edge mediano de segundos (data Q5) → cadencia <500ms suficiente
- Con edge mediano de 100ms → cadencia debe ser <50ms

**Caveat actual:** los 30s en NBA temporada baja del Gate 0 no muestran cadencia bajo presión real.

**Cómo se mide:**
```bash
# inspect_ws.py mirando ts_ms entre mensajes ticker consecutivos
cd /app && PYTHONPATH=. python scripts/inspect_ws.py \
  --tickers <ticker-activo> \
  --channels ticker \
  --duration 300 \
  --verbose | grep ts_ms
```

Analizar: distribución de delta-ts entre tickers del mismo mercado.

**Umbral aceptable (tentativo):**
- Mediana < 200ms → MUY BIEN
- p95 < 500ms → BIEN
- p95 > 1000ms → PROBLEMA — el trigger reacciona tarde, repensar detección

### 2. RTT bajo carga real (pendiente desde 01-jun)

**La pregunta:** ¿El RTT warm de 33ms / p95 64ms (medido en madrugada NBA temporada baja) aguanta cuando Kalshi está bajo presión real?

**Por qué importa:**
- Bajo carga, p95 podría degradar a 200ms+
- Sumado a ejecución de 2 patas (FOK), tiempo total podría exceder vida del edge
- El Motor REST se vuelve marginal si RTT triplica

**Cómo se mide:**
```bash
cd /app && PYTHONPATH=. python scripts/bench_rest_rtt.py \
  --ticker <ticker-activo> \
  --samples 200 \
  --concurrent 3
```

**Umbral aceptable:**
- p95 < 100ms bajo concurrencia → MUY BIEN
- p95 < 200ms → BIEN (margen menor)
- p95 > 300ms → PROBLEMA — Motor REST marginal

### 3. Shape del ticker sobre soccer

**La pregunta:** ¿El shape confirmado sobre NBA (BBO + sizes) aparece igual en mercados de soccer del Mundial?

**Por qué importa:**
- Gate 0 validó sobre NBA porque NO había soccer abierto
- El formato debería ser genérico de la API (no por deporte)
- PERO conviene verificar antes de confiar el trigger por spread a un mercado nuevo

**Cómo se mide:**
```bash
# 30s contra un mercado KXUCL/KXWC del Mundial cuando abra
cd /app && PYTHONPATH=. python scripts/inspect_ws.py \
  --tickers <KXUCL-mundial-ticker> \
  --channels ticker,orderbook_delta \
  --max-messages 30 --verbose --duration 30
```

**Veredicto esperado:** mismo shape que NBA. Si difiere → repensar parseo del trigger.

## Por qué este gate NO bloquea el diseño

**El diseño del ejecutor FOK depende de:**
- Lógica de "FOK ambas patas, qué hacer si una se rechaza" — independiente de latencia
- Reuso del path de evaluación existente — ya validado offline
- Integración con `RiskManager.check_pre_trade` — comportamiento conocido

**Ninguno de estos depende de los números bajo carga.**

**El diseño FOK se puede hacer ahora con energía fresca.** La validación bajo carga llega después.

## Por qué este gate SÍ bloquea TRADING_ENABLED

**Activar `TRADING_ENABLED=true` con capital real requiere:**
- Confianza de que la detección reacciona dentro de la vida del edge
- Confianza de que la ejecución FOK completa antes de que se mueva el mercado
- Confianza de que el throttle anti-429 funciona en ráfagas reales

**Sin las tres mediciones bajo carga, esa confianza es opinión, no dato.**

## Calendario operativo del gate

### Opción A — Esperar al Mundial (11-jun)
- ✅ Mercado más relevante (soccer es el filón identificado)
- ✅ Cubre la medición #3 (shape soccer)
- ✅ Volumen masivo para medir cadencia + RTT bajo carga real
- ⏳ 9 días de espera desde el 02-jun

### Opción B — Prime time NBA (próxima semana)
- ✅ Mide cadencia + RTT bajo carga
- ❌ NO cubre #3 (shape soccer)
- ✅ Disponible antes que Mundial
- ⏳ Verificar calendario NBA específico

### Opción C — Combinación
- B primero: validar cadencia + RTT bajo NBA prime time (medición preliminar)
- A después: confirmar #3 + revalidar cadencia/RTT en régimen Mundial

**Recomendación implícita:** Opción C — mide temprano lo que se pueda, confirma en el régimen final.

## Estado del bot durante este período de espera

**Mientras el gate está pendiente:**
- ✅ V1 sigue capturando data (acumula referencia)
- ✅ Diseño FOK puede progresar
- ✅ Implementación shadow puede progresar
- ✅ Tests offline pueden correrse
- ❌ `TRADING_ENABLED` permanece false
- ❌ `MOTOR_REST_ENABLED` puede ser true solo en modo shadow (no opera)

**El bot no está bloqueado — está en modo "preparación pre-Mundial".**

## Plan de medición concreto (cuando aplique)

### Para el Mundial (11-jun)

**T-1 día (10-jun):**
1. Re-confirmar shape sobre soccer del Mundial (medición #3)
2. Validar que `inspect_ws.py` se conecta correctamente a tickers KXUCL/KXWC

**T+0 (11-jun primer partido):**
1. Antes del kickoff: snapshot baseline de cadencia ticker (mercado pre-evento)
2. Durante kickoff: medir cadencia bajo carga real (mediciones #1)
3. Durante el partido: correr `bench_rest_rtt.py` en background (medición #2)

**T+1 hora:**
1. Análisis de cadencia + RTT
2. Aplicar criterios de aceptación
3. Decisión: ¿continuar a shadow del Motor REST, o ajustes pre-activación?

## Criterios de aceptación del gate completo

**Para considerar el gate PASA:**
- Cadencia ticker p95 < 500ms ✅
- RTT bajo carga p95 < 200ms ✅
- Shape ticker en soccer = shape NBA ✅
- Sin 429s en ráfagas observadas ✅

**Si los 4 ✅:**
- Motor REST validado para activación
- Decisión: ¿activar shadow primero (recomendado) o trading directo?

**Si alguno ❌:**
- Documentar qué medición falló
- Analizar implicaciones para el diseño
- Posible refinamiento de la arquitectura

## El gate más importante de todos NO mencionado: instrumentación de shadow

**Aún si los 4 ✅, antes de TRADING_ENABLED=true:**

Modo shadow del Motor REST durante varios partidos:
- Tabla `edge_windows` poblándose con data real del Mundial
- Análisis de captura neta efectiva (no proxy NBA)
- Validación de que el ciclo detección→GET→evaluación funciona en producción
- Cero capital en riesgo

**Solo cuando shadow muestre captura neta consistente → considerar activar capital.**

## La trampa que este gate impide

**Sin este gate:**
1. Diseño FOK termina
2. Implementación termina
3. Tests pasan offline
4. "Estamos listos — activemos trading el 11-jun"
5. 11-jun: kickoff → cadencia de ticker es 2s → detectás tarde → arbs evaporados → pérdidas

**Con este gate:**
1. Diseño + implementación + tests offline ✅
2. Shadow durante primeros partidos
3. Medición de cadencia/RTT bajo carga real del Mundial
4. **DECIDIR** activar trading con datos, no opinión

**Es la diferencia entre llegar al Mundial con "el bot técnicamente listo" y llegar con "el bot validado bajo carga real."**

## Estado al cierre

- ⏳ Gate pendiente — requiere calendario (mercado activo)
- ✅ Plan de medición concreto definido
- ✅ Criterios de aceptación definidos
- ✅ Plan B (NBA prime time) disponible si se quiere medir antes
- 🔒 `TRADING_ENABLED=false` hasta gate completo

## Links
- [[2026-06-02-noche-GATES-0-y-0-5-CERRADOS-shape-ticker-y-FOK]] — Gate 0 que destapó la cuestión de cadencia
- [[2026-06-02-noche-DISENO-motor-REST-PR-13-revision-adversarial]] — diseño que se valida aquí
- [[2026-06-02-noche-sesion-gates-cerrados-cierre-disciplinado]] — sesión
- [[2026-06-02-pivot-MUNDIAL-11jun-calendar-driven]] — pivot calendar-driven que enmarca este gate
- [[2026-06-02-DATA-tres-chequeos-edge-RTT-captura-73]] — RTT medido en madrugada (necesita validación bajo carga)
- [[kalshi-bot]]
