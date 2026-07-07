---
tipo: sesion-auditoria
proyecto: "[[kalshi-bot]]"
fecha: 2026-07-02
tags:
  - kalshi
  - auditoria
  - root-cause
  - usable-1-dolar
  - riskmanager-netting-bug
  - counterfactual-edge-buckets
  - polybot
  - nuevo-frente
  - settlement-reconciliacion
  - 2026-07-02
estado: unlock-confirmado-boot-trigger-pendiente-continuo
frente: "Root cause del $1 usable identificado (arb hedgeado viejo + notes=None); counterfactual muestra 5-8% edge es donde está el negocio; Polybot arrancando como nuevo frente"
relacionado:
  - "[[2026-07-01-kill-switch-limpiado-Motor-4-MM-elegido-V2-desync-bloquea]]"
  - "[[2026-06-28-deploy-shadow-Motor-3-capital-dinamico-operativo]]"
---

# 2026-07-02 — Auditoría Kalshi (root cause del $1 usable) + Polybot como nuevo frente

## Estado

Post-auditoría profunda del "por qué Motor 2 apostaba $1". No era config del stake — era el
cap de exposición saturado por un arb hedgeado del 30-jun que quedó sin reconciliar por bug
en RiskManager netting (`notes=None`). **Nuevo deploy con fix del settlement disparó unlock**
($253 filled → $4.75, 30-jun TBKC settled con $235.71). **Polybot aparece como nuevo frente
en la infra** (puerto :18081 previsto).

---

## Infra

- Droplet: `104.236.211.240` | Coolify v4.0.0
- **Kalshi status:** `:18080/status`
- **Polybot:** `:18081` (previsto)
- Kalshi container live: `kalshi-bot-...-032023877818` (commit `0c7b2d7`)

**Nuevo:** aparece Polybot como bot separado en el mismo droplet. Del 07-01 se había
descartado "cross-venue arb Kalshi vs Polymarket" (sin spec, sin clientes). Hoy Polybot es un
frente aparte, no cross-venue — bot dedicado a Polymarket con su propia infra y puerto.

---

## KALSHI — Root cause del "$1"

### El síntoma

Motor 2 estaba apostando ~$1 por señal (`usable=$0.02` en algún momento). Parecía problema de
sizing config.

### Lo que NO era

- Motor 2 usa sizing **FLAT** (no Kelly); `MOTOR_2_MAX_STAKE_PCT` default 1.0%
- RiskManager cap por trade = `min(3%×$1200, $200) = $36`
- Con esos parámetros el bot podía haber estado apostando $36 por señal, no $1

**El config estaba OK.** El bug estaba aguas arriba.

### La causa REAL

**El cap de exposición simultánea (50%) estaba LLENO** por un arb hedgeado viejo del 30-jun
(`KXMLBGAME-26JUN...TBKC`, 243×243, ~$235 total).

### El bug de RiskManager netting

- RiskManager netea arbs hedgeados agrupando por `arb_id` parseado de `notes`
- **Pero `notes=None`** → netting falla → cuenta $235 BRUTO en vez de neto → llena cap →
  Motor 2 bloqueado a `usable=$0.02`

### Dos bugs concatenados

1. **Motor 1 no escribe `arb_id` / `kalshi_order_id`** → sin arb_id no se puede netear
2. **Reconciliación de settlement no cerraba posiciones 30-jun** → el arb quedó abierto en la
   contabilidad interna aunque en Kalshi ya estaba resuelto

**El sistema veía un arb activo consumiendo $235 de exposición que en la realidad ya no
existía.** Exactamente el patrón meta del 21-jun: *"un mecanismo de seguridad funcionando se
ve igual que un mecanismo roto si no mirás la métrica correcta."* El cap saturado NO era el
sistema protegiéndote — era el sistema contabilizando fantasmas.

### Conexión con la saga de "leer la realidad mal"

**Quinto bug de "leer la realidad mal" identificado:**

