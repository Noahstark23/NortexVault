---
tipo: sesion
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-13
tags:
  - kalshi
  - motor-2
  - consensus
  - sportsbook
  - the-odds-api
  - mundial
  - deploy
  - shadow-live
  - 2026-06-13
estado: shadow-live (sin capital)
frente: "Motor 2 cableado con feed real — primera EdgeWindow consensus capturada"
sesion: "Mundial día 3 — encendido de Motor 2"
deadline: ventana de decisión 24-48h sobre data real
---

# 2026-06-13 — Encendido de Motor 2 (consensus) en vivo

## TL;DR

Hoy se **conectó el feed real** de The Odds API a Motor 2. El bot pasó de
shadow-con-fixture a **shadow con odds reales del Mundial**. Apareció la **primera señal de
edge >3pp sobre un partido real** (3.11pp, USA/AUS). Decisión: **NO se enciende capital con
N=1 marginal** — se acumulan 24-48h y se decide con la muestra. **Plata intacta.**

**El pivot de la auditoría de ayer se ejecutó en un día:** P3 multi-outcome (1X2) Y Motor 2
cable ambos están en main. Motor REST mantiene el plan original (opción gratis armada). Las dos
estrategias con señal real, en producción shadow, capturando data.

---

## Qué se mergeó hoy (todo en main, shadow-safe)

| PR | Qué | Estado |
|---|---|---|
| #48 | chore: limpieza de CI (formato + 2 tests muertos + lint) | ✅ merged |
| #49 | Motor 2 **executor** direccional single-leg (el cable que apuesta) | ✅ merged |
| #47 | Motor 2 **cable shadow** (extractor Kalshi + poller + matcher) | ✅ merged |
| #50 | Motor REST: **arb multi-outcome 1X2** ejecutable (profit lockeado) | ✅ merged |
| #51 | **Flip por config**: `ODDS_API_KEY` set → `LiveOddsSource` (regiones `eu,us`/Pinnacle) | ✅ merged |
| #52 | fix: throttle de alertas V2 init a `-inf` (bug latente + flake de CI) | ✅ merged |
| #53 | Motor 2: **desglose auditable** (gross/fee/neto) + umbral tuneable + script reporte | 🟢 verde, listo |

---

## 🎯 El hito: feed real conectado

- `ODDS_API_KEY` seteada (len 32), `SPORT_KEYS=soccer_fifa_world_cup`, `REGIONS=eu,us`
- `TRADING_ENABLED=false` → **observa, no apuesta**
- **Primera fila `EdgeWindow(kind='consensus')`:**
  - `KXWCGAME-26JUN19USAAUS-USA` · **edge 3.11pp neto** · 2026-06-13 20:32 UTC
  - Conteo tabla: `consensus=1`, `multi_outcome=116`

**Lo que esto significa:** la pipeline `Odds API → Pinnacle (regiones eu,us) → no-vig consensus
→ match contra ticker Kalshi → comparación con BBO de Kalshi → cálculo de edge neto post-fee`
está corriendo end-to-end sobre data real del Mundial. **Sin shortcuts, sin fixture, sin demo.**

---

## 🐛 Bugs encontrados y arreglados

### Throttle de alertas V2 (#52) — latente + causa del flake de CI

El throttle usaba `now - last_alert > THRESHOLD` con `now = time.monotonic()` (segundos desde
el boot) y `last_alert` init en `0.0`. En un proceso con **uptime < THRESHOLD** (container/CI
recién arrancado), bloqueaba **por error la primera alerta**.

→ Fix: init a `float("-inf")`.

**Impacto en producción:** un container recién deployado no alertaba sobre tormentas de gaps en
su primer arranque. Bug silencioso, latente desde hace tiempo, descubierto al investigar un flake
de CI que recreaba la condición.

### "¿Por qué no conectaba?" — la trampa del deploy

Setear la env var **no alcanza** si el código desplegado no la lee. El flip que lee
`ODDS_API_KEY` vivía en un PR sin mergear → el bot seguía con el fixture demo.

**Lección:** *"merge ≈ deploy; una env var nueva solo sirve si el código corriendo la consume."*

Esto se conecta con el patrón de toda la saga: la verificación end-to-end contra la realidad
es lo único que confirma que el path funciona. "Setear el env var" sin verificar logs habría
dejado el bot corriendo con fixture indefinido sin que nadie lo notara.

---

## 🧠 Conceptos clave (para no olvidar)

### Motor 2 (consensus) = apuesta DIRECCIONAL (+EV), NO arbitraje

- **Puede perder** un trade individual
- A $5/apuesta sobre $100 = ~20 tiros → **varianza alta** aun con edge real
- El edge paga en **cientos de apuestas**, no en una
- Por eso N=1 marginal NO basta para activar capital

