import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, Subscription } from 'rxjs';
import {
  DEFAULT_SETTINGS,
  GameBlueprint,
  GameMode,
  LobbyState,
  Seat,
  TeamStanding,
  WinCondition,
} from '../models/core-model';
import { FirebaseGameClientService } from './firebase-game-client.service';

const createSeedStandings = (mode: GameMode): TeamStanding[] => {
  const teamIds = mode === 'INDIVIDUAL_1v1' || mode === 'TEAMS_2v2' ? ['A', 'B'] : ['A', 'B', 'C'];
  const isIndividual = mode === 'INDIVIDUAL_1v1' || mode === 'INDIVIDUAL_3';

  return teamIds.map(teamId => ({
    id: teamId,
    name: `${isIndividual ? 'Player' : 'Team'} ${teamId}`,
    totalTimeSeconds: 0,
    bestSingleRunSeconds: 0,
    runsCompleted: 0,
  }));
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
      foundConfirmed: false,
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
      verificationCooldownSeconds: settings.endgameVerificationCooldownSeconds,
      canVerifyAnytimeDuringChase: true,
      tentaclesOnlyInEndgame: true,
    },
  };
};

const randomGameId = (): string => Math.random().toString(36).slice(2, 8).toUpperCase();

const PRESET_PLAYERS_BY_MODE: Record<GameMode, string[]> = {
  INDIVIDUAL_1v1: ['Fede', 'Nom2'],
  INDIVIDUAL_3: ['Fede', 'Nom2', 'Nom3'],
  TEAMS_2v2: ['Fede', 'Nom2', 'Nom3', 'Nom4'],
  TEAMS_2v2v2: ['Fede', 'Nom2', 'Nom3', 'Nom4', 'Nom5', 'Nom6'],
};

interface CreateGameResponse {
  gameId: string;
  joinUrl: string;
  mode: GameMode;
  settings: GameBlueprint['settings'];
}

@Injectable({ providedIn: 'root' })
export class GameFacadeService {
  constructor(private readonly firebaseClient: FirebaseGameClientService) {}

  private readonly games = new Map<string, { blueprint: GameBlueprint; lobby: LobbyState }>();
  private loadedGameId: string | null = null;
  private gameSubscription: Subscription | null = null;

  private readonly blueprintSubject = new BehaviorSubject<GameBlueprint>(
    buildBlueprint('INDIVIDUAL_3', 2, 'TOTAL_TIME'),
  );
  readonly blueprint$ = this.blueprintSubject.asObservable();

  private readonly lobbySubject = new BehaviorSubject<LobbyState | null>(null);
  readonly lobby$ = this.lobbySubject.asObservable();

  async createGame(
    mode: GameMode,
    turnsPerTeam: 1 | 2 | 3,
    winCondition: WinCondition,
    ukMode: boolean,
    hostDisplayName: string,
  ): Promise<LobbyState> {
    const currentUser = this.firebaseClient.requireCurrentUser();
    const response = await this.firebaseClient.callFunction<
      { mode: GameMode; turnsPerTeam: 1 | 2 | 3; winCondition: WinCondition; ukMode: boolean; displayName: string },
      CreateGameResponse
    >('createGame', {
      mode,
      turnsPerTeam,
      winCondition,
      ukMode,
      displayName: hostDisplayName.trim() || currentUser.displayName || currentUser.email || 'Host',
    });

    this.loadGame(response.gameId);
    return {
      gameId: response.gameId,
      joinLink: response.joinUrl || `${window.location.origin}/join/${response.gameId}`,
      seats: [],
      teamsLocked: false,
    };
  }

  async joinGame(gameId: string, displayName: string): Promise<void> {
    const currentUser = this.firebaseClient.requireCurrentUser();
    await this.firebaseClient.callFunction<{ gameId: string; displayName: string }, { ok: boolean }>('joinGame', {
      gameId,
      displayName: displayName.trim() || currentUser.displayName || currentUser.email || 'Jugador',
    });
    this.loadGame(gameId);
  }

  loadGame(gameId: string): void {
    if (this.loadedGameId === gameId) {
      return;
    }
    this.loadedGameId = gameId;
    this.gameSubscription?.unsubscribe();
    this.gameSubscription = combineLatest([
      this.firebaseClient.gameDoc$(gameId),
      this.firebaseClient.seats$(gameId),
    ]).subscribe({
      next: ([game, seats]) => {
        if (!game) {
          return;
        }
        this.blueprintSubject.next(this.mapGameDocToBlueprint(game));
        this.lobbySubject.next(this.mapGameDocToLobby(gameId, game, seats));
      },
      error: error => console.warn('[firebase-game] No se pudo cargar la partida', error),
    });

    const entry = this.games.get(gameId);
    if (!entry) {
      return;
    }
    this.blueprintSubject.next(entry.blueprint);
    this.lobbySubject.next(entry.lobby);
  }

