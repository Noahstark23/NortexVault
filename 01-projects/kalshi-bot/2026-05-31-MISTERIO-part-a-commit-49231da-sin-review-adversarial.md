---
fecha: 2026-05-31
tipo: bug-de-proceso
proyecto: kalshi-bot
severidad: alta
estado: PENDIENTE-resolver
tags:
  - bug-de-proceso
  - kalshi-bot
  - 2026-05-31
  - disciplina
  - auditoria-retroactiva
---

# 🚨 MISTERIO Part A — commit 49231da supuestamente en main sin review adversarial

> **Bug de proceso, no de código.** Claude Code mencionó dos veces que "Part A ya está mergeada" — un fix de bootstrap buffering que **nunca pasó por la disciplina de review** establecida en el workflow desde el 25-may. Esto viola toda la cadena de gates de Lección 9.

## El problema, literal

Durante el cuarto discovery (31-may), Claude Code escribió:
> *"Esto es lo que la Part A ya mergeada corrige."*
> *"la Part A que mergeamos hoy ataca (a)"*

**Tres posibilidades:**
1. El PR #2 (que vimos como "merged" — instrumentación asimétrica + update Lección 9) incluía **más** que instrumentación: un fix de bootstrap que no se revisó
2. Hubo otro merge en una sesión de Claude Code que no pasó por revisión humana ni adversarial
3. Claude Code está confundido o alucinando

**En cualquiera de los tres casos, hay un problema.**

## Por qué importa

Toda la disciplina de Lección 9 + las últimas 5 sesiones está construida sobre:
- **Diseño → review adversarial → implementación → review del código → merge → validación en producción**
- Cada gate cazado en tiempo real ha evitado errores reales:
  - 25-may: rollback disciplinado vs "esperar a ver si se estabiliza"
  - 27-may: pre-flight literal vs saltar pasos por momentum
  - 29-may: capa adversarial frenó atribución externa
  - 30-may mañana: rechazó "indiscutiblemente es el feed"
  - 30-may tarde: rollback a T+37s sin esperar línea defensiva

**Si Part A entró a main sin gate, la cadena de control rota.** El fix mismo podría ser correcto, pero el **proceso** falló.

## Hipótesis sobre qué pasó

### Hipótesis 1 — Scope creep silencioso en PR #2
El PR #2 era oficialmente "instrumentación asimétrica + update Lección 9". Pero Claude Code podría haber agregado el bootstrap buffer al mismo PR sin marcarlo. Si Noel mergeó "el PR de instrumentación" sin revisar diff completo, el fix entró sin gate.

**Evidencia a favor:** ambos cambios tocan `orderbook_manager_v2.py`. Es físicamente posible mezclar.
**Evidencia en contra:** el brief de instrumentación era explícito sobre scope ("solo logging, cero cambios de lógica"). Code lo violó si efectivamente lo hizo.

### Hipótesis 2 — Otro PR fuera de la conversación
Hubo otra sesión con Claude Code (no documentada en el chat principal) donde se diseñó e implementó Part A. Si pasó así, la conversación principal no tiene registro y el fix entró por un canal paralelo.

### Hipótesis 3 — Confusión / alucinación
Claude Code se refiere a "Part A" como si existiera, pero no es real en main. Es un artefacto de su contexto interno.

**Forma de descartar:** verificar el commit `49231da` (referenciado por Claude Code) en GitHub.

## Acción inmediata pendiente

**Antes de cualquier otra cosa relacionada a Part B:**

1. **Verificar `commit 49231da` en GitHub** — ¿existe? ¿qué contiene? ¿está en main?
2. **Si existe y está en main** → auditoría retroactiva del diff. Aunque sea correcto, hay que revisar.
3. **Si NO existe** → Claude Code estaba confundido. Aclarar antes de seguir el cuarto discovery basado en esa premisa.

**Material para review:**
- Commit (diff exacto): https://github.com/Noahstark23/botkalshi/commit/49231da
- Compare: https://github.com/Noahstark23/botkalshi/compare/audit/part-a-base...dev/v2-bootstrap-fix

## Restricciones operativas mientras se resuelve el misterio

❌ **NO implementar Part B** hasta aclarar Part A
❌ **NO re-activar V2** (cuarta ventana) sin tener (a) confirmado en main Y (b) revisado
❌ **NO confiar que "Part A ya corrige (a)" sin ver el diff**
✅ **V2 sigue dormant** (`USE_ORDERBOOK_MANAGER_V2=false` verificado en config.py:70)

## El patrón que esto expone

Este episodio es valioso **como prueba de los límites del workflow multi-agent**:

- Claude Code es un "máquina de picar código" — si recibe tarea de arquitectura abierta, va a ejecutar
- El gate humano + adversarial es lo que impide que ejecute sin diseño aprobado
- **Si el gate se salta una vez, código sin revisar puede entrar a main**

**Lección operacional:** todos los PRs de Claude Code deben tener diff explícitamente revisado por la capa humana antes de merge, **incluso los marcados como "doc-only" o "scope limitado"**. Confiar en el marcado del scope sin verificar el diff es exactamente cómo entró Part A.

## Decisiones a tomar (post-aclaración)

### Si Part A existe y es correcto
- ✅ Crear PR retroactivo de auditoría (audit/part-a-base ← dev/v2-bootstrap-fix)
- ✅ Documentar formalmente el diff con review adversarial post-hoc
- ✅ Anotar como "review retroactivo" en el commit message del merge
- ✅ Lección operacional: gate post-mortem, no preventivo (peor pero rescatable)

### Si Part A existe y tiene problemas
- ⏸ Revertir el commit en main
- 📝 Redactar Part A con review pre-merge
- 🔄 Re-mergeable solo después del gate
- 📜 Lección 11: bypass de gate produce código incorrecto en main

### Si Part A NO existe
- 🤔 Investigar de dónde sacó Claude Code la idea
- 📝 Diseñar Part A con review normal
- 🚧 Implementar con disciplina

## Por qué documenté este misterio aparte

Vale tener este artefacto **separado** del discovery técnico porque:
1. **Es un bug de proceso**, no técnico
2. Va a ser referenciado cuando se resuelva ("ah, esto es lo que pasó el 31-may")
3. Si se repite el patrón, este archivo es el catálogo del precedente
4. Para NotebookLM: subir esto distinto del discovery técnico — son temas diferentes

## Links
- [[2026-05-31-cuarto-discovery-v2-Q1-a-Q4-desde-codigo]] — discovery donde apareció la mención
- [[2026-05-31-sesion-31may-cuarto-discovery-correccion-y-misterio-part-a]] — sesión completa
- [[fix-v2-opcion-a-implementado-commits]] — fix anterior que SÍ pasó por review
- [[decision-2026-05-30-branch-separada-v2-instrumentacion-asimetrica]] — decisión que estableció scope de PR #2 (que Part A podría haber violado)
- [[leccion-9-FINAL-causa-raiz-pendiente]] — Lección 9 base (disciplina que se rompió)
- [[kalshi-bot]]

## Status al cierre del 31-may
- Misterio sigue **sin aclarar**
- PR retroactivo de auditoría intentado, bloqueado por restricción de GitHub App (base ≠ main)
- Opciones: usuario crea PR desde UI manual O crear Issue como acta retroactivo
- **Decisión pendiente del usuario**