1. #75 (firma 401) — path con querystring
2. #87 (`position_fp`) — campo mal nombrado
3. #54 (in-play vs Odds API) — comparación no comparable
4. WS v2 (28-jun) — `action="get_snapshot"` inválido
5. **HOY: RiskManager netting con `notes=None` — el `arb_id` que no estaba escrito**

**Patrón común:** todos fallan en silencio, todos requieren mirar la realidad (no el config)
para descubrir. **La contabilidad del cap era el "dashboard" que mentía, igual que el
dashboard del 18-jun parte 2 mentía con `position_fp`.**

---

## KALSHI — Counterfactual por bucket de edge (trades.db)

**Este es el análisis más importante del día.** Bucketear los trades por edge y ver qué
habría pasado con stake completo ($36) vs stake real que el bot pudo poner:

| Edge bucket | Real P&L | Counterfactual @$36 |
|---|---|---|
| **<5%** | +$9 | +$151 |
| **5-8%** | **+$133** | **+$653** ← **bucket rentable** |
| 8-11% | −$237 | +$21 ← basura (48-50% winrate) |
| ≥11% | −$339 | +$37 ← basura |

### Lo que dice esto

**La plata está en el bucket 5-8% de edge.** Los buckets 8%+ son basura (48-50% winrate = casi
random). Contra la intuición: **más edge NO es mejor.** Los edges >8% en Motor 2 consensus
probablemente son datos podridos (fantasmas tipo del 14-jun, o líneas stale del sportsbook, o
mercados que Kalshi movió agresivamente por razones que consensus no capta).

**Conclusión operativa:** *"NO subir stake global a ciegas."* La respuesta NO es "poné $36 en
todos los trades" — es "poné $36 en los 5-8%, filtrá los 8%+ como probable data podrida."

### Conexión con el guardarraíl del 14-jun

El 14-jun se agregó `MAX_PLAUSIBLE_EDGE = 0.15` como cap de plausibilidad (edges >15pp son
data podrida). **El counterfactual sugiere que el umbral real es más bajo: >8% ya es
sospechoso.** Vale ajustar el umbral con esta nueva evidencia.

### Séptimo patrón meta refutado (aplicación 2)

Del 07-01: *"shadow que valida sin flip cuesta plata"*. **Hoy aplicación distinta:** *"edges
grandes que parecen buenos pueden ser data podrida que cuesta plata."* Mismo principio meta
que la saga: la asunción implícita ("más edge = mejor") no aguanta contra el régimen real
medido.

---

## KALSHI — Unlock confirmado (nuevo deploy 03:20-03:21)

Post-deploy con fix del settlement:

- `filled $253` → `$4.75` (bajó de casi todo lleno a casi nada — el arb viejo se cerró)
- `settled 166` → `224` (58 posiciones adicionales pasaron a settled)
- 30-jun TBKC → `'settled' $235.71` (el arb viejo específicamente cerró con esa cifra)
- Logs: `settlement.group_settled` + `settlement.tick settled_legs=58`

**OJO:** fue trigger de boot, no continuo. **3ª señal (counts reales Motor 2) sin confirmar
hasta que llegue slate MLB.**

**Lo que esto significa:** el fix funcionó en el momento del deploy porque el startup
disparó una reconciliación completa. Pero **no sabemos aún si la reconciliación continua
(en steady-state) funciona.** Puede que el startup sea el único evento que la dispare —
en cuyo caso al primer bug intermedio se acumula deuda otra vez.

**Validación pendiente:** ver si con el próximo slate MLB, el Motor 2 usable vuelve a $36
sostenido (no $1). Si sí → fix estructural. Si no → hay reconciliación continua rota.

---

## KALSHI — Estado actual `/status` (02-jul 15:53)

`is_paused=false`, `ws_connected=true`, `capita[...]`

*(el resto del status quedó cortado en la nota original — la sesión se cortó a mitad de
transcribir el `/status`. Los datos existen en producción; vale reconstituirlos en la próxima
sesión para completar este bloque)*

---

