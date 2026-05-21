# NortexVault

Vault personal de Noel Pineda. Sistema PARA + capa de IA.

## Estructura

```
00-inbox/         → captura rápida, sin procesar
01-projects/      → proyectos con deadline/objetivo claro
02-areas/         → responsabilidades continuas (sin deadline)
03-resources/     → material de referencia, snippets, docs
04-archive/       → proyectos terminados o pausados
_notebooklm/      → notas consolidadas que se sincronizan a Google Drive
_templates/       → templates de notas
```

## Reglas

- **00-inbox** es temporal. Procesar al menos 1 vez por semana.
- **_notebooklm/** es el único directorio que se sincroniza a Drive (para NotebookLM).
- Notas en `_notebooklm/` son **consolidadas**, no atómicas. Límite NotebookLM: 50 sources × 500k palabras.
- Templates se usan vía el core plugin "Templates" de Obsidian.
- Auto-commit cada 30 min vía plugin "Obsidian Git" (Fase 2).

## Templates disponibles

- `sesion-ia.md` — registro de sesión con Claude/Gemini
- `decision.md` — decisión técnica/estratégica con razones
- `proyecto.md` — nota raíz de proyecto
- `nota-diaria.md` — daily note

## Backup

- Git local + remoto privado en GitHub
- Plugin "Obsidian Git" commitea + pushea cada 30 min
