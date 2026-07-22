Contexto: Quiero construir una app móvil/web (Ionic Angular) para jugar un hide-and-seek a escala ciudad inspirado en Jet Lag: The Game. Backend Firebase (Auth con Google como login principal + Firestore + Cloud Functions). La app debe permitir que un host cree una partida con un ID/link tipo Kahoot para que otros se unan (Firebase Hosting). Máximo 6 personas según modo. Geolocalización necesaria. Seekers comparten ubicación, hider NO comparte ubicación exacta.

Fuente normativa consolidada:
`arch/REGLAMENTO_CONSOLIDADO.md` contiene el reglamento completo vigente. Este `SPEC_MASTER.md` resume contratos técnicos y roadmap; si hay una diferencia, el reglamento consolidado prevalece y la arquitectura debe alinearse contra ese documento.

1) Modos de juego (teams)

Todos los modos se modelan como teams. En “individual” cada team tiene 1 jugador. Máximo:
INDIVIDUAL_1v1: 2 jugadores individuales (2 teams de 1). En cada turno: 1 hider vs 1 seeker.
INDIVIDUAL_3: 3 jugadores individuales (3 teams de 1). En cada turno: 1 hider vs 2 seekers.
TEAMS_2v2: 2 teams de 2 jugadores.
TEAMS_2v2v2: 3 teams de 2 jugadores (6 jugadores).

En el lobby los jugadores eligen equipos manualmente o se asignan al azar. También se define/elige al azar el orden inicial.

2) Identidad / Rejoin
Auth Firebase con Google como login principal. Cada cuenta de Google representa a un jugador y su `uid` es la identidad estable para seats, permisos, reconexión y takeover. Auth anónimo puede quedar solo como fallback de desarrollo/testing, no como flujo principal de juego.
La identidad social es un Seat (displayName único case-insensitive dentro de la partida).
Rejoin: si alguien entra con el mismo displayName, toma su lugar (takeover del seat). Para evitar dos dispositivos simultáneos con el mismo nombre: takeover permitido si el seat está “offline” (lastSeenAt viejo) o mismo uid; si está online se rechaza (o se requiere confirmación).

3) Fases y timers (turn engine)
Cada “run” (turno donde un team es hider) tiene fases:
INTERMISSION / Intervalo: 5 minutos, countdown visible para todos. Sin acciones.
ESCAPE: 60 minutos fijos en todos los runs, countdown visible para todos. Prohibido preguntar. El hider se mueve libremente. No hay cartas todavía (mano inicial 0).
CHASE: empieza cuando termina escape, max 5 horas computables. Aquí se hacen preguntas, se usan cartas/curses y corre el cronómetro computable.
Termina por:
captura FOUND confirmada, o timeout (5h computables).
Las pausas reglamentarias, incluida Move, no cuentan para el máximo computable.

Todo el motor de fases debe ser server-authoritative con timestamps (phaseEndsAt) y avanzar automáticamente (Scheduled Function).

Regla global de transporte:
Permitidos: subte, tren, colectivo y caminata.
Prohibidos: Uber, taxi, bicicleta, Ecobici, vehiculos particulares y equivalentes.

4) Estaciones (HQ) y Zona
Para AMBA se usará un JSON local stations_amba.json (luego GTFS→JSON). Líneas:

Subte: A,B,C,D,E,H
Tren: Mitre, San Martín, Urquiza, Roca, Belgrano Norte, Sarmiento, Belgrano Sur

Durante ESCAPE el hider debe seleccionar manualmente una estación jugable como estación base. Puede cambiarla mientras continúe ESCAPE y debe confirmarla antes de que terminen los 60 minutos. La selección debe contemplar hubs, distancia física entre estaciones del mismo hub, errores de GPS y diferencias entre el punto representativo y la extensión real de la estación.
Si ESCAPE termina sin confirmación manual, el servidor asigna automáticamente la estación jugable más cercana a la última ubicación válida del hider y registra esa asignación en historial.
Si el hider sigue viajando al terminar ESCAPE, la estación base debe ser la última estación válida por la que pasó; no puede seleccionar una estación futura a la que todavía no llegó.
Zona del hider (hiding zone) = círculo:
zoneRadiusM default 600m