## Polybot — nuevo frente en la infra

**Aparece un nuevo bot:** Polybot, puerto :18081 previsto. Del contexto del 07-01: se había
descartado cross-venue arb Kalshi ↔ Polymarket porque "no hay clientes de Polymarket". Hoy
aparece Polybot como bot dedicado a Polymarket, no cross-venue.

**Implicaciones:**
- **Dos bots corriendo en paralelo en el mismo droplet** — Kalshi + Polybot
- El droplet 2vCPU/4GB (upgrade del 23-jun) debería soportarlos, pero **hay que verificar
  saturación como en el 23-jun** — que un bot no ahogue al otro
- Multi-agent coordination se hace más complejo: ahora hay Kalshi (con Motor 2/3/REST/1) +
  Polybot como frentes distintos

**Nota importante:** Polybot no está documentado en la saga hasta hoy. Vale crear una nota
raíz separada `polybot.md` cuando tengamos más contexto. Por ahora solo aparece como puerto
:18081 previsto — asumiendo que está en fase de arranque, no operando aún.

---

## Estado consolidado al cierre del 02-jul

| Frente | Estado |
|---|---|
| Kalshi bot | Running (commit `0c7b2d7`), `is_paused=false`, `ws_connected=true` |
| Capital | ~$353 efectivo (del 07-01) — no confirmado si cambió hoy |
| Root cause del `$1 usable` | ✅ Identificada: arb hedgeado 30-jun + `notes=None` + reconciliación de settlement rota |
| Bug RiskManager netting (`notes=None`) | 🟡 Requiere fix: Motor 1 escribir `arb_id` + `kalshi_order_id` |
| Reconciliación settlement | 🟡 Funcionó en boot post-deploy — falta validar continua con slate MLB |
| Unlock post-deploy | ✅ filled $253→$4.75, 58 settled adicionales, 30-jun TBKC cerrado con $235.71 |
| **Counterfactual edge buckets** | ✅ Insight clave: **la plata está en 5-8%, 8%+ es basura** |
| Guardarraíl `MAX_PLAUSIBLE_EDGE=0.15` (14-jun) | 🟡 Vale ajustar a umbral más bajo (~8%) con la nueva evidencia |
| Motor 3 trailing/CLV closes | (del 07-01: 0 — `MOTOR_3_TRAILING_ENABLED=true` aplicado, esperar validación operativa) |
| V2 desync (bloqueaba Motor 4 MM) | (del 07-01: pendiente fix a Claude Code) |
| Kill-switch auto-limpieza reset mensual | (del 07-01: pendiente fix a Claude Code) |
| **Polybot** | 🆕 Puerto :18081 previsto en la infra. **NUEVO FRENTE** |
| Slate MLB para validación | 📅 Esperar próximo slate para confirmar Motor 2 usable sostenido |

---

## Los 3 hallazgos que valen recordar

### 1. El $1 usable NO era config — era contabilidad fantasma

*"Un mecanismo de seguridad funcionando se ve igual que un mecanismo roto si no mirás la
métrica correcta."* El cap saturado por un arb que ya no existía en la realidad. Mismo
patrón que #75 firma 401 (podía leer cartera), #87 position_fp (dashboard mentía), 14-jun
in-play (feed mentía), 28-jun WS v2 (action inválido), y hoy notes=None (netting fantasma).

### 2. El bucket 5-8% es donde está la plata; los edges >8% son data podrida

Contraintuitivo pero medido. **Mismo patrón meta de toda la saga aplicado al filtro de
señales:** la asunción implícita ("más edge = mejor") no aguanta contra el régimen real
medido. **Sumá una séptima aplicación al patrón meta de "medir el régimen real."**

Además: el guardarraíl del 14-jun (`MAX_PLAUSIBLE_EDGE=0.15`) fue defensa contra fantasmas
in-play. Hoy la data sugiere que ese umbral es alto — 8% ya es sospechoso en régimen normal.
Vale calibrar con evidencia nueva.

