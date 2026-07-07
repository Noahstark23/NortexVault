---
tipo: recurso
fecha: 2026-07-07
tags:
  - recurso
  - meta
  - automatizacion
---

# Flujo del cerebro automatizado

> Cómo fluye el conocimiento desde una sesión de trabajo con Claude hasta NotebookLM, sin pasos manuales. Configurado el 2026-07-07.

## La cadena completa

```
Sesión de trabajo con Claude (Cowork)
        │
        │ (1) al cierre de sesión importante: Claude escribe nota sesion-ia
        │ (2) respaldo: tarea programada nocturna 10pm lee TODAS las
        │     sesiones del día y escribe las que falten
        ▼
01-projects/<proyecto>/YYYY-MM-DD-sesion-*.md   (nota atómica)
        │
        │ la misma tarea nocturna actualiza el Log de la nota raíz
        │ y el consolidado si hubo cambios de estado importantes
        ▼
_notebooklm/proyecto-X.md   (consolidado standalone)
        │
        │ plugin Obsidian Git: commit + push automático a GitHub
        ▼
github.com/Noahstark23/NortexVault  (branch main)
        │
        │ Apps Script "syncNotebookLM" corre cada hora en tu cuenta Google:
        │ lee _notebooklm/*.md del repo y reescribe los Google Docs
        ▼
Google Drive / carpeta "NortexVault-NotebookLM"  (9 Google Docs)
        │
        │ NotebookLM auto-sync nativo (desde mayo 2026):
        │ sources de Drive se refrescan solos cada pocos minutos
        ▼
NotebookLM — notebook "Cerebro Noel"
```

## Componentes y dónde viven

| Componente | Dónde | Qué hace |
|---|---|---|
| Tarea programada "vault-session-sync" | App Claude (Scheduled) | 10pm: sesiones del día → notas al vault |
| Plugin Obsidian Git | Obsidian | commit + push del vault a GitHub |
| Apps Script `apps-script-sync.gs` | script.google.com | GitHub → Google Docs, cada hora |
| Google Docs (9) | Drive: `NortexVault-NotebookLM/` | sources vivos de NotebookLM |
| NotebookLM auto-sync | notebooklm.google.com | refresca sources de Drive solo |

## Setup pendiente (una sola vez)

- [ ] Instalar el Apps Script — instrucciones dentro de `_notebooklm/apps-script-sync.gs`
- [ ] En NotebookLM: Add source → Google Drive → seleccionar los 9 docs de `NortexVault-NotebookLM/`
- [ ] Verificar que Obsidian Git vuelve a commitear/pushear (se eliminó un `index.lock` huérfano que lo tenía bloqueado desde el 5 de junio)

## Mantenimiento

- Proyecto nuevo → crear su `_notebooklm/proyecto-X.md`, pedir a Claude crear el Google Doc, agregar la línea al mapa `FILES` del Apps Script, y agregarlo como source en NotebookLM. (Una vez.)
- Si la tarea nocturna no corrió (app cerrada), corre al abrir la app al día siguiente.
- El Apps Script solo reescribe un Doc si su archivo cambió en GitHub (compara SHA) — no gasta cuota.

## Puntos de falla conocidos

1. **App Claude cerrada a las 10pm** → la tarea corre al siguiente arranque.
2. **Obsidian Git bloqueado** (`index.lock`) → borrar `.git/index.lock` en el vault.
3. **Token GitHub expirado** → el Apps Script loguea HTTP 401 en "Ejecuciones"; regenerar token y actualizar la propiedad `GITHUB_TOKEN`.
