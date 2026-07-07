---
tipo: auditoria-estrategica
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-12
tags:
  - kalshi
  - auditoria-motores
  - p3-multi-outcome
  - motor-2-consenso
  - near-miss-telemetria
  - reordenamiento-estrategico
  - 2026-06-12
estado: diagnostico-cerrado-reordenamiento-pendiente
frente: "Gap entre infraestructura construida (Motor REST 10/10) y señal real (P3 + Motor 2)"
---

# 2026-06-12 — Auditoría motor-por-motor: el gap entre "el bot funciona" y "el bot gana plata"

## Diagnóstico en una frase

> **Construimos primero (y muy bien) la infraestructura y los frenos del motor cuya estrategia tiene la MENOR frecuencia de señal del menú; las dos estrategias con señal REAL (P3 y Motor 2) son las que faltan cablear.**

---

## La tabla — motor por motor

| Motor | Mecánica | Negocio | Veredicto |
|---|---|---|---|
| **Motor REST (arb binario)** | ✅ **10/10** — cable, frenos, settlement, kill-switch, harness | 🔴 **caza una presa casi inexistente** (libro cruzado) | Dejarlo armado (opción gratis, dispara si algún día pasa) **pero NO esperar trades de acá** |
| **P3 multi-outcome (1X2)** | ❌ **NO construido** — `detect_multi_outcome_arb` existe en `math/`, sin usar | 🟢 **LA oportunidad real del fútbol**: 3 mercados del mismo partido (Gana/Empata/Pierde) sumando <100 post-fee. Desalineación entre 3 libros = más frecuente y ventanas más largas que un libro cruzado | **El gap #1 entre "el bot funciona" y "el bot gana plata"** |
| **Motor 2 (consenso sportsbooks)** | 🟡 cerebro completo (#34-37), sin manos: falta fuente de quotes + poller + executor + tu API key | 🟢 el roadmap lo llama **"EL MÁS RENTABLE"** — no necesita ineficiencia interna de Kalshi, solo que Kalshi **se atrase** vs los books (>3pp). Pasa mucho más seguido que un libro cruzado | **Gap #2 — el cerebro está, hay que cablearle las manos** |
| **Motor 3 (CLV)** | ❌ cero código | depende de entradas que no existen | Último, correcto que espere |

---

## El agravante: ceguera por falta de telemetría near-miss (P4)

> *"Ni siquiera sabemos cuán cerca estuvo cada mercado (¿a 1¢? ¿a 20¢?), porque la telemetría de near-miss (P4) nunca se construyó. Estamos ciegos a la distancia de la oportunidad."*

**Por qué importa:**
- Binario = 0 confirmado, pero **no sabemos** si la comisión come por 1¢ (cerca, ajustable) o por 20¢ (lejos, estructural)
- Sin esa data, no podemos calibrar umbrales ni decidir si un cambio de fee schedule de Kalshi nos abriría el mercado
- **P4 es la data que convierte "binario = 0" en accionable** (cerca → seguimos mirando; lejos → confirmado estructural)

---

## El reordenamiento estratégico implícito

### Lo que la auditoría nos dice — sin decirlo directamente

**FASE 0 completa fue trabajo correcto de los frenos, PERO el orden de las FASES 1-2-3 está al revés vs el ranking de negocio:**

| Plan original | Lo que el diagnóstico sugiere |
|---|---|
| FASE 1: Motor REST ON (smoke + 7d + capital) | FASE 1: Motor REST ON — pero **con expectativa cero de trades**, es la opción gratis |
| FASE 2: Motor 2 cable | FASE 2: **P3 multi-outcome (1X2)** — la oportunidad real del fútbol, y el Mundial está corriendo AHORA |
| FASE 3: Motor 3 | FASE 3: **Motor 2 cable** — "el más rentable" según roadmap |
| (sin lugar) | P4 near-miss telemetría — habilita decisiones sobre binario |

**No es que FASE 0 esté mal hecha — es que cablear las manos a los motores con señal real (P3 + Motor 2) genera más PnL esperado que pasar al smoke del Motor REST con `TRADING_ENABLED=true`.**

### El dilema que esto plantea

- Ya construimos los frenos para el Motor REST (FASE 0). Activarlo con capital tiene marginal cost bajo (smoke + 7d).
- PERO con el binario = 0 confirmado, el ROI esperado de esos 7 días es ≈ 0.
- Los mismos 7 días invertidos en P3 (que ya tiene matemática + cerebro hecho) o en cablear las manos de Motor 2 dan EV mucho más alto.

**Pregunta para próxima sesión:** ¿Activar Motor REST igual (porque la opción es gratis, los frenos ya están, y "dispara si algún día pasa") MIENTRAS en paralelo se cablea P3? ¿O pausar Motor REST en `TRADING_ENABLED=false` indefinido y dedicar 100% del foco a P3 + Motor 2?

---

## Por qué este diagnóstico vale más que cualquier PR del sprint

**El sprint de 5 días (PRs #31-#41) fue ingeniería disciplinada y bien hecha.** Pero la auditoría destapa algo que ningún PR podía destapar:

> Estábamos **resolviendo correctamente el problema equivocado.**

Los frenos del Motor REST son perfectos. La infra del Motor REST es 10/10. Y el Motor REST captura una oportunidad **que casi no existe** en el régimen real medido.

Esto es **exactamente el patrón meta que toda la saga viene cazando** — pero esta vez aplicado al diseño de portafolio de estrategias, no a la arquitectura de un componente:

- En la saga V2: construíamos defensas para un componente cuya complejidad NO era necesaria → archivamos V2, pivot a Motor REST.
- En este sprint: construimos frenos para un motor cuya señal NO es frecuente → reordenar prioridades hacia los motores con señal real.

**Mismo principio: medir el régimen real antes de invertir en el componente.** Lo aplicamos para arquitectura; faltaba aplicarlo para selección de estrategia.

---

## Lo que NO cambia (sigue válido)

- FASE 0 está bien hecha. Los frenos del Motor REST son reutilizables cuando se cablee Motor 2 (que TAMBIÉN ejecuta órdenes en Kalshi). El RiskManager, settlement, kill-switch, harness — todo aplica.
- El Motor REST sigue siendo una **opción gratis** — si en algún momento el régimen cambia (cambio de fee schedule, mercado con menos market makers), dispara solo.
- La decisión de demo cancelada sigue siendo correcta. La decisión de TRADING_ENABLED=false hasta gates duros sigue siendo correcta.

---

## Lo que SÍ cambia (acciones nuevas que esta auditoría destapa)

1. **P3 multi-outcome (1X2) sube a prioridad #1** — diseñar + implementar + cablear. La matemática (`detect_multi_outcome_arb`) ya existe.
2. **P4 telemetría near-miss sube a prioridad #2** — habilita decisiones informadas sobre binario en futuro régimen.
3. **Motor 2 cable de manos sube a prioridad #3** — el cerebro analítico está (#34-#37), falta:
   - Fuente de quotes Kalshi
   - Poller shadow
   - ODDS_API_KEY ($30-60/mes — decisión Noel)
   - Executor (diseño → review, puede reusar frenos del Motor REST)
4. **Motor REST mantiene plan original** pero con expectativa explícita de 0 trades — no es prioridad, es opción gratis.

---

## Preguntas operativas pendientes para próxima sesión

- ¿Activar Motor REST igual (smoke + 7d con expectativa cero) o pausarlo indefinido?
- ¿En qué orden P3 vs P4 vs Motor 2-cable? ¿Paralelos o secuenciales?
- Motor 2 necesita `ODDS_API_KEY` ($30-60/mes): ¿se compra ya o se espera a tener P3 funcionando primero?
- Para P3: ¿qué deportes/torneos del Mundial son los más prometedores para shadow inmediato? (selección, no todos)

---

## Aprendizajes meta de la auditoría

- **"Construir bien la cosa equivocada es peor que construir mal la cosa correcta."** Los frenos del Motor REST están 10/10, pero el motor captura una oportunidad casi inexistente. El sprint fue ingeniería disciplinada, pero el diagnóstico estratégico destapa que el orden de FASES 1-2-3 estaba mal vs el ranking de negocio.

- **El régimen real refuta la teoría de portafolio también, no solo la de arquitectura.** Asumimos que el ranking del roadmap (Motor 1 → 2 → 3) era el orden correcto de construcción. La data del Mundial dice que el orden correcto es P3 → Motor 2 → resto. **Mismo patrón: medir el régimen antes de invertir.**

- **La ceguera de near-miss (P4) es deuda de telemetría que se paga ahora.** Sin saber si el binario está a 1¢ o a 20¢, no podemos tomar decisiones informadas sobre el componente. P4 no es lujo — es la data que convierte "binario = 0" en accionable.

- **Una auditoría adversarial vale más que un PR completo cuando el componente que dejaste de construir tiene más EV que el que terminaste.** El gap entre "el bot funciona" y "el bot gana plata" no se cierra con más código del Motor REST — se cierra con código de P3 y Motor 2.

---

## Links
- [[kalshi-bot]]
- [[2026-06-12-FASE-0-completa-sprint-motores-Mundial-operativo]] — el sprint que esta auditoría reordena
- [[2026-06-07-sesion-Motor-REST-encendido-SHADOW-WAL-fix]] — encendido del shadow
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — la decisión que llevó al Motor REST
- [[2026-06-02-HALLAZGO-INVERTIDO-liquidez-dilata-no-comprime]] — el dato que sostuvo Motor REST sobre NBA-proxy (que NO valió para Mundial)
