---
tipo: sesion-implementacion
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-23
tags:
  - kalshi
  - f1-roadmap
  - auto-sync-capital
  - pr-100
  - guardrails-arquitectonicos
  - 2026-06-23
estado: F1-C-01-implementado-en-PR-draft
frente: "F1 auto-sync capital pasó de 'anticipado' a 'en progreso' — PR #100 (C-01) en draft, C-02/C-03/C-04 pendientes"
parte: 2
relacionado:
  - "[[2026-06-23-optimizacion-capital-1500-server-upgrade-modo-prueba-mes]]"
  - "[[2026-06-21-botkalshi-arquitectura-completa-sistema-rentable]]"
---

# 2026-06-23 (parte 2) — F1 Auto-sync de capital en progreso (PR #100)

## TL;DR

Continuación del día. Después de bumpear cap manualmente + upgradeear servidor (parte 1), se
arrancó la implementación del **F1 del roadmap** (auto-sync de capital). **PR #100 (C-01)
draft con `refresh_capital_from_balance()` implementado**, caché a nivel CLASE, fallback nunca
$0. C-02/C-03/C-04 pendientes (factor 90% + clamp hard cap $5k, alerta de desfase, tests edge
cases). **Decisión NO posponer:** el techo de $5k antes de depositar más capital.

**Continúa de:** [[2026-06-23-optimizacion-capital-1500-server-upgrade-modo-prueba-mes]] — donde el
problema operativo del cap desactualizado justificó arrancar F1 inmediatamente.

---

## Infraestructura (HECHO — recap de parte 1)

- Capital: `ACTIVE_CAPITAL_USD` $1050 → $1500 (env var Coolify)
- Servidor: resize 1vCPU/2GB → 2vCPU/4GB ($28/mo)
- `do-agent` métricas instalado
- Bot: Running (healthy), Capital activo $1500, Trading enabled
- **SidGapError: ya fixeado en main** (commit previo, log INFO limpio)

El item del SidGapError es nuevo respecto a la parte 1 — quedaba como "fix opcional pendiente"
y resulta que ya entró a main en algún commit previo del día. **Una deuda menos sin esfuerzo
explícito** — el diff ya estaba aplicado.

---

## Fase 1 — Auto-sync capital (EN PROGRESO)

### C-01 ✅ implementado → PR #100 (draft, rama `claude/nifty-darwin-2s7wm`)

- `refresh_capital_from_balance()` lee `GET /portfolio/balance` (cash disponible)
- **Caché a nivel CLASE** (cada motor crea su RiskManager — sin esto, cada motor pegaría a
  Kalshi independientemente)
- **Fallback nunca $0** (si el GET falla, mantiene el valor configurado en vez de colapsar
  el cap a cero)
- 18 risk tests + 51 totales pasando
- **Handoff C-02 en `docs/handoff/C-02.md`** — el doc que la próxima sesión leerá

### C-02 ⏳ pendiente (factor 90% + clamp hard cap $5k)

Margen de seguridad: no usar 100% del cash real, sino 90%. Y clampar contra hard cap.

### C-03 ⏳ alerta de desfase

Telegram/log cuando el cap efectivo cambia significativamente (transparencia operativa —
exactamente lo que F1 del roadmap del 21-jun pedía: "logueo claro cuando el cap cambia").

### C-04 ⏳ tests edge cases

Balance fluctuando, GET timeout, depósito durante un ciclo, retiro mid-ejecución, etc.

---

## Guardrails arquitectónicos (NO olvidar)

> **Documentados acá porque son el tipo de cosa que se pierde entre sesiones si no quedan
> explícitas.**

### 1. Hard cap $5000 en `_production_safety` → clampear capital efectivo

Aún si Kalshi reporta $10k de balance, el bot no debería operar con más de $5k hasta que el
operador suba este techo conscientemente. **El auto-sync NO elimina el techo manual** — solo
elimina el sobre-betting cuando el balance baja.

### 2. Caché balance a nivel CLASE (cada motor crea su RiskManager)

