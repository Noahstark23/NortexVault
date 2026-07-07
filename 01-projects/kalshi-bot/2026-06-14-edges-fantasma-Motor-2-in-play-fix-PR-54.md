---
tipo: sesion
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-14
tags:
  - kalshi
  - motor-2
  - consensus
  - mundial
  - bug
  - edge-fantasma
  - in-play
  - pre-match-discipline
  - 2026-06-14
estado: shadow-live (sin capital) — debugging de señales
frente: "Edges fantasma de Motor 2 cazados y filtrados (PR #54). Muestra limpia empieza"
sesion: "Mundial día 4 — depuración de edges fantasma de Motor 2"
---

# 2026-06-14 — Edges fantasma de Motor 2 (consensus) y su fix

## TL;DR

El feed real (día 2 de Motor 2 live) generó **146 ventanas consensus**, pero **8 eran falsos
positivos monstruosos** (48-51pp) — todos del mismo partido **GER vs CUW jugándose EN VIVO**.
Causa: mercado in-play → Kalshi colapsa el outcome perdedor, odds API stale → **spread fantasma
de ~50pp**. Se agregaron **3 guardarraíles en capas** (PR #54). **Capital intacto** — nunca se
apostó. La muestra para el gate de decisión arranca limpia desde ahora.

---

## 📊 La data que destapó el bug

`EdgeWindow consensus` pasó de **1 → 146 filas**, todas >3pp. Distribución **bimodal**:

| Bucket | Cantidad | Veredicto |
|---|---|---|
| **3-5pp** | 137 | ✅ Sanas, plausibles — lo esperado |
| **48-51pp** | 8 | 🚩 Monstruos imposibles |

**Las 8 anomalías:**
- Todas del mismo ticker family: `KXWCGAME-26JUN14GERCUW` (Alemania vs Curazao)
- Outcomes CUW (Curazao gana) y TIE (empate)
- Ventana temporal acotada: **18:40-18:57 UTC** (~17 min)
- Coincidencia exacta con la **fase in-play del partido**

**Por qué se sabe que son falsos positivos sin verificar la causa:** un edge neto de 51pp =
duplicar capital sin riesgo. **Económicamente imposible** en un mercado binario líquido con
participantes informados. Si fuera real, lo habrían arbitrado en segundos.

---

## 🔍 Causa raíz (mecanismo)

### Spread fantasma por mercado in-play

Cuando el partido **arranca a jugarse**:

1. **Kalshi reacciona al juego en vivo** → cuando Alemania empieza a dominar, el outcome
   perdedor (CUW gana) y el empate (TIE) **colapsan a precios ~0/100** rápidamente. El BBO de
   Kalshi refleja la realidad emergente del partido.

2. **The Odds API sigue sirviendo líneas pre-partido o in-play degeneradas.** El feed no se
   actualiza con la velocidad/precisión que Kalshi sí tiene. La línea consensus de Pinnacle
   sigue cerca de la línea pre-partido.

3. **El detector compara las dos** → diferencia gigantesca → "edge de ~50pp" → guardar
   EdgeWindow.

**El gap real:** faltaba un filtro de **mercado iniciado / resuelto / stale**. El núcleo
matemático estaba bien (las 137 señales de 3-5pp lo prueban). Era ruido de borde, no bug
estructural.

### Por qué esto es coherente con la lógica de la estrategia

Motor 2 es **comparación de consenso pre-match** vs precio de Kalshi. La hipótesis del edge es:
*"Kalshi se atrasa vs los sportsbooks profesionales pre-kickoff."*

**Después del kickoff esa hipótesis se rompe** — ahora Kalshi tiene MÁS información en tiempo
real (el juego en vivo) que la línea consensus pre-partido. La comparación deja de tener
sentido. Es como tratar de arbitrar el precio de un boleto de avión vs el de un asiento ya
ocupado.

---

## 🛠️ El fix — PR #54 (3 guardarraíles en capas)

| # | Guardarraíl | Dónde | Qué hace |
|---|---|---|---|
| 1 | **Pre-match** *(principal)* | `detector.find_signals` | solo evalúa partidos con `commence_time > now` (no iniciados) |
| 2 | **Mercado resuelto** | `sources._parse_event_quotes` | saltea markets con `status != open/active` |
| 3 | **Cap plausibilidad** | `MAX_PLAUSIBLE_EDGE = 0.15` | descarta y loguea cualquier edge >15pp como artefacto |

### Por qué 3 capas y no 1

**Defense in depth:** cada capa cubre un agujero distinto que las otras pueden no detectar:

- **Capa 1 (pre-match)** ataca la causa raíz: Motor 2 es estrategia pre-match, así que filtrá
  todo lo que no es pre-match.
- **Capa 2 (mercado resuelto)** captura el caso donde Kalshi marca un mercado como resuelto/cerrado
  antes que `commence_time` lo indique (la fuente de verdad de Kalshi tiene prioridad).
- **Capa 3 (cap plausibilidad)** es la red de seguridad — *"si nada de lo anterior te atrapa
  pero el edge resulta >15pp en un binario líquido, es data podrida por definición"*. Loguea y
  descarta sin necesidad de identificar la causa específica.

**Las tres juntas:** para que se cuele un falso positivo monstruo se necesitan los tres filtros
fallando al mismo tiempo, lo cual implicaría un bug nuevo en cada capa. Si una capa falla, las
otras dos siguen activas.

### Tests + fixtures

- **3 tests nuevos** cubriendo cada guardarraíl
- **Fixtures pasadas a fecha RELATIVA a `now`** — evita flake por reloj congelado, **misma
  clase de bug que el #52 del throttle de alertas**. Cuando se hardcodea una fecha en fixture,
  cualquier test que dependa del tiempo presente queda susceptible al paso del tiempo. Fixtures
  relativas a `now` eliminan toda una clase de flakes.
- **443 passed** · ruff/format limpios

---

## 🧠 Lección clave (para el cerebro)

> **El edge de consenso SOLO es válido pre-kickoff.**

Comparar el precio de Kalshi (que reacciona al juego en vivo) contra una línea de sportsbook
(pre-partido o in-play degenerada) **después del kickoff** produce basura. Motor 2 es una
estrategia **pre-match**. Esto es estructural, no una optimización — la hipótesis del edge
solo se sostiene antes del kickoff.

**Regla nueva como heurística operativa:**

> *"Ningún edge >15pp es real en un binario líquido — es data podrida."*

Esta heurística es independiente de la causa específica del fantasma (in-play, mercado cerrado,
feed congelado, sportsbook sin actualizar). Cualquier fuente de podredumbre futura genera edges
absurdos; el cap los caza todos.

---

## ✅ Estado y próximos pasos

- [x] Diagnóstico confirmado (8 monstruos = GER/CUW in-play, 17 min de ventana)
- [x] Fix con 3 guardarraíles (#54, 443 passed)
- [x] Tests con fixtures relativas a `now` (evita futuro flake)
- [ ] **Mergear #54 + redeploy** → de acá en más solo se graban filas **pre-match y <15pp**
- [ ] Dejar correr **24-48h con data limpia**
- [ ] `python scripts/motor2_consensus_report.py --hours 48` → decidir encendido sobre señales reales
- [ ] **Gate de decisión:** ¿puñado consistente de edges 3-5pp NO marginales en varios partidos?
  - **Sí** → encender `TRADING_ENABLED=true` + `ACTIVE_CAPITAL_USD=100` (frenos: $5/trade, $25
    exposición, stop diario −$3)
  - **No** → no encender, plata a salvo, recalibrar

---

## 🔒 Seguridad (sin cambios)

- `TRADING_ENABLED=false`
- `trades=0`
- `risk_events=0`
- kill-switches=0
- **Cero capital en riesgo**

**Infra sana:**
- 1.25M tickers evaluados
- Frescura 200/200
- Shadow multi-outcome en 688 señales
- Heartbeat REST creciendo

---

## El patrón meta que esto refuerza

> **"Construir bien la cosa equivocada es peor que construir mal la cosa correcta" — y un
> corolario: construir bien la cosa correcta TAMBIÉN destapa que el régimen real difiere de la
> hipótesis idealizada.**

El detector de Motor 2 funciona perfecto. Las 137 señales sanas (3-5pp) son la prueba: la
matemática es correcta. **El bug NO estaba en el cálculo — estaba en la asunción implícita de
que todas las muestras del feed son comparables.**

La hipótesis idealizada: *"el feed de Odds API y el BBO de Kalshi miden lo mismo"*. La realidad
del régimen: *"el feed mide pre-match consensus, Kalshi mide pre-match O in-play según el reloj
del partido — son la misma cosa SOLO antes del kickoff"*.

Este es el mismo patrón meta de toda la saga aplicado a una clase nueva de error:
- En la saga V2: la teoría microestructural HFT no aplicaba al régimen Kalshi (refutación de
  compresión por liquidez)
- En la auditoría 12-jun: el ranking del roadmap (Motor 1→2→3) no era el orden correcto de
  construcción (la data del Mundial dijo que P3 y Motor 2 son los de señal real)
- Hoy 14-jun: la hipótesis "feed consensus comparable con BBO Kalshi siempre" no aplica
  in-play (la data del Mundial mostró 8 muestras donde la comparación es basura)

**Mismo principio: medir el régimen real antes de confiar la asunción.** Tres aplicaciones en
arquitectura, portafolio, y ahora calidad de data.

---

## Aprendizajes de la sesión

- **"El núcleo matemático estaba bien — era ruido de borde."** Cuando un detector produce
  138 buenas + 8 monstruos, la pregunta NO es "¿el cálculo está mal?" sino "¿qué hay diferente
  en esas 8?". La distribución bimodal es la pista — si fuera bug de cálculo, todas serían
  monstruos o ninguno. La forma de la distribución dice dónde mirar.

- **Heurísticas de plausibilidad económica son red de seguridad poderosa.** "Ningún edge >15pp
  es real en binario líquido" no requiere identificar la causa del fantasma para protegerte de
  él. Las 3 capas del fix combinan ataque a la causa raíz (pre-match) + red estructural (cap
  plausibilidad).

- **Defense in depth en filtros, igual que en el muro de capital.** El muro de 3 capas para
  apostar plata (LiveOddsSource + TRADING_ENABLED + place_order check) y los 3 guardarraíles
  contra edges fantasma comparten el mismo principio: para que un error se cuele se necesitan
  todas las capas fallando simultáneamente, lo cual reduce el blast radius exponencialmente.

- **Fixtures relativas a `now` eliminan una clase entera de flakes.** Misma raíz que el bug
  del throttle (#52): hardcodear un tiempo en lugar de relativizar al presente. La regla:
  "cualquier test que dependa del paso del tiempo se hace relativo a `now`, no a una fecha
  hardcodeada".

- **La hipótesis idealizada vs el régimen real es la fuente más fértil de bugs estructurales.**
  No hay forma de cazarlos en revisión de código aislada — solo aparecen cuando el detector se
  ejecuta sobre datos reales en condiciones reales. Por eso el shadow con feed real es
  irreemplazable, y por eso "agarrarlo en N=146 antes de N=1 con capital" vale cada hora de
  disciplina.

- **El día 1 de feed real generó 1 señal; el día 2 generó 146 con bimodalidad imposible.** Sin
  la disciplina N=1 de ayer, el bot podría haber estado operando con capital cuando aparecieron
  los 8 monstruos. **Los 8 monstruos NO habrían disparado órdenes** (el muro de capas hubiera
  parado por sizing/exposición), pero la data en DB estaría contaminada y las decisiones futuras
  sesgadas. La disciplina del día 1 protegió la integridad de la muestra del día 2.

---

## Resumen de una línea

> **Día 4: feed real funcionando, falso-positivo de mercado in-play cazado y filtrado, capital
> intacto. La muestra para decidir empieza limpia ahora.**

---

## Links
- [[kalshi-bot]]
- [[2026-06-13-Motor-2-encendido-feed-real-primera-senal-consensus]] — el encendido que generó la data
- [[2026-06-12-AUDITORIA-motores-gap-entre-infra-y-senal]] — el pivot que llevó a cablear Motor 2
- [[2026-06-12-FASE-0-completa-sprint-motores-Mundial-operativo]] — Mundial corriendo, sprint frenos
