---
fecha: 2026-06-02
tipo: sesion-conmigo
proyecto: kalshi-bot
ia: Claude + Claude Code + Gemini (CTO)
modelo: multi-agent workflow
duracion: cierre-de-saga-V2
tags:
  - sesion-conmigo
  - kalshi-bot
  - 2026-06-02
  - cierre-saga
  - decision-final
  - motor-rest
---

# 02-jun — CIERRE DE LA SAGA V2: Motor REST decidido con números

> **La sesión más decisiva.** Empezó con el benchmark REST escrito y el RTT real medido (cazando el "0.49ms" como medición incorrecta). Continuó con un análisis empírico que **invirtió la premisa central de Gemini sobre microestructura**. Terminó con la decisión arquitectónica cuantificada: **Motor REST puro para el Mundial, V2 archivado, 73% captura validada**.

## Contexto al inicio del día

- V1 sano corriendo en producción
- PR #11 congelado con 2 gaps cazados (01-jun)
- B1+A2 diseñado pero archivado (sobre-ingeniería detectada)
- Pivot a Opción 2 (REST híbrido) aprobado pendiente benchmark
- Spec del benchmark lista
- Patrón "diseño+implementación en mismo turno" nombrado y corregido

## La cadena de eventos del día

### 1. Benchmark REST escrito (02-jun madrugada)
Claude Code construyó `scripts/bench_rest_arb_path.py`:
- Path completo (snapshot → parse → derivar asks → `detect_binary_arb`)
- Concurrencia sostenida (N tickers × rate-hz × duration)
- Mercados reales (parametrizable)
- Verdicto automático (P99<150ms + 429<1% → Opción 2)
- Read-only, aislado en `scripts/`

**Pero no podía correrlo desde el entorno** (sin credenciales Kalshi).

### 2. Coolify cap restart cerrado (no implementar)
Agente web verificó: Coolify hardcodea `restart: unless-stopped`, no Swarm, no cap nativo. Propuesta de "wrapper de entrypoint" rechazada porque **era A2 con otro nombre** — exactamente la sobre-ingeniería que el pivot a REST viene a podar.

Documentado en [[2026-06-02-Coolify-restart-cap-no-soportado-A2-descartado]].

### 3. Tickers reales identificados — schema validado
Claude Code verificó:
- DB pasó de 7.7M → 7.96M filas en ~11h (captura fluyendo)
- **Schema real:** columna es `ticker`, NO `market_ticker`; timestamp es `received_at`, NO `ts`
- Mi query original (con `market_ticker/ts`) habría dado error o basura silenciosa
- Code lo corrigió contra DB real antes de ejecutar (patrón Lección 8)

**Tickers más activos identificados:**
- NBA: KXNBA-26-NYK (2418), KXNBA-26-SAS (2245)
- NHL: KXNHL-26-CAR (475), KXNHL-26-VGK (398)
- MLB: <105 (un orden de magnitud menos)

### 4. La confesión sobre "0.49ms" (catch crítico)
**Primer benchmark reportó:** mediana 0.49ms del read-path.

**Sospecha del adversarial:** *"0.49ms es físicamente imposible para un GET transcontinental."*

**Claude Code confirmó:**
> *"Ese benchmark NO tocaba la red. Medía `cursor.execute(SELECT...).fetchall()` sobre SQLite local. Cero round-trip a Kalshi."*

Sin el catch, la decisión arquitectónica se habría tomado sobre un número que no medía la variable correcta.

### 5. RTT real medido — el número que importaba
- KXNBA-26-SAS, 80 muestras warm, 0 errores
- **Mediana 33.4ms, p95 64ms, p99 67.8ms**
- Cold (con TCP+TLS handshake): 102.3ms

**Esto sí era el dato real.** RTT warm de 33ms = costo real de cada GET REST.

### 6. Análisis duración del edge sobre 7.9M eventos
Aplicando filtros correctos (edge≥3c, gap-cutoff 5s):
- 236,680 ventanas calificadas
- Mediana global: 243ms
- 290 mil truncamientos del gap-cutoff (artefactos eliminados)

**Sin el filtro habríamos creído que el edge dura ~25s** (confirmando falsamente la premisa de Gemini).

### 7. Segmentación por deporte — perfiles radicales
- **NBA:** 146K ventanas, mediana 769ms, 54% ≥20c (filón histórico)
- **NHL:** 56K, mediana 7.7ms (relámpago, REST inviable)
- **Soccer (UCL):** 53 ventanas, ya en zona líquida-lenta
- **MLB-futuros:** 0% ≥10c (ruido — son mercados de temporada)

### 8. 🔥 EL HALLAZGO INVERTIDO
Curva liquidez → duración del edge (NBA+NHL deciles):
- Decil más ilíquido (liq~11): edge mediano **5ms**
- Decil más líquido (liq~783): edge mediano **4.06s**
- **Relación ~800× MONÓTONA en dirección OPUESTA a la teoría microestructura clásica**

**Gemini predijo compresión por liquidez. La data probó dilatación.** Ver [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]].

