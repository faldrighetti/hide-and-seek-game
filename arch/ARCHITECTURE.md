# Jet Lag Hide & Seek (AMBA) — Spec & Architecture v1

> Documento consolidado para usar como `ARCHITECTURE.md` y pegar en Codex.
> Fuente normativa completa: `arch/REGLAMENTO_CONSOLIDADO.md`.

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

- **INDIVIDUAL_1v1**: 2 teams (A/B) de 1 jugador. En cada turno: 1 hider vs 1 seeker.
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
- `intermissionSeconds = 300` (Intervalo de 5 min)
- `escapeSeconds = 3600` (60 min fijos para todos los runs)
- `chaseMaxSeconds = 18000` (5h computables; pausas reglamentarias como Move no cuentan)
- `zoneRadiusM = 600`
- `eligibleBufferM = 0`
- `arrivalRadiusM = 100`
- `endgameVerificationCooldownSeconds = 600` (10 min)
- `deckMaxSize = 6`

Transporte:
- Permitidos: subte, tren, colectivo y caminata.
- Prohibidos: Uber, taxi, bicicleta, Ecobici, vehiculos particulares y equivalentes.

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
1) **INTERMISSION / Intervalo (5m)**: sin acciones (todos ven countdown). Cualquier jugador puede pausar o reanudar.
2) **ESCAPE (60m fijos)**:
   - No hay preguntas.
   - Hider puede moverse.
   - Hider debe seleccionar y confirmar estación base manualmente.
   - **No hay cartas** (mano inicial 0, no se usa nada en escape).
   - Al finalizar escape: se fija estación HQ final.
3) **CHASE (máx 5h computables)**:
   - Se habilitan preguntas.
   - Se habilitan cartas/curses.
   - Puede activarse Endgame.
   - Termina por captura FOUND confirmada o timeout.

Timers son **server-authoritative** (timestamps `endsAt`).

---

## 5) Estaciones (cabecera) y zona
### 5.1 Dataset
Se usará `stations_amba.json` (local, versionado) derivado de GTFS, con:
- Subte: A, B, C, D, E, H
- Tren: Mitre, San Martín, Urquiza, Roca, Belgrano Norte, Sarmiento, Belgrano Sur

En MVP se puede hardcodear un mini JSON de pocas estaciones.

### 5.2 Elección en ESCAPE
- El hider debe elegir una **estación base** jugable y confirmarla antes de que termine ESCAPE.
- Puede cambiar la selección mientras siga ESCAPE.
- Si no confirma ninguna estación, el servidor asigna automáticamente la estación jugable más cercana a la última ubicación válida.
- Si el hider sigue viajando al terminar ESCAPE, la estación base debe ser la última estación válida por la que pasó.

### 5.3 Zona
- Zona del turno = círculo (centro = estación base, radio = `zoneRadiusM`=600m).

---

## 6) Endgame (short-game)
### 6.1 Activación automática
- `endgameActive=true` si en modos normales hay 2 o más seekers activos dentro de la hiding zone. En 1v1 de test alcanza con el único seeker activo. Además, las ubicaciones deben estar fresh, la velocidad GPS baja durante aproximadamente 30 a 45 segundos y el movimiento no debe parecer transporte público.
- El hider recibe notificación; los seekers no reciben aviso explícito.
- El endgame no consume cartas ni recursos.

### 6.3 Regla de movimiento
- Cuando `endgameActive=true`, el hider debe quedarse fijo en un punto público, accesible, en planta baja y razonablemente visible (regla social + UI).
- Se desactiva si los seekers permanecen fuera de la hiding zone durante 30 segundos continuos. La desactivación depende solo de posición GPS.

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
MVP: la app no sube ni almacena archivos. El hider envÃ­a la foto por un canal externo y la app registra metadata manual: enviada, recibida, vÃ¡lida/rebotada, timestamps y actor.
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

La foto real viaja por fuera de la app; el servidor solo persiste el estado manual.

## 10) Captura FOUND
- El botón ENCONTRADO se habilita por proximidad GPS solo si el endgame está activo.
- La captura requiere reconocimiento inequívoco en persona; GPS no reemplaza la confirmación visual.
- El hider tiene 15 segundos para confirmar. Si no confirma, se requieren dos confirmaciones de cuentas seeker distintas.
- Solo puede existir un intento activo y los intentos fallidos quedan registrados con cooldown técnico.

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
- Captura FOUND con confirmación
- Scoring + ranking + fin de juego

### Iteración 2
- Effects/Curses + dado server-side
- Zoologist lock + fotos externas + confirmaciÃ³n/rebote manual

### Iteración 3
- stations JSON (hardcode mini)
- estación base manual durante ESCAPE y fallback automático
- endgame automático por ubicación fresh, baja velocidad y todos los seekers dentro de zona
- desactivación tras 30s continuos fuera de zona
- tentacles ENDGAME_ONLY
