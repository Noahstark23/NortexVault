# _notebooklm — bridge a NotebookLM

> Esta carpeta es el puente entre el vault y NotebookLM. Es la **única** carpeta cuyos archivos se suben a NotebookLM como sources.

## Por qué existe esta carpeta

El vault completo tiene cientos (eventualmente miles) de notas atómicas con `[[wikilinks]]`. NotebookLM:

- No resuelve wikilinks.
- Tiene límite de 50 sources por notebook.
- Funciona mejor con documentos consolidados que con miles de fragmentos.

Entonces: el vault es para **pensar** (Obsidian, links, grafo). `_notebooklm/` es para **consultar con IA** (NotebookLM).

## Reglas para los archivos aquí

1. **Una nota por tema consolidado**, no una nota por sesión.
2. **Standalone:** cada archivo debe poder leerse SIN abrir el vault. Sin wikilinks no resueltos.
3. Si una nota crece más de ~50k palabras, partirla.
4. **Frescura:** actualizar cuando el proyecto/área cambie de estado importante, no en cada edición menor.
5. Límite NotebookLM: **50 sources × 500k palabras** — sobra margen.

## Cómo se llena este folder

```
Brain dump del proyecto (en 01-projects/...)
            │
            │  refactorizar lo importante a la nota raíz
            ▼
    Nota raíz del proyecto
            │
            │  reescribir versión standalone, sin wikilinks
            ▼
   _notebooklm/proyecto-X.md   ← este folder
```

## Cómo llega a NotebookLM (AUTOMATIZADO desde 2026-07-07)

**Ya no se sube a mano.** La cadena es:

```
_notebooklm/*.md → GitHub (obsidian-git) → Apps Script horario → Google Docs → NotebookLM auto-sync
```

- Cada archivo `.md` de aquí tiene un Google Doc gemelo en Drive, carpeta **NortexVault-NotebookLM**.
- El Apps Script (`apps-script-sync.gs` en esta carpeta, instalado en script.google.com) reescribe cada Doc cuando su `.md` cambia en GitHub.
- NotebookLM sincroniza sources de Drive automáticamente (feature nativa desde mayo 2026).
- **Único paso manual restante:** agregar los 9 Docs como sources UNA vez en el notebook "Cerebro Noel" (Add source → Google Drive).

Ver [[flujo-cerebro-automatizado]] en `03-resources/` para el diagrama completo y los puntos de falla.

## Sources actuales

| Archivo | Tema | Google Doc |
|---|---|---|
| `proyecto-kalshi-bot.md` | Bot de trading | [doc](https://docs.google.com/document/d/1h5RUtj81uVux8LPcXJ85hnfxRK9sfyJIV-c2dRD637c/edit) |
| `proyecto-nortex.md` | Negocio Nortex | [doc](https://docs.google.com/document/d/1EJULLwuS_3o28ZDBAB0nMcq6yzQRGGoYBRbLwzjaAlQ/edit) |
| `proyecto-psicoisabel.md` | PsicoIsabel | [doc](https://docs.google.com/document/d/1ZyQTV_Jn8-5AcyzXAiOvtVDrjrlri36-5FeN955oEw0/edit) |
| `proyecto-esteli-build.md` | Mudanza Estelí | [doc](https://docs.google.com/document/d/1lU6UvZHiGlntIEcW8Fh6mq6gNh1s7uzJyjVOR0leWZ8/edit) |
| `proyecto-youtube-latam.md` | Canal YouTube | [doc](https://docs.google.com/document/d/1B_oPRJHNEpp_NpVj1YKPSrEw-FUbWT-SEuN4CuDMAbQ/edit) |
| `area-finanzas.md` | Runway, ingresos, gastos | [doc](https://docs.google.com/document/d/1B2sqMgb7xJCs2UY10Cp2iAnLSvOdqAdBvJUtJ7NtSMk/edit) |
| `area-trading.md` | Disciplina trading | [doc](https://docs.google.com/document/d/19wwWhIFnaMy9zzRXf2yYGJ2RLnCzdPgTvm-ISCVDgSk/edit) |
| `area-salud.md` | Métricas y rutinas | [doc](https://docs.google.com/document/d/1YKmOQQBLUCkR3x4ht3badkvBDgNIwtWlgWUYH__GeE8/edit) |
| `area-ciberseguridad.md` | Postura seguridad | [doc](https://docs.google.com/document/d/1OA8hF5BydEl12uzCyeuQycH_L58_7oCFhboFGidvFN0/edit) |

## Cadencia

- Los `.md` de aquí los actualiza la tarea nocturna de Claude cuando un proyecto cambia de estado importante (y tú/Claude tras brain dumps grandes).
- El resto de la cadena es automático — no requiere acción.
- **Proyecto nuevo:** crear el `.md` aquí, pedir a Claude el Google Doc gemelo, agregar la línea al mapa `FILES` del Apps Script y el source en NotebookLM.
