import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  DEFAULT_SETTINGS,
  GameBlueprint,
  GameMode,
  LobbyState,
  Seat,
  TeamStanding,
  WinCondition,
} from '../models/core-model';

const createSeedStandings = (mode: GameMode): TeamStanding[] => {
  if (mode === 'TEAMS_2v2') {
    return [
      { id: 'A', name: 'Team A', totalTimeSeconds: 0, bestSingleRunSeconds: 0, runsCompleted: 0 },
      { id: 'B', name: 'Team B', totalTimeSeconds: 0, bestSingleRunSeconds: 0, runsCompleted: 0 },
    ];
  }

  return [
    {
      id: 'A',
      name: mode === 'INDIVIDUAL_3' ? 'Player A' : 'Team A',
      totalTimeSeconds: 0,
      bestSingleRunSeconds: 0,
      runsCompleted: 0,
    },
    {
      id: 'B',
      name: mode === 'INDIVIDUAL_3' ? 'Player B' : 'Team B',
      totalTimeSeconds: 0,
      bestSingleRunSeconds: 0,
      runsCompleted: 0,
    },
    {
      id: 'C',
      name: mode === 'INDIVIDUAL_3' ? 'Player C' : 'Team C',
      totalTimeSeconds: 0,
      bestSingleRunSeconds: 0,
      runsCompleted: 0,
    },
  ];
};

const buildBlueprint = (
  mode: GameMode,
  turnsPerTeam: 1 | 2 | 3,
  winCondition: WinCondition,
  ukMode = false,
): GameBlueprint => {
  const settings = { ...DEFAULT_SETTINGS, turnsPerTeam, winCondition, ukMode };

  return {
    gameName: 'Jet Lag Hide & Seek AMBA',
    mode,
    settings,
    currentTurn: {
      runNumber: 1,
      hiderTeamId: 'A',
      phase: 'INTERMISSION',
      endsAtIso: new Date(Date.now() + settings.intermissionSeconds * 1000).toISOString(),
      pendingQuestion: false,
      expirations: 0,
      foundVotes: [],
      endgameEligible: false,
      endgameActive: false,
    },
    standings: createSeedStandings(mode),
    questionPolicy: {
      maxPendingQuestions: 1,
      photoTimeoutSeconds: 600,
      regularTimeoutSeconds: 300,
      timeoutPenaltySeconds: 1800,
    },
    deckPolicy: {
      maxSize: settings.deckMaxSize,
      reshuffleEnabled: true,
      duplicateReplacesItself: true,
    },
    effectPolicy: {
      allowOnlyInChaseOrEndgame: true,
      blockIfQuestionPending: true,
      uniqueByEffectType: true,
      serverDice: true,
    },
    endgamePolicy: {
      eligibleRadiusM: settings.zoneRadiusM + settings.eligibleBufferM,
      requestCooldownSeconds: settings.endgameRequestCooldownSeconds,
      canRequestAnytimeDuringChase: true,
      tentaclesOnlyInEndgame: true,
    },
  };
};

const randomGameId = (): string => Math.random().toString(36).slice(2, 8).toUpperCase();

@Injectable({ providedIn: 'root' })
export class GameFacadeService {
  private readonly games = new Map<string, { blueprint: GameBlueprint; lobby: LobbyState }>();

  private readonly blueprintSubject = new BehaviorSubject<GameBlueprint>(
    buildBlueprint('INDIVIDUAL_3', 2, 'TOTAL_TIME'),
  );
  readonly blueprint$ = this.blueprintSubject.asObservable();

  private readonly lobbySubject = new BehaviorSubject<LobbyState | null>(null);
  readonly lobby$ = this.lobbySubject.asObservable();

