---
fecha: 2026-07-07
tipo: sesion-ia
proyecto: vault
ia: claude
modelo: claude-fable-5
tags:
  - sesion-ia
  - automatizacion
---

# Setup: automatización sesiones → vault → NotebookLM

## Contexto
Sesión de diseño del flujo automático del cerebro: que las sesiones de trabajo con Claude se guarden solas en el vault y NotebookLM se actualice sin intervención manual.

## Decisiones / conclusiones
- Backup git estaba ROTO desde 05-jun por `index.lock` huérfano → eliminado, mes pendiente commiteado.
- NotebookLM auto-sincroniza sources de Google Drive nativos desde mayo 2026 → arquitectura elegida: `_notebooklm/*.md` → GitHub → Apps Script horario → Google Docs → NotebookLM.
- Creados 9 Google Docs en Drive, carpeta `NortexVault-NotebookLM` (IDs mapeados en `apps-script-sync.gs`).
- Tarea programada "vault-session-sync" (10pm diaria): lee sesiones del día, escribe notas sesion-ia al proyecto correcto, actualiza Log de nota raíz y consolidados, committea.
- Proyecto PsicoIsabel creado en `01-projects/psicoisabel/` + consolidado en `_notebooklm/`.

## Próximos pasos
- [ ] Instalar Apps Script (instrucciones en `_notebooklm/apps-script-sync.gs`): pegar en script.google.com, token GitHub read-only, ejecutar `instalarTrigger()`.
- [ ] NotebookLM: Add source → Google Drive → los 9 docs de `NortexVault-NotebookLM` (una vez).
- [ ] Verificar que Obsidian Git vuelve a pushear solo.
- [ ] Brain dump de PsicoIsabel.

## Links relacionados
- [[flujo-cerebro-automatizado]]
- [[psicoisabel]]
