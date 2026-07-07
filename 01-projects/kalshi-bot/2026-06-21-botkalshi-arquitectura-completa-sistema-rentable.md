---
tipo: arquitectura-snapshot
proyecto: "[[kalshi-bot]]"
fecha: 2026-06-21
tags:
  - botkalshi
  - trading
  - arquitectura
  - sistema
  - rentable
  - master-doc
  - 2026-06-21
estado: rentable
actualizado: 2026-06-21
relacionado:
  - "[[2026-06-18-PRIMER-DIA-CAPITAL-Motor-2-gana-Motor-REST-sangra-fix-pata-dura]]"
  - "[[2026-06-18-parte-2-flags-por-motor-bug-position_fp-escalado-Motor-2-Telegram]]"
---

# 🤖 botkalshi — Arquitectura Completa (snapshot 2026-06-21)

> **Estado actual:** Running (healthy) · **+$250 P&L realizado** · winrate **69.5%** · fees $0.70
> Cash real Kalshi: **$216** · posiciones abiertas: **$158** · **total ~$375**

---

## 🧠 Idea central

Bot de trading **multi-motor** sobre la API de Kalshi. No es "apostar y rezar" — tiene motores
con responsabilidades separadas, capa de riesgo dura y feature flags. Desplegado en **Coolify**
sobre droplet de **DigitalOcean**.

---

## 🏗️ Las 6 capas

**Flujo:** Mercado → Estrategia → Riesgo → Ejecución → Persistencia (+ Observabilidad transversal)

1. **Datos de mercado** — ingiere y evalúa tickers de Kalshi (Motor REST evalúa 41k+/ciclo)
2. **Estrategia** — los 3 motores, independientes entre sí
3. **Risk Manager** — guardián único; toda orden pasa por acá
4. **Ejecución** — habla con Kalshi vía FOK/IOC (place_order V2, sin 410)
5. **Persistencia** — sqlite `/app/data/trades.db`, fuente de verdad del P&L
6. **Observabilidad** — logs + alertas Telegram + health checks Coolify

---

## ⚙️ Los 3 motores

| Motor | Rol | Estado | P&L |
|---|---|---|---|
| **Motor 2 — consensus** | El que gana 🏆 | Activo real | **+$252.91 (48 tr)** |
| **Motor REST — arbitraje** | Detecta cruces | Shadow (REST=False) | −$2.61 (11 tr) |
| **Motor 3 — CLV** | Trackea posiciones + close_time | Activo diagnóstico | — |

---

## 🛡️ Risk Manager (la pieza clave)

> Toda la lógica de sizing vive en `risk/manager.py`

- `ceiling = ACTIVE_CAPITAL_USD × 50%` (exposición máx simultánea)
- `max_trade = CAP × 5%`
- `usable = min(max_trade, cupo_restante, $200)`
- **Regla de oro:** `CAP ≤ cash real` (si no, órdenes fallan por fondos)

**Cuando "no apostaba" → no era bug, era el techo de exposición lleno** ($149/$150). El sistema
protegiendo, no roto. Es exactamente el patrón meta de la saga aplicado al diseño operativo:
*"un mecanismo de seguridad funcionando se ve igual que un mecanismo roto si no mirás la
métrica correcta"*.

---

## 🗄️ Estados de un trade

`filled` → `settled` (cierra con `pnl_cents`) · `cancelled` (FOK/IOC que no llenó)

**Hoy (snapshot 21-jun):**
- 30 filled
- 59 settled
- 1475 cancelled

El ratio de cancelled altísimo (1475 / 1564 ≈ 94%) es **esperable y SANO** dado el diseño:
FOK/IOC priorizan precio sobre fill — preferimos perder la oportunidad antes que llenar a
precio peor. Los 89 que llenaron son los que tenían profundidad real al precio elegible.

---

## 🖥️ Infra

- Droplet **2GB / 1vCPU**, uso ~437MB, load ~1.0
- Deploy vía **Coolify** → Configuration → Environment Variables
- Config actual: `CAP=300 · EXP=50% · TRADE=5% · MAX_TRADE=$200 · TRADING=true · REST=false`

---

## ⚠️ Gotchas operativos (memoria de terminal)

**Para la próxima sesión:**

