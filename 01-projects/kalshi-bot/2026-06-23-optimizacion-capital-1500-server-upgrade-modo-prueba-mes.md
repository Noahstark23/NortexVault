---
tipo: sesion-optimizacion
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-23
tags:
  - kalshi
  - optimizacion
  - capital-escalado
  - infraestructura
  - digitalocean
  - exposicion-topada
  - oom
  - sidgaperror
  - modo-prueba-mes
  - 2026-06-23
estado: optimizado-en-prueba
frente: "Bot desbloqueado + servidor upgradeado. Modo prueba 1 mes para validar break-even antes de escalar a $3000"
relacionado:
  - "[[2026-06-21-botkalshi-arquitectura-completa-sistema-rentable]]"
---

# 2026-06-23 — Sesión de optimización: capital $1500 + upgrade servidor + modo prueba 1 mes

## TL;DR

Bot estaba **bloqueado (no tomaba posiciones)** + servidor **saturado (18-19 reinicios)**.
Subimos capital **$1050→$1500** y servidor **1vCPU/2GB→2vCPU/4GB**. Bot ahora corriendo limpio.
**En modo prueba 1 mes.**

---

## Diagnóstico — los 3 problemas

### 1. Capital (RESUELTO ✅)

- Bot rechazaba **TODAS las señales** con `usable=$0.19`
- Causa: exposición topada al 100% ($525 de $525)
- **Hallazgo clave:** el bot **NO lee el cash real de Kalshi** — solo usa `ACTIVE_CAPITAL_USD`
  (config) + exposición interna en `trades.db`

**Variables relevantes:**

- `ACTIVE_CAPITAL_USD` = capital que el bot cree tener
- `MAX_SIMULTANEOUS_EXPOSURE_PCT = 50%` → cap de exposición
- `MAX_TRADE_SIZE_PCT = 3.0`

### 2. Servidor (RESUELTO ✅)

- Droplet **1vCPU/2GB saturado**
- CPU 70-75%, load 2.0-2.8 (sobre 1 solo núcleo)
- **RAM patrón sierra 50-82% = firma de OOM** → causaba los reinicios
- Reinicios eran **del contenedor (Coolify), NO del servidor** (DO confirmó último power event
  hace 1 mes)

### 3. SidGapError (PENDIENTE — no urgente)

- Sid gap: `expected seq=102, got 105` → WS perdió mensajes
- **NO crashea el bot:** lo captura `asyncio.gather(return_exceptions=True)` → solo loggea
- **Era síntoma** del servidor saturado, no causa de reinicios
- Fix = solo limpieza de log (ERROR ruidoso → INFO). Diff listo para Claude Code

---

## Acciones ejecutadas

| Cambio | De | A |
|---|---|---|
| `ACTIVE_CAPITAL_USD` | $1050 | **$1500** |
| Cap de exposición (50%) | $525 | **$750** |
| Plan droplet | $14/mo (1vCPU/2GB) | **$28/mo (2vCPU/4GB)** |
| `do-agent` (métricas) | — | **instalado ✅** |

**Secuencia usada:** guardar variable en Coolify → power off droplet → resize → power on.
**Un solo downtime resolvió ambas cosas** (el reinicio del SO ya hizo que el contenedor leyera
el capital nuevo, sin redeploy extra).

---

## Estado actual (confirmado en logs 03:55)

- **Capital activo: $1500.0** ✅
- **Trading enabled: True** ✅
- **Running (healthy)** ✅
- **motor2.kalshi 11/11 eventos con quotes usables** ✅
- Búsqueda `usable=$0.19` → **0 matches** (salió del estado de rechazo)

---

## Economía / break-even

- **Costo fijo: $58/mes** ($28 droplet + $30 API)
- Sobre $1500 capital = **~3.9% mensual mínimo** para no perder
- Cash real disponible: $3000 (solo $1500 puesto a trabajar por ahora)

**Calibración del cap:** $1500 sobre $3000 disponibles = 50% del cash real puesto a trabajar.
Misma proporción de "operación cautelosa" que la disciplina de toda la saga. **No escalar a
$3000 hasta validar el mes.**

---

## Siguientes pasos

1. **Vigilar 24-48h** → confirmar que RAM se estabiliza (ya no sierra) y reinicios paran.
   Revisar gráfica con `do-agent`.
2. **Confirmar que abre posiciones nuevas** → ~$225 de margen libre ($750 cap − $525 abierto).
   Señales béisbol Jun 24-25.
3. **Validar break-even en el mes** → si genera **>$58 neto + estable** → justifica escalar
   hacia los $3000.
4. (Opcional) Aplicar fix SidGapError con Claude Code (solo logs).

---

## Notas de criterio

- **Estabilidad (hardware) ≠ volumen de trading (capital/config) — dos problemas
  independientes.** El servidor más potente no aumenta posiciones; eso lo hace el capital.
- **NYC3 es óptimo para latencia** (cerca de Kalshi/AWS us-east-1). El upgrade da estabilidad,
  NO menos latencia de red.
- **No escalar capital más allá de $1500 hasta ver resultados del mes.** Con 50% exposure,
  $1500 = hasta $750 simultáneos en riesgo.
- **General Purpose / Dedicated CPU no disponibles en NYC3** — por eso fuimos a Basic Premium
  AMD.

---

## Referencias rápidas

