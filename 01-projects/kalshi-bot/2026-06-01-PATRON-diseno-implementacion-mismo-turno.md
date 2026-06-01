---
fecha: 2026-06-01
tipo: patron-meta
proyecto: kalshi-bot
severidad: alta-causa-raiz-de-3-incidentes
estado: PATRON-NOMBRADO-y-corregido
tags:
  - patron
  - kalshi-bot
  - 2026-06-01
  - meta-leccion
  - workflow
  - disciplina
---

# 🔍 PATRÓN IDENTIFICADO — "Diseño + implementación en el mismo turno"

> El origen real del problema "código antes del gate". No era desobediencia de Claude Code ni iniciativa autónoma — era que **mis directivas mezclaban diseño y autorización de código en la misma instrucción**. El patrón se nombró, se diagnosticó y se corrigió. Esta nota lo cataloga como anti-patrón con su mecanismo y su antídoto.

## El patrón

**Cuando una directiva contiene tanto "diseñá X" como "implementá X" en el mismo mensaje** (especialmente bajo modos tipo "EXECUTION MODE" o "ZERO DEBATE"), la capa de ejecución (Claude Code) procesa ambas instrucciones como un solo task atómico. El brief queda como contexto del problema, no como diseño separado a revisar — y el código se escribe inmediatamente, sin que pase por la revisión adversarial del diseño que se "iba a hacer".

**Resultado:** código en main sin que el diseño haya pasado por gate. El gate se saltea no por desobediencia, sino porque la instrucción que sale del CTO **ya viene con el gate colapsado**.

## Tres casos documentados esta semana

### Caso 1 — Part A (commit `49231da`)
Directiva original (parafraseo): *"Diseñá el fix de bootstrap buffering e implementalo..."*
**Resultado:** fix mergeado a main, descubierto solo cuando Claude Code lo mencionó al pasar dos días después como "Part A ya mergeada". Yo no recordaba haberlo aprobado.

**Es el caso más grave** — código en main sin review.

### Caso 2 — PR #7 (Decimal refactor, commit `1deb9c7`)
Directiva original: *"LIQUIDAR DEUDA TÉCNICA... Refactorizar `parse_price_to_cents` a Decimal..."*
**Resultado:** rama y PR generados inmediatamente con la implementación lista. Yo no había aprobado el cambio — la directiva venía de Gemini disfrazada como "tarea green-bucket".

**Atajado por capa adversarial** antes de merge. PR #7 cerrado sin mergear.

### Caso 3 — PR #11 (Part B, commit `3f4257e`)
Directiva original: *"IMPLEMENTACIÓN DE ROBUSTEZ EN RECOVERY (PART B)... Se autoriza la escritura de código"*
**Resultado:** 324 líneas implementadas en branch, tests escritos, todo "listo para merge"... pero con dos gaps críticos (supervisor no wireado, reintegración inexistente) que solo se descubrieron al pedir auditoría posterior.

**Atajado por capa adversarial** que exigió las 4 verificaciones antes de merge.

## La diagnosis de Claude Code (palabras de la capa de ejecución)

Cuando le pedí trazabilidad de cómo nacieron PR #7 y PR #11, Claude Code respondió con honestidad:

> *"Las directivas de implementación venían en el mismo turno que el diseño, con EXECUTION MODE, sin un checkpoint intermedio de aprobación del brief. El brief de Part B existió como borrador antes del código, pero **su aprobación formal y el código se pidieron juntos**."*

**Eso nombró el patrón.** No es que Code se adelante — es que la directiva ya viene con el gate colapsado.

## El mecanismo

```
DIRECTIVA del CTO:
  "1. Diseñá el fix X
   2. Implementá el fix X
   3. Corré los tests
   4. Abrí el PR"
  
↓ Procesado por Claude Code

→ Lee toda la directiva como UN solo task
→ El "diseño" (paso 1) es contexto que informa al "implementá" (paso 2)
→ Genera la rama, escribe el código, corre los tests, abre el PR
→ El brief queda como "documentación post-hoc"
→ NUNCA hay un checkpoint intermedio donde el operador humano vea el diseño antes del código
```

**El gate teórico (review del diseño antes del código) NUNCA EXISTE en este flujo.** No se saltea — nunca se le da espacio para existir.

## Por qué el patrón es seductor (y por eso peligroso)

1. **Es eficiente en velocidad superficial.** Un solo turno produce código entregado.
2. **Suena disciplinado.** "Diseñá y luego implementá" parece estructurado.
3. **Funciona para cambios triviales.** Para un bug fix de 2 líneas, no hay riesgo real.
4. **Es lo que el "EXECUTION MODE" promete.** Ejecutar sin perder tiempo en discusión.

**Pero para cambios de state-machine, recovery, o componentes críticos, el ahorro de tiempo es ficticio:** se gana 1 turno de chat pero se pierden días de auditoría retroactiva cuando aparecen los gaps.

## El antídoto — workflow disciplinado

**REGLA:** *"Diseñá X"* y *"Implementá X"* **NUNCA van en el mismo mensaje** para componentes:
- De state-machine
- De recovery
- De gestión de riesgo
- Que tocan capital
- Que tocan el path crítico del bot

**Workflow correcto:**

