---
fecha: 2026-06-02
tipo: decision-arquitectura-final
proyecto: kalshi-bot
componente: arquitectura-Motor-1
estado: APROBADA-pendiente-implementacion-gate
sustentada-por: tres-chequeos-empiricos-7.9M-eventos
tags:
  - decision
  - arquitectura
  - kalshi-bot
  - 2026-06-02
  - motor-rest
  - v2-archivado
  - mundial
---

# 🎯 DECISIÓN ARQUITECTÓNICA FINAL — Motor REST puro para el Mundial, V2 archivado

> Cierre del arco completo de la saga V2. Tras 3 attempts fallidos, 4 discoveries, fortress B1+A2 archivada, pivot conceptual a Opción 2 (01-jun), y validación empírica con tres chequeos sobre 7.9M eventos (02-jun): **la decisión queda cuantificada con números, no asumida con teoría.**

## La decisión

**Motor REST puro** para capturar arbitraje en el Mundial 2026 (inicia 11-jun). **V2 archivado en PR #11 — recuperable pero no implementado.**

## Por qué REST gana (data-driven, no opinión)

### 1. La premisa de compresión se refutó
Gemini predijo (teoría microestructura): *"Liquidez del Mundial comprimirá el edge a microsegundos → necesitás V2/WS."*

Tu data probó lo opuesto: **liquidez DILATA el edge ~800× monótono**. Ver [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]].

### 2. REST captura 73% del edge en mercados líquidos
Validación empírica sobre 40,532 ventanas en Q5 (alta liquidez):
- 72.6% capturable con umbral 100ms
- 73.7% capturable con peor caso RTT (64ms p95)
- **NO hay penalización por magnitud** — la banda 20c+ (dinero gordo) captura 73.9%, igual que el promedio

Detalle en [[2026-06-02-DATA-tres-chequeos-edge-RTT-captura-73]].

### 3. El 27% perdido es estructural — NI V2 lo captura bien
Son edges sub-50ms que nacen y mueren en un tick. V2 no te daría 27% más; te daría una fracción peleando por los arbs más imposibles.

### 4. RTT real 33ms warm vs edge mediano 4s (Q5 dec 10)
**Ratio 120× de margen.** REST con su latencia es ampliamente suficiente para capturar la mediana en mercados líquidos. V2 ganaría 33ms de latencia para resolver un problema que no domina.

### 5. Calendar alignment con el Mundial
- NBA termina (el filón histórico de NBA tenía mediana 769ms)
- MLB-futuros descartado (0% ≥10c)
- Mundial: inyecta liquidez global → soccer entra en zona líquida-lenta-gorda → REST ideal
- Ver [[2026-06-02-pivot-MUNDIAL-11jun-calendar-driven]]

## Arquitectura del Motor REST (diseño para revisar con gate)

```
┌─────────────────────────────────────────┐
│  Suscripción WS al feed de TICKER       │
│  (liviano, sin orderbook deltas)        │
│  Sin riesgo de desync — no hay state    │
│  in-memory que se pueda corromper       │
└──────────────────┬──────────────────────┘
                   │ ticker muestra spread crudo elegible
                   ▼
┌─────────────────────────────────────────┐
│  GET REST /markets/{ticker}/orderbook   │
│  RTT warm: ~33ms p50, ~64ms p95         │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  Parsear + derivar asks                 │
│  yes_ask = 100 - best_no_bid            │
│  no_ask  = 100 - best_yes_bid           │
└──────────────────┬──────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────┐
│  Evaluar con detect_binary_arb()        │
│  (función existente, reutilizada)       │
└──────────────────┬──────────────────────┘
                   │ si edge ≥ umbral
                   ▼
┌─────────────────────────────────────────┐
│  Emitir orden via REST                  │
│  + INSTRUMENTACIÓN OBLIGATORIA          │
└─────────────────────────────────────────┘
```

## Componentes del diseño

### Detección
- **WS al feed de ticker** (NO orderbook deltas) — liviano, sin riesgo de desync, sin máquina de estados que se rompa en bootstrap
- Trigger: cuando el ticker muestre spread crudo elegible (umbral pendiente decisión de negocio)

