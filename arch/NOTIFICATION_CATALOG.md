# Catálogo de notificaciones

Este catálogo documenta el mapeo server-side implementado en `app/functions/src/notifications.ts`.

Reglas de producto:
- Todas las notificaciones se persisten en `games/{gameId}/notifications`.
- Todas quedan vinculadas al historial por `eventId`.
- Las notificaciones `CRITICAL` son obligatorias y no se pueden desactivar.
- Las notificaciones `MEDIUM` y `LOW` pueden silenciarse por categoría en preferencias de usuario.
- Silenciar una categoría afecta el envío/push futuro, no el historial ni el feed.

Campos:
- `category`: agrupación para settings/feed.
- `importance`: `CRITICAL`, `MEDIUM` o `LOW`.
- `audience`: `HIDER`, `SEEKERS` o `ALL`.
- `requiresAction`: si el destinatario debe actuar para que el flujo avance o se coordine correctamente.

## Tabla

| Event type | Category | Importance | Audience | Requires action | Notificación |
|---|---|---:|---|---:|---|
| `GAME_STARTED` | `phase` | `CRITICAL` | `ALL` | Sí | Partida iniciada |
| `PHASE_ADVANCED` | `phase` | `CRITICAL` | `ALL` | Sí | Empieza ESCAPE / CHASE |
| `PHASE_ADVANCED` con `toPhase=CHASE` y `baseStationSelectionRequired=true` | `base_station` | `CRITICAL` | `HIDER` | Sí | Estación base pendiente |
| `TURN_STARTED` | `turn` | `CRITICAL` | `ALL` | Sí | Nuevo turno iniciado |
| `TURN_ENDED_MANUALLY` | `turn` | `CRITICAL` | `ALL` | Sí | Turno cerrado |
| `TURN_ENDED_BY_TIMEOUT` | `turn` | `CRITICAL` | `ALL` | Sí | Turno cerrado por tiempo |
| `GAME_PAUSED` | `operations` | `CRITICAL` | `ALL` | No | Partida pausada |
| `GAME_RESUMED` | `operations` | `CRITICAL` | `ALL` | No | Partida reanudada |
| `EMERGENCY_DECLARED` | `operations` | `CRITICAL` | `ALL` | Sí | Emergencia declarada |
| `GAME_CANCELED` | `operations` | `CRITICAL` | `ALL` | No | Partida cancelada |
| `BASE_STATION_CONFIRMED` | `base_station` | `MEDIUM` | `SEEKERS` | No | Estación base confirmada |
| `QUESTION_SENT` | `question` | `CRITICAL` | `HIDER` | Sí | Nueva pregunta |
| `QUESTION_RESOLVED` | `question` | `CRITICAL` | `SEEKERS` | Sí | Respuesta recibida |
| `QUESTION_RESOLVED` | `loot` | `CRITICAL` | `HIDER` | Sí | Loot disponible |
| `QUESTION_EXPIRED` | `question` | `CRITICAL` | `ALL` | No | Pregunta vencida |
| `LOOT_SELECTED` | `loot` | `CRITICAL` | `SEEKERS` | Sí | Loot resuelto |
| `CURSE_PLAYED` | `curse` | `CRITICAL` | `SEEKERS` | Sí | Maldición activada |
| `CURSE_PLAYED` | `curse` | `CRITICAL` | `SEEKERS` | Sí | Confirmación requerida |
| `CURSE_COMPLETED` | `curse` | `CRITICAL` | `ALL` | No | Maldición completada |
| `ENDGAME_ACTIVATED` | `endgame` | `CRITICAL` | `ALL` | Sí | Endgame activo |
| `ENDGAME_VERIFIED_ACTIVE` | `endgame` | `CRITICAL` | `ALL` | Sí | Endgame activo |
| `ENDGAME_DEACTIVATED` | `endgame` | `MEDIUM` | `ALL` | No | Endgame desactivado |
| `ENDGAME_VERIFIED_INACTIVE` | `endgame` | `MEDIUM` | `ALL` | No | Endgame desactivado |
| `ENDGAME_QUESTIONS_CONSULTED` con `unlocked=true` | `endgame` | `MEDIUM` | `SEEKERS` | Sí | Preguntas de endgame habilitadas |
| `CAPTURE_ATTEMPT_STARTED` | `capture` | `CRITICAL` | `HIDER` | Sí | Intento de captura |
| `CAPTURE_REJECTED_BY_HIDER` | `capture` | `CRITICAL` | `SEEKERS` | Sí | Captura rechazada |
| `CAPTURE_RATIFIED_BY_SEEKER` | `capture` | `CRITICAL` | `SEEKERS` | Sí | Captura ratificada |
| `CAPTURE_CONFIRMED_BY_HIDER` | `capture` | `CRITICAL` | `ALL` | No | Captura confirmada |
| `CAPTURE_CONFIRMED_BY_SEEKERS` | `capture` | `CRITICAL` | `ALL` | No | Captura confirmada |
| `OUT_OF_AREA_SUSPECTED` | `safety` | `CRITICAL` | `HIDER` | Sí | Salida de área sospechada |
| `OUT_OF_AREA_REPORTED` | `safety` | `CRITICAL` | `HIDER` | Sí | Salida de área sospechada |
| `OUT_OF_AREA_ALERTED` | `safety` | `CRITICAL` | `ALL` | Sí | Salida de área alertada |
| `OUT_OF_AREA_SAFETY_CONFIRMED` | `safety` | `MEDIUM` | `SEEKERS` | No | Seguridad confirmada |
| `OUT_OF_AREA_CLEARED_BY_LOCATION` | `safety` | `MEDIUM` | `ALL` | No | Salida de área resuelta |
| `OUT_OF_AREA_CLEARED_MANUALLY` | `safety` | `MEDIUM` | `ALL` | No | Salida de área resuelta |
| `PLAYER_TEMPORARILY_DISCONNECTED` | `presence` | `MEDIUM` | `ALL` | No | Desconexión temporal |
| `PLAYER_RECONNECTED` | `presence` | `MEDIUM` | `ALL` | No | Jugador reconectado |

## Sin notificación

Algunos eventos de historial no generan notificación si no hay acción o información útil para interrumpir:
- `ENDGAME_QUESTIONS_CONSULTED` con `unlocked=false`.
- Eventos futuros no mapeados explícitamente en `notifications.ts`.

## Categorías actuales

| Category | Uso |
|---|---|
| `phase` | Inicio/cambio de fase y partida |
| `turn` | Cierre e inicio de turnos |
| `operations` | Pausa, reanudación, emergencia y cancelación |
| `base_station` | Estación base pendiente o confirmada |
| `question` | Preguntas enviadas, resueltas o vencidas |
| `loot` | Loot disponible o resuelto |
| `curse` | Maldiciones activadas, completadas o pendientes de confirmación |
| `endgame` | Estado y preguntas de endgame |
| `capture` | Intentos, rechazo, ratificación y confirmación de captura |
| `safety` | Salida de área y confirmaciones de seguridad |
| `presence` | Desconexión temporal y reconexión |