```
TURNO 1 (operador):  "Diseñá X — texto en docs/X.md, NO escribas código"
TURNO 2 (operador):  Lee el diseño, revisa adversarial, ajusta
TURNO 3 (operador):  "Aprobado. AHORA implementá X según el diseño aprobado"
TURNO 4 (operador):  Revisa el diff, aprueba o pide cambios
TURNO 5 (operador):  "Merge"
```

**El número de turnos importa.** No es burocracia — cada turno es un checkpoint donde el diseño puede modificarse antes de tener código que defender.

## Cómo se aplicó el antídoto esta semana (los gates funcionaron)

Tras el caso 3 (PR #11), apliqué el antídoto:

| Pedido | Acción | Resultado |
|---|---|---|
| Cerrar gaps de PR #11 | "Diseñá la solución, NO implementes" | Diseños B1+A2 en texto |
| Crash-loop destapado | "Diseñá ambas opciones en texto, recomendá una" | Recomendación B1+A2 razonada |
| Question de fondo | "¿V2 vale toda esta complejidad?" | Gemini propone Opción 2 (pivot) |
| Validar Opción 2 | "Construí benchmark, NO implementes Opción 2 todavía" | Spec del benchmark en `scripts/` |

**Resultado:** 4 turnos consecutivos con disciplina diseño-antes-de-código. Cero código nuevo de V2 en main durante toda la semana. Ahorró potencial cuarta ventana fallida.

## El insight más importante

**"El patrón no era desobediencia. Era una falla del operador (yo) al estructurar las directivas."**

No hay que pelearse con Claude Code por "adelantarse" cuando la instrucción literalmente dice "implementá". El gate vive en el OPERADOR, en cómo redacta la directiva, no en la capa de ejecución que la procesa.

**La capa de ejecución hace lo que le piden. Si le pedís diseño Y código en el mismo turno, escribe código. Si solo le pedís diseño, escribe diseño.**

## Reglas operacionales derivadas

### Regla 1 — Verbos unitarios por turno
Para componentes críticos, un turno tiene UN solo verbo de acción:
- "Diseñá" (output: texto en docs)
- "Verificá" (output: análisis sobre código existente, sin modificar)
- "Implementá" (output: código en branch)
- "Revisá" (output: análisis del diff)
- "Mergea" (output: action)

**NO combinar.** Para componentes triviales (cambios cosméticos, doc-only) la combinación es OK.

### Regla 2 — "EXECUTION MODE" / "ZERO DEBATE" — banderas rojas
Estos modos colapsan el gate. **NO USAR** para state-machine, recovery, capital, path crítico. Reservar para tareas verdaderamente sin riesgo (formato, doc admin, limpieza de ramas).

### Regla 3 — Si la directiva tiene >1 verbo de acción, partila
Antes de mandar la directiva a Claude Code, leerla y contar verbos de acción. Si hay más de uno, partir en turnos separados.

### Regla 4 — "Brief" no es "implementación informada"
Si pido un brief, el output es **texto en `docs/`**, no código. El brief se revisa, se ajusta, se aprueba. Solo entonces se autoriza el código en un turno separado.

### Regla 5 — Los tests verdes NO certifican wiring
Tests pueden pasar perfectos en lógica aislada mientras el componente no esté enchufado al runtime. Auditoría de wiring (¿quién instancia esta task? ¿quién la supervisa?) es un paso independiente del test suite.

## Estado al cierre del 01-jun

✅ Patrón nombrado y catalogado
✅ Antídoto definido y aplicado 4 turnos consecutivos
✅ Casos históricos documentados
✅ Reglas operacionales escritas

**Próxima medición:** observar si el patrón reaparece en las próximas sesiones, o si la disciplina del "verbo único por turno" se sostiene.

## Una validación retroactiva

Esta semana validó múltiples patrones de Lección 9 en cadena:
1. Lección 9 #1: *"un diagnóstico no validado contra producción es una hipótesis"* — aplicado al diagnóstico del 30-may corregido el 31
2. Lección 9 #5: *"atribución externa requiere refutar hipótesis internas con discovery arquitectónico"* — aplicado al "indiscutiblemente es el feed"
3. Lección 9 anti-patrón "tests verdes no certifican producción" — aplicado a PR #11 (23/23 tests verdes con supervisor no wireado)
4. **ESTE PATRÓN (nuevo):** "directivas que colapsan el gate" — meta-causa raíz de los 3 casos anteriores

**Este patrón es Lección 11 candidato.** El gate funciona cuando la directiva lo respeta. Cuando la directiva lo colapsa, el código aparece en main sin revisión.

## Links
- [[2026-06-01-AUDITORIA-PR11-gaps-criticos-cazados]] — caso 3 (PR #11)
- [[2026-05-31-MISTERIO-part-a-commit-49231da-sin-review-adversarial]] — caso 1 (Part A)
- [[2026-06-01-sesion-01jun-auditoria-pr11-pivot-opcion-2]] — sesión donde el patrón se diagnosticó
- [[2026-06-01-PIVOT-opcion-2-rest-hibrido]] — pivot estratégico que el patrón corregido habilitó
- [[leccion-9-FINAL-causa-raiz-pendiente]] — Lección 9 base
- [[kalshi-bot]]
