# Jet Lag Hide & Seek (AMBA) — Spec & Architecture v1

> Documento consolidado para usar como `ARCHITECTURE.md` y pegar en Codex.

## 0) Stack
- **Frontend:** Ionic Angular
- **Backend:** Firebase (Auth anónimo + Firestore + Cloud Functions)
- **Hosting:** Firebase Hosting (links tipo Kahoot)
- **Arquitectura:** Monorepo

Estructura sugerida:
```
/app/              # Ionic Angular
/functions/         # Cloud Functions (TypeScript)
/shared/
  /content/         # preguntas/cartas JSON (ES)
  /data/            # stations_amba.json (más adelante)
  /types/           # modelos TypeScript
  /rules/           # reglas puras (sin Firebase)
firebase.json
firestore.rules
firestore.indexes.json
```

---

## 1) Modos de juego
Todos los modos se modelan como **teams** (en individual, teams de 1).

- **INDIVIDUAL_3**: 3 teams (A/B/C) de 1 jugador. En cada turno: 1 hider vs 2 seekers.
- **TEAMS_2v2**: 2 teams (A/B) de 2 jugadores.
- **TEAMS_2v2v2**: 3 teams (A/B/C) de 2 jugadores.

---

## 2) Settings (al crear la partida)
Defaults:
- `turnsPerTeam = 2` (rango 1–3)
- `winCondition = TOTAL_TIME` (o BEST_SINGLE_RUN)
- `ukMode = false`

Timers / reglas:
- `intermissionSeconds = 120`
- `escapeSeconds = 3600`
- `chaseMaxSeconds = 21600` (6h)
- `zoneRadiusM = 500`
- `eligibleBufferM = 100` → eligibleRadius = 600m
- `arrivalRadiusM = 100`
- `endgameRequestCooldownSeconds = 600` (10 min)
- `deckMaxSize = 6`

---

## 3) Identidad, lobby y rejoin (“toma su lugar”)
- Auth Firebase: **anónimo** (uid).
- Identidad social: **Seat** (displayName único case-insensitive por partida).
- Join con `gameId + displayName`.
  - Si displayName ya existe: el usuario **toma el seat** si el anterior está offline (p.ej. `lastSeenAt` viejo) o es el mismo uid.
  - Si está online, rechazar para evitar duplicados simultáneos.

---

## 4) Fases del turno
Cada turno (run) sigue:
1) **INTERMISSION (2m)**: sin acciones (todos ven countdown).
2) **ESCAPE (1h)**:
   - No hay preguntas.
   - Hider puede moverse.
   - Hider puede elegir estación objetivo (incentivo, no se revela).
   - **No hay cartas** (mano inicial 0, no se usa nada en escape).
   - Al finalizar escape: se fija estación HQ final.
3) **CHASE (máx 6h)**:
   - Se habilitan preguntas.
   - Se habilitan cartas/curses.
   - Puede activarse Endgame.
   - Termina por voto FOUND (mayoría equipos) o timeout.

Timers son **server-authoritative** (timestamps `endsAt`).

---

## 5) Estaciones (cabecera) y zona
### 5.1 Dataset
Se usará `stations_amba.json` (local, versionado) derivado de GTFS, con:
- Subte: A, B, C, D, E, H
- Tren: Mitre, San Martín, Urquiza, Roca, Belgrano Norte, Sarmiento, Belgrano Sur

En MVP se puede hardcodear un mini JSON de pocas estaciones.

### 5.2 Elección en ESCAPE
- El hider puede elegir una **estación objetivo** (no se revela).
- Al final de ESCAPE se calcula:
  - `hqStationFinal = estación más cercana a la ubicación del hider al final del ESCAPE`
  - La estación objetivo **no influye** (es solo incentivo).

### 5.3 Zona
- Zona del turno = círculo (centro = `hqStationFinal`, radio = `zoneRadiusM`=500m).

---

## 6) Endgame (short-game)
### 6.1 Eligibility (silenciosa)
- `eligibleRadius = zoneRadiusM + eligibleBufferM = 600m`.
- `endgameEligible=true` si **cualquier seeker** (fresh location) está dentro del `eligibleRadius` del `hqStationFinal`.
- No se muestra automáticamente (sin spoilers).

### 6.2 Request
- Botón “Solicitar Endgame” **siempre disponible** en CHASE.
- Cooldown: 10 minutos.
- Hider puede aceptar o rechazar.
  - Si acepta: `anchorPoint = ubicación actual del hider` y `endgameActive=true`.
  - Si rechaza: solo se loguea (sin penalidad v1).

### 6.3 Regla de movimiento
- Cuando `endgameActive=true`, el hider debe quedarse fijo en el `anchorPoint` (regla social + UI).

### 6.4 Categorías
- MVP: `Tentacles = ENDGAME_ONLY`.
- El resto `BOTH` hasta refinar.

---

## 7) Preguntas (core loop)
### 7.1 Pendiente única
- Solo **1 pregunta pendiente** por turno.
- Seekers envían pregunta (categoría + pregunta fija o random de categoría).
- Deben esperar respuesta para enviar otra.

### 7.2 Respuesta del hider
El hider “contesta” la interacción con:
- `ANSWER` (respuesta normal)
- `VETO_CARD` (si tiene carta)
- `RANDOMIZE_CARD` (si tiene carta)