- Terminal Coolify: **reconectar tras cada redeploy** (container nuevo)
- **Click en terminal ANTES de tipear** — el "/" abre el palette y tira la sesión
- DB es `/app/data/trades.db` (NO `bot.db`) · columna es `strategy` (NO `motor`) · timestamp
  `placed_at`
- settings: `from src.utils.config import get_settings` (NO `src.config.settings`)
- `KalshiRestClient` necesita `async with` · no hay `sqlite3` CLI ni `free` → usar python3 /
  /proc
- `get_page_text` obsoleto → usar screenshots

**Estos gotchas valen oro** — son la memoria operacional que sin notarla cuesta ~30min de
re-aprender en cada sesión nueva. Vale tenerlos siempre a un click.

---

## 🗺️ Roadmap

- **F0** Higiene (runbook, gaps Motor 1, reinicios)
- **F1** ⭐ **Auto-sync de capital** — bot lee cash real y ajusta techo solo
- **F2** Validar + activar Motor REST (tests KILL ya listos)
- **F3** Observabilidad (dashboard métricas, alertas ricas)
- **F4** Resiliencia infra (separar DB, backups)
- **F5** Escalado de capital continuo

---

## 📜 Constitución del proyecto

> **Principios que mantuvieron el sistema sano:**

1. **Diagnosticar con datos reales antes de actuar**
2. **Código de dinero real → solo vía PR del operador**
3. **Capital/env vars → solo el operador en Coolify**
4. **Validar contra realidad (API/logs/DB), no suposiciones**
5. **Separar siempre bot vs manual · P&L por motor**

**Esta es la destilación del patrón meta de toda la saga** en cinco reglas operativas. Cada
una se ganó con un bug o un casi-bug a lo largo del proyecto:
- Regla 1 ← V2 attempts #1/#2/#3, edges fantasma 14-jun
- Regla 2 ← misterio Part A commit `49231da`, PR #11 audit
- Regla 3 ← `TRADING_ENABLED` global, AUTJOR
- Regla 4 ← fantasma code 8, position_fp, firma 401
- Regla 5 ← AUTJOR fills, dashboard mintiendo

---

## 💰 Valor de ingeniería

Activo reproducible **~$18k–45k USD** (sistema $15-40k + operaciones $1.5-4k).

*Costo de reproducir el trabajo ≠ valor comercial (eso depende de rentabilidad sostenida a
escala).*

---

## El salto del 18-jun → 21-jun en perspectiva

