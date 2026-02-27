Contexto: Quiero construir una app móvil/web (Ionic Angular) para jugar un hide-and-seek a escala ciudad inspirado en Jet Lag: The Game. Backend Firebase (Auth anónimo + Firestore + Cloud Functions). La app debe permitir que un host cree una partida con un ID/link tipo Kahoot para que otros se unan (Firebase Hosting). Máximo 6 personas según modo. Geolocalización necesaria. Seekers comparten ubicación, hider NO comparte ubicación exacta.

1) Modos de juego (teams)

Todos los modos se modelan como teams. En “individual” cada team tiene 1 jugador. Máximo:
INDIVIDUAL_3: 3 jugadores individuales (3 teams de 1). En cada turno: 1 hider vs 2 seekers.
TEAMS_2v2: 2 teams de 2 jugadores.
TEAMS_2v2v2: 3 teams de 2 jugadores (6 jugadores).

En el lobby los jugadores eligen equipos manualmente o se asignan al azar. También se define/elige al azar el orden inicial.

2) Identidad / Rejoin
Auth Firebase anónimo (uid).
La identidad social es un Seat (displayName único case-insensitive dentro de la partida).
Rejoin: si alguien entra con el mismo displayName, toma su lugar (takeover del seat). Para evitar dos dispositivos simultáneos con el mismo nombre: takeover permitido si el seat está “offline” (lastSeenAt viejo) o mismo uid; si está online se rechaza (o se requiere confirmación).

3) Fases y timers (turn engine)
Cada “run” (turno donde un team es hider) tiene fases:
INTERMISSION: 2 minutos, countdown visible para todos. Sin acciones.
ESCAPE: 1 hora, countdown visible para todos. Prohibido preguntar. El hider se mueve libremente. No hay cartas todavía (mano inicial 0).
CHASE: empieza cuando termina escape, max 6 horas. Aquí se hacen preguntas, se usan cartas/curses y corre el cronómetro (tiempo transcurrido).
Termina por:
FOUND vote (mayoría por equipos), o timeout (6h).

Todo el motor de fases debe ser server-authoritative con timestamps (phaseEndsAt) y avanzar automáticamente (Scheduled Function).

4) Estaciones (HQ) y Zona
Para AMBA se usará un JSON local stations_amba.json (luego GTFS→JSON). Líneas:

Subte: A,B,C,D,E,H
Tren: Mitre, San Martín, Urquiza, Roca, Belgrano Norte, Sarmiento, Belgrano Sur

Durante ESCAPE el hider puede elegir estación “objetivo” (solo incentivo; no se revela).
Al finalizar ESCAPE, se fija la estación HQ final como:
hqStationFinal = estación más cercana a la ubicación real del hider al terminar ESCAPE
Zona del hider (hiding zone) = círculo:
zoneRadiusM default 500m

5) Endgame (short-game)
Existe un estado ENDGAME dentro de CHASE.
eligibleRadius = zoneRadiusM + eligibleBufferM
default: 500 + 100 = 600m
eligible = true si cualquier seeker (ubicación “fresh”, ej. <60s) está dentro del eligibleRadius del hqStationFinal.
La app NO debe delatar automáticamente que eligible=true.
Seekers pueden presionar un botón “Solicitar Endgame” (siempre visible en CHASE) con cooldown 10 min.
Hider puede aceptar/rechazar. Rechazo solo se loguea, sin penalidad por ahora.
Si acepta:
anchorPoint = ubicación actual del hider en ese momento.
endgameActive = true
Hider debe quedarse fijo (regla social + UI).
Tentacles (cartas/endgame) solo permitidas en endgame.
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

9) Voto FOUND (anti-troll)
Hay botón “FOUND” y el fin de turno es por votación por equipos, sin rollback.
Mayoría por equipos:
2 teams: 2/2
3 teams: 2/3
Esto evita que “un amigo trollee” terminando el turno solo.

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
fotos + rebotar (Storage recomendable)

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
HQ final al final de ESCAPE (nearest station)
eligibleRadius 600m silencioso
endgame request con cooldown y aceptación/rechazo
anchorPoint = ubicación del hider al aceptar
tentacles endgame-only
mapa recortado con repo JetLagHideAndSeek (más adelante)

G) Notificaciones
hider recibe pregunta
seekers reciben respuesta
curse activada / zoologist lock (FCM)

Output esperado del asistente:
Checklist completo con fases (MVP1, MVP2, MVP3)
Modelos Firestore sugeridos (colecciones/docs)
Contrato de Cloud Functions (inputs/outputs)
Recomendaciones prácticas (qué postergar, qué hacer ya)
Gotchas (SPA rewrites, scheduled functions, timestamps, etc.)