---
fecha: 2026-06-02
tipo: analisis-empirico-consolidado
proyecto: kalshi-bot
componente: validacion-arquitectura-REST-vs-V2
estado: ANALISIS-CERRADO
dataset: 7.965.702 filas (16-may → 2-jun)
tags:
  - data
  - kalshi-bot
  - 2026-06-02
  - empirico
  - benchmark
  - decision-arquitectura
---

# 📊 Tres chequeos + RTT real + tasa de captura — análisis empírico que cerró la decisión

> **El análisis completo que cerró la saga V2.** Cuatro mediciones sobre 7.9M eventos + RTT real medido. Numero final: **REST captura ~73% del edge en mercados líquidos**, robusto al peor caso de latencia. Decisión arquitectónica cuantificada, no intuida.

## La confesión sobre el "0.49ms"

**Primer benchmark (parse+eval offline):** reportó "mediana 0.49ms del read-path".

**Sospecha del adversarial:** *"0.49ms es físicamente imposible para un GET transcontinental a Kalshi."*

**Confirmación honesta de Claude Code:**
> *"Ese benchmark NO tocaba la red. Medía `cursor.execute(SELECT...).fetchall()` sobre la SQLite local del container — puro parseo de un snapshot ya materializado. Cero round-trip a Kalshi."*

**Importancia:** sin el catch del adversarial, se habría tomado una decisión arquitectónica usando un número que no medía la variable correcta. **Confirmation bias evitado por verificación.**

## RTT REAL medido — `get_orderbook()` contra Kalshi

**Método:** reutilizar el cliente de producción (`KalshiRestClient`, `httpx.AsyncClient` con keepalive, signer autenticado real), contra `https://api.elections.kalshi.com/trade-api/v2`, ticker vivo `KXNBA-26-SAS` (134 updates en 10min previos). 80 muestras warm, 0 errores.

| Métrica | Valor |
|---|---|
| RTT cold (incl. TCP+TLS handshake) | 102.3 ms |
| RTT warm min | 26.4 ms |
| **RTT warm mediana** | **33.4 ms** |
| RTT warm mean | 38.4 ms |
| **RTT warm p95** | **63.4 ms** |
| RTT warm p99 | 67.8 ms |

**Conclusiones operativas:**
- **Mediana 33ms** = costo de cada GET REST de orderbook
- **p95 64ms** = peor caso bajo latencia normal
- Path completo del Motor 1: GET (33ms) + parse+eval (<1ms) + GET para enviar orden (~33-50ms) = **~100-150ms por ciclo de decisión**

## Análisis de duración del edge — el dato principal

**Filtros aplicados (validados):**
- edge ≥ 3c (descartar ruido de +1/+2c)
- gap-cutoff 5s (si book sin updates >5s, cerrar ventana — eliminar artefactos de silencios)

**Sobre data completa: 236,680 ventanas calificadas**

| Duración | Ventanas | % |
|---|---|---|
| < 1ms | 44,655 | 18.9% |
| 1-10ms | 37,891 | 16.0% |
| 10-100ms | 26,062 | 11.0% |
| 100ms-1s | 31,584 | 13.3% |
| **1-10s** | **80,116** | **33.8%** |
| 10-60s | 15,190 | 6.4% |
| >60s | 1,182 | 0.5% |

- **Mediana global: ~243ms**
- Mean: ~3.4s (sesgada por la cola)
- p95: ~12.6s

**Catch metodológico crítico:** el gap-cutoff disparó **288,689 truncamientos** — casi 290 mil ventanas que el análisis crudo contaba como "arb vivo" eran books rancios entre silencios. **Sin el filtro habrías creído que la mediana era 25s** (confirmando falsamente la premisa de Gemini).

## Chequeo (a) — Curva liquidez → duración

**Pregunta:** ¿la liquidez comprime o dilata el edge?

**Método:** segmentar 202,480 ventanas (NBA+NHL) en deciles de liquidez (updates orderbook en 5min previos a la ventana).

| Decil | Liq med | Dur mediana | Peak med |
|---|---|---|---|
| 1 (ilíquido) | 11 | **5.0 ms** | 10c |
| 5 | 66 | 122.5 ms | 15c |
| 10 (líquido) | 783 | **4.06 s** | 15c |