  toggleTeamsLock(gameId: string): void {
    const current = this.lobbySubject.value;
    void this.firebaseClient.callFunction<{ gameId: string; lock: boolean }, { ok: boolean; teamsLocked: boolean }>(
      'lockTeams',
      { gameId, lock: !current?.teamsLocked },
    );

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

  assignSeatToTeam(gameId: string, seatId: string, teamId: string): void {
    void this.firebaseClient.callFunction<{ gameId: string; assignments: Record<string, string> }, { ok: boolean }>(
      'setTeams',
      { gameId, assignments: { [seatId]: teamId } },
    );

    const entry = this.games.get(gameId);
    if (!entry || entry.lobby.teamsLocked) {
      return;
    }

    entry.lobby = {
      ...entry.lobby,
      seats: entry.lobby.seats.map(seat => (seat.id === seatId ? { ...seat, teamId } : seat)),
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

  voteFound(seatId: string): void {
    const current = this.blueprintSubject.value;
    const lobby = this.lobbySubject.value;

    if (!lobby || !current.currentTurn.endgameActive) {
      return;
    }

    const seat = lobby.seats.find(item => item.id === seatId);
    if (!seat || seat.teamId === current.currentTurn.hiderTeamId) {
      return;
    }

    const votes = current.currentTurn.foundVotes.includes(seatId)
      ? current.currentTurn.foundVotes
      : [...current.currentTurn.foundVotes, seatId];

    this.blueprintSubject.next({
      ...current,
      currentTurn: {
        ...current.currentTurn,
        foundVotes: votes,
        foundConfirmed: this.isFoundConfirmed(current, lobby, votes),
      },
    });
  }

  setEndgameActive(active: boolean): void {
    const current = this.blueprintSubject.value;

    this.blueprintSubject.next({
      ...current,
      currentTurn: {
        ...current.currentTurn,
        endgameActive: active,
        foundVotes: active ? current.currentTurn.foundVotes : [],
        foundConfirmed: active ? current.currentTurn.foundConfirmed : false,
      },
    });
  }

  startGame(gameId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string }, { ok: boolean }>('startGame', { gameId });
  }

  sendQuestion(gameId: string, categoryId: string, prompt: string, isPhoto: boolean): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<
      { gameId: string; categoryId: string; prompt: string; isPhoto: boolean },
      { ok: boolean }
    >('sendQuestion', { gameId, categoryId, prompt, isPhoto });
  }

  private isFoundConfirmed(current: GameBlueprint, lobby: LobbyState, votes: string[]): boolean {
    const seekerSeats = lobby.seats.filter(seat => seat.teamId !== current.currentTurn.hiderTeamId);

    if (current.mode === 'INDIVIDUAL_1v1' || current.mode === 'INDIVIDUAL_3' || current.mode === 'TEAMS_2v2') {
      const seekerSeatIds = seekerSeats.map(seat => seat.id);
      return seekerSeatIds.length > 0 && seekerSeatIds.every(seekerSeatId => votes.includes(seekerSeatId));
    }

    const seekerTeamIds = [...new Set(seekerSeats.map(seat => seat.teamId))];
    return (
      seekerTeamIds.length > 0
      && seekerTeamIds.every(teamId => seekerSeats.some(seat => seat.teamId === teamId && votes.includes(seat.id)))
    );
  }

  private mapGameDocToLobby(
    gameId: string,
    game: Record<string, unknown>,
    seats: Array<Record<string, unknown> & { id: string }>,
  ): LobbyState {
    return {
      gameId,
      joinLink: `${window.location.origin}/join/${gameId}`,
      seats: seats.map(seat => ({
        id: seat.id,
        displayName: String(seat['displayName'] ?? 'Jugador'),
        teamId: String(seat['teamId'] ?? ''),
        host: Boolean(seat['isHost']),
      })),
      teamsLocked: Boolean(game['teamsLocked']),
    };
  }

  private mapGameDocToBlueprint(game: Record<string, unknown>): GameBlueprint {
    const settings = { ...DEFAULT_SETTINGS, ...(game['settings'] as Partial<GameBlueprint['settings'] | undefined>) };
    const standingsRecord = (game['standings'] ?? {}) as Record<string, {
      totalTimeSeconds?: number;
      bestSingleRunSeconds?: number;
      runsCompleted?: number;
    }>;
    const standings = Object.entries(standingsRecord).map(([id, standing]) => ({
      id,
      name: `Team ${id}`,
      totalTimeSeconds: standing.totalTimeSeconds ?? 0,
      bestSingleRunSeconds: standing.bestSingleRunSeconds ?? 0,
      runsCompleted: standing.runsCompleted ?? 0,
    }));
    const mode = (game['mode'] as GameMode | undefined) ?? 'INDIVIDUAL_3';
    const currentTurn = game['currentTurn'] as Record<string, unknown> | undefined;
    const fallback = buildBlueprint(mode, settings.turnsPerTeam, settings.winCondition, settings.ukMode);

    return {
      ...fallback,
      gameName: String(game['gameName'] ?? fallback.gameName),
      mode,
      settings,
      standings: standings.length ? standings : fallback.standings,
      currentTurn: {
        ...fallback.currentTurn,
        runNumber: Number(currentTurn?.['runNumber'] ?? fallback.currentTurn.runNumber),
        hiderTeamId: String(currentTurn?.['hiderTeamId'] ?? fallback.currentTurn.hiderTeamId),
        phase: (currentTurn?.['phase'] as GameBlueprint['currentTurn']['phase'] | undefined) ?? fallback.currentTurn.phase,
        endsAtIso: this.timestampToIso(currentTurn?.['phaseEndsAt']) ?? fallback.currentTurn.endsAtIso,
        pendingQuestion: Boolean(currentTurn?.['pendingQuestionId']),
        expirations: Number(currentTurn?.['expirations'] ?? 0),
        foundVotes: Array.isArray(currentTurn?.['foundVotes']) ? currentTurn['foundVotes'] as string[] : [],
        endgameActive: Boolean(currentTurn?.['endgameActive']),
      },
    };
  }

  private timestampToIso(value: unknown): string | null {
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
      return value.toDate().toISOString();
    }
    return null;
  }
}
