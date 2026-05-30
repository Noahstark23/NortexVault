---
tipo: sesion
proyecto: "[[kalshi-bot]]"
fecha: 2026-05-30
tags:
  - kalshi
  - v2
  - watchdog
  - ws-zombie
  - deploy
  - post-mortem
  - causa-raiz-capturada
estado: cerrada
frentes-tocados:
  - V1-watchdog
  - V2-activacion
  - instrumentacion
autoria: noel-redactada
---

# Sesión 2026-05-30 tarde — Watchdog a prod + 3ª ventana V2 (causa raíz capturada)

> **Nota redactada por Noel.** Esta es la versión narrativa de la sesión, con el bloque clave del `msg_seq=186 state_seq=184` destacado. Mantenida tal como se redactó. Los detalles técnicos extendidos viven en archivos separados linkeados al final.

## TL;DR
Dos logros grandes: (1) el fix del **watchdog WS** llegó a producción y quedó validado 7h+; (2) la **tercera activación de V2** falló como las anteriores PERO esta vez la instrumentación capturó la causa raíz — **NO es feed corruption, es desincronización de secuencia en bootstrap**. El frente V2 pasó de "causa desconocida" a "causa identificada, fix pendiente".

---

## 1. Watchdog WS → producción ✅ CERRADO

- **PR #1** (`claude/nifty-darwin-2s7wm`) mergeado a main → commit `b52a052` → deploy.
- Fix = 3 piezas (Fase 1): `force_reconnect()` ante silencio >300s, alerta Telegram tras N detecciones, TTL de 900s en `last_error`.
- **Validado 7h+ en prod**: 0 `force_reconnect` espurios, 0 tracebacks post-deploy, throughput continuo sin gaps.
- Origen: incidente WS zombie del 28-may (ver [[leccion-10-FINAL-ws-zombie-con-fix-validado]]).

### Deuda explícita (NO asumir como hecho)
- **Latencia real ~10-15min**, no 60s. El detector reacciona a silencio de 300s, NO a degradación escalonada con goteo.
- **Fase 2 (detector de tasa)** = pendiente. Requiere baseline por hora (varianza del feed: 5k-56k/h, threshold absoluto da falsos positivos).
- **Dos señales `ws_connected` sin unificar**: la TCP-based (Coolify `/health`, 300s) puede mostrar verde durante un zombie.

---

## 2. Tercera ventana V2 → FALLÓ, pero causa CAPTURADA 🎯

