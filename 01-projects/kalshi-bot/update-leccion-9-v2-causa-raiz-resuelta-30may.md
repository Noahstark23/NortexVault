---
fecha: 2026-05-30
tipo: leccion-update
proyecto: kalshi-bot
numero: 9
estado: redactado-pendiente-merge-PR2
target: KALSHI_BOT_CONTEXT.md (v1.6 → v1.7)
relacion: actualiza update previo del 29-may + cierra causa raíz
tags:
  - leccion-update
  - kalshi-bot
  - causa-raiz-resuelta
  - smoking-gun
---

# Update Lección 9 — Causa raíz V2 CAPTURADA en attempt #3

> Segundo update consecutivo a Lección 9, pero esta vez con causa raíz **CONFIRMADA** por evidencia dura del log instrumentado durante attempt #3 (30-may 17:41 UTC). El update del 29-may dejó causa "no resuelta" con A/B/C abiertas; este la cierra con C confirmada y A/B descartadas.

## Por qué hay un SEGUNDO update

- **Update #1 (29-30 may):** tercer + cuarto discovery, parsing limpio, V2 NO exculpado, 3 hipótesis A/B/C vivas (ver [[update-leccion-9-29may-tercer-discovery-cerrado]])
- **Update #2 (30-may tarde, ESTE):** attempt #3 ejecutado con instrumentación, smoking gun capturado, **C confirmada, A y B descartadas**

Ambos updates entran al `KALSHI_BOT_CONTEXT.md` en orden cronológico. Lección 9 ahora tiene una progresión de estados que es valiosa documentación del proceso:

```
Versión inicial → "causa NO RESUELTA, pendiente tercer discovery"
Update #1       → "parsing limpio, V2 no exculpado, A/B/C vivas"
Update #2       → "C CONFIRMADA con evidencia, A/B descartadas"
(Futuro)        → "fix diseñado y validado en cuarta ventana"
```

## Texto del update (para pegar literal al final de Lección 9)