### Snapshot
- **GET REST `/markets/{ticker}/orderbook`** — reutilizar `KalshiRestClient` existente
- RTT esperado: 33ms warm p50, 64ms p95 (medido empíricamente)

### Evaluación
- Reutilizar `detect_binary_arb()` que ya existe
- Reutilizar `parse_price_to_cents` (sin tocar)
- Derivar asks: `yes_ask = 100 - best_no_bid`, `no_ask = 100 - best_yes_bid`

### Ejecución
- Si edge confirmado ≥ umbral → orden vía REST
- Tamaños de trade pequeños (5% exposure cap) durante validación
- Demo first si la infraestructura lo permite

### Instrumentación obligatoria (Lección 9 aplicada)
**Desde el primer partido del Mundial**, loguear cada ventana de edge detectada:
- Duración real
- Magnitud
- Si se capturó o se perdió
- Latencia real de cada GET (mediana en vivo, no proxy)
- Latencia del path completo
- % de fills vs órdenes emitidas (captura neta de PnL)

**Esto convierte la proyección NBA/NHL (proxy) en medición real del régimen Mundial en días.**

## Lo que se archiva (recuperable, no descartado)

| Artefacto | Estado |
|---|---|
| PR #11 (Part B implementada) | 🔒 Archivado recuperable |
| Diseño B1+A2 (fortress) | 🔒 Archivado con 4 correcciones cerradas |
| `orderbook_manager_v2.py` | 🔒 Intacto en main, no se ejecuta (flag false) |
| `USE_ORDERBOOK_MANAGER_V2` | 🔒 Permanece `false` indefinidamente |
| Cooldown determinista (Gap c) | 🔒 Diseño aprobado, no implementado |
| Wrapper anti-zombie (Gap b) | 🔒 Diseño aprobado, no implementado |

## Cuándo se desarchiva V2

**Condiciones para reactivar el trabajo en V2:**
1. Mundial en vivo muestra que el edge se comportó distinto a la proyección (se comprimió, contra toda la evidencia)
2. Instrumentación en vivo muestra que el 27% perdido tenía PnL desproporcionado
3. La fase eliminatoria del Mundial (mayor liquidez aún) introduce dinámica nueva no anticipada
4. Cambio estructural del mercado Kalshi (HFT entrando, market makers cambiando)

**Si esas condiciones ocurren:** desarchivar PR #11, cerrar los 6 puntos pendientes de B1+A2, pasar por review adversarial, implementar.

## Lo que NO se hace

❌ **NO se borra código de V2.** Queda en repo como referencia + opción de fallback.
❌ **NO se ejecuta Captura Neta de PnL ahora** — se mide en vivo con el Mundial.
❌ **NO se mergea PR #11.** Sigue como branch archivada.
❌ **NO se asume "REST gana"** — se mide en cada partido del Mundial.
❌ **NO se construye sin gate.** Patrón "diseño + implementación mismo turno" sigue prohibido (ver [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]]).

## Plan operativo para los 11 días pre-Mundial

### Hoy
1. ✅ Análisis cerrado, decisión tomada
2. ✅ Documentación en Obsidian + commit en repo

### Próximas sesiones (en orden, con gate diseño→review→implementación)
1. **Decisión de negocio:** umbral de edge para trigger (¿≥3c, ≥10c, ≥20c?). Pregunta tuya, no de los datos.
2. **Diseño en texto del Motor REST** — Claude Code presenta arquitectura completa, sin código
3. **Review adversarial** del diseño
4. **Implementación** con review del diff antes de merge
5. **Tests** de path completo offline
6. **Deploy demo** (no production) para validar antes del 11
7. **11-jun: kickoff Mundial** — bot vivo con instrumentación midiendo todo

## La pregunta de negocio pendiente

**¿Umbral de trigger?**
- ≥3c: capturar todo arb, alto volumen, riesgo de tradear ruido
- ≥10c: balance, sub-set significativo (ventana fácil de capturar por REST)
- ≥20c: solo los gordos (54% de NBA, los más valuables)

