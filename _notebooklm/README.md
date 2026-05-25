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

## Cómo se sube a NotebookLM

**No hay auto-sync.** Es manual y se hace cuando hay cambios significativos:

1. Abrir https://notebooklm.google.com
2. Crear notebook "Cerebro Noel" (o el que uses)
3. **Add source** → **Upload** → seleccionar los archivos `.md` de esta carpeta
4. Cuando un archivo cambia: en NotebookLM, click en el source viejo → ⋮ → Delete. Luego volver a Add source con el archivo nuevo.

**Alternativa para automatizar (futuro):** mover esta carpeta dentro de un folder sincronizado de Google Drive Desktop y conectar NotebookLM a esa carpeta de Drive. Ver `02-areas/ciberseguridad/` por implicaciones de seguridad antes de hacerlo.

## Sources actuales

| Archivo | Tema | Última actualización |
|---|---|---|
| `proyecto-esteli-build.md` | Mudanza Estelí | 2026-05-24 (skeleton) |
| `proyecto-kalshi-bot.md` | Bot de trading | 2026-05-24 (skeleton) |
| `proyecto-nortex.md` | Negocio Nortex | 2026-05-24 (skeleton) |
| `proyecto-youtube-latam.md` | Canal YouTube | 2026-05-24 (skeleton) |
| `area-finanzas.md` | Runway, ingresos, gastos | 2026-05-24 (skeleton) |
| `area-salud.md` | Métricas y rutinas | 2026-05-24 (skeleton) |
| `area-trading.md` | Disciplina trading | 2026-05-24 (skeleton) |
| `area-ciberseguridad.md` | Postura seguridad | 2026-05-24 (skeleton) |

## Cadencia recomendada

- **Mensual:** revisar qué archivos cambiaron en el vault y reflejar en su versión consolidada aquí.
- **Trimestral:** resubir todo el folder a NotebookLM para refrescar el contexto.
- **Después de un brain dump grande:** actualizar el archivo consolidado de ese proyecto el mismo día.
