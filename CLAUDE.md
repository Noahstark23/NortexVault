# NortexVault — contexto para Claude Code

Este es el vault de Obsidian de Noel ("el cerebro"). Es la fuente de verdad sobre sus proyectos. Léelo antes de asumir nada.

## Regla #1 — No alucinar

- Si un dato no está en el vault, **di que no está y pregunta**. No inventes estados, fechas, repos, cifras ni nombres.
- Antes de opinar sobre un proyecto, lee su nota raíz (`01-projects/<proyecto>/<proyecto>.md`) y las 2-3 notas de sesión más recientes de su carpeta.
- Las notas de sesión tienen fecha en el nombre (`YYYY-MM-DD-...`). La más reciente manda; las viejas pueden estar desactualizadas.

## Estructura (PARA)

- `00-inbox/` — capturas sin procesar, dailies, dashboard.
- `01-projects/` — proyectos con objetivo y fin. Uno por subcarpeta. Índice: `01-projects/_index.md`.
- `02-areas/` — responsabilidades continuas: ciberseguridad, finanzas, salud, trading.
- `03-resources/` — referencia.
- `04-archive/` — terminado o pausado. No trabajar aquí.
- `_notebooklm/` — consolidados standalone que se sincronizan a NotebookLM (sin wikilinks). Se actualizan cuando un proyecto cambia de estado importante.
- `_templates/` — plantillas (proyecto, brain-dump, decision, sesion-ia, nota-diaria, etc.).
- `_HOME.md` — página de entrada con tabla de proyectos activos.

## Proyectos activos (2026-07-07)

| Proyecto | Carpeta | Qué es |
|---|---|---|
| kalshi-bot | `01-projects/kalshi-bot/` | Bot de trading en Kalshi. El más documentado (~90 notas). Estado consolidado: ver nota de sesión más reciente. |
| bot-polymarket (Polybot) | `01-projects/bot-polymarket/` | Bot dedicado a Polymarket, frente separado de Kalshi. Arrancando (:18081 previsto, mismo droplet). |
| nortex | `01-projects/nortex/` | Producto/SaaS. Detalle pendiente de brain dump. |
| karol-cleaning | `01-projects/karol-cleaning/` | Página web de negocio de limpieza, repo en GitHub de Noel, él la administra. |
| psicoisabel | `01-projects/psicoisabel/` | Marca/consultorio digital de una psicóloga (Isabel). |
| esteli-build | `01-projects/esteli-build/` | Mudanza + setup en Estelí. |
| youtube-latam | `01-projects/youtube-latam/` | Canal de YouTube LATAM. |

## Convenciones al escribir en el vault

1. **Notas de sesión**: usar template `_templates/sesion-ia.md`, nombre `YYYY-MM-DD-tema.md`, guardar en la carpeta del proyecto correspondiente (no en la raíz).
2. **Nota raíz del proyecto**: el `## Log` es append-only — agregar línea con fecha, nunca editar entradas viejas.
3. **Decisiones**: template `_templates/decision.md`, en la carpeta del proyecto.
4. **Nada de archivos en la raíz del vault** — todo va a su carpeta. Si no sabes dónde, a `00-inbox/`.
5. **Frontmatter YAML** siempre (tipo, fecha, tags), siguiendo los templates.
6. Al cerrar un cambio importante de estado, actualizar también el consolidado en `_notebooklm/proyecto-<nombre>.md` (standalone, sin wikilinks) y la tabla de `_HOME.md`.
7. Español, como el resto del vault.

## Infra relacionada

- Git: auto-commit/push cada 30 min vía plugin Obsidian Git → github.com/Noahstark23/NortexVault. Ojo con `index.lock` huérfanos (ya rompió el backup una vez, 05-jun).
- NotebookLM: se alimenta solo de `_notebooklm/` vía Apps Script → Google Docs (ver `_notebooklm/apps-script-sync.gs`). Si agregas un consolidado nuevo, hay que crear su Google Doc y mapearlo en el script.