```markdown
**Update (30-may, tarde — attempt #3 con instrumentación):** La instrumentación
asimétrica mergeada esta tarde (PR #2, `logger.error` en `_apply_delta_msg` línea
407 con `raw_msg` + bucket state) capturó la causa raíz en la tercera activación
de V2.

**Smoking gun:** durante attempt #3, primer crash a T+37s en bootstrap:
`msg_seq=186 state_seq=184 side=yes price_cents=3 delta_size=-13
bucket_qty_pre_delta=2`. El book interno de V2 estaba en seq=184 cuando llegó un
delta de seq=186 — **falta el seq=185**. V2 aplicó el delta adelantado sobre
estado obsoleto: `2 + (-13) = -11` → `OrderbookDesyncError`.

**Hipótesis C confirmada con evidencia dura.** El feed entregó secuencia válida
y consecutiva (184 → 185 → 186); V2 saltó el 185. El problema está en cómo V2
maneja gap/recovery durante bootstrap, NO en cómo filtra snapshots ni en el feed.

**Hipótesis A y B descartadas:**
- (A) Feed corruption real → DESCARTADA. El feed entregó secuencia consecutiva,
  fue V2 quien saltó el 185.
- (B) Snapshot inicial parcial → DESCARTADA. El bug está en el manejo del gap
  entre snapshot inicial y los primeros deltas, no en el snapshot per se.

**El sesgo hardcodeado de `orderbook.py:65` resultó cuantitativamente erróneo.**
Hace 5 días documentamos: *"El código pre-juzga causa externa. qty<0 indica
desync que puede ser interno o externo; el código asume externo."* El attempt #3
prueba que esta vez es desync INTERNO. El label "(feed corruption)" en el
mensaje del error encubrió la causa real durante 4 días.

**Acción derivada:** eliminar o cambiar el texto `"(feed corruption)"` en el fix
definitivo. Etiquetar la causa antes de diagnosticarla es exactamente el
anti-patrón de Lección 9.

**Patrones validados retroactivamente por el attempt #3:**

1. **El logging fix del attempt #2** (`logger.opt(exception=r)`) habilitó este
   discovery. Sin él, attempt #3 hubiera sido otro `NoneType: None`.
2. **La instrumentación asimétrica del PR #2** (snapshot DEBUG full + delta
   ERROR on failure con bucket state defensivo) capturó exactamente el
   `raw_msg` necesario. Sin el ERROR level, LOG_LEVEL=INFO en Coolify lo habría
   descartado.
3. **Mantener abierto el espacio de hipótesis** (no aceptar "indiscutiblemente
   es el feed" el 30-may mañana) preservó la posibilidad de capturar C. Si la
   capa adversarial hubiera cerrado en "es el feed", el cuarto discovery habría
   ido a buscar variantes del feed y se habría perdido el smoking gun.
4. **Runbook 12.5 + línea defensiva T+5→T+30** contuvo el tercer rollback en
   <5min. Cero daño en ninguno de los tres incidentes.
5. **"Capturar es ganar"** — el attempt #3 falló operacionalmente pero la
   ventana fue **éxito** porque salió con evidencia que cierra Lección 9 en su
   causa raíz.

**Cadena del incidente (attempt #3, 30-may 17:41 UTC):**
- 17:41:01 — flag flippeado, redeploy
- 17:41:08 — primer error (T+37s, bootstrap): KXMLB-26-PHI 3¢
- 17:41:08 — Sid 1 gap detected (cascada, 37 tickers stale, recovery requested)
- 17:41:0X — Kalshi `code 15 "Action required"`
- 17:47:XX — `books_initialized: 0` a T+6min, recovery no convergió
- 17:47:XX — rollback ejecutado <5min, V1 baseline sano

**Estado de causa raíz: IDENTIFICADA.** Pasa de NO RESUELTA a CONFIRMADA con
evidencia. Pendiente: cuarto discovery sobre el log preservado para entender
mecanismo exacto (¿buffer no se llena en bootstrap? ¿race condition snapshot
apply vs delta processing? ¿gap detection antes de inicializar `_last_seq_by_sid`?),
y diseñar fix de bootstrap/gap-handling.

**Pregunta abierta para el cuarto discovery:** ¿por qué V2 no bufferó el seq=185?
El código tiene buffer en `handle_message:166` (`self._pending_deltas[sid].append`)
pero el patrón sugiere que ese buffer no se llena durante bootstrap. La respuesta
determina la forma del fix.

**Segundo bug separado a investigar:** recovery loop no convergió
(`books_initialized: 0` a T+6min). Incluso fixeando bootstrap, recovery
degradado seguiría siendo problema en operación normal.

**Próximos pasos (en orden, ninguno urgente):**
1. Cuarto discovery sobre `data/v2_attempt3_20260530_174849.log` (29 KB)
2. Diseñar fix de bootstrap/gap-handling (post-discovery)
3. Test fix offline contra el escenario reproducido (seq=184 → seq=186 sin 185)
4. Cuarta ventana de activación con fix puesto + runbook 12.5 literal
5. Si V2 estable a T+2h → desbloquear Motor 1

**Logs preservados:**
- attempt #1: 25-may (logs limitados, stack traces perdidos)
- attempt #2: `data/rollback_v2_attempt2_20260527_154809.log` (949 KB)
- attempt #3: `data/v2_attempt3_20260530_174849.log` (29 KB) — **EL QUE TIENE LA CAUSA RAÍZ**
```

## Actualización del header del archivo a v1.7

