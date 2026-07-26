# Roadmap pendiente

Registro operativo de lo que falta implementar. `SPEC_MASTER.md` y `REGLAMENTO_CONSOLIDADO.md` siguen siendo las fuentes normativas; este archivo es una lista de trabajo.

## Bloqueos externos

- Completar `environment.firebase` y `environment.prod.firebase` con el `firebaseConfig` web real del proyecto `hide-and-seek-game-2026`.
- Habilitar Google como provider en Firebase Auth para el proyecto.
- Validar login con Google en navegador real usando `signInWithPopup`.
- Validar una partida real contra Firebase desplegado o emuladores con Auth Google y reglas Firestore activas.

## Proximo tramo recomendado

1. Conectar flujo de preguntas real. Parcialmente conectado en frontend.
   - Seekers envian pregunta con `sendQuestion`.
   - UI muestra pregunta pendiente desde Firestore.
   - Hider responde con `resolveQuestion`.
   - `resolveQuestion` genera `lootOffer` real en backend.
   - Pendiente: pulir UX de respuesta.

2. Conectar deck/loot real.
   - Mostrar cartas robadas desde `currentTurn.lootOffer.drawnCardIds`.
   - Hider elige cartas con `selectLoot`.
   - Aplicar limite de mano de 6 con descarte manual desde la mano.
   - Reemplazar el mazo mock local por el estado server-side.
   - Pendiente: pulir UX de swap/descarte.

3. Roles reales en UI. Parcialmente conectado.
   - Detectar equipo del usuario actual.
   - Mostrar preguntas solo a seekers.
   - Mostrar mano/loot/respuesta solo al hider.
   - Mantener validacion server-side como fuente autoritativa.
   - Lobby bloquea acciones no-host en UI.
   - Pendiente: revisar pantallas restantes y mensajes para usuarios sin seat.

4. Lobby real completo. Parcialmente conectado.
   - Randomizar equipos via Function host-only.
   - Mostrar errores de `setTeams`, `lockTeams` y `startGame`.
   - Validar composicion de equipos antes de iniciar en backend y UI.
   - Pendiente: revisar takeover/reconexion visual de seats.

5. Curses/effects MVP. Parcialmente conectado.
   - Activacion desde mano del hider con `playCurse`.
   - Timed effects con `expiresAt` desde duracion de `Tarjetas_CABA.json`.
   - Mostrar `activeEffects` en pantalla de partida.
   - Lock effects bloquean preguntas en `sendQuestion` y los seekers pueden limpiarlos manualmente con `completeCurseEffect`.
   - Limpieza manual por WhatsApp confirmable por seekers o hider.
   - UX especifica MVP para curses con evidencia, ubicacion manual, contador de preguntas o duracion fija.
   - Pendiente futuro: tracking automatico solo donde aporte valor real y no reemplace confirmaciones por WhatsApp.
   - No implementar dado server-side: no habra curses que precisen dado.
   - No implementar Zoologist ni Gambler's Feet: curses desestimadas.

6. Geolocalizacion + estacion base + endgame/captura.
   - Publicacion throttleada de ubicacion seeker.
   - Seleccion/confirmacion de estacion base durante ESCAPE.
   - Fallback automatico de estacion si no hubo confirmacion.
   - Endgame live conectado en UI.
   - Captura MVP conectado: seeker inicia intento, hider confirma/rechaza, seekers pueden ratificar.
   - Pendiente futuro: validacion GPS fina de distancia de captura y auditoria/historial server-side.

7. Reglamento operativo.
   - Conexion degradada/desconexion temporal conectada con reportes de jugador y eventos.
   - Salida de mapa conectada con estado `outOfArea`, confirmacion de seguridad y eventos.
   - Pausa/reanudacion manual host-only conectada con congelamiento de timers.
   - Emergencia/stand-by host-only conectada como pausa operativa con bloqueo de acciones.
   - Cancelacion host-only conectada con cierre de partida y evento.
   - Historial server-side MVP conectado para eventos de partida, turno, base, endgame, preguntas, loot, curses, captura y salida de area, con lectura via `listGameEvents`.
   - Pendiente: pantalla/admin viewer para consultar historial/incidentes sin abrir Firestore.

8. Notificaciones.
   - Catalogo server-side modularizado en `functions/src/notifications.ts`, documentado en `arch/NOTIFICATION_CATALOG.md`, conectado al historial con `importance`, `audience`, `requiresAction`, `category`, titulo y cuerpo.
   - Notificaciones persistidas en `games/{gameId}/notifications`, vinculadas por `eventId`.
   - Lectura via `listGameNotifications`.
   - Preferencias por usuario via `getNotificationPreferences` y `updateNotificationPreferences`; criticas siempre activas.
   - Pendiente: UI de feed/settings y envio push real.