- Droplet DO: `555867684` (ubuntu-s-1vcpu-1gb-nyc3-01 → ahora 2vCPU/4GB)
- Commit desplegado: `f7e56c9`
- Repo: `Noahstark23/botkalshi`
- Archivos clave revisados: `src/risk/manager.py`, `src/utils/config.py`,
  `src/clients/kalshi_ws.py`, `orderbook_manager_v2.py`

---

## El hallazgo que conecta con el roadmap F1

> **"El bot NO lee el cash real de Kalshi — solo usa `ACTIVE_CAPITAL_USD` (config) + exposición
> interna en `trades.db`."**

**Este es EXACTAMENTE el problema que el F1 del roadmap del 21-jun anticipó:**

Del snapshot 21-jun:
> *"F1 ⭐ Auto-sync de capital — bot lee cash real y ajusta techo solo. Elimina sobre-betting
> si cash baja. Métricas de éxito: `ACTIVE_CAPITAL_USD_EFFECTIVE` se calcula desde el balance
> Kalshi en cada ciclo; cap nunca > cash real (regla de oro automatizada); logueo claro cuando
> el cap cambia."*

**Hoy se manifestó el problema:** `ACTIVE_CAPITAL_USD=1050` quedó desactualizado, no
correspondía al cash real, y el bot rechazaba señales con `usable=$0.19` mientras había $3000
disponibles. **La operación manual de "match cap con cash" se sostuvo manualmente** (bumping
de $1050 a $1500), pero F1 lo va a eliminar como categoría de problema.

**Lección operativa que esto suma:** mientras F1 no esté implementado, el operador debe revisar
periódicamente que `ACTIVE_CAPITAL_USD` ≤ cash real Y que la exposición real esté dentro del
cap. **El bot puede entrar a "modo rechazo silencioso" sin avisar** — no es bug, es la regla
de oro funcionando, pero sin telemetría clara de "cap saturado vs señal real" es difícil
distinguir "no hay oportunidad" de "no se puede ejecutar".

---

## El patrón meta del día

**Dos problemas independientes que parecían uno solo.** Reinicios + bot bloqueado → fácil
asumir "los reinicios bloquearon el bot". La realidad: dos causas separadas (servidor saturado
por OOM + exposición topada por config desactualizada) que se solucionaron con dos cambios
independientes (upgrade hardware + bump de cap).

**Si hubieras escalado solo capital** (sin upgrade de servidor) → los reinicios habrían
continuado.
**Si hubieras hecho solo el upgrade** (sin bumpear cap) → el bot seguía rechazando señales.

**Mismo patrón meta de toda la saga aplicado a diagnóstico:** *"medir la causa real antes de
actuar — los síntomas correlacionados pueden tener causas independientes."*

Y se conecta con el patrón del 18-jun parte 1 sobre el rollback:
> *"Un mecanismo de seguridad que se ejercita frecuentemente NO es seguridad — es síntoma."*

Acá el "síntoma" era distinto: el bot rechazaba señales (parecía bug del filtro) cuando en
realidad la regla de oro de exposición estaba funcionando correctamente — solo que sobre un
cap desactualizado. **El sistema protegiendo, no roto.** Mismo principio del 21-jun
(`usable=$0.11` por cap saturado).

---

## Estado consolidado al cierre del 23-jun

| Frente | Estado |
|---|---|
| Capital activo | ✅ $1500 (era $1050 — había rechazo por exposición topada) |
| Cap de exposición (50%) | $750 (era $525) |
| Cash real Kalshi disponible | $3000 (solo $1500 puesto a trabajar) |
| Margen libre actual | ~$225 ($750 − $525 abierto) |
| Servidor | ✅ 2vCPU/4GB (era 1vCPU/2GB saturado, RAM sierra OOM) |
| Reinicios contenedor | 18-19 acumulados → debería detenerse post-upgrade |
| Logs de salud | `usable=$0.19` ya NO aparece, 11/11 quotes usables |
| do-agent métricas DO | ✅ Instalado |
| SidGapError | 🟡 Pendiente fix de log (no urgente, no crashea) |
| **Modo prueba** | 📅 **1 mes** — validar break-even >$58 + estable antes de escalar a $3000 |
| Costo fijo mensual | $58 ($28 droplet + $30 API) |
| Break-even mínimo | ~3.9% mensual sobre $1500 |
| Próximo hito F1 | ⭐ Auto-sync capital — sigue siendo prioridad (este día lo probó) |

---

## Frase del día

> **"Dos problemas independientes que parecían uno: servidor saturado (OOM) bloqueaba la
> infra; cap de capital desactualizado bloqueaba el flujo. Upgrade + bump resolvieron ambos
> con un solo downtime. Modo prueba 1 mes antes de escalar a $3000."**

---

## Links
- [[kalshi-bot]]
- **[[2026-06-21-botkalshi-arquitectura-completa-sistema-rentable]]** — snapshot maestro donde
  F1 (auto-sync) ya estaba identificado como próximo hito; hoy se manifestó el problema
- [[2026-06-18-PRIMER-DIA-CAPITAL-Motor-2-gana-Motor-REST-sangra-fix-pata-dura]] — primer día con capital
- [[2026-06-18-parte-2-flags-por-motor-bug-position_fp-escalado-Motor-2-Telegram]] — escalado anterior $100→$300
- [[2026-06-12-AUDITORIA-motores-gap-entre-infra-y-senal]] — la auditoría profética