**18-jun (primer día con capital):**
- Balance neto: +$10.55 sobre $100 (+10.5% en 24h)
- Motor 2: 8 trades, 50% wr, +$13.16
- Motor REST: 11 trades, 9% wr, −$2.61 (sangrando — fix #85)

**21-jun (hoy, después del escalado parte 2 + 3 días operativos):**
- Balance neto: **+$250 P&L sobre $300** (+83% acumulado)
- Motor 2: **48 trades, 69.5% wr, +$252.91** (6× más trades, win-rate subió de 50% → 69.5%)
- Motor REST: dormido (REST_ENABLED=True, EXECUTION_ENABLED=False) por fix pendiente validar
- Total: cash $216 + portfolio $158 = ~$375

**El win-rate subió de 50% → 69.5% con N de 8 → 48 trades.** Esto puede ser:
- Convergencia hacia el win-rate true (la varianza con N=8 era demasiado alta para creer 50%)
- El escalado funcionó porque destrabó el cap de exposición — más señales se ejecutaron
- Mejor selección por el `MOTOR_2_MIN_EDGE_PCT` calibrado tras #53/desglose auditable
- Mundial entrando en eliminatorias con mercados más predecibles

**Caveat:** N=48 sigue siendo muestra acotada (semanas, no meses). Pero la trayectoria es la
que esperabas — la auditoría del 12-jun acertó con N=19, y ahora con N=48 sigue acertando.

---

## El cierre del arco "de shadow a rentable" en 9 días

| Fecha | Hito | Estado |
|---|---|---|
| 13-jun | Feed real conectado, primera señal consensus 3.11pp | Shadow |
| 14-jun | Edges fantasma cazados (PR #54: 3 guardarraíles) | Shadow limpio |
| 18-jun parte 1 | Primer día con capital $100. Bug arb huérfano cazado por $4.83 | Live, frenos OK |
| 18-jun parte 2 | Per-motor flags + position_fp + escalado $100→$300 + Telegram | Live, multi-motor desacoplado |
| 19-21-jun | Tres días de operación escalada | +$250 acumulado |
| **21-jun** | **Snapshot rentable: 48 tr · 69.5% wr · $375 total** | **🏆 RENTABLE** |

**9 días entre el primer feed real y el sistema rentable.** Los 5 días previos
(03-07 jun) fueron infra; los 5 días intermedios (07-12 jun) fueron sprint de motores + auditoría;
los 9 días finales fueron validación + capital + escalado.

**Costo total del aprendizaje a lo largo de la operación con capital: $4.83.** Todo lo demás
es ganancia. La disciplina de gates de toda la saga se pagó con la inversa: cada gate que
respetaste, cada motor que dejaste dormir hasta validar, cada bug que descubriste antes de
escalar — todo eso es lo que hizo posible el 69.5% wr de hoy.

---

## Conexión con el patrón meta de la saga

**El sistema está rentable PORQUE respetó el patrón meta en cada bifurcación:**
- Saga V2 archivada por análisis empírico → no se construyó fortaleza compleja
- Auditoría 12-jun reordenó portafolio → Motor 2 prioridad #1
- Disciplina N=1 marginal 13-jun → protegió integridad de la muestra del 14-jun
- 3 guardarraíles 14-jun → defensa contra fantasmas in-play
- Capital con frenos 18-jun → cazó bug arb huérfano por $4.83
- Flags por-motor 18-jun parte 2 → permitió validar shadow sin apagar ganador
- Escalado modesto $100→$300 (no $3k) → varianza acotada
- Motor REST dormido hasta validar fix → no recurre el bug

**Cada decisión "lenta" pagó dividendos.** La velocidad real del proyecto no es la velocidad
de mergear PRs — es la velocidad de iterar SIN romper lo que funciona. Y eso es exactamente
lo que la disciplina de gates compra.

---

## Próximos hitos (F1 + más allá)

**F1 — Auto-sync de capital (⭐ próximo):**
El operador no debería tener que ajustar `ACTIVE_CAPITAL_USD` manualmente cada vez que deposita
o retira. El bot debería leer el cash real de Kalshi y ajustar el techo automáticamente. Esto
elimina una clase de error (sobre-betting si el cash bajó) y libera al operador para enfocarse
en estrategia, no en sincronización.

**Métricas de éxito del F1:**
- `ACTIVE_CAPITAL_USD_EFFECTIVE` se calcula desde el balance Kalshi en cada ciclo
- Cap nunca > cash real (regla de oro automatizada)
- Logueo claro cuando el cap cambia (transparencia operativa)

**Hueco actual:** el operador es el que valida que el cap del bot match con el cash real. Es
una operación manual que ya falló una vez (over-betting transitorio en algún momento). Auto-sync
lo elimina como categoría de problema.

---

## El estado del cerebro (Obsidian + NotebookLM)

Esta nota es la **snapshot maestra** de arquitectura — útil para:
- **Onboarding rápido** de un colaborador futuro (humano o agente)
- **Re-arranque** después de pausa larga del proyecto
- **NotebookLM** como source consolidado del estado actual
- **Auditoría externa** (CTO de Gemini, code reviewer, etc.)

Las sesiones individuales (con prefijo `YYYY-MM-DD-`) cuentan el cómo se llegó aquí. Esta
nota cuenta dónde estamos hoy.

---

## Links
- [[kalshi-bot]]
- [[2026-06-18-PRIMER-DIA-CAPITAL-Motor-2-gana-Motor-REST-sangra-fix-pata-dura]] — parte 1
- [[2026-06-18-parte-2-flags-por-motor-bug-position_fp-escalado-Motor-2-Telegram]] — parte 2
- [[2026-06-14-edges-fantasma-Motor-2-in-play-fix-PR-54]] — defensa contra fantasmas
- [[2026-06-13-Motor-2-encendido-feed-real-primera-senal-consensus]] — encendido Motor 2
- [[2026-06-12-AUDITORIA-motores-gap-entre-infra-y-senal]] — la auditoría profética
- [[2026-06-12-FASE-0-completa-sprint-motores-Mundial-operativo]] — sprint FASE 0
- [[2026-06-05-sesion-FOKExecutor-sensor-validado-API-viva]] — cisne negro 409
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — decisión arquitectónica madre