### Arb multi-outcome 1X2 (#50) = profit LOCKEADO, sin varianza

- Comprar YES en los 3 outcomes si Σasks < 100 (post-fee)
- **Cero exposición direccional** — el arbitraje es matemáticamente garantizado
- Pero dispara **raro** (near-miss ~101c en lo medido)
- Es el componente que la auditoría de ayer identificó como "la oportunidad real del fútbol"

### `edge_pct` YA es neto

La comisión se resta en `_net_edge_pct`. El `gross/fee None` que veíamos en EdgeWindow era
cosmético; con #53 se persiste el desglose explícito (gross + fee + neto separados) para
auditabilidad y para tunear umbrales con visibilidad.

### El muro de 3 capas para apostar plata real

1. **`LiveOddsSource` (odds reales)** — con fixture fake nunca apuesta
2. **`TRADING_ENABLED=true`** → construye el executor (Capa A)
3. **`place_order` bloquea buys con flag off** (Capa C)

**Encendido = solo env vars.** Ya no hay que editar código — la decisión de capital vive
enteramente en configuración. Eso reduce el blast radius del error humano y deja la decisión
operativa separada de la decisión de código.

---

## ✅ Próximos pasos (decisión con datos, no con ansiedad)

1. Mergear **#53** + redeploy → empieza a guardar gross/fee/neto, umbral tuneable
2. Dejar correr shadow con feed real **24-48h** (`TRADING_ENABLED=false`)
3. Mañana/pasado: `python scripts/motor2_consensus_report.py --hours 48`
4. **Gate de decisión:** ¿hay un puñado consistente de edges **>3pp NO-marginales**?
   - **Sí** → encender:
     - `TRADING_ENABLED=true`
     - `ACTIVE_CAPITAL_USD=100`
     - `MOTOR_REST_ENABLED=true`
     - Frenos: **$5/trade, $25 exposición, stop diario −$3**
   - **No** (solo señales marginales aisladas) → **NO encender, plata a salvo**

---

## 📌 Variables Coolify (referencia operativa)

### Shadow readout (ahora)
```
ODDS_API_KEY=<set>
MOTOR_2_SPORTSBOOK_ENABLED=true
TRADING_ENABLED=false
```

### Encender capital (si el gate da SÍ)
```
TRADING_ENABLED=true
ACTIVE_CAPITAL_USD=100
MOTOR_REST_ENABLED=true
```

### Tunear umbral / filtrar marginales (tras #53)
```
MOTOR_2_MIN_EDGE_PCT=4.0
```

---

## La decisión clave del día: NO encender con N=1 marginal

Apareció UNA señal de 3.11pp. Es **3.11pp neto post-fee, sobre el umbral de 3pp**, pero apenas.
La tentación es decir "ya hay edge, encendamos capital — solo $100 para empezar".

**La disciplina dice no.** Razones:

1. **Motor 2 es DIRECCIONAL.** Una señal individual puede perder por varianza. El edge paga en
   cientos, no en una. N=1 es ruido, no señal.
2. **3.11pp sobre 3pp umbral es MARGINAL.** Si el umbral real necesario para PnL positivo es
   3.5pp (post-fee de ejecución, slippage, etc.), entonces 3.11pp es perdedor esperado. Solo la
   data con N alto y reporte de desglose dice si los edges sobre 3pp son consistentes o
   aislados.
3. **24-48h es barato.** No hay urgencia. El Mundial sigue. Cada hora de shadow es una hora de
   data adicional sobre la distribución real de edges en este régimen.
4. **El reporte con #53 va a desglosar gross/fee/neto** → permite ver si las señales son
   estructurales (consistente gross alto, fee normal) o de borde (fee come casi todo el gross).

**El patrón:** *"medir antes de decidir le ganó a la intuición en cada bifurcación de la saga."*
Esta es la misma disciplina aplicada al gate de capital. Plata intacta cuando la data no es
clara es **siempre** la opción correcta.

---

## El arco de hoy en contexto del pivot de ayer

Ayer la auditoría destapó que **construimos los frenos del motor con menor señal mientras P3 y
Motor 2 (los de señal real) faltaban cablear**. Hoy:

- **P3 multi-outcome (1X2)**: cableado ejecutable en PR #50 (arb LOCKEADO, profit garantizado si dispara). El componente que la auditoría llamó "gap #1".
- **Motor 2 cable shadow**: cableado en PR #47 + executor en PR #49. El componente que la auditoría llamó "gap #2 — el cerebro está, hay que cablearle las manos".
- **Feed real conectado**: ODDS_API_KEY set, LiveOddsSource activo. The Odds API ($30-60/mes
  decisión pendiente de ayer) → ejecutada y operando.
- **Primera EdgeWindow consensus** registrada con data real.

