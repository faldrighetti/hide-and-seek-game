# Jet Lag Hide & Seek (AMBA) — Spec & Architecture v1.1

Multiplayer city-scale hide-and-seek game (Jet Lag–inspired) built with Ionic Angular + Firebase.  
Includes lobby with join link (Kahoot-style), configurable team modes, timed turn phases, question system with penalties, deck & card engine, curse effects system, geolocation logic, and configurable scoring.

---
# 0) Stack

- Frontend: Ionic Angular
- Backend: Firebase (Auth anónimo + Firestore + Cloud Functions)
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
- intermissionSeconds: 120
- escapeSeconds: 3600
- chaseMaxSeconds: 21600

Map:
- zoneRadiusM: 500
- eligibleBufferM: 100
- arrivalRadiusM: 100
- endgameRequestCooldownSeconds: 600

Deck:
- deckMaxSize: 6

---
# 3) Phase System

Each run:

1) INTERMISSION (2m)
2) ESCAPE (1h)
3) CHASE (max 6h)

Timers are server-authoritative (timestamps).

## ESCAPE
- No questions allowed.
- No cards usable.
- Hider moves freely.
- Hider may choose a target station (not revealed).
- At end: HQ = nearest station to hider location.

## CHASE
- Questions enabled.
- Cards enabled.
- Curses enabled.
- Endgame may activate.
- Ends by majority FOUND vote or timeout.

---
# 4) Realtime Location Rules

- Seekers publish live location (throttled).
- Hider location is private.
- Endgame eligibility if ANY seeker within eligibleRadius (zoneRadius + buffer).
- AnchorPoint = hider location at endgame acceptance.
- During endgame, hider must remain fixed (social rule + UI indicator).

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

Dice is always server-generated.

System must support future `castRestriction` field.

---
# 8) Endgame System

Eligibility:
- Within zoneRadius + buffer

Request:
- Seekers request
- Cooldown 10 min
- Hider accept/reject (no penalty on reject v1)

When active:
- AnchorPoint fixed
- Tentacles category only allowed in ENDGAME

---
# 9) Voting (FOUND)

Majority by teams:
- 2 teams: 2/2
- 3 teams: 2/3

No rollback.

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
