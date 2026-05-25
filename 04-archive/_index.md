---
tipo: index
carpeta: 04-archive
tags:
  - index
---

# 📁 04-archive — índice

> Donde van las cosas terminadas o pausadas. No se borra nada, solo se mueve aquí.

## Qué entra aquí

- **Proyectos terminados** o pausados más de 3 meses → la subcarpeta completa entra.
- **Brain dumps procesados** → cuando ya se refactorizó el contenido a la nota raíz del proyecto.
- **Recursos viejos** que ya no se consultan.
- **Daily notes antiguos** (opcional, depende del gusto — se pueden dejar en `00-inbox/`).

## Qué NO entra aquí

- Nada que todavía esté activo, aunque sea de baja prioridad.
- Notas que crees que vas a borrar — esas borras directo, no archives.

## Convención de nombres

Para evitar conflictos con futuros proyectos del mismo nombre, agregar año al archivar:

```
04-archive/kalshi-bot-2027/
04-archive/youtube-latam-2026Q4/
04-archive/recursos-2025/
```

## Cuándo limpiar el archivo

**Nunca.** Git mantiene el historial. Si algo molesta visualmente, se puede ignorar en el graph view o filtrar por tag.

## Restaurar algo del archivo

1. Mover la subcarpeta de vuelta a `01-projects/` (o donde corresponda).
2. Quitar el sufijo de año del nombre.
3. Agregar a [[_HOME]] y a `01-projects/_index.md`.
4. Actualizar `estado:` en el frontmatter de la nota raíz.