```markdown
**Versión:** 1.7
**Última actualización:** Mayo 30, 2026

**Cambios v1.6 → v1.7 (2026-05-30):**
- **Update Lección 9 #2:** causa raíz V2 CAPTURADA por instrumentación del PR #2
  en attempt #3. Hipótesis C confirmada con evidencia dura
  (msg_seq=186/state_seq=184, missing seq=185). Hipótesis A y B descartadas.
  Sesgo hardcodeado de `orderbook.py:65` confirmado cuantitativamente erróneo
  para este caso.
- PR #2 mergeado (instrumentación asimétrica). Cumplió su propósito.
- Tercera activación V2 ejecutada con runbook 12.5 literal. Rollback <5min,
  cero daño operativo. Logs preservados con raw_msg del crash.
- Sección 11 actualizada: V2 sigue no apto para producción, pero **fase de
  diseño del fix definitivo está desbloqueada** (causa identificada).
- Sección 12.5 actualizada: pre-flight ahora con los 4 ✅ (backup íntegro,
  flags por nombre, Telegram confirmado en cliente, código verificado en vivo).
  Corrección de seguridad: NO dump del environment, lectura por nombre con
  `printenv VAR1 VAR2`.
```

## Por qué este es el update más importante

Los updates anteriores **acotaban** el espacio de hipótesis. Este update **cierra** el espacio de hipótesis sobre la pregunta original de Lección 9.

| Update | Movimiento | Estado de causa raíz |
|---|---|---|
| Original (26-27 may, obsoleto) | Asume H1 (size=0) como causa | (Incorrecto) "Causa = size=0" |
| Lección 9 FINAL (28-may, SHA `3a4b384`) | Refuta H1, mantiene apertura | "NO RESUELTA, pendiente tercer discovery" |
| Update #1 (29-30 may) | Refina A/B/C, parsing limpio | "A/B/C vivas, V2 no exculpado" |
| **Update #2 (este, 30-may tarde)** | **Confirma C, descarta A/B** | **"C CONFIRMADA con evidencia, fix pendiente"** |

## Lo que NO se cierra todavía

Esta update **identifica la causa** pero NO **cierra el fix**. Para cerrar Lección 9 completamente faltaría:
- Un futuro update #3 con el mecanismo exacto del bug (post-cuarto discovery sobre log preservado)
- Un futuro update #4 con el fix diseñado y validado en cuarta ventana

Por eso el estado de causa raíz pasa de "NO RESUELTA" a "IDENTIFICADA" (no a "CERRADA"). Disciplina: no declarar "resuelto" hasta tener fix validado en producción (decisión derivada #1 de Lección 9).

## Decisiones derivadas inmediatas (ya tomadas en sesión)

1. ✅ Aplicar rollback al primer error en T+37s sin esperar línea defensiva T+30min (regla literal del runbook).
2. ✅ NO escribir fix hoy. Cuarto discovery primero, en otra sesión.
3. ✅ PR #2 cumplió su propósito y puede mergearse limpio.
4. ✅ Sesión cerrada disciplinadamente post-rollback. Cuarto discovery con cabeza fresca.

## Links
- [[sesion-2026-05-30-tarde-watchdog-prod-y-v2-causa-capturada]] — sesión narrativa
- [[causa-raiz-v2-desync-secuencia-bootstrap-CAPTURADA]] — análisis del smoking gun
- [[incidente-v2-attempt-3-2026-05-30-causa-capturada]] — post-mortem técnico
- [[update-leccion-9-29may-tercer-discovery-cerrado]] — update previo (A/B/C abiertas)
- [[leccion-9-FINAL-causa-raiz-pendiente]] — Lección 9 base (SHA `3a4b384`)
- [[brief-instrumentacion-v2-asymmetric-logging]] — brief que produjo la cámara
- [[cuarto-discovery-v2-parsing-limpio-tres-dominios-seq]] — discovery del 30-may mañana
- [[discovery-forense-v2-attempt2-h1-refutada]] — tercer discovery (29-may)
- [[fix-v2-opcion-a-implementado-commits]] — fix Opción A (logging fix sí funcionó)
- [[kalshi-bot]]