### El hallazgo (lo más importante de la sesión)
La instrumentación (`logger.error` línea 407, capturada en attempt #3) registró:

```
msg_seq=186 state_seq=184 side=yes price_cents=3 delta_size=-13 bucket_qty_pre_delta=2
```

**El book estaba en seq 184 y le llegó un delta de seq 186 → falta el 185.** V2 aplicó un delta adelantado sobre estado desincronizado: `2 + (-13) = -11` → `OrderbookDesyncError`.

**NO es feed corruption.** El label "feed corruption" en el mensaje de error es del código, no un diagnóstico. El gap visible en la secuencia prueba que es bug interno de V2 en manejo de gap/recovery durante bootstrap. → **Hipótesis C del tercer discovery, confirmada con evidencia dura.**

### Datos del incidente
- Activación 17:41:01, primer error a 17:41:08 (**T+37s**, bootstrap — mismo patrón que attempts 1 y 2).
- Ticker: `KXMLB-26-PHI` a 3¢.
- Cadena: desync → gap seq sid=1 (esperaba 186, llegó 187) → `_start_recovery` (CRITICAL, 37 tickers stale) → Kalshi `code 15 "Action required"`.
- Recovery **no convergió** (`books_initialized: 0` a T+6min) → rollback.

### Evidencia preservada
`data/v2_attempt3_20260530_174849.log` (29KB, 390 líneas) — en volumen persistente, sobrevive restart. Contiene el `raw_msg` pre-corrupción, la cadena completa del error, el `_start_recovery`, y el `/status`.

### Rollback
`USE_ORDERBOOK_MANAGER_V2=false` → redeploy → V1 baseline sano, `last_error: null`, <5min. Tercera contención disciplinada, cero daño (trading off).

---

## 3. Lo que cambió de estado

| Antes | Después |
|---|---|
| Causa raíz V2 = NO resuelta ([[leccion-9-FINAL-causa-raiz-pendiente]]) | **Causa identificada: desync de secuencia en bootstrap** |
| Hipótesis A/B/C abiertas | **C confirmada con evidencia** (A=feed y B=snapshot parcial descartadas) |
| Próximo paso V2 = más diagnóstico | **Próximo paso = diseñar fix** (problema concreto, no fantasma) |
| Watchdog en PR | **Watchdog en producción, validado** |

---

## 4. Pendientes (próximas sesiones, sin urgencia)

- [ ] **4º discovery V2** → analizar el log capturado: ¿por qué V2 no bufferó el seq 185? ¿por qué el recovery no convergió? De ahí sale el diseño del fix de bootstrap/gap-handling.
- [ ] **Lección 10** → elegir versión (corta vs completa) y commitear a PR #2. Quedó sin decidir.
- [ ] **PR #2** (`claude/v2-desync-logging`) → en draft, instrumentación + update Lección 9 ya commiteados. Mergear cuando se decida.
- [ ] **Fase 2 watchdog** (detector de tasa con baseline por hora) → ticket de diseño.
- [ ] **`sqlite3 database is locked`** (visto 19:46/19:48 del 28, container viejo) → monitorear si se repite. Baja prioridad.

---

## 5. Meta-aprendizajes de la sesión

- **La instrumentación pagó.** El 25-may volamos a ciegas (`NoneType: None`). Hoy el `raw_msg` en ERROR resolvió en una ventana lo que 3 discoveries no pudieron. → *El logging defensivo en el path de error vale su peso en oro.*
- **"Capturar es ganar"** — el cambio de mentalidad funcionó: V2 falló pero la ventana fue éxito porque salió con evidencia.
- **Dos agentes frenaron solos** ante patrones raros (el del backup colgado, el del arranque "no verde"). El sistema de contención funciona en todas las capas, no solo en la humana.
- **Pre-flight completo por 1ª vez**: los 4 (backup íntegro con `integrity=ok`, flags por nombre sin exponer secretos, Telegram confirmado EN EL CELULAR no solo `sent=True`, código verificado en vivo no por commit message).
- **Corrección de seguridad al runbook**: el pre-flight lee flags con `printenv VAR1 VAR2` por nombre, NUNCA dump del environment (expondría `KALSHI_API_KEY_ID`, `TELEGRAM_BOT_TOKEN`).

---

## Links (ajustados a nombres reales del vault)
- [[kalshi-bot]] · [[leccion-9-FINAL-causa-raiz-pendiente]] · [[leccion-10-FINAL-ws-zombie-con-fix-validado]]
- [[cheatsheet-runbook-12.5-v2-activacion]]
- Sesiones previas: [[sesion-2026-05-27-segunda-ventana-v2-preflight]] · [[sesion-2026-05-28-leccion-9-corregida-y-ws-zombie]] · [[sesion-2026-05-29-fix-v1-mergeado-y-tercer-discovery-v2]] · [[sesion-2026-05-30-cuarto-discovery-v2-instrumentacion-plan]] (mañana del mismo día)

## Artefactos técnicos derivados (escritos por Claude post-sesión)
- [[causa-raiz-v2-desync-secuencia-bootstrap-CAPTURADA]] — el smoking gun en detalle
- [[incidente-v2-attempt-3-2026-05-30-causa-capturada]] — post-mortem técnico
- [[update-leccion-9-v2-causa-raiz-resuelta-30may]] — texto del próximo update para `KALSHI_BOT_CONTEXT.md` v1.6 / v1.7