**Relación: ~800× monótona en dirección OPUESTA a la teoría microestructura clásica.**

**Conclusión: liquidez DILATA el edge, no lo comprime.** Ver detalle en [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]].

## Chequeo control por magnitud — la dilatación es REAL

**Pregunta de robustez:** ¿quizás la dilatación es solo correlación con magnitud (ventanas líquidas son más gordas, edges gordos tardan más)?

**Método:** dentro de banda de magnitud **fija**, segmentar por quintiles de liquidez.

| Banda | Q1 dur_med | Q5 dur_med | Factor |
|---|---|---|---|
| 3-4c | 5 ms | 1,558 ms | ~290× |
| 5-9c | 6 ms | 2,553 ms | ~420× |
| **10-14c** | **5.6 ms** | **3,467 ms** | **~620×** |
| 15-19c | 10 ms | 2,598 ms | ~260× |
| 20c+ | 8 ms | 3,438 ms | ~450× |

**Conclusión:** la dilatación es **real e independiente de la magnitud**. Dentro de 10-14c (magnitud constante), liquidez ↑ → duración ↑ por factor 620×. **El driver dominante de la duración es la liquidez, no el tamaño.**

## Chequeo (b) — Sensibilidad del cutoff en soccer

**Pregunta:** ¿el "4s mediana del soccer" es real o artefacto del cutoff de 5s?

**Método:** barrer gap-cutoff (1s/2s/5s/10s) sobre las 53 ventanas de soccer.

| gap | n_ventanas | dur_med | p25 | p75 | dur_max | n>60s |
|---|---|---|---|---|---|---|
| 1s | 1,509 | 1,608 ms | 389 ms | 5,108 ms | 1,476 s | 49 |
| 2s | 302 | 6,077 ms | 1,454 ms | 15,584 ms | 4,064 s | 33 |
| **5s** | **53** | **4,028 ms** | 206 ms | 133,740 ms | 4,064 s | 16 |
| 10s | 38 | 905 ms | 99 ms | 6,257 ms | 5,606 s | 7 |

**Conclusión:** el "4s mediana" del soccer **NO es robusto** — es sensible al cutoff. La mediana real ronda 1.6s con cutoff agresivo.

**PERO la cola larga sobrevive a todos los cutoffs:** incluso con cutoff 1s, quedan 49 ventanas >60s con updates dentro de cada segundo. Esos son edges genuinamente persistentes, no artefacto.

**Soccer histórico tiene cola larga real, solo que menos extensa que el número inflado sugería.**

## Segmentación por deporte — perfiles radicalmente distintos

| Deporte | Ventanas | Mediana dur | p95 | edge ≥10c | edge ≥20c |
|---|---|---|---|---|---|
| **NBA** | 146,170 | **769 ms** | 16.0 s | 22% | **54%** |
| NHL | 55,913 | 7.7 ms | 6.4 s | 48% | 11% |
| Soccer (UCL) | 53 | 4,028 ms* | ~50min* | 28% | 13% |
| MLB | 34,657 | 402 ms | 6.4 s | **0%** | **0%** |

*Soccer: sensible al cutoff, dirección>número.

**Hallazgos clave:**

1. **NBA es el filón histórico.** 146K ventanas, mediana 769ms (capturable por REST), 54% llega a ≥20c (gordos).
2. **NHL es trampa de velocidad.** Mediana 7.7ms. REST con RTT 33ms ya perdió 4× sobre la mediana. **Inhospitable para REST.**
3. **Soccer:** ya en zona líquida-lenta (chequeo b), Mundial profundizará.
4. **MLB-futuros = ruido.** 0% ≥10c sobre 30 tickers y >1.5M filas. Pico máximo +2c (NYY). Son mercados de **temporada** ("LAD gana"), no partido-a-partido. Descartado definitivamente.

## Tasa de captura REST — el número que cierra la decisión

**Pregunta operativa:** ¿qué % del edge en mercados líquidos captura REST puro?

**Método:** dentro de Q5 (alta liquidez) de cada banda de magnitud, qué fracción de ventanas dura > umbral (capturable por REST con su RTT).