Si la caché estuviera a nivel INSTANCIA, cada motor pegaría independientemente a Kalshi
`GET /portfolio/balance` en cada ciclo → 3 motores × N ciclos/min = rate limit problem. **A
nivel CLASE, una sola llamada compartida** entre todos los motores.

### 3. Stop-losses (daily/weekly/monthly) también se vuelven dinámicos

Si el cap cambia automáticamente, los stop-losses (que son % del cap) también cambian. Esto
no es bug — es feature: si depositaste $1k más, tu stop-loss diario también se mueve. **Pero
el operador debe entender que el comportamiento del stop-loss ya no es estático.**

### 4. `ACTIVE_CAPITAL_USD` default en código ya es $4000 (scale-4k)

Importante: el default subió de los valores históricos. **Cualquier deploy nuevo arranca con
$4000 si el env var no está seteado.** Esto se conecta con el guardrail #1: aún con $4000
default, el hard cap de $5000 deja margen pero NO mucho. Si depositás $5k+ y el env var no
está bien seteado, el bot operaría con $5000 — el clamp protege, pero el operador no se
entera del techo.

---

## Acciones pendientes del owner

- [ ] Revisar PR #100 + esperar CI verde
- [ ] Mergear #100 → validar logs post-deploy (balance real, no fallback)
- [ ] **Decidir techo de seguridad real ($5k actual vs subirlo) antes de depositar más**
- [ ] Abrir sesión nueva C-02 con `docs/handoff/C-02.md`

---

## La decisión que NO se debe posponer

> *"Como planeas depositar más capital, decide en frío si ese límite [$5k] te sirve antes
> de que un depósito grande haga que el bot no arranque (o sub-utilice el capital)."*

**Por qué importa decidirlo AHORA y no después del depósito:**

1. **Decisión en frío vs en caliente:** decidir el techo cuando tenés el depósito pendiente
   pero no transferido es decisión deliberada. Decidirlo después de transferir es decisión
   bajo presión ("no puedo operar con todo el capital, ¿subo el techo?") — y el patrón meta
   de la saga dice que decisiones bajo presión saltean gates.

2. **El bot puede sub-utilizar sin avisar** (parte 1 lo probó hoy). Si depositás $5k+, el
   bot operaría con $5000 (clampado) silenciosamente. No es bug — pero sin telemetría clara,
   te enterás cuando notás que la captura está saturada.

3. **El techo es decisión de gestión, no técnica.** Subirlo es trivial (variable de
   configuración). Bajarlo después de tener $10k corriendo es más doloroso. **Mejor techo
   conservador que se sube deliberadamente, que techo agresivo que se baja después.**

**Recomendación implícita:** mantener $5k hasta que el mes de prueba (con $1500) muestre
break-even + estabilidad. Si la prueba va bien y querés escalar a $3k → bumpear cap a $3500
(margen). Si querés $5k → mantener el techo y operar al máximo. Si querés más que $5k → subir
el techo CONSCIENTEMENTE y aceptar la varianza.

---

## El arco del día completo (parte 1 + parte 2)

| Hora | Hito |
|---|---|
| (parte 1, mañana) | Bot bloqueado por exposición topada `usable=$0.19`. Servidor saturado con 18-19 reinicios |
| (parte 1) | Diagnosis: 2 problemas independientes — capital desactualizado + droplet OOM |
| (parte 1) | Fix: ACTIVE_CAPITAL_USD $1050→$1500, droplet 1vCPU/2GB→2vCPU/4GB, do-agent instalado |
| (parte 1, ~03:55) | Logs confirman: capital $1500, 11/11 quotes usables, healthy |
| (parte 2) | Hallazgo: F1 del roadmap se justifica con evidencia operacional. **Arranque inmediato de implementación.** |
| (parte 2) | C-01 implementado en PR #100 (draft). `refresh_capital_from_balance()` + caché CLASE + fallback. 18+51 tests passing |
| (parte 2) | Handoff doc para C-02 listo en `docs/handoff/C-02.md` |
| (parte 2 cierre) | Decisión pendiente NO posponer: techo de $5k antes de depositar más |

