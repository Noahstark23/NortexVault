---
fecha: 2026-06-01
tipo: spec-benchmark
proyecto: kalshi-bot
componente: validacion-arquitectura-opcion-2
estado: SPEC-APROBADO-pendiente-ejecucion
tags:
  - benchmark
  - kalshi-bot
  - 2026-06-01
  - decision-criteria
  - anti-confirmation-bias
---

# 📊 Benchmark REST — spec del script + criterio de decisión a priori

> Script que valida si la Opción 2 (REST híbrido) es viable. Lo crítico: el criterio de decisión debe definirse **ANTES** de ver los números, para evitar confirmation bias (racionalizar hacia el approach ya preferido).

## Qué decide este benchmark

Opción 2 reemplaza V2 (orderbook in-memory con deltas sub-ms) por:
- WS solo para ticker (último precio/BBO, sin deltas)
- REST snapshot bajo demanda cuando ticker dispara arbitraje (~50-100ms)

**Si la latencia P99 del path completo es baja Y los 429 son raros bajo concurrencia → Opción 2 viable, V2 archivado.**
**Si la latencia es alta O hay 429 frecuentes bajo concurrencia → Opción 2 inviable, volver a V2 con B1+A2.**

## Spec del script

**Ubicación:** `scripts/benchmark_rest_latency.py`
**Naturaleza:** aislado, fuera del hot path del bot, no toca producción ni V2

### Lo que el script DEBE medir

#### 1. Latencia del PATH COMPLETO, no solo del GET

**Por qué importa:** la latencia que decide es **desde que el ticker dispara hasta que la condición de arbitraje está evaluada**, no solo el RTT HTTP.

**Path real del Motor 1:**
```
ticker WS detecta movimiento (~1ms)
  ↓
REST GET /markets/{ticker}/orderbook (HTTP RTT)
  ↓
parsear JSON → estructura interna (~5-20ms?)
  ↓
evaluar condición de arbitraje (~1ms)
  ↓
[si dispara] enviar orden (~RTT adicional)
```

**El benchmark mide:** `T_request + T_response + T_json_parse + T_extract_book_top + T_evaluate_arb_condition`

Medir SOLO el GET subestima la latencia real por una factor 1.5-3x.

#### 2. Concurrencia REAL, no secuencia

**Por qué importa:** el escenario operativo NO es "100 GETs uno tras otro". Es:
- 3-4 tickers desarbitrados simultáneamente
- Cada uno a ~20Hz
- Sostenido durante segundos

**Esto es concurrencia sostenida**, no batch secuencial.

**El benchmark debe simular:**
- `N = 4` tareas concurrentes
- Cada una hace REST GET sostenido a `20Hz` (50ms entre requests)
- Duración: al menos 30 segundos sostenidos
- Reportar P99 BAJO esa carga, no en aislamiento

**Diferencia esperada:** P99 secuencial puede ser 80ms; bajo 4 concurrentes a 20Hz puede ser 200ms+ (TCP backpressure, queueing del servidor de Kalshi).

#### 3. Mercados ACTIVOS en horario ACTIVO

**Por qué importa:** un snapshot de un mercado muerto a las 4am vuelve rápido (pocas órdenes en book). Un snapshot de MLB en vivo, con book profundo y Kalshi bajo carga global, puede ser más lento.

**El benchmark debe correr contra:**
- Mercados con actividad real (MLB en vivo durante temporada, UCL si hay partido)
- Horario de actividad (no madrugada UTC)
- Múltiples días para que el P99 capture la varianza real

**Anti-patrón:** medir contra mercado muerto y declarar "la latencia es 40ms". El P99 productivo será mayor.

#### 4. Reportar las métricas correctas

**Output del benchmark debe incluir:**
- **Latencia media** del path completo
- **P95** (95% de requests caen por debajo)
- **P99** (99% de requests caen por debajo — el peor caso esperable)
- **% de errores HTTP 429** (rate limiting)
- **% de otros errores** (5xx, timeouts)
- **Comportamiento bajo carga sostenida** (¿la latencia crece con el tiempo? backpressure?)
- **Tabla por hora del día** si corre múltiples días

## Criterio de decisión — DEFINIDO A PRIORI (antes de ver números)

**ESTE ES EL PUNTO MÁS IMPORTANTE DE TODA LA SPEC.**

### Por qué definirlo antes
Si defino el umbral DESPUÉS de ver los números, voy a racionalizar hacia el approach que ya prefiero. **Confirmation bias garantizado.**

Definirlo **ahora**, con la decisión todavía abstracta, blinda contra ese sesgo.

### Thresholds

| Métrica | Opción 2 GANA (REST híbrido) | Opción 2 PIERDE (volver a V2) | Zona gris |
|---|---|---|---|
| P99 path completo | **< 150ms** | **> 300ms** | 150-300ms |
| 429 bajo concurrencia | **< 2%** | **> 10%** | 2-10% |
| Otros errores | < 1% | > 5% | 1-5% |
| Estabilidad temporal | latencia estable bajo carga sostenida | latencia crece > 50% en 30s sostenidos | crecimiento 20-50% |

