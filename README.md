# NortexVault — manual del sistema

Vault personal de Noel Pineda. Sistema PARA + capa de IA + bridge a NotebookLM.

> Si abres Obsidian y no sabes qué hacer, abre **[[_HOME]]**. Si quieres entender el sistema, sigue leyendo.

---

## 1. Estructura

```
_HOME.md           → página de entrada (lo que abres primero)
README.md          → este manual del sistema

00-inbox/          → captura rápida, sin procesar
01-projects/       → proyectos con deadline u objetivo claro
02-areas/          → responsabilidades continuas (sin deadline)
03-resources/      → material de referencia, snippets, docs
04-archive/        → proyectos terminados o pausados

_templates/        → templates de notas (usar vía core plugin "Templates")
_notebooklm/       → sources consolidadas que se suben a NotebookLM
```

---

## 2. Las 5 carpetas PARA — cuándo usar cada una

### `00-inbox/`
- Cualquier idea, link, screenshot, frase suelta entra aquí primero.
- Sin estructura. Sin frontmatter. Sin lugar definido todavía.
- **Regla:** se procesa MÍNIMO una vez por semana en el [[weekly-review]]. Inbox lleno > 1 semana = sistema roto.

### `01-projects/`
- Algo con **objetivo claro y fecha** (aunque sea estimada).
- Cada proyecto = una subcarpeta + una nota raíz `nombre-proyecto.md`.
- Cuando se termina o se pausa indefinidamente → se mueve a `04-archive/`.
- Proyectos actuales: [[esteli-build]], [[kalshi-bot]], [[nortex]], [[youtube-latam]].

### `02-areas/`
- Responsabilidades **sin deadline** — cosas que no terminan, solo se mantienen.
- Cada área = una subcarpeta con una nota raíz.
- Áreas actuales: [[ciberseguridad]], [[finanzas]], [[salud]], [[trading]].

### `03-resources/`
- Material de referencia que NO es de un proyecto específico.
- Libros, snippets reutilizables, papers, contactos, plantillas externas.
- Cada recurso usa el template `recurso.md`.

### `04-archive/`
- Proyectos terminados, brain dumps procesados, lecciones viejas que ya no se consultan.
- Nada se borra, solo se mueve aquí. El historial completo vive en Git de todas formas.

---

## 3. Templates — cuándo usar cada uno

| Template | Cuándo usarlo |
|---|---|
| `proyecto.md` | Nueva nota raíz de proyecto en `01-projects/` |
| `nota-diaria.md` | Daily de cada día. Va en `00-inbox/YYYY-MM-DD.md` |
| `sesion-conmigo.md` (o `sesion-ia.md`) | Cierre de una sesión con IA que produjo algo útil |
| `decision.md` | Decisión técnica o estratégica que vale documentar |
| `brain-dump.md` | Vaciado de cabeza estructurado sobre un tema o proyecto |
| `weekly-review.md` | Ritual semanal de procesar inbox + chequear proyectos |
| `leccion.md` | Algo aprendido que no quiero volver a aprender |
| `recurso.md` | Link, libro, video, snippet que vale conservar |

Para usar un template: `Ctrl+P` → "Insert template" → seleccionar.

---

## 4. El flujo de captura

```
Cabeza / chat con IA / lo que leo / lo que decido
                 │
                 ▼
         ┌───────────────┐
         │   00-inbox/   │   ← entra crudo aquí
         └───────┬───────┘
                 │  weekly review (procesar)
                 ▼
   ┌─────────────┴─────────────┐
   │                           │
   ▼                           ▼
01-projects/             02-areas/         03-resources/
(con deadline)        (continuo)            (referencia)
   │
   │ proyecto termina
   ▼
04-archive/
```

### Reglas de movimiento
1. **Inbox → projects/areas/resources**: en el weekly review se decide a dónde va. Si no se decide, no es importante.
2. **Projects → archive**: cuando se termina o se pausa más de 3 meses.
3. **Resources → archive**: cuando un recurso deja de servir.
4. **Nada se borra.** Solo se mueve. Git mantiene el historial.

---

## 5. El rol de la IA en este vault

La IA (Claude/Cowork) tiene acceso de escritura al vault. Eso significa:

- Al cerrar cualquier sesión útil, la IA guarda automáticamente una nota `sesion-conmigo-...md` en la carpeta correspondiente.
- Cuando detecta una decisión, propone guardarla como `decision-...md`.
- Cuando hace research o investigación, el resultado se guarda como `recurso-...md` en `03-resources/`.
- No tienes que pedírselo. Es la conducta por defecto.

Esto cierra el hoyo del flujo: antes el conocimiento se evaporaba al cerrar el chat. Ahora queda escrito y commiteado.

---

## 6. Backup y sync

- **Git local** + **GitHub privado** (https://github.com/Noahstark23/NortexVault).
- Plugin **Obsidian Git** (Vinzent, v2.38.3) auto-commit + push **cada 30 min**.
- Si quieres forzar commit ahora: `Ctrl+P` → "Obsidian Git: Commit-and-sync".
- Si el plugin se atora: ver `02-areas/ciberseguridad/sesion-2026-05-24-setup-git-fase2.md`.

---

## 7. NotebookLM bridge

- `_notebooklm/` es la única carpeta que se sube manualmente a NotebookLM como sources.
- Reglas detalladas: ver `_notebooklm/README.md`.
- Cuando un proyecto evoluciona, su nota en `_notebooklm/proyecto-X.md` se actualiza para reflejarlo.

---

## 8. Rutinas mínimas

- **Diaria** (2 min): abrir [[_HOME]], abrir o crear el daily del día, registrar lo que se trabajó.
- **Semanal** (30 min): correr [[weekly-review]]. Vaciar inbox. Decidir lo UNO de la siguiente semana.
- **Mensual** (15 min): cierre financiero (último domingo). Actualizar runway.
- **Trimestral**: revisar `_notebooklm/` y resubir lo cambiado.

---

## 9. Cuando dudes

- ¿No sabes dónde poner algo? → `00-inbox/`. Lo decides después.
- ¿No sabes qué template usar? → escribir sin template y volver a etiquetar en el weekly.
- ¿No sabes si vale la pena guardar? → guarda. Es más barato borrar después que reconstruir.