  createGame(mode: GameMode, turnsPerTeam: 1 | 2 | 3, winCondition: WinCondition, ukMode: boolean): LobbyState {
    const gameId = randomGameId();
    const blueprint = buildBlueprint(mode, turnsPerTeam, winCondition, ukMode);
    const lobby: LobbyState = {
      gameId,
      joinLink: `https://demo.web.app/join/${gameId}`,
      seats: [{ id: 'seat-host', displayName: 'Host', teamId: 'A', host: true }],
      teamsLocked: false,
    };

    this.games.set(gameId, { blueprint, lobby });
    this.blueprintSubject.next(blueprint);
    this.lobbySubject.next(lobby);
    return lobby;
  }

  joinGame(gameId: string, displayName: string): LobbyState {
    const entry = this.games.get(gameId) ?? {
      blueprint: buildBlueprint('INDIVIDUAL_3', 2, 'TOTAL_TIME'),
      lobby: {
        gameId,
        joinLink: `https://demo.web.app/join/${gameId}`,
        seats: [],
        teamsLocked: false,
      },
    };

    const normalizedName = displayName.trim() || `Player-${entry.lobby.seats.length + 1}`;
    const alreadyIn = entry.lobby.seats.some(
      seat => seat.displayName.toLowerCase() === normalizedName.toLowerCase(),
    );

    if (!alreadyIn) {
      const teams = entry.blueprint.standings.map(team => team.id);
      const newSeat: Seat = {
        id: `seat-${Date.now()}`,
        displayName: normalizedName,
        teamId: teams[entry.lobby.seats.length % teams.length],
        host: entry.lobby.seats.length === 0,
      };
      entry.lobby = { ...entry.lobby, seats: [...entry.lobby.seats, newSeat] };
    }

    this.games.set(gameId, entry);
    this.blueprintSubject.next(entry.blueprint);
    this.lobbySubject.next(entry.lobby);
    return entry.lobby;
  }

  loadGame(gameId: string): void {
    const entry = this.games.get(gameId);
    if (!entry) {
      return;
    }
    this.blueprintSubject.next(entry.blueprint);
    this.lobbySubject.next(entry.lobby);
  }

  toggleTeamsLock(gameId: string): void {
    const entry = this.games.get(gameId);
    if (!entry) {
      return;
    }
    entry.lobby = { ...entry.lobby, teamsLocked: !entry.lobby.teamsLocked };
    this.games.set(gameId, entry);
    this.lobbySubject.next(entry.lobby);
  }

  randomizeTeams(gameId: string): void {
    const entry = this.games.get(gameId);
    if (!entry || entry.lobby.teamsLocked) {
      return;
    }

    const teams = entry.blueprint.standings.map(team => team.id);
    const shuffled = [...entry.lobby.seats].sort(() => Math.random() - 0.5);
    entry.lobby = {
      ...entry.lobby,
      seats: shuffled.map((seat, index) => ({ ...seat, teamId: teams[index % teams.length] })),
    };

    this.games.set(gameId, entry);
    this.lobbySubject.next(entry.lobby);
  }

  configure(mode: GameMode, turnsPerTeam: 1 | 2 | 3, winCondition: WinCondition): void {
    this.blueprintSubject.next(buildBlueprint(mode, turnsPerTeam, winCondition));
  }

  setPhase(phase: GameBlueprint['currentTurn']['phase']): void {
    const current = this.blueprintSubject.value;
    const durationByPhase = {
      INTERMISSION: current.settings.intermissionSeconds,
      ESCAPE: current.settings.escapeSeconds,
      CHASE: current.settings.chaseMaxSeconds,
      ENDED: 0,
    };

    this.blueprintSubject.next({
      ...current,
      currentTurn: {
        ...current.currentTurn,
        phase,
        endsAtIso: new Date(Date.now() + durationByPhase[phase] * 1000).toISOString(),
      },
    });
  }

  voteFound(teamId: string): void {
    const current = this.blueprintSubject.value;
    const votes = current.currentTurn.foundVotes.includes(teamId)
      ? current.currentTurn.foundVotes
      : [...current.currentTurn.foundVotes, teamId];

    this.blueprintSubject.next({
      ...current,
      currentTurn: {
        ...current.currentTurn,
        foundVotes: votes,
      },
    });
  }
}