**Recomendación implícita de la data:** la banda 20c+ tiene 73.9% captura igual que el promedio. Si arrancás solo con ≥20c, perdés volumen pero capturás el dinero gordo. Si bajás a ≥10c o ≥3c, capturás más volumen pero te exponés a más ruido de ejecución.

**Esta es decisión TUYA, no de la data.** La data te dice qué pasa con cada umbral, no cuál elegir.

## Caveats persistentes (a tener presentes durante el Mundial)

1. **Régimen Mundial no medido** — toda la decisión usa NBA/NHL como proxy. Instrumentación en vivo confirma o refuta en días.

2. **Captura de ventana ≠ captura de fill** — el 73% asume detección instantánea + ejecución instantánea. La realidad será menor cuando descontes RTT.

3. **Profundidad del book** — el análisis mide persistencia del edge, no si el contrario sigue ahí al llegar la orden. Bajo competencia real, podría no estarlo.

4. **27% estructural perdido** — los relámpagos sub-50ms son irreducibles para REST. Si esa cola resulta tener PnL desproporcionado, considerar V2 selectivo para ciertos tickers.

## La validación del proceso

**Cadena completa de la saga V2:**

| Momento | Estado | Decisión |
|---|---|---|
| 25-may | V2 attempt #1 falla con 87 errores | Rollback |
| 27-may | V2 attempt #2 falla, smoking gun preservado | Logging fix valida |
| 30-may | V2 attempt #3 falla, causa raíz CAPTURADA | Pivot a Opción 2 |
| 31-may | Cuarto discovery desde código | Q2/Q3 identificadas |
| 01-jun | Auditoría PR #11 → 2 gaps críticos | B1+A2 propuesto, luego archivado |
| 01-jun | Pivot conceptual a Opción 2 | Aprobado pendiente benchmark |
| 02-jun (madrugada) | RTT real medido (33ms) | Datos para decidir |
| 02-jun (tarde) | Análisis edge — premisa de compresión refutada | Liquidez DILATA |
| 02-jun (noche) | Tasa de captura 73% | **DECISIÓN: Motor REST** |

**Cada paso destapó algo del anterior. El gate retuvo TODO en diseño. Ninguna línea de V2 fortress se escribió en vano porque nunca se implementó.**

## Para Lección 12

**Candidato a documentar como Lección 12:**

> *"La teoría dominante de un dominio puede no aplicar a tu microestructura específica. Medir tu mercado, no asumir el genérico."*

La microestructura HFT clásica predice compresión por liquidez. Kalshi (prediction market retail) muestra dilatación con factor 800× en la dirección opuesta. Heredar la teoría sin medir habría llevado a sobre-construir V2 fortress.

**Patrón confirmado:** medir > heredar.

## Métricas de éxito del Motor REST (a validar post-Mundial)

- **Captura efectiva ≥ 60%** del edge total observado (descontando RTT y profundidad)
- **0 incidentes de stale state** (porque no hay state mutable in-memory)
- **0 crash-loops** (porque no hay supervisor frágil)
- **Latencia path completo p95 < 200ms**
- **PnL positivo** en al menos 50% de partidos del Mundial

Si estas se cumplen → REST validado para futuros eventos, V2 puede borrarse.
Si fallan → desarchivar V2, evaluar híbrido.

## Links
- [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]] — el hallazgo central
- [[2026-06-02-DATA-tres-chequeos-edge-RTT-captura-73]] — análisis empírico completo
- [[2026-06-02-pivot-MUNDIAL-11jun-calendar-driven]] — pivot estratégico
- [[2026-06-02-sesion-cierre-saga-V2-motor-REST-decidido]] — sesión
- [[2026-06-02-Coolify-restart-cap-no-soportado]] — limitación operativa documentada
- [[2026-06-01-PIVOT-opcion-2-rest-hibrido]] — pivot conceptual (01-jun)
- [[2026-06-01-diseno-B1-A2-archivado-fortress-de-V2]] — fortress que se archivó
- [[2026-06-01-AUDITORIA-PR11-gaps-criticos-cazados]] — auditoría que disparó la pregunta de fondo
- [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]] — patrón de proceso que sigue aplicando
- [[kalshi-bot]]
