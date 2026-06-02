---
fecha: 2026-06-02
tipo: limitacion-operativa-documentada
proyecto: kalshi-bot
componente: Coolify-deploy-policy
estado: documentado-NO-implementar-wrapper
ref: Coolify discussion #10259
tags:
  - operativo
  - kalshi-bot
  - 2026-06-02
  - coolify
  - decision-no-implementar
---

# 🔧 Coolify restart cap NO soportado — A2 (wrapper entrypoint) DESCARTADO

> Limitación de infraestructura documentada. **Coolify hardcodea `restart: unless-stopped`** sin cap nativo. La alternativa del wrapper de entrypoint era A2 con otro nombre — la misma sobre-ingeniería que el pivot a REST viene a podar. NO implementar.

## El problema técnico

Durante el diseño de B1+A2 (anti-crash-loop para V2), apareció una preocupación: si el supervisor muere y Docker reinicia el contenedor, no hay cap → crash-loop infinito si el bootstrap falla repetidamente.

**Propuesta inicial:** poner cap en Docker (`restart: on-failure:5` o policy similar).

## Lo que el agente web verificó

**Coolify hardcodea `restart: unless-stopped`:**
- Referencia: discusión oficial Coolify #10259
- Coolify re-inyecta esta policy en CADA deploy (sobreescribe lo que tengas en `docker-compose.yml`)
- No expone setting nativo para cambiarlo
- No se corre Swarm → `deploy.restart_policy.max_attempts` ignorado

**Resultado:** no hay cap de Docker limpio en este entorno. Cerrado.

## La alternativa que se rechazó (correctamente)

El agente web sugirió un **wrapper de entrypoint** que:
1. Lea estado durable de arranques previos en el volumen
2. Cuente arranques en ventana temporal
3. Si supera N arranques en M minutos → arranca en "modo seguro"

**Por qué se rechazó:**

**Eso es A2 con otro nombre.** Exactamente la misma sobre-ingeniería que el pivot a REST viene a evitar:
- Estado durable que puede corromperse (nueva superficie de fallo)
- Contador de arranques (lógica nueva)
- "Modo seguro" indefinido (otro estado a especificar)
- Wrapper de entrypoint (toca el path de inicialización del bot)

**El argumento es el mismo que motivó el pivot:**
- Estamos agregando capas para proteger un componente (V2) que ya decidimos archivar
- Construir defensas para un escenario (crash-loop de V2 supervisor) que ya no ocurrirá porque V2 no se ejecuta
- Sobre-ingeniería para un problema que el pivot a REST elimina

## La decisión

**NO implementar el wrapper de entrypoint.**

**Razones:**

1. **A escala de 4-8 mercados NBA, riesgo de crash-loop era bajo.** Con pivot a Motor REST puro, V2 ni se ejecuta → riesgo = 0.

2. **Si V2 nunca corre, el supervisor que podría disparar el crash-loop nunca corre.** El problema que A2 resolvía no se materializa.

3. **El Motor REST no tiene state-machine que pueda colgarse.** Sin bootstrap frágil, sin recovery sin convergencia, sin riesgo de cascada. **El problema que A2 resolvía no existe en REST.**

4. **Mitigaciones existentes son suficientes para el escenario REST:**
   - Alerta Telegram del watchdog (PR #1, validado 7h en producción)
   - Healthcheck de Docker
   - Intervención manual: apagar el flag `USE_ORDERBOOK_MANAGER_V2` (ya está false permanentemente)

5. **El cap automático era "nice-to-have", no bloqueante** — incluso en el escenario V2.

## Lo que SÍ se documenta (para el futuro)

**En `docs/part_b_gaps_pendientes.md` se agregó nota:**

> *"Cap de restart de Docker: NO soportado en Coolify (hardcodea `unless-stopped`, ref. discusión Coolify #10259; no Swarm → `deploy.restart_policy` ignorado). Decisión: NO implementar wrapper de entrypoint (= A2 reintroducido, descartado por sobre-ingeniería). A escala de 4-8 mercados NBA, el riesgo de crash-loop es bajo; se mitiga con la alerta de Telegram existente (PR #1) + healthcheck + intervención manual (apagar el flag). El cap automático era nice-to-have, no bloqueante."*

## Implicaciones para futuras decisiones de infraestructura

### Patrón a recordar
**"Cuando un agente propone una solución, verificar si es la solución que descartamos por nombre con otro nombre."**

El wrapper de entrypoint sonaba distinto a "A2: cap de arranques en runner", pero era **funcionalmente idéntico**:
- Mismo objetivo (cap automático de arranques)
- Mismo mecanismo (estado durable + contador)
- Mismo trade-off (sobre-ingeniería)

**Sin la pregunta "¿esto es A2 con otro nombre?", se habría implementado.**

### Lección para multi-agent workflow
**Cada propuesta nueva debe verificarse contra patrones ya descartados.** Lista mental:
- ¿Esto es {patrón ya descartado} con otro nombre?
- ¿Estoy resolviendo el problema que decidimos no resolver?
- ¿La nueva propuesta hereda los trade-offs que rechazamos antes?

## Estado al cierre

✅ Limitación de Coolify documentada en `docs/part_b_gaps_pendientes.md`
✅ Wrapper de entrypoint **NO** implementado
✅ Invariantes intactos: `docker-compose.yml` NO tocado, NO redeploy
✅ Decisión coherente con pivot a Motor REST puro

## Por qué esto importa más allá del caso

**Esta es la quinta vez esta semana que el sistema cazó "trabajo innecesario disfrazado":**
1. Part A: implementación sin gate
2. PR #7: refactorización oportunista paralela
3. PR #11 Part B: 2 gaps que habrían matado la cuarta ventana
4. B1+A2 fortress: sobre-ingeniería ante diagnóstico que no la justificaba
5. **Wrapper Coolify: A2 con otro nombre**

**El sistema multi-agent con review adversarial sostenido funciona** cuando cada nueva propuesta se evalúa contra las decisiones ya tomadas. El gate no es paranoia — es la disciplina que separa "construir lo necesario" de "construir todo lo que se ocurra."

## Links
- [[2026-06-02-DECISION-motor-REST-mundial-V2-archivado]] — decisión que torna obsoleto A2
- [[2026-06-01-diseno-B1-A2-archivado-fortress-de-V2]] — A2 original archivado
- [[2026-06-01-PATRON-diseno-implementacion-mismo-turno]] — patrón meta que aplica a este caso
- [[2026-06-02-sesion-cierre-saga-V2-motor-REST-decidido]] — sesión
- [[fix-v1-watchdog-21fe6fd-validado-produccion]] — alerta Telegram + healthcheck del watchdog (mitigaciones existentes)
- [[kalshi-bot]]
