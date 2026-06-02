---
fecha: 2026-06-02
tipo: pivot-estrategico-calendario
proyecto: kalshi-bot
componente: prioridad-deportes
estado: APROBADO
trigger: Mundial 2026 inicia 11-jun
tags:
  - pivot
  - kalshi-bot
  - 2026-06-02
  - calendario
  - mundial
  - estrategia
---

# 🌍 Pivot Mundial 11-jun — el calendario cambia el filón

> El Mundial 2026 (mayor evento de liquidez global del año) empieza el **11 de junio**. Eso cambia qué deporte importa, refuta la urgencia de optimizar V2 para NBA, y se alinea perfectamente con la decisión de Motor REST (el régimen líquido-lento que el Mundial introduce favorece REST sobre V2).

## El insight que cambió el calendario operativo

**Antes del 02-jun:** "El filón es NBA. NBA tiene edges de 769ms — apretado para REST, justifica V2."

**Post-02-jun:**
1. NBA termina (playoffs/finales en su fin)
2. MLB-futuros descartado (0% ≥10c)
3. **Mundial empieza el 11-jun** y va a inundar de liquidez los mercados de soccer
4. Soccer histórico ya está en zona líquida-lenta (chequeo b)
5. El Mundial profundiza esa dirección → edges más largos, más gordos → favorece REST

## Por qué el Mundial cambia todo

### El Mundial NO es un evento más

| Característica | Implicación |
|---|---|
| Mayor evento deportivo global | Volumen retail masivo |
| Atrae market makers algorítmicos globales | Profundidad de book inédita |
| Múltiples partidos diarios | Mercados concurrentes |
| Mes completo de duración | Captura sostenida posible |
| Mercados binarios claros (gana/no gana) | Apto para arbitraje binario |

### Comparación con NBA (el filón histórico)

| Atributo | NBA finales | Mundial |
|---|---|---|
| Volumen mercado/día | Alto | **Masivo** |
| Duración del evento | Series 4-7 partidos | 1 mes |
| Concurrencia de mercados | Pocos partidos/día | **Múltiples concurrentes** |
| Profundidad del book | Media-alta | **Esperado: muy alta** |
| Edge mediano histórico | 769ms (NBA) | Proyectado: segundos (soccer líquido) |

## Por qué esto valida REST sobre V2

**El argumento técnico cierra solo:**

1. **Liquidez DILATA el edge** (hallazgo 02-jun, ~800×)
2. **Soccer histórico ya está en techo de liquidez NBA** (53 ventanas, liq mediana 3,114)
3. **Mundial empuja soccer MÁS allá en esa dirección** → edges aún más largos
4. **REST con RTT 33ms captura cómodo edges de segundos**
5. **V2 fortress sería sobre-ingeniería** para un régimen que no necesita sub-ms

**Si V2 era cuestionable para NBA, es claramente innecesario para Mundial.**

## La trampa del calendario (cazada a tiempo)

**Sin el análisis del 02-jun, podrías haber hecho esto:**
- 02-jun a 10-jun: apurar V2-light NBA-only contra reloj
- 11-jun: Mundial empieza, NBA termina
- 11-jun: descubrir que la herramienta optimizada para NBA es la equivocada para el filón del mes

**Riesgo evitado:** construir la herramienta para el deporte que se va, contra reloj del deporte que viene.

**La presión del calendario era real, pero la respuesta correcta NO era "construir más rápido lo planeado." Era "re-responder la pregunta del filón con la nueva realidad."**

## Hallazgos por deporte que sustentan el pivot

| Deporte | Estado para Mundial |
|---|---|
| **Soccer (Mundial 11-jun)** | 🎯 **FILÓN PRIMARIO** — zona líquida-lenta, edges gordos esperados |
| NBA | 🔚 Temporada terminando |
| NHL | ⚠️ Edges relámpago (7.7ms mediana), REST inviable |
| MLB-futuros | ❌ Ruido (0% ≥10c) |
| MLB partido-individual | ⏳ NO MEDIDO — pendiente para análisis post-Mundial |

## Lo que el bot debería hacer durante el Mundial

### Suscripción WS
- Tickers de los mercados de soccer del Mundial (a definir según calendario de partidos)
- Solo feed de ticker (no orderbook deltas — sin riesgo de desync)