**Velocidad del día:** del "F1 es próximo hito" del 21-jun al "F1 C-01 en PR draft" del 23-jun
parte 2. **Dos días desde la idea hasta el código.** Y el motivador no fue impaciencia — fue
que el problema operativo del cap desactualizado lo pasó de "deuda teórica" a "deuda
manifestada con `usable=$0.19`".

---

## Conexión con el patrón meta de la saga

**F1 es el primer item del roadmap que se acelera porque el problema operativo lo destapó.**
Los items anteriores del roadmap (FASE 0, sprint de motores) fueron construidos por
anticipación. F1 también estaba anticipado en el snapshot 21-jun — pero la diferencia es que
hoy el problema **se manifestó** (parte 1) y eso justificó arrancarlo HOY (parte 2) en vez de
"cuando toque".

**Lección operativa:** los items del roadmap que están "anticipados" se aceleran cuando el
régimen real los reclama. La auditoría del 12-jun acertó el orden de motores; el roadmap del
21-jun acertó la prioridad de F1; hoy 23-jun el problema operativo justifica el código.
**Mismo patrón meta:** medir el régimen real, dejar que la realidad ordene las prioridades.

---

## Estado consolidado al cierre del 23-jun (parte 2)

| Frente | Estado |
|---|---|
| Capital activo (operativo) | $1500 (parte 1) |
| Capital default en código | $4000 (scale-4k) — nuevo |
| Cap de exposición (50%) | $750 |
| Cash real Kalshi | $3000 disponible, $1500 puesto a trabajar |
| Hard cap producción | **$5000** (clampa cualquier balance reportado) |
| Servidor | 2vCPU/4GB |
| do-agent | Instalado |
| SidGapError | ✅ FIXEADO en main (commit previo del día) |
| **F1 C-01 (refresh_capital_from_balance)** | ✅ Implementado en PR #100 (draft) |
| F1 C-02 (factor 90% + clamp hard cap) | ⏳ Pendiente, handoff doc en `docs/handoff/C-02.md` |
| F1 C-03 (alerta de desfase) | ⏳ Pendiente |
| F1 C-04 (tests edge cases) | ⏳ Pendiente |
| Tests passing | 18 risk + 51 totales |
| **Decisión pendiente NO posponer** | 🟡 Techo $5k antes de depositar más capital |
| Modo prueba 1 mes (parte 1) | 📅 Sigue activo |

---

## Frase del día (parte 2)

> **"F1 pasó de roadmap a código en dos días — no por impaciencia, sino porque el régimen
> real (cap desactualizado bloqueando señales) lo reclamó. La velocidad correcta sale de la
> realidad pidiéndola, no del impulso de hacer."**

---

## Para el próximo turno

1. **Decisión en frío: techo de $5k.** ¿Sirve, subirlo, mantenerlo? Decidir ANTES de
   depositar más capital, no después.
2. **Revisar PR #100 + esperar CI verde** (18+51 tests ya pasan locales).
3. **Mergear #100 + redeploy + validar logs:** confirmar que `refresh_capital_from_balance()`
   loguea balance real, no fallback. Si loguea fallback consistente → bug del GET, no del
   auto-sync.
4. **Abrir sesión C-02 con el handoff doc** — factor 90% + clamp hard cap $5k.
5. **Vigilar (de parte 1):** RAM estabilizada, reinicios paran, abre posiciones nuevas.

---

## Links
- [[kalshi-bot]]
- **[[2026-06-23-optimizacion-capital-1500-server-upgrade-modo-prueba-mes]] — parte 1 (capital + servidor)**
- [[2026-06-21-botkalshi-arquitectura-completa-sistema-rentable]] — snapshot maestro donde F1 estaba anticipado
- [[2026-06-18-parte-2-flags-por-motor-bug-position_fp-escalado-Motor-2-Telegram]] — patrón de parte 1/parte 2 del mismo día
- [[2026-06-12-AUDITORIA-motores-gap-entre-infra-y-senal]] — la auditoría que ordenó el roadmap