**El pivot de la auditoría se ejecutó en UN DÍA.** El sprint de los 5 días previos había
construido los frenos del Motor REST; hoy se cablearon las manos a los motores con señal real.
Eso es **velocidad de ejecución sostenida por la disciplina de gates** — no se rompen las reglas
del shadow, no se enciende capital con N=1, no se mete capital en motor de varianza alta sin
muestra.

**Y aún así:** Motor REST sigue armado como opción gratis (PR #50 le agregó el arb
multi-outcome 1X2 ejecutable, sumándole un componente sin varianza). No se desarmó nada — se
sumó.

---

## Estado consolidado al cierre del 13-jun

| Frente | Estado |
|---|---|
| V1 baseline | ✅ SANO continuo |
| Motor REST shadow | ✅ Corriendo, ahora con arb 1X2 ejecutable (#50) |
| **Motor 2 (consensus) feed real** | ✅ **LIVE en shadow** con The Odds API |
| Primera EdgeWindow consensus | ✅ 3.11pp neto USA/AUS, 20:32 UTC |
| EdgeWindow multi_outcome | 116 (acumulado) |
| EdgeWindow consensus | 1 (primera del día) |
| Throttle de alertas V2 (latente) | ✅ Arreglado (#52) — init a `-inf` |
| Flip por env var (`ODDS_API_KEY`) | ✅ #51 mergeado |
| Desglose gross/fee/neto auditable | 🟢 #53 verde, pendiente merge + redeploy |
| Script reporte 48h | ✅ `scripts/motor2_consensus_report.py` |
| TRADING_ENABLED | 🔒 false hasta gate de decisión con muestra |
| Capital | 🔒 Cero — disciplina N=1 sostenida |
| Ventana de decisión | 📅 24-48h de shadow con feed real → gate |

---

## Aprendizajes de la sesión

- **"Merge ≈ deploy."** Setear una env var sin que el código mergeado la lea = bot corriendo
  con fixture indefinido sin que nadie lo note. La verificación end-to-end contra logs es lo
  único que confirma que el path real está activo.

- **Bug latente cazado por flake de CI.** El throttle de alertas V2 nunca se ejercitó en
  producción porque siempre había uptime > THRESHOLD al primer trigger. CI lo expuso al arrancar
  containers nuevos. **Los flakes de CI a veces son señal de bugs latentes en producción**, no
  ruido — vale investigar antes de "skip"-earlos.

- **N=1 marginal NO es base para activar capital.** El Motor 2 es direccional con varianza
  alta; el edge paga en cientos de apuestas. 3.11pp sobre 3pp umbral es marginal aun siendo
  matemáticamente sobre el threshold. 24-48h de shadow con #53 (desglose auditable) dan la
  data para decidir con N suficiente.

- **Encendido = solo env vars** es disciplina de blast radius. Separa la decisión operativa
  (configurar) de la decisión de código (compilar/deployar). Eso permite encender y apagar sin
  reinicio de captura sana de V1 y sin tocar el código que ya pasó review.

- **El pivot estratégico se ejecuta rápido cuando los componentes están listos.** Ayer la
  auditoría reordenó prioridades; hoy ambos gaps (#1 P3 multi-outcome ejecutable, #2 Motor 2
  cable + executor) están en main. La velocidad vino de que la matemática y el cerebro ya
  estaban — solo faltaba cablear y conectar el feed.

- **El muro de 3 capas reduce el riesgo del error humano.** LiveOddsSource + TRADING_ENABLED +
  place_order check. Para que el bot apueste por error se necesitan TRES cosas configuradas mal
  al mismo tiempo — defense in depth en el path de capital.

---

## Para el próximo turno

1. **Mergear #53 + redeploy** → desglose auditable persistido en DB
2. **Esperar 24-48h** con shadow + feed real corriendo (cero acciones manuales necesarias)
3. **Correr el reporte** `python scripts/motor2_consensus_report.py --hours 48`
4. **Analizar la distribución:**
   - ¿Cuántas señales >3pp neto en 48h?
   - ¿Cuántas >4pp? ¿>5pp?
   - ¿Hay patrón por liga/mercado/tipo?
   - ¿Hay sesgo en algún sportsbook (Pinnacle vs otros)?
5. **Aplicar el gate de decisión:**
   - Si hay puñado consistente de edges >3pp NO marginales → encender capital con frenos
   - Si solo hay señales marginales aisladas → seguir shadow, ajustar umbral, esperar muestra

---

## Links
- [[kalshi-bot]]
- [[2026-06-12-AUDITORIA-motores-gap-entre-infra-y-senal]] — el pivot que esta sesión ejecutó
- [[2026-06-12-FASE-0-completa-sprint-motores-Mundial-operativo]] — la base sobre la que se cableó
- [[2026-06-07-sesion-Motor-REST-encendido-SHADOW-WAL-fix]] — el shadow original
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — la decisión arquitectónica
