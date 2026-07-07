# Proyecto: Bot Polymarket (Polybot)

> Documento consolidado standalone para NotebookLM. Última actualización: 2026-07-07.

## Qué es

Bot de trading dedicado a Polymarket, como frente separado del bot de Kalshi (no es arbitraje cross-venue; esa opción se descartó el 2026-07-01 por falta de spec y de clientes de Polymarket).

## Estado actual

Al 2026-07-02 (fuente: auditoría de Kalshi de esa fecha):

- Fase de arranque, no operando aún.
- Puerto previsto :18081 en el mismo droplet que el bot de Kalshi (104.236.211.240, Coolify v4, 2vCPU/4GB).
- Riesgo identificado: dos bots en el mismo droplet — verificar saturación (hubo precedente de saturación el 23-jun).

## Decisiones clave

- 2026-07-01: descartado cross-venue arb Kalshi ↔ Polymarket; Polybot será bot dedicado a Polymarket.

## Próximos pasos

- Definir estrategia/motor inicial.
- Documentar repo y spec.
- Deploy en :18081 verificando que no ahoga al bot de Kalshi.