### Trigger
- Cuando ticker muestre spread crudo elegible
- Umbral de edge (decisión pendiente: ≥3c, ≥10c, ≥20c)

### Captura
- GET REST orderbook → parse → evaluar `detect_binary_arb` → ejecutar si confirma

### Instrumentación obligatoria (Lección 9 #1)
- Cada ventana de edge: duración real, magnitud, capturada vs perdida
- Latencia real del path completo
- % de fills vs órdenes emitidas

**Esta instrumentación es lo que CONFIRMA o REFUTA la proyección NBA-como-proxy en días.**

## Caveats del pivot

### 1. El Mundial es un régimen no medido
Toda la decisión usa NBA/NHL como proxy. El soccer de Mundial podría:
- Comportarse como NBA (proyección base — REST gana)
- Comportarse distinto por dinámica global única (régimen no anticipado)

**Por eso: instrumentar en vivo desde el primer partido.** El evento mismo da el dato real.

### 2. MLB partido-individual no se midió
Descartamos KXMLB porque son mercados de temporada ("LAD gana"). No medimos mercados de partido individual (si Kalshi los tiene). Si durante el Mundial el bot deja de capturar oportunidades, MLB partido-a-partido es una opción a explorar para mantener volumen.

### 3. Soccer histórico es 53 ventanas
Muestra chica. La dirección "soccer está en zona líquida-lenta" es robusta (chequeo b sobrevive a todos los cutoffs); el número exacto de duración mediana NO es robusto.

## El cronograma operativo de los 11 días

| Día | Acción |
|---|---|
| 02-jun | ✅ Análisis cerrado, decisión Motor REST |
| 03-04 jun | Decisión de negocio del umbral (≥3c vs ≥10c vs ≥20c) |
| 03-04 jun | Diseño en texto del Motor REST → review adversarial |
| 04-06 jun | Implementación con gate, review del diff |
| 06-08 jun | Tests offline del path completo |
| 08-10 jun | Deploy demo (si hay infraestructura), validación pre-Mundial |
| **11-jun** | **🎯 KICKOFF MUNDIAL — bot vivo con instrumentación midiendo** |
| 11-jun → fin Mundial | Monitoreo + ajustes según data real |

## Por qué este pivot es coherente con todo lo aprendido esta semana

**Validación de patrones:**

1. **"Medir antes de decidir"** — el calendario no se asumió, se identificó como restricción real
2. **"Tests verdes ≠ funciona en producción"** — proyección NBA ≠ régimen Mundial, instrumentación en vivo necesaria
3. **"Cada capa de robustez es código que puede fallar"** — Motor REST simple > V2 fortress compleja
4. **"La presión del calendario no debe acelerar lo planeado, debe replantear lo planeado"** — pivot, no apuro

## Decisión pendiente que define la implementación

**¿Umbral de trigger del edge?**

La pregunta de negocio que la data NO responde por sí sola:
- **≥3c:** capturar todo, alto volumen, riesgo de tradear ruido
- **≥10c:** balance (28% de ventanas soccer históricas)
- **≥20c:** solo gordos (13% soccer histórico, 54% NBA — los más valuables)

Esta es tu decisión, Noel. La data dice qué pasa con cada umbral; vos decidís cuál tradear.

## Status al cierre del 02-jun

✅ Análisis cerrado (tres chequeos sobre 7.9M filas)
✅ Decisión arquitectónica aprobada (REST)
✅ Pivot calendario validado (Mundial = filón)
✅ V2 archivado recuperable (PR #11 intacto)
⏳ Decisión de negocio del umbral
⏳ Diseño del Motor REST en texto
⏳ Implementación con gate

**Capital sigue en cero. `TRADING_ENABLED=false` indefinidamente hasta validar el Motor REST en demo + decisión consciente de activar trading.**

## Links
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — decisión arquitectónica completa
- [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]] — hallazgo central que sustenta REST
- [[2026-06-02-DATA-tres-chequeos-edge-RTT-captura-73]] — análisis empírico
- [[2026-06-02-sesion-cierre-saga-V2-motor-REST-decidido]] — sesión
- [[kalshi-bot]]