5) Endgame (short-game)
Existe un estado ENDGAME dentro de CHASE.
endgameActive se activa automáticamente cuando, en modos normales, hay 2 o más seekers activos dentro de la hiding zone. En el modo 1v1 de test, alcanza con el único seeker activo. Además, sus ubicaciones deben estar fresh, la velocidad GPS debe permanecer baja durante aproximadamente 30 a 45 segundos y el desplazamiento no debe parecer compatible con transporte público.
El hider recibe una notificación cuando empieza el endgame. Los seekers no reciben una notificación explícita de que comenzó.
El endgame no consume cartas ni recursos.
Durante endgame, el hider debe permanecer fijo en un punto público, legalmente accesible, en planta baja, razonablemente visible y sin accesos restringidos. Esta parte es principalmente regla social y de UI.
El endgame se desactiva cuando los seekers permanecen fuera de la hiding zone durante 30 segundos continuos. Una única lectura GPS fuera de la zona no basta. La desactivación depende solo de posición GPS, no de velocidad ni transporte público.
Al desactivarse, el hider recibe una notificación y vuelve a poder moverse dentro de su hiding zone.
Tentacles (cartas/endgame) solo permitidas en endgame.
Los seekers pueden usar un botón "Consultar endgame"; si el servidor confirma que el endgame está activo, se desbloquea la categoría Endgame. La categoría no se muestra automáticamente antes de esa consulta. Si la consulta no desbloquea endgame, el botón tiene un cooldown de 60 segundos.
La pregunta de endgame "¿En qué dirección va la calle/avenida en donde te estás parando?" se responde en dos partes: primero "diagonal" u "horizontal o vertical". Si la primera respuesta es "diagonal", la segunda debe ser noreste, noroeste, sudeste, sudoeste o doble mano. Si la primera respuesta es "horizontal o vertical", la segunda debe ser norte, sur, este, oeste o doble mano.
La categoría Endgame también incluye preguntas sobre parada de colectivos/acceso a estación en la cuadra y tipo de vía.
Seekers no ven lista de estaciones posibles.

6) Preguntas (core loop)
Solo 1 pregunta pendiente por turno.
Seekers eligen pregunta y se la envían al hider.
Hasta que se resuelva o expire, no puede enviarse otra.
Hider puede responder con:
ANSWER (respuesta normal)
VETO (usando carta)
RANDOMIZE (usando carta)
Importante: vetar/randomize son “respuestas” del hider (no acciones del seeker).
Timeout para responder:
Preguntas de foto: 10 min
Resto: 5 min

Si una pregunta expira:
no se quema (queda disponible para el futuro)
no habilita robo de cartas/loot
penalidad: -30 min al score final del turno

Fotos:
Seekers pueden “Rebotar foto” (si no cumple/no se ve). Máximo 1 rebote.
Rebotar no resetea el timer.
MVP: la app no almacena fotos ni URLs. El hider envÃ­a la foto por un canal externo y registra "foto enviada"; los seekers registran si fue recibida y vÃ¡lida.
Randomize:
El hider usa Randomize ⇒ el sistema reemplaza Q1 por Q2 (misma categoría) ⇒ el hider debe contestar Q2 en esa misma interacción.
Q1 queda bloqueada el resto del turno.
Cuenta como una sola interacción (una pregunta pendiente).
Randomize también bloquea la pregunta original para ese turno.
Preguntas se “queman” por turno (las resueltas no se repiten en ese turno). Las expiradas NO se queman.

7) Deck / Mazo del hider (max 6)
El hider tiene un mazo/hand con máximo 6 cartas.
Mano inicial siempre 0 (porque solo se gana contestando preguntas).
Cada vez que el hider “contesta” (ANSWER, VETO, RANDOMIZE), entonces:
roba cartas del drawPile según categoría (draw N pick K) y decide cuáles agrega.
Si el mazo está lleno (6), puede agregar solo si descarta la misma cantidad (swap).
Puede optar por no cambiar su mazo.
Si una pregunta expira: no hay loot.
Reshuffle: si drawPile se vacía, se reshuffle discardPile → drawPile.