### Decisión consolidada

**Opción 2 GANA si:**
- P99 < 150ms
- AND 429 < 2%
- AND otros errores < 1%
- AND latencia estable (no crece bajo carga)

→ Archivar V2 permanentemente. Implementar Opción 2.

**Opción 2 PIERDE si:**
- P99 > 300ms
- OR 429 > 10%
- OR otros errores > 5%
- OR latencia crece > 50% bajo carga sostenida

→ Desarchivar B1+A2, implementar Part B con la fortress.

**Zona gris si ninguna condición clara aplica:**
- Análisis adicional caso por caso
- Probablemente: ejecutar benchmark un día más para más datos
- O: considerar Opción 2 con mitigación de los puntos débiles

## Segundo análisis necesario en paralelo: ¿cuánto dura el edge?

Gemini apoya toda la Opción 2 en *"el edge persiste segundos/minutos"*. **Eso es una hipótesis no medida.**

**Si el edge realmente dura 200ms, ni REST ni V2 sirven** — habría problema más profundo que cambia toda la decisión.

### Análisis a hacer
Tengo ~5 semanas de captura V1 en `orderbook_events` (SQLite). Análisis:
1. Identificar pares de mercados correlacionados (ej: KXMLB-26-PHI vs KXMLB-26-ATL en escenario donde uno gana → el otro pierde)
2. Calcular el spread implícito entre ellos a cada timestamp
3. Detectar momentos donde el spread se descalza (oportunidad de arbitraje)
4. Medir cuánto persiste cada descalce antes de cerrarse

**Output:** distribución de "duración del edge" — P50, P95, P99.

**Si P95 del edge > 200ms → Opción 2 viable independiente del benchmark de latencia (porque incluso 100ms de path REST deja ventana de captura).**

**Si P95 del edge < 50ms → Ni REST ni V2 sirven sin reducir aún más latencia (problema más profundo).**

## Lo que el benchmark NO mide

**Honestidad sobre limitaciones:**
- No mide latencia de la orden post-snapshot (otro HTTP RTT, ~50ms más)
- No mide en condiciones de máxima volatilidad de Kalshi (eventos de cierre, NFL playoffs)
- No mide rate limiting global del exchange si todos los bots están haciendo lo mismo
- No mide impacto en el ticker WS bajo carga REST simultánea

**Mitigación:** correr múltiples días/condiciones; reportar varianza, no solo medias.

## Restricciones de ejecución

- ✅ Script aislado en `scripts/`, NO en `src/`
- ✅ Fuera del hot path del bot productivo (V1 sigue corriendo normal)
- ✅ Solo lee de Kalshi API (read-only, no envía órdenes)
- ✅ Output a archivo + stdout, no a DB de producción
- ❌ NO importa módulos de V2 (independiente)
- ❌ NO toca `USE_ORDERBOOK_MANAGER_V2` (sigue false)
- ❌ NO interfiere con el bot productivo

## Próximos pasos (orden)

1. **Implementar el script** según esta spec (Claude Code, branch nueva, PR)
2. **Review del script** (yo, asegurar que mide lo que dice medir)
3. **Correr el benchmark** múltiples días/horarios
4. **Análisis paralelo del edge** sobre data V1 existente
5. **Decisión consolidada:** aplicar el criterio a priori sobre los números reales
6. **Si Opción 2 gana:** diseñar implementación + revisar + implementar + nueva ventana
7. **Si Opción 2 pierde:** desarchivar B1+A2 y proceder con V2

## Anti-patrones a evitar durante el benchmark

❌ **NO modificar el criterio de decisión tras ver los números** ("bueno, 200ms igual está bien...")
❌ **NO comparar solo medias** (P99 es lo que importa para escenarios reales)
❌ **NO medir en condiciones favorables y extrapolar** (madrugada con mercado muerto)
❌ **NO saltar el análisis del edge** (es el supuesto central que sostiene Opción 2)
❌ **NO implementar Opción 2 antes de tener el número** (volver a "código antes del gate")

## El sesgo a vigilar en mí mismo

Después de 5 días con V2 fallando, **PREFIERO Opción 2**. Lo reconozco honestamente. Por eso:
- El criterio numérico definido a priori es el contrapeso
- Si los números dicen V2, vuelvo a V2 sin discutir
- Gemini puede revisar mi interpretación de los números si me obstino

## Links
- [[2026-06-01-PIVOT-opcion-2-rest-hibrido]] — decisión arquitectónica
- [[2026-06-01-AUDITORIA-PR11-gaps-criticos-cazados]] — por qué llegamos aquí
- [[2026-06-01-diseno-B1-A2-archivado-fortress-de-V2]] — el approach alternativo si Opción 2 pierde
- [[2026-06-01-sesion-01jun-auditoria-pr11-pivot-opcion-2]] — sesión
- [[kalshi-bot]]
