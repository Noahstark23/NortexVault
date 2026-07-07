---
tipo: proyecto
estado: activo
fecha-inicio: 2026-07-02
fecha-objetivo: 
tags:
  - proyecto
  - bot-polymarket
  - polybot
  - trading
---

# bot-polymarket (Polybot)

## Objetivo
Bot de trading dedicado a Polymarket, como frente separado de [[kalshi-bot]] (no cross-venue).

## Por qué importa
Segundo frente de ingresos por trading algorítmico, reutilizando la infra ya construida para Kalshi.

## Estado actual
Datos documentados al 2026-07-02 (fuente: [[2026-07-02-auditoria-Kalshi-root-cause-del-1-usable-counterfactual-Polybot-nuevo]]):
- Fase de arranque, no operando aún
- Puerto previsto: `:18081` en el mismo droplet que Kalshi (`104.236.211.240`, Coolify v4)
- Decisión previa (07-01): se descartó cross-venue arb Kalshi ↔ Polymarket; Polybot es bot dedicado a Polymarket
- Riesgo identificado: dos bots en el mismo droplet 2vCPU/4GB — verificar saturación (precedente: 23-jun)

## Próximos hitos
- [ ] Definir estrategia/motor inicial de Polybot
- [ ] Deploy en :18081 y verificar que no ahoga a Kalshi
- [ ] Documentar repo y spec

## Decisiones tomadas
- 2026-07-01: descartado cross-venue arb → bot dedicado a Polymarket

## Recursos
- Droplet compartido: `104.236.211.240` (Coolify v4)
- Repo: (pendiente documentar)
- Nota relacionada: [[kalshi-bot]]

## Bloqueos / dudas abiertas
- ¿Qué estrategia corre primero? ¿Reutiliza motores de Kalshi?
- Saturación del droplet con dos bots

## Log
- 2026-07-02: Polybot aparece como nuevo frente en auditoría de Kalshi (puerto :18081 previsto).
- 2026-07-07: nota raíz creada durante reorganización del vault (estaba solo mencionado dentro de kalshi-bot). Pendiente brain dump → [[bot-polymarket-braindump]].