Visibilidad:
Seekers no ven nada del mazo del hider (ni cantidad).

Time Bonus:
cartas que suman tiempo al resultado final (ej. +15, +20).
Se aplican al final del turno si están en el mazo del hider cuando termina el turno.

Duplicate Card:
Existe carta Duplicate que cuando se usa reemplaza a Duplicate por una copia de una carta ya existente en el mazo.
No aumenta el tamaño del mazo.
No permite duplicar el mismo curseType activo (ver curses).

8) Curses (maldiciones) y efectos
Curses son cartas activas que complican a seekers. Algunas tienen duración y requieren timers.

Reglas:
Solo se pueden jugar en CHASE/ENDGAME y solo si NO hay pregunta pendiente.
Se pueden tener múltiples curses simultáneas sobre seekers, pero no puede haber 2 activas del mismo effectType (no se puede “re-aplicar” Right Turn mientras siga activa).
Existe una restricción adicional sobre curses aún por definir (debe ser extensible con un campo de reglas futuro).

Efectos:
Timed: tienen endsAt.
Lock: no tienen endsAt, se “limpian” al cumplir condición.

Dado:
Debe existir un sistema de dado 1–6 para seekers.
El valor debe ser server-generated (Function) para evitar trampas.

Ejemplos:
Right Turn Curse: por X minutos, seekers solo pueden doblar a la derecha (regla social + timer).
Gambler’s Feet: por X minutos, seekers deben tirar dado para caminar: sale N ⇒ pueden dar N pasos, luego deben volver a tirar. Contador manual; no pedómetro.
Curse of the Zoologist (LOCK):
Hider juega la curse, manda foto de un animal y define su categoría (insecto/ave/reptil/anfibio/etc).
Hasta que seekers manden una foto de un animal de la misma categoría, no pueden preguntar.
Hider acepta o rebota la foto de limpieza.
No tiene duración máxima: queda bloqueado hasta limpiarla.

La foto real se comparte por fuera de la app; la app solo guarda el estado de envÃ­o/recepciÃ³n/validez.
9) Captura FOUND
Encontrar al hider requiere reconocimiento inequívoco en persona; la proximidad GPS solo habilita el procedimiento.
El botón ENCONTRADO permanece visible durante CHASE/Búsqueda, pero solo se habilita cuando se cumplen condiciones de proximidad y el endgame está activo.
Condiciones técnicas recomendadas: al menos un seeker a 25m o menos del hider, ubicaciones frescas de hider y seeker en los últimos 15 segundos, precisión GPS preferentemente menor a 30m y ningún intento de captura activo.
Cuando un seeker pulsa ENCONTRADO, el servidor registra acción, ubicación, distancia, precisión y timestamp. El hider recibe notificación formal, queda inmovilizado y tiene 15 segundos para confirmar.
Si el hider confirma, el estado pasa a FOUND. Si no confirma, se habilita confirmación seeker; se requieren dos confirmaciones de cuentas seeker distintas para establecer FOUND.
La operación es idempotente y solo puede existir un intento activo. Los intentos fallidos quedan registrados y generan cooldown técnico.

10) Scoring y ganador
Por turno:
finalTime = chaseDuration + sum(TimeBonus) - 30min * expirations
Condición de victoria (setting al crear partida):
TOTAL_TIME: gana mayor total acumulado.
BEST_SINGLE_RUN: gana quien tenga el finalTime individual más largo.
UI debe mostrar siempre:
totalTime acumulado
bestSingleRun
pero el ranking principal depende del winCondition.

Fin del juego:
turnsPerTeam ∈ {1,2,3}, default 2.
El juego termina cuando todos completaron N hides, con excepción ukMode.
ukMode: Si ukMode=true, aplica “leader sits out”:
si todos los no-líderes completaron sus N runs y nadie supera al líder, el juego termina y el líder gana automáticamente aunque no complete N.

