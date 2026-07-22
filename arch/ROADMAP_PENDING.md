# Roadmap pendiente

Registro operativo de lo que falta implementar. `SPEC_MASTER.md` y `REGLAMENTO_CONSOLIDADO.md` siguen siendo las fuentes normativas; este archivo es una lista de trabajo.

## Bloqueos externos

- Completar `environment.firebase` y `environment.prod.firebase` con el `firebaseConfig` web real del proyecto `hide-and-seek-game-2026`.
- Habilitar Google como provider en Firebase Auth para el proyecto.
- Validar login con Google en navegador real usando `signInWithPopup`.
- Validar una partida real contra Firebase desplegado o emuladores con Auth Google y reglas Firestore activas.

## Proximo tramo recomendado

1. Conectar flujo de preguntas real.
   - Seekers envian pregunta con `sendQuestion`.
   - UI muestra pregunta pendiente desde Firestore.
   - Hider responde con `resolveQuestion`.
   - Se genera `lootOffer` real.

2. Conectar deck/loot real.
   - Mostrar cartas robadas desde `currentTurn.lootOffer.drawnCardIds`.
   - Hider elige cartas con `selectLoot`.
   - Aplicar limite de mano de 6 y descarte/swap.
   - Reemplazar el mazo mock local por el estado server-side.

3. Roles reales en UI.
   - Detectar equipo del usuario actual.
   - Mostrar preguntas solo a seekers.
   - Mostrar mano/loot/respuesta solo al hider.
   - Mantener validacion server-side como fuente autoritativa.

4. Lobby real completo.
   - Randomizar equipos via Function o eliminar accion mock.
   - Mostrar errores de `setTeams`, `lockTeams` y `startGame`.
   - Bloquear acciones no-host en UI.

5. Curses/effects MVP.
   - Activacion desde mano del hider.
   - Timed effects con `endsAt`.
   - Lock effects con condicion manual de limpieza.
   - Dado server-side.
   - Zoologist con confirmacion manual de foto externa.

6. Geolocalizacion + estacion base + endgame.
   - Publicacion throttleada de ubicacion seeker.
   - Seleccion/confirmacion de estacion base durante ESCAPE.
   - Fallback automatico de estacion si no hubo confirmacion.
   - Endgame live ya modelado en backend, pero falta UX real.

7. Reglamento operativo.
   - Conexion degradada/desconexion temporal.
   - Salida de mapa.
   - Pausas/intermission controlado.
   - Emergencia/stand-by/cancelacion.
   - Historial server-side.

8. Notificaciones.
   - Pregunta al hider.
   - Respuesta a seekers.
   - Curse activada / lock activo.
   - Inicio/desactivacion de endgame.
   - Alertas operativas.