### 9. Chequeo control por magnitud — dilatación REAL
Dentro de banda 10-14c (magnitud fija):
- Q1 liquidez: 5.6ms duración
- Q5 liquidez: 3,467ms duración
- **Factor 620×** moviéndote solo en liquidez

**Conclusión:** la dilatación es real e independiente de la magnitud. Driver dominante = liquidez.

### 10. Chequeo sensibilidad cutoff — soccer "4s" era artefacto
Barrido del gap-cutoff en soccer:
- 1s → 1,509 ventanas (×28), mediana 1.6s
- 5s → 53 ventanas, mediana 4.0s
- 10s → 38 ventanas, mediana 0.9s

**El número puntual no es robusto.** Pero la **cola larga sobrevive a todos los cutoffs** (49 ventanas >60s incluso con cutoff 1s).

**Soccer histórico tiene cola larga real, solo que la mediana específica era artefacto del cutoff.**

### 11. PIVOT MUNDIAL identificado
**Insight estratégico:** "Mundial 11-jun. El edge de 4 segundos no necesita V2/WebSocket. Y si el filón próximo es el Mundial, V2-light NBA-only sería herramienta equivocada para deporte equivocado."

Ver [[2026-06-02-pivot-MUNDIAL-11jun-calendar-driven]].

### 12. Análisis del Mundial validado por chequeo (a)
**La dilatación independiente de magnitud + soccer ya en zona líquida-lenta** = el Mundial empujará soccer **más** hacia edges largos, no hacia microsegundos.

**Premisa de compresión de Gemini queda DEFINITIVAMENTE refutada para el escenario del Mundial.**

### 13. La tasa de captura REST — el número final
Q5 (alta liquidez), por banda de magnitud:
- 3-4c: 63% captura
- **10-14c: 75% captura**
- **20c+: 74% captura** (la banda más valiosa, sin penalización por tamaño)
- **Pooled: ~73% captura a 100ms / ~74% a 64ms (p95 RTT)**

**Conclusiones operativas:**
1. REST captura ~73% del edge en mercados líquidos
2. NO hay penalización por magnitud
3. El peor caso de latencia NO degrada
4. El 27% perdido es estructural — ni V2 lo captura bien

### 14. DECISIÓN FINAL
✅ **Motor REST puro para el Mundial**
✅ **V2 archivado en PR #11 (recuperable)**
✅ **Detección por ticker WS (liviano) + ejecución REST**
✅ **Instrumentación obligatoria desde el primer partido**

Ver [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]].

## Workflow capa por capa observado HOY

| Capa | Rol del día |
|---|---|
| **Claude Code** | Construyó benchmark; verificó schema contra DB real (corrigió my query); confesó honestamente el 0.49ms NO mide red; midió RTT real; ejecutó tres chequeos sobre 7.9M; respondió cada pregunta con número + caveat. **Honestidad técnica ejemplar.** |
| **Gemini (CTO)** | Propuso compresión por liquidez (teoría refutada); aceptó la refutación cuando la data la probó falsa; propuso Mundial como pivot calendar-driven. |
| **Yo (Claude adversarial)** | Cacé el 0.49ms como medición incorrecta; identifiqué trampa del "top 25% soccer ilíquido"; reformulé el chequeo correctamente (NBA como muestra con rango de liquidez real); identifiqué Coolify wrapper como "A2 con otro nombre"; recomendé "no corras la última pasada de PnL neto sobre proxies — se mide en vivo con Mundial". |
| **Yo (Noel)** | Pidi los tres chequeos en la misma tanda. Confirmé NBA/NHL como tickers (no MLB) porque "están en temporada". Acepté la decisión de no correr PnL neto ahora. Aprobé Motor REST para Mundial. |

## Patrones validados HOY (acumulando desde el 25-may)

1. **"Verificar contra la realidad antes de actuar"** — el catch del 0.49ms
2. **"Datos > intuición"** — Gemini predijo, la data invirtió la predicción
3. **"Teoría dominante puede no aplicar a tu microestructura específica"** (candidato Lección 12)
4. **"Verificar contra patrones ya descartados"** — Coolify wrapper = A2 reintroducido
5. **"Una solución para un componente archivado es trabajo innecesario"** — wrapper rechazado
6. **"Filtros metodológicos cambian las conclusiones"** — gap-cutoff 5s eliminó 290K truncamientos
7. **"Cuando hay dos hipótesis, la que tiene 800× evidencia gana"** — dilatación, no compresión

## Anti-patrones cazados HOY

1. **Medir el proxy en vez de la variable** (0.49ms no era el RTT)
2. **Heredar teoría sin medir el dominio** (microestructura HFT no aplica a Kalshi)
3. **"A2 con otro nombre"** (wrapper de entrypoint = sobre-ingeniería)
4. **"Refinar el número sobre proxies cuando el evento real está a días"** (PnL neto NBA cuando Mundial empieza en 9 días)
5. **Confundir captura de ventana con captura de fill** (caveat persistente — instrumentar en vivo)