Empates:
desempate por el otro criterio; si persiste, co-ganadores.

11) Hosting / Link join
Hosting SPA con rewrites a index.html.
Link: https://<project>.web.app/join/<gameId> abre Join con gameId pre-cargado.
En la app el joinUrl debe generarse como ${window.location.origin}/join/${gameId}.

12) Backlog: qué falta implementar (orden recomendado)
Quiero un plan de implementación con checklist y dependencias:
A) Infra/Backend
Firestore rules (solo miembros leen; acciones críticas por Functions)
Cloud Functions para: createGame, joinGame(seats takeover), setTeams, lockTeams, startGame, scheduled tick, sendQuestion, resolveQuestion, expireQuestion, votes, endTurn, nextTurn, scoring, finishGame.

B) Turn engine automático
phaseEndsAt, auto-advance (scheduled)
rotación hider (2-team alternancia; 3-team orden inicial)
fin de turno por voto/timeout
fin del juego por turnsPerTeam + ukMode
timers UI basados en timestamps

C) Preguntas
cargar JSON de preguntas ES y categorías
pendiente única
expiración por tipo (5/10) con penalidad y sin loot
randomize (bloquea Q1 resto del turno, reemplaza por Q2)
fotos externas + confirmaciÃ³n manual de envÃ­o/recepciÃ³n/validez (sin Storage en MVP)

D) Deck/Cards
JSON de cartas ES
drawPile/discardPile, reshuffle
loot post-respuesta, swap si mazo lleno
time bonus aplicado al cierre del turno
Duplicate reemplazo

E) Curses/effects
ActiveEffects timed/lock
unicidad por effectType
dado 1–6 server-side
gambler’s feet (contador manual)
right turn (timer)
zoologist lock (bloquea preguntas)

F) Geolocalización + Estaciones + Endgame
stations_amba.json (mini hardcode primero)
seekers publican ubicación (throttle)
selección manual de estación base durante ESCAPE
asignación automática de estación jugable más cercana si no hubo confirmación manual
hiding zone de 600m alrededor de estación base
endgame server-side automático si todos los seekers activos están dentro de la zona, con ubicación fresh y sin indicios de transporte público
endgame se desactiva si los seekers permanecen fuera de zona 30s continuos
tentacles endgame-only
mapa recortado con repo JetLagHideAndSeek (más adelante)

G) Reglamento operativo pendiente
GPS/conectividad: conexión degradada, desconexión temporal a 90s, abandono técnico a 5m, permisos obligatorios y bloqueo de acciones sin ubicación reciente
salida del mapa: alerta global, gracia de 2m, congelar run si la salida es real
intermission/Intervalo: cualquier jugador puede pausar o reanudar el contador antes del siguiente run
sesiones/reconexión: una sesión activa por jugador y takeover controlado
emergencias: confirmación, congelar/cancelar actividad y revelar ubicaciones por seguridad
abandono/cancelación/stand-by: runs incompletos no cuentan; reanudar descarta el run incompleto y empieza nuevo ESCAPE; el ID queda reservado 15 días y puede eliminarse automáticamente si no se reanuda
historial del servidor: registrar timestamps, ubicaciones, preguntas, respuestas/correcciones, vetos, cartas, curses, captura, desconexiones, pausas, intermissions, estaciones, abandonos, emergencias y stand-by

H) Notificaciones
hider recibe pregunta
seekers reciben respuesta
curse activada / zoologist lock (FCM)
hider recibe inicio/desactivación de endgame
alertas por desconexión, salida de mapa, emergencia, stand-by y captura

Output esperado del asistente:
Checklist completo con fases (MVP1, MVP2, MVP3)
Modelos Firestore sugeridos (colecciones/docs)
Contrato de Cloud Functions (inputs/outputs)
Recomendaciones prácticas (qué postergar, qué hacer ya)
Gotchas (SPA rewrites, scheduled functions, timestamps, etc.)