### 3. La reconciliación continua NO está confirmada

El unlock de hoy fue trigger de boot post-deploy. Si la reconciliación continua funciona
igual que la de boot → fix estructural. Si la de boot fue caso especial y la continua sigue
rota → al primer arb hedgeado nuevo el cap volverá a saturarse. **Validación pendiente:
próximo slate MLB con Motor 2 usable sostenido en $36.**

---

## Conexión con el patrón meta de la saga

**Octavo patrón meta refutado (o extensión del séptimo):** *"un edge más grande no es
necesariamente un edge mejor — puede ser data podrida disfrazada de oportunidad."*

Complementa la serie de 7 patrones meta acumulados:
1. Saga V2 — HFT no aplica a Kalshi
2. Auditoría 12-jun — ranking del roadmap incorrecto
3. 14-jun — feed in-play no comparable
4. 18-jun — FOK paralelo no seguro multi-pata
5. 23-jun — el bot no leía cash real
6. 26-jun — settlement pasivo no es gestión
7. 07-01 — shadow sin flip cuesta plata
8. **07-02 — edges grandes pueden ser data podrida (bucket >8% pierde plata)**

Todos comparten estructura: **una asunción implícita que el régimen real refuta cuando lo
medís.**

---

## Frase del día

> **"El bot no apostaba $1 por falta de capital — apostaba $1 porque contabilizaba un arb
> fantasma que en Kalshi ya estaba cerrado. El sistema no estaba roto; estaba viendo un
> mundo que no existía. Y el counterfactual dice algo aún más incómodo: los edges grandes
> que parecían la oportunidad, en realidad estaban costando plata. La plata está en el
> 5-8%."**

---

## Para el próximo turno

1. **Completar el `/status` que quedó cortado** en la nota original (`capita[...]`)
2. **Validar reconciliación continua** con próximo slate MLB — Motor 2 usable debería
   sostener $36 (no $1)
3. **Fix a Claude Code:** Motor 1 debe escribir `arb_id` + `kalshi_order_id` en `notes` para
   que RiskManager netea correctamente
4. **Ajustar `MAX_PLAUSIBLE_EDGE`** del 14-jun (era 0.15) a un umbral más bajo con evidencia
   del counterfactual — 8% parece sospechoso
5. **Considerar filtro específico por bucket:** Motor 2 podría filtrar edges >8% como
   probable data podrida (o darles menor peso)
6. **Documentar Polybot** cuando tengamos más contexto — nota raíz separada si es proyecto
   propio, sección aquí si es cross-venue con Kalshi
7. **Seguir con pendientes del 07-01:** fix V2 desync (bloquea Motor 4 MM), auto-limpieza
   kill-switch en reset mensual, análisis de WR bajando de 69.5%→57%

---

## ⚠️ Nota sobre la sesión

Esta sesión quedó cortada mientras el operador transcribía el `/status`. Los últimos datos
que faltan son las métricas actuales del bot al 02-jul 15:53. La nota está completa en los
hallazgos analíticos (root cause + counterfactual + unlock), solo falta el snapshot de
`/status` que se puede reconstruir en el próximo turno directamente contra el bot.

---

## Links
- [[kalshi-bot]]
- **[[2026-07-01-kill-switch-limpiado-Motor-4-MM-elegido-V2-desync-bloquea]]** — sesión inmediatamente previa
- [[2026-06-28-deploy-shadow-Motor-3-capital-dinamico-operativo]] — deploy del Motor 3 que nunca activó
- [[2026-06-21-botkalshi-arquitectura-completa-sistema-rentable]] — snapshot rentable, baseline del deterioro
- [[2026-06-18-parte-2-flags-por-motor-bug-position_fp-escalado-Motor-2-Telegram]] — patrón del "dashboard mentía"
- [[2026-06-14-edges-fantasma-Motor-2-in-play-fix-PR-54]] — guardarraíl MAX_PLAUSIBLE_EDGE=0.15, hoy la evidencia sugiere ajustar