| Banda | Q5_n | liq_med | cap >100ms | cap >64ms | dur_med |
|---|---|---|---|---|---|
| 3-4c | 1,324 | 147 | 63.1% | 64.4% | 1,558 ms |
| 5-9c | 10,447 | 204 | 70.8% | 72.1% | 2,553 ms |
| 10-14c | 8,553 | 239 | 74.6% | 76.0% | 3,466 ms |
| 15-19c | 3,304 | 162 | 70.0% | 70.8% | 2,598 ms |
| **20c+** | **16,904** | 228 | **73.9%** | 74.9% | 3,438 ms |
| **Pooled** | **40,532** | — | **72.6%** | **73.7%** | — |

### Las tres conclusiones operativas

**1. REST captura ~73% del edge en mercados líquidos.** Robusto entre 70-75% en todas las bandas salvo la más chica (3-4c, 63%).

**2. NO hay penalización por magnitud.** La banda más valiosa (20c+) captura 73.9%, igual que el promedio. **El dinero gordo es tan capturable por REST como el chico.**

**3. El peor caso de latencia NO degrada significativamente.** Diferencia entre umbral 100ms y p95 real 64ms: ~1 punto porcentual. **No hay acantilado entre 64-100ms.** Operar al p95 bajo carga sigue capturando ~74%.

### El 27% perdido es estructural e irreducible

Son edges sub-50ms — la cola que **ni V2 captura bien** porque son los más efímeros. Reducirlo a milisegundos requeriría co-ubicación o algo más extremo que WS.

**Conclusión:** V2 no te daría 27% más de captura. Te daría una fracción de ese 27%, peleando por los arbs más imposibles.

## Caveats honestos (la honestidad de Claude Code valida la solidez)

1. **NBA/NHL es proxy del Mundial.** No contiene el régimen de liquidez real del Mundial. Soccer-de-Mundial-global no es NBA-de-finales.

2. **Captura de ventana ≠ captura de fill.** El RTT (33-64ms) consume parte de la duración. La captura efectiva de PnL es **algo menor** que el 73% de ventanas — habría que descontar RTT del inicio de cada ventana.

3. **Mide persistencia del edge, no profundidad del book.** Asume que el contrario sigue ahí al llegar tu orden. Bajo competencia real, podría no estar.

4. **53 ventanas de soccer es muestra chica.** La dirección (soccer ya está en zona líquida-lenta) es sólida, el número exacto no.

5. **El régimen del Mundial es único.** El evento mismo va a corregir cualquier proyección en los primeros partidos. Por eso: **instrumentar en vivo** desde el primer partido.

## Por qué NO se corre el último chequeo de PnL neto ahora

Claude Code ofreció: "descontar RTT del inicio de cada ventana, medir qué fracción sigue abierta cuando llegaría la orden — el % realmente ejecutable, no solo detectable."

**Decisión: NO ahora.** Tres razones:
1. La decisión "REST vs V2" ya está cuantificada con el 73%. La captura neta de PnL la afina, no cambia la dirección.
2. Aunque la captura neta fuera 65%, REST sigue siendo la respuesta correcta — el 27-35% perdido es la cola imposible.
3. **La captura neta se mide EN VIVO con el Mundial**, no sobre proxies. La instrumentación del Motor REST desde el primer partido da el número real del régimen real, que vale infinitamente más que la estimación sobre NBA/NHL.

## Estado del análisis

✅ **CERRADO.** Tres chequeos completos, RTT real medido, tasa de captura cuantificada, dirección clara.

**Decisión arquitectónica habilitada:** Motor REST puro para el Mundial, V2 archivado-recuperable.

Ver [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]].

## Links
- [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]] — el hallazgo central que invierte la premisa
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — decisión arquitectónica final
- [[2026-06-02-pivot-MUNDIAL-11jun-calendar-driven]] — el pivot estratégico
- [[2026-06-02-sesion-cierre-saga-V2-motor-REST-decidido]] — sesión
- [[2026-06-01-benchmark-rest-spec-criterio-decision]] — spec del benchmark que motivó este análisis
- [[2026-06-01-diseno-B1-A2-archivado-fortress-de-V2]] — fortress archivada
- [[kalshi-bot]]