#### Randomize
- Bloquea Q1 para el resto del turno.
- Selecciona Q2 (misma categoría).
- El hider contesta Q2 en la **misma interacción** (cuenta como 1).
- Loot se calcula por la categoría de Q1 (equivalente a Q2).

### 7.3 Timeouts y penalidad
- Photo: 10 min
- Otras: 5 min
Si expira:
- Penalidad: **-30 min** al resultado final del turno.
- **NO roba cartas**.
- **NO se quema** la pregunta (puede volver a salir).
- Libera el slot para otra pregunta.

### 7.4 Fotos
- Seekers pueden “Rebotar foto” si no cumple/no se ve.
- Máximo 1 rebote por foto.
- Rebote **no resetea** timer.

---

## 8) Deck / mano del hider (máx 6)
### 8.1 Visibilidad
- Seekers **no ven nada** sobre el mazo del hider.

### 8.2 Capacidad y loot
- Capacidad: `deckMaxSize=6`.
- Al contestar una pregunta (ANSWER/VETO/RANDOMIZE), el hider entra a “loot”:
  - roba `drawN` (según categoría) y elige `keepK`.
  - si excede 6: puede descartar del mazo **después** para hacer espacio (swap).
  - puede elegir 0 (no cambia nada).
- Si expira una pregunta: **no hay loot**.

### 8.3 Reshuffle
- Si `drawPile` no alcanza: reshuffle `discardPile → drawPile`.
- Si ambos vacíos: no roba.

### 8.4 Time Bonus
- Cartas pasivas: se suman al final si están en el mazo al terminar el turno.

### 8.5 Duplicate Card
- No aumenta tamaño.
- **Reemplaza** la carta Duplicate por una copia de otra carta ya existente en el mazo (cuando el hider quiera, entre preguntas).
- Aun duplicada, una curse del mismo tipo no puede estar activa dos veces.

---

## 9) Curses / efectos
### 9.1 Uso
- Se pueden jugar en CHASE/ENDGAME.
- **No** se pueden jugar si hay una pregunta pendiente.

### 9.2 Unicidad por tipo
- Puede haber múltiples curses simultáneas sobre seekers,
- pero **máximo 1 effect activo por `effectType`** (no duplicadas).

### 9.3 Effects
Modelo:
- Timed effects: tienen `endsAt`.
- Lock effects: no tienen `endsAt`, se limpian con una condición.

### 9.4 Dado (1–6)
- El dado lo tiran los seekers en la UI, pero el valor lo genera el servidor.
- Se registra en logs.

### 9.5 Ejemplos
- **Right Turn Curse** (timed): seekers solo doblan a la derecha (regla social + timer).
- **Gambler’s Feet** (timed): seekers tiran dado → caminan N pasos → vuelven a tirar (regla social, contador manual opcional).
- **Curse of the Zoologist** (lock):
  - Hider manda foto de animal y selecciona categoría (honor system).
  - Seekers deben mandar una foto de animal de la misma categoría.
  - Hasta limpiar: seekers **no pueden preguntar**.
  - Hider acepta o rebota.

### 9.6 Restricción extra pendiente
- Puede existir una restricción adicional de curses (por investigar). El sistema debe soportar un campo futuro tipo `castRestriction` sin romper.

---

## 10) Votos: fin de turno (FOUND)
- Turno termina por:
  - Voto FOUND por mayoría de equipos
  - o timeout (6h)

Mayoría:
- 2 equipos: 2/2
- 3 equipos: 2/3

Sin rollback.

---

## 11) Scoring y fin del juego
### 11.1 FinalTime por turno
```
finalTime =
chaseDuration
+ sum(TimeBonus en mazo al final)
- 30min * expiraciones
(+ otras penalidades futuras)
```

### 11.2 WinCondition
Setting al inicio:
- `TOTAL_TIME`: gana mayor `totalTime` acumulado.
- `BEST_SINGLE_RUN`: gana mayor `bestSingleRun`.

UI siempre muestra ambos (`totalTime` y `bestSingleRun`), pero el ranking principal se ordena por `winCondition`.

### 11.3 Fin de juego
- `turnsPerTeam` ∈ {1,2,3}
- Termina cuando todos completan N hides, con excepción UK.

### 11.4 ukMode
- Existe un líder con mejor tiempo vigente.
- Si `ukMode=true`: cuando todos los **no-líderes** completaron sus N runs y nadie superó al líder, el juego termina y el líder gana aunque no completó N.

### 11.5 Empates
- Desempate por el otro criterio (si gana TOTAL_TIME, desempate por BEST_SINGLE_RUN y viceversa).
- Si sigue empate: co-ganadores.

---

## 12) Firebase Hosting (join link)
- Link: `https://<project>.web.app/join/<gameId>`
- Abre la web app (responsive) y permite unirse con nombre.

---

## 13) MVP Iteration Plan
### Iteración 1 (jugable sin estaciones/endgame/curses)
- Seats + Lobby + equipos + orden
- Motor de fases
- Preguntas + expiración + penalidad
- Deck + loot + swap + reshuffle + Duplicate
- Votos FOUND
- Scoring + ranking + fin de juego

### Iteración 2
- Effects/Curses + dado server-side
- Zoologist lock + fotos + rebote

### Iteración 3
- stations JSON (hardcode mini)
- HQ final al final ESCAPE
- eligibility silenciosa
- endgame request + anchorPoint
- tentacles ENDGAME_ONLY
