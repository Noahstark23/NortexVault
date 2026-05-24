# _notebooklm — fuentes para NotebookLM

Esta carpeta es la **única** que se sincroniza a Google Drive y se sube como sources a NotebookLM.

## Reglas

1. **Una nota por tema consolidado**, no una nota por sesión.
2. Cada archivo debe poder leerse SOLO (sin abrir el vault). NotebookLM no resuelve `[[wikilinks]]`.
3. Si una nota crece más de ~50k palabras, partirla.
4. Actualizar cuando el proyecto/área cambie de estado importante, no en cada edición menor.
5. Límite NotebookLM: 50 sources × 500k palabras → tienes margen.

## Sources actuales

| Archivo | Tema | Actualizado |
|---|---|---|
| `proyecto-esteli-build.md` | Mudanza Estelí | 2026-05-24 (skeleton) |
| `proyecto-kalshi-bot.md` | Bot de trading | 2026-05-24 (skeleton) |
| `proyecto-nortex.md` | Negocio Nortex | 2026-05-24 (skeleton) |
| `proyecto-youtube-latam.md` | Canal YouTube | 2026-05-24 (skeleton) |
| `area-finanzas.md` | Runway, ingresos, gastos | 2026-05-24 (skeleton) |
| `area-salud.md` | Métricas y rutinas de salud | 2026-05-24 (skeleton) |
| `area-trading.md` | Disciplina y reglas de trading | 2026-05-24 (skeleton) |
| `area-ciberseguridad.md` | Postura de seguridad | 2026-05-24 (skeleton) |

## Cómo regenerar

Cuando refactorices un brain dump al proyecto, copia la versión "limpia y standalone" al archivo `_notebooklm/proyecto-...md` correspondiente. NotebookLM lo recogerá en la próxima sync.
