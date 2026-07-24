# Jet Lag Hide & Seek (AMBA) — Spec & Architecture v1.1

Multiplayer city-scale hide-and-seek game (Jet Lag–inspired) built with Ionic Angular + Firebase.  
Includes lobby with join link (Kahoot-style), configurable team modes, timed turn phases, question system with penalties, deck & card engine, curse effects system, geolocation logic, and configurable scoring.
Full normative source: `arch/REGLAMENTO_CONSOLIDADO.md`.

---
# 0) Stack

- Frontend: Ionic Angular
- Backend: Firebase (Google Auth as the primary login + Firestore + Cloud Functions)
- Hosting: Firebase Hosting
- Architecture: Monorepo

Structure:

/app  
/functions  
/shared  
  /content  
  /data  
  /types  
  /rules  

---
# 1) Game Modes

- INDIVIDUAL_1v1 (2 teams of 1)
- INDIVIDUAL_3 (3 teams of 1)
- TEAMS_2v2 (2 teams of 2)
- TEAMS_2v2v2 (3 teams of 2)

All modes modeled as teams. One team is Hider per turn; others are Seekers.

---
# 2) Game Settings (on creation)

- turnsPerTeam: 1–3 (default 2)
- winCondition: TOTAL_TIME | BEST_SINGLE_RUN (default TOTAL_TIME)
- ukMode: boolean (default false)

Timers:
- intermissionSeconds: 300 (Intervalo, 5 min)
- escapeSeconds: 3600 (60 min fixed for every run)
- chaseMaxSeconds: 18000 (5 computable hours; rule pauses such as Move do not count)

Map:
- zoneRadiusM: 600
- eligibleBufferM: 0
- arrivalRadiusM: 100
- endgameVerificationCooldownSeconds: 600

Deck:
- deckMaxSize: 6

Transport:
- Allowed: subway/subte, train, bus/colectivo, walking.
- Prohibited: Uber, taxi, bicycle, Ecobici, private vehicles, and equivalents.

---
# 3) Phase System

Each run:

1) INTERMISSION / Intervalo (5m; any player can pause or resume)
2) ESCAPE (60m fixed)
3) CHASE (max 5 computable hours)

Timers are server-authoritative (timestamps).

## ESCAPE
- No questions allowed.
- No cards usable.
- Hider moves freely.
- Hider manually selects and confirms a playable base station before ESCAPE ends.
- If not confirmed, server assigns the nearest playable station to the last valid hider location.
- If still travelling when ESCAPE ends, base station is the last valid station the hider passed; hider must return to that station or its hiding zone.

## CHASE
- Questions enabled.
- Cards enabled.
- Curses enabled.
- Endgame may activate.
- Ends by confirmed FOUND capture or timeout.

---
# 4) Realtime Location Rules

- Seekers publish live location (throttled).
- Hider location is private.
- Endgame activates automatically when normal modes have 2 or more active seekers inside the hiding zone. In 1v1 test mode, the single active seeker is enough. Locations must be fresh, GPS speed must remain low for roughly 30 to 45 seconds, and movement must not look like public transport.
- Hider is notified; seekers are not explicitly notified.
- Endgame consumes no cards or resources.
- During endgame, hider must remain fixed in a public, accessible, ground-floor, reasonably visible point.
- Endgame deactivates after seekers remain outside the hiding zone for 30 continuous seconds. Deactivation depends only on GPS position.

Playable area:
- General playable area is CABA.
- If the active hiding zone of a playable base station crosses outside CABA, that portion of the circle is also playable.
- Runtime check: `isInsidePlayableArea = isInsideCaba(point) || isInsideActiveHidingZoneFromPlayableStation(point)`.
- Boundaries are inclusive.
- Out-of-area alerts require fresh, reliable location and sustained out-of-area readings. A single GPS outlier or stale location must not trigger the alert.

---
# 5) Question System

- Only 1 pending question per turn.
- Seekers must wait until resolved or expired.

Timeouts:
- Photo: 10 min
- Other: 5 min

If expired:
- -30 min penalty
- No loot
- Question not burned

Resolutions:
- ANSWER
- VETO_CARD
- RANDOMIZE_CARD

Randomize:
- Replaces Q1 with Q2 (same category)
- Counts as one interaction
- Loot calculated from original category

---
# 6) Deck Engine (Hider)

- Max size: 6
- Loot only after answering (not expiration)
- Draw N, pick K
- If full: must discard to add
- Can choose to add nothing
- Reshuffle discard → drawPile when needed

## Duplicate Card
- Replaces itself with copy of another card in deck
- Does not increase size
- Does not bypass curse uniqueness rule

## Time Bonus
- Applied at end of turn if still in deck

---
# 7) Curse System (Effects Engine)

Rules:
- Only usable during CHASE/ENDGAME
- Not usable if question pending
- Only 1 active effect per effectType
- Multiple different curses may coexist

Types:
- Timed effects (have endsAt)
- Lock effects (cleared by condition)

Examples:

Right Turn Curse (timed)
- Seekers only turn right (social rule)

Gambler's Feet (timed)
- Server rolls dice (1–6)
- Seekers walk N steps
- Must reroll to continue

Curse of the Zoologist (lock)
- Hider sends animal photo and selects category
- Seekers must send matching category photo
- Until cleared, seekers cannot ask questions
- Hider approves or rejects attempt
- MVP stores only manual confirmation metadata; photo files are exchanged outside the app.

Dice is always server-generated.

System must support future `castRestriction` field.

---
# 8) Endgame System

Eligibility:
- All active seekers are inside the hiding zone
- Locations are fresh
- GPS speed stays low for roughly 30 to 45 seconds
- Movement does not look like public transport

Activation:
- Server activates endgame automatically during CHASE
- Hider is notified
- Seekers are not explicitly notified
- No cards or resources are consumed

When active:
- Hider remains fixed in a public, accessible, ground-floor, reasonably visible point
- Deactivates after seekers remain outside the hiding zone for 30 continuous seconds
- Tentacles category only allowed in ENDGAME

---
# 9) Capture (FOUND)

- ENCONTRADO is enabled by GPS proximity only when endgame is active
- Capture requires unequivocal in-person recognition
- Hider has 15 seconds to confirm
- If hider does not confirm, two distinct seeker accounts must confirm
- Only one active capture attempt is allowed
- Failed attempts are logged and trigger a technical cooldown

---
# 10) Scoring System

Per turn:

finalTime =
chaseDuration
+ sum(TimeBonus)
- 30min * expirations

WinCondition:

TOTAL_TIME:
- Highest accumulated totalTime

BEST_SINGLE_RUN:
- Highest individual finalTime

UI always displays:
- totalTime
- bestSingleRun
- runsCompleted / N

---
# 11) Game End

- Each team must complete N hides
- Except ukMode

## ukMode
If all non-leaders completed N runs and did not surpass leader → leader wins automatically.

Tie-break:
1) Other scoring metric
2) Co-winners

---
# 12) Hosting

Join link:
https://<project>.web.app/join/<gameId>

---
# 13) Development Plan

Iteration 1:
- Lobby
- Phase engine
- Questions
- Deck
- Voting
- Scoring

Iteration 2:
- Effects engine
- Dice
- Zoologist

Iteration 3:
- Stations dataset
- Endgame geolocation