## El arco completo de la saga (25-may → 02-jun)

```
25-may  V2 attempt #1   → 87 errores      → rollback
27-may  V2 attempt #2   → 4 ERROR         → rollback + logging fix valida
30-may  V2 attempt #3   → 1 OrderbookDesyncError → rollback + smoking gun
31-may  Cuarto discovery → Q2 (bootstrap) + Q3 (recovery sin convergencia)
31-may  Misterio Part A resuelto → patrón "diseño+impl mismo turno" nombrado
01-jun  Auditoría PR #11 → 2 gaps críticos cazados (sin auditoría → cuarta ventana fallida)
01-jun  B1+A2 propuesto → crash-loop destapado
01-jun  PREGUNTA DE FONDO: "¿V2 vale toda esta complejidad?"
01-jun  Pivot conceptual a Opción 2 (Gemini propone, aprobado pendiente benchmark)
02-jun  Benchmark construido + RTT real medido (33ms)
02-jun  Tres chequeos sobre 7.9M eventos
02-jun  PREMISA DE COMPRESIÓN REFUTADA (liquidez DILATA ~800×)
02-jun  Mundial 11-jun identificado como filón
02-jun  Tasa de captura 73% medida en Q5
02-jun  🎯 DECISIÓN: Motor REST puro, V2 archivado
```

**Cero líneas de la fortaleza V2 en main que no hayan sido revisadas retroactivamente.** El gate retuvo todo en diseño durante toda la saga.

## Para Lección 12 (candidato)

**"La teoría dominante de un dominio puede no aplicar a tu microestructura específica. Medí tu mercado, no asumas el genérico."**

Microestructura HFT clásica predice compresión por liquidez. Tu data probó dilatación con factor 800× en dirección opuesta. Si hubieras heredado la teoría sin medir, habrías construido V2 fortress (semanas de trabajo) contra un problema que no existe en tu mercado.

**Patrón:** medir > heredar.

## Decisiones pendientes (próxima sesión)

1. **Umbral de edge para trigger** (≥3c vs ≥10c vs ≥20c) — decisión de NEGOCIO, no técnica
2. **Diseño en texto del Motor REST** — con gate diseño→review→implementación
3. **Implementación con review del diff** antes de merge
4. **Tests offline del path completo**
5. **Deploy demo** (no production) para validar pre-Mundial
6. **11-jun: kickoff** — bot vivo con instrumentación midiendo todo

## Métricas de éxito post-Mundial (que decidirán si REST queda definitivo)

- Captura efectiva ≥60% del edge (descontando RTT y profundidad)
- 0 incidentes de stale state (no hay state mutable in-memory)
- 0 crash-loops (no hay supervisor frágil)
- Latencia path completo p95 < 200ms
- PnL positivo en ≥50% de partidos

Si estas se cumplen → REST validado, V2 puede borrarse.
Si fallan → desarchivar V2, evaluar híbrido.

## Lo nuevo del 02-jun para NotebookLM

**6 archivos nuevos (todos con prefijo `2026-06-02-`):**
- [[2026-06-02-DATA-tres-chequeos-edge-RTT-captura-73]]
- [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]]
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]]
- [[2026-06-02-pivot-MUNDIAL-11jun-calendar-driven]]
- [[2026-06-02-Coolify-restart-cap-no-soportado-A2-descartado]]
- Esta sesión

## El balance honesto al cierre

**9 días intensos terminan con:**
- V2 fortress archivada (no construida sin necesidad)
- Motor REST decidido con números (no por intuición)
- Premisa de Gemini refutada por tu propia data (800× en dirección opuesta)
- Patrón meta nombrado y corregido ("diseño+impl mismo turno")
- 11 días para construir Motor REST simple con gate completo antes del Mundial
- V1 corriendo sano y estable durante toda la saga

**Y la lección más importante de toda la semana:**

> *"Saber distinguir entre 'agregar otra defensa' y 'el approach mismo está mal' es un movimiento maduro. Y a veces, la teoría dominante del dominio NO aplica a tu microestructura específica — solo lo descubrís midiendo."*

El gate funcionó. La medición sustituyó la asunción. El Motor REST simple ganó a la fortaleza V2 compleja porque los números así lo dijeron — no porque sea más simple.

## Links
- [[2026-06-02-DATA-tres-chequeos-edge-RTT-captura-73]]
- [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]]
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]]
- [[2026-06-02-pivot-MUNDIAL-11jun-calendar-driven]]
- [[2026-06-02-Coolify-restart-cap-no-soportado-A2-descartado]]
- [[2026-06-01-sesion-01jun-auditoria-pr11-pivot-opcion-2]] — sesión anterior
- [[2026-06-01-AUDITORIA-PR11-gaps-criticos-cazados]] — auditoría que disparó la pregunta de fondo
- [[2026-06-01-PIVOT-opcion-2-rest-hibrido]] — pivot conceptual del 01-jun
- [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]] — patrón meta corregido
- [[kalshi-bot]]
