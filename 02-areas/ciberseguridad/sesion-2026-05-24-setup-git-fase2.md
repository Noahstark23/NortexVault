---
fecha: 2026-05-24
tipo: sesion-ia
proyecto: vault-setup
ia: Claude
modelo: Cowork mode
tags:
  - sesion-ia
  - obsidian
  - git
  - setup
  - decision
---

# Setup Fase 2 — Obsidian Git + sembrado del vault

## Contexto
Llevaba 2 semanas atorado con el setup del cerebro de Obsidian. El plugin Obsidian Git decía "Git is not ready" persistentemente. El vault estaba con estructura pero vacío de contenido (solo `.gitkeep`). Necesitaba arrancar a poblar el cerebro para usarlo en NotebookLM antes de perder acceso a IA.

## Decisiones / conclusiones

### 1. Plugin Obsidian Git: la causa raíz fue Restricted Mode
- **Problema:** "Git is not ready" + plugin no ejecutaba comandos + `community-plugins.json` no existía.
- **Causa:** el vault estaba en **Restricted Mode**, que bloquea TODOS los community plugins a nivel de vault. El plugin se podía "instalar" pero su código nunca se cargaba.
- **Fix:** Settings → Community plugins → "Turn on community plugins" → instalar Git de Vinzent → Enable.
- **Resultado:** al habilitar, el plugin auto-detectó el repo, committeó y pusheó 30 archivos solo.

### 2. Configuración del plugin que funciona
- `gitPath: "C:\\Program Files\\Git\\cmd\\git.exe"` (ruta explícita, no relativa)
- `autoSaveInterval: 30` y `autoPushInterval: 30` minutos
- `syncMethod: "merge"` + `pullBeforePush: true`
- Mensaje commit: `"vault backup: {{date}}"`

### 3. Sembrado del vault (de 6 → 24 archivos .md)
- Notas raíz de 4 proyectos: esteli-build, kalshi-bot, nortex, youtube-latam
- Notas índice de 4 áreas: ciberseguridad, finanzas, salud, trading
- Brain dumps (uno por proyecto) — hojas de captura rápida con preguntas guía
- Dashboard maestro en `00-inbox/00-dashboard.md`
- Daily de hoy
- 9 sources skeleton en `_notebooklm/` (4 proyectos + 4 áreas + README)

### 4. El gap del flujo de trabajo identificado
- Plomería completa: Obsidian → Git → GitHub auto-sync cada 30 min ✓
- **Pero**: no había nada que metiera información al vault automáticamente.
- **Decisión**: usar al agente de IA (Claude/Cowork) como feeder. Cada sesión que produzca decisiones, código, o aprendizajes debe terminar con una nota `sesion-ia` guardada al vault.

## Próximos pasos
- [ ] Llenar brain dumps de los 4 proyectos (~20 min cada uno)
- [ ] Refactorizar brain dumps a las notas raíz de proyecto
- [ ] Consolidar versiones standalone a `_notebooklm/proyecto-*.md`
- [ ] Subir `_notebooklm/` a NotebookLM (manual upload o vía Google Drive Desktop)
- [ ] Configurar costumbre: pedir a la IA "guarda esta sesión al vault" al cerrar conversaciones útiles

## Snippets / código

Comando útil para forzar commit-and-sync manual en Obsidian:
```
Ctrl+P → "Obsidian Git: Commit-and-sync"
```

Verificar estado del repo desde PowerShell:
```powershell
cd C:\Users\noelp\NortexVault
git log --oneline -5
git status -sb
```

Si vuelve a aparecer un `.git/index.lock` atorado:
```powershell
Remove-Item -Force C:\Users\noelp\NortexVault\.git\index.lock
```

## Links relacionados
- [[00-dashboard]]
- [[esteli-build]] · [[kalshi-bot]] · [[nortex]] · [[youtube-latam]]
- Repo: https://github.com/Noahstark23/NortexVault
- Commit que cerró Fase 2: `17f6474`
