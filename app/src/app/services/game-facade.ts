import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  DEFAULT_SETTINGS,
  GameEvent,
  GameNotification,
  GameBlueprint,
  GameMode,
  LobbyState,
  NotificationPreferences,
  PendingQuestion,
  PlayerRole,
  TurnQuestionHistoryItem,
  QuestionResolution,
  Seat,
  TeamStanding,
  WinCondition,
} from '../models/core-model';
import { FirebaseGameClientService } from './firebase-game-client.service';

const createSeedStandings = (mode: GameMode): TeamStanding[] => {
  const teamIds = mode === 'INDIVIDUAL_1v1' || mode === 'TEAMS_2v2' ? ['A', 'B'] : ['A', 'B', 'C'];
  return teamIds.map(teamId => ({
    id: teamId,
    name: `Equipo ${teamId}`,
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
    status: 'LOBBY',
    winnerTeamIds: [],
    mode,
    settings,
    operational: {
      mode: 'NORMAL',
      reason: null,
      changedAtIso: null,
      phaseRemainingSeconds: null,
      pendingQuestionRemainingSeconds: null,
      canceledAtIso: null,
      cancellationReason: null,
    },
    currentTurn: {
      runNumber: 1,
      hiderTeamId: 'A',
      phase: 'INTERMISSION',
      startedAtIso: new Date().toISOString(),
      endsAtIso: new Date(Date.now() + settings.intermissionSeconds * 1000).toISOString(),
      pendingQuestionId: null,
      pendingQuestionEndsAtIso: null,
      pendingQuestion: false,
      hiderHandIds: [],
      drawPileCount: 0,
      discardPileCount: 0,
      lootOffer: null,
      categoryCooldowns: {},
      askedQuestionPrompts: [],
      hidingZone: null,
      baseStationCandidateIds: [],
      baseStationSelectionRequired: false,
      activeEffects: [],
      expirations: 0,
      foundVotes: [],
      foundConfirmed: false,
      captureAttempt: null,
      endgameConsultation: null,
      endgameEligible: false,
      endgameActive: false,
      endgameQuestionsUnlocked: false,
      lastQuestionResult: null,
      moveState: null,
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

interface ListGameEventsResponse {
  ok: boolean;
  events: GameEvent[];
}

interface ListGameNotificationsResponse {
  ok: boolean;
  notifications: GameNotification[];
}

interface SendQuestionOptions {
  distanceM?: number;
  customDistanceM?: number;
  randomizePool?: string[];
}

@Injectable({ providedIn: 'root' })
export class GameFacadeService {
  constructor(private readonly firebaseClient: FirebaseGameClientService) {}

  private readonly games = new Map<string, { blueprint: GameBlueprint; lobby: LobbyState }>();
  private loadedGameId: string | null = null;
  private gameSubscription: Subscription | null = null;
  private questionSubscription: Subscription | null = null;
  private questionsSubscription: Subscription | null = null;
  private loadedPendingQuestionKey: string | null = null;
  private turnQuestionHistoryRunNumber = 0;
  private turnQuestionHistoryStartedAt: number | null = null;

  private readonly blueprintSubject = new BehaviorSubject<GameBlueprint>(
    buildBlueprint('INDIVIDUAL_3', 2, 'TOTAL_TIME'),
  );
  readonly blueprint$ = this.blueprintSubject.asObservable();

  private readonly lobbySubject = new BehaviorSubject<LobbyState | null>(null);
  readonly lobby$ = this.lobbySubject.asObservable();

  private readonly pendingQuestionSubject = new BehaviorSubject<PendingQuestion | null>(null);
  readonly pendingQuestion$ = this.pendingQuestionSubject.asObservable();

  private readonly turnQuestionHistorySubject = new BehaviorSubject<TurnQuestionHistoryItem[]>([]);
  readonly turnQuestionHistory$ = this.turnQuestionHistorySubject.asObservable();

  readonly playerRole$ = combineLatest([
    this.firebaseClient.user$,
    this.lobby$,
    this.blueprint$,
  ]).pipe(
    map(([user, lobby, blueprint]) => this.buildPlayerRole(user?.uid ?? null, lobby, blueprint)),
  );

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
      displayName: hostDisplayName.trim() || this.firstNameFromGoogleUser(currentUser) || 'Host',
    });

    this.loadGame(response.gameId);
    return {
      gameId: response.gameId,
      status: 'LOBBY',
      hostUid: currentUser.uid,
      joinLink: response.joinUrl || `${window.location.origin}/join/${response.gameId}`,
      seats: [],
      teamsLocked: false,
    };
  }

  async joinGame(gameId: string, displayName: string): Promise<void> {
    const currentUser = this.firebaseClient.requireCurrentUser();
    await this.firebaseClient.callFunction<{ gameId: string; displayName: string }, { ok: boolean }>('joinGame', {
      gameId,
      displayName: displayName.trim() || this.firstNameFromGoogleUser(currentUser) || 'Jugador',
    });
    this.loadGame(gameId);
  }

  loadGame(gameId: string): void {
    if (this.loadedGameId === gameId) {
      return;
    }
    this.loadedGameId = gameId;
    this.gameSubscription?.unsubscribe();
    this.questionsSubscription?.unsubscribe();
    this.questionsSubscription = null;
    this.turnQuestionHistorySubject.next([]);
    this.gameSubscription = combineLatest([
      this.firebaseClient.gameDoc$(gameId),
      this.firebaseClient.seats$(gameId),
    ]).subscribe({
      next: ([game, seats]) => {
        if (!game) {
          this.syncPendingQuestion(gameId, null);
          this.turnQuestionHistorySubject.next([]);
          return;
        }
        this.syncPendingQuestion(gameId, this.getPendingQuestionId(game));
        this.syncTurnQuestionHistory(gameId, game);
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

  randomizeTeams(gameId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string }, { ok: boolean }>('randomizeTeams', { gameId });
  }

  assignSeatToTeam(gameId: string, seatId: string, teamId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; assignments: Record<string, string> }, { ok: boolean }>(
      'setTeams',
      { gameId, assignments: { [seatId]: teamId } },
    );
  }

  configure(mode: GameMode, turnsPerTeam: 1 | 2 | 3, winCondition: WinCondition): void {
    this.blueprintSubject.next(buildBlueprint(mode, turnsPerTeam, winCondition));
  }

  castFoundVote(gameId: string, teamId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; teamId: string }, { ok: boolean }>(
      'castFoundVote',
      { gameId, teamId },
    );
  }

  startCaptureAttempt(gameId: string): Promise<{ ok: boolean; attemptId: string }> {
    return this.firebaseClient.callFunction<{ gameId: string }, { ok: boolean; attemptId: string }>(
      'startCaptureAttempt',
      { gameId },
    );
  }

  resolveCaptureAttempt(gameId: string, confirmed: boolean): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; confirmed: boolean }, { ok: boolean }>(
      'resolveCaptureAttempt',
      { gameId, confirmed },
    );
  }

  confirmCaptureBySeeker(gameId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string }, { ok: boolean }>(
      'confirmCaptureBySeeker',
      { gameId },
    );
  }

  startGame(gameId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string }, { ok: boolean }>('startGame', { gameId });
  }

  processGameTick(gameId: string): Promise<{ ok: boolean; changed: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string }, { ok: boolean; changed: boolean }>(
      'processGameTick',
      { gameId },
    );
  }
  sendQuestion(
    gameId: string,
    categoryId: string,
    prompt: string,
    isPhoto: boolean,
    options: SendQuestionOptions = {},
  ): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<
      {
        gameId: string;
        categoryId: string;
        prompt: string;
        isPhoto: boolean;
        distanceM?: number;
        customDistanceM?: number;
        randomizePool?: string[];
      },
      { ok: boolean }
    >('sendQuestion', { gameId, categoryId, prompt, isPhoto, ...options });
  }

  confirmBaseStation(gameId: string, stationId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; stationId: string }, { ok: boolean }>(
      'confirmBaseStation',
      { gameId, stationId },
    );
  }

  consultEndgameQuestions(gameId: string): Promise<{ ok: boolean; unlocked: boolean; cooldownActive?: boolean; pendingConfirmation?: boolean }> {
    return this.firebaseClient.callFunction<
      { gameId: string },
      { ok: boolean; unlocked: boolean; cooldownActive?: boolean; pendingConfirmation?: boolean }
    >(
      'consultEndgameQuestions',
      { gameId },
    );
  }


  resolveEndgameConsultation(gameId: string, confirmed: boolean): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; confirmed: boolean }, { ok: boolean }>(
      'resolveEndgameConsultation',
      { gameId, confirmed },
    );
  }
  resolveQuestion(gameId: string, resolution: QuestionResolution, answerText?: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<
      { gameId: string; resolution: QuestionResolution; answerText?: string },
      { ok: boolean }
    >(
      'resolveQuestion',
      { gameId, resolution, answerText },
    );
  }

  selectLoot(
    gameId: string,
    selectedCardIds: string[],
    discardFromHandIds: string[],
  ): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<
      { gameId: string; selectedCardIds: string[]; discardFromHandIds: string[] },
      { ok: boolean }
    >('selectLoot', { gameId, selectedCardIds, discardFromHandIds });
  }

  playMovePowerup(gameId: string, cardId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; cardId: string }, { ok: boolean }>(
      'playMovePowerup',
      { gameId, cardId },
    );
  }

  playDiscardDrawPowerup(gameId: string, cardId: string, discardCardIds: string[]): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<
      { gameId: string; cardId: string; discardCardIds: string[] },
      { ok: boolean }
    >('playDiscardDrawPowerup', { gameId, cardId, discardCardIds });
  }

  playCurse(
    gameId: string,
    cardId: string,
    blocksQuestions: boolean,
    blocksTransport: boolean,
    expiresAtMillis: number | null,
  ): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<
      {
        gameId: string;
        cardId: string;
        blocksQuestions: boolean;
        blocksTransport: boolean;
        expiresAtMillis: number | null;
      },
      { ok: boolean }
    >('playCurse', { gameId, cardId, blocksQuestions, blocksTransport, expiresAtMillis });
  }

  completeCurseEffect(gameId: string, effectId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; effectId: string }, { ok: boolean }>(
      'completeCurseEffect',
      { gameId, effectId },
    );
  }

  pauseGame(gameId: string, reason: string | null): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; reason: string | null }, { ok: boolean }>(
      'pauseGame',
      { gameId, reason },
    );
  }

  resumeGame(gameId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string }, { ok: boolean }>('resumeGame', { gameId });
  }

  declareEmergency(gameId: string, reason: string | null): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; reason: string | null }, { ok: boolean }>(
      'declareEmergency',
      { gameId, reason },
    );
  }

  cancelGame(gameId: string, reason: string | null): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; reason: string | null }, { ok: boolean }>(
      'cancelGame',
      { gameId, reason },
    );
  }

  reportTemporaryDisconnect(gameId: string, reason: string | null): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; reason: string | null }, { ok: boolean }>(
      'reportTemporaryDisconnect',
      { gameId, reason },
    );
  }

  clearTemporaryDisconnect(gameId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string }, { ok: boolean }>('clearTemporaryDisconnect', { gameId });
  }

  async listGameEvents(gameId: string, limit = 100): Promise<GameEvent[]> {
    const response = await this.firebaseClient.callFunction<
      { gameId: string; limit: number },
      ListGameEventsResponse
    >('listGameEvents', { gameId, limit });
    return response.events;
  }

  async listGameNotifications(gameId: string, limit = 100): Promise<GameNotification[]> {
    const response = await this.firebaseClient.callFunction<
      { gameId: string; limit: number },
      ListGameNotificationsResponse
    >('listGameNotifications', { gameId, limit });
    return response.notifications;
  }

  getNotificationPreferences(): Promise<NotificationPreferences> {
    return this.firebaseClient.callFunction<object, NotificationPreferences>('getNotificationPreferences', {});
  }

  updateNotificationPreferences(preferences: Pick<NotificationPreferences, 'medium' | 'low'>): Promise<NotificationPreferences> {
    return this.firebaseClient.callFunction<
      Pick<NotificationPreferences, 'medium' | 'low'>,
      NotificationPreferences
    >('updateNotificationPreferences', preferences);
  }

  private mapGameDocToLobby(
    gameId: string,
    game: Record<string, unknown>,
    seats: Array<Record<string, unknown> & { id: string }>,
  ): LobbyState {
    return {
      gameId,
      status: (game['status'] as LobbyState['status'] | undefined) ?? 'LOBBY',
      hostUid: typeof game['hostUid'] === 'string' ? game['hostUid'] : null,
      joinLink: `${window.location.origin}/join/${gameId}`,
      seats: seats.map(seat => ({
        id: seat.id,
        uid: String(seat['uid'] ?? seat.id),
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
      name: `Equipo ${id}`,
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
      status: (game['status'] as GameBlueprint['status'] | undefined) ?? fallback.status,
      winnerTeamIds: this.stringArray(game['winnerTeamIds']),
      mode,
      settings,
      operational: this.mapOperationalState(game['operational']),
      standings: standings.length ? standings : fallback.standings,
      currentTurn: {
        ...fallback.currentTurn,
        runNumber: Number(currentTurn?.['runNumber'] ?? fallback.currentTurn.runNumber),
        hiderTeamId: String(currentTurn?.['hiderTeamId'] ?? fallback.currentTurn.hiderTeamId),
        phase: (currentTurn?.['phase'] as GameBlueprint['currentTurn']['phase'] | undefined) ?? fallback.currentTurn.phase,
        startedAtIso: this.timestampToIso(currentTurn?.['phaseStartedAt']),
        endsAtIso: this.timestampToIso(currentTurn?.['phaseEndsAt']) ?? fallback.currentTurn.endsAtIso,
        pendingQuestionId: this.getPendingQuestionId(game),
        pendingQuestionEndsAtIso: this.timestampToIso(currentTurn?.['pendingQuestionEndsAt']),
        pendingQuestion: Boolean(currentTurn?.['pendingQuestionId']),
        hiderHandIds: this.stringArray(currentTurn?.['hiderHand']),
        drawPileCount: this.stringArray(currentTurn?.['drawPile']).length,
        discardPileCount: this.stringArray(currentTurn?.['discardPile']).length,
        lootOffer: this.mapLootOffer(currentTurn?.['lootOffer']),
        categoryCooldowns: this.mapCategoryCooldowns(currentTurn?.['categoryCooldowns']),
        askedQuestionPrompts: this.stringArray(currentTurn?.['askedQuestionPrompts']),
        hidingZone: this.mapHidingZone(currentTurn?.['hidingZone']),
        baseStationCandidateIds: this.stringArray(currentTurn?.['baseStationCandidateIds']),
        baseStationSelectionRequired: Boolean(currentTurn?.['baseStationSelectionRequired']),
        activeEffects: this.mapActiveEffects(currentTurn?.['activeEffects']),
        expirations: Number(currentTurn?.['expirations'] ?? 0),
        foundVotes: Array.isArray(currentTurn?.['foundVotes']) ? currentTurn['foundVotes'] as string[] : [],
        captureAttempt: this.mapCaptureAttempt(currentTurn?.['captureAttempt']),
        endgameConsultation: this.mapEndgameConsultation(currentTurn?.['endgameConsultation']),
        endgameActive: Boolean(currentTurn?.['endgameActive']),
        endgameQuestionsUnlocked: Boolean(currentTurn?.['endgameQuestionsUnlocked']),
        lastQuestionResult: this.mapLastQuestionResult(currentTurn?.['lastQuestionResult']),
        moveState: this.mapMoveState(currentTurn?.['moveState']),
      },
    };
  }

  private mapCategoryCooldowns(value: unknown): Record<string, string | null> {
    if (!value || typeof value !== 'object') {
      return {};
    }

    const cooldowns: Record<string, string | null> = {};
    for (const [categoryId, timestamp] of Object.entries(value as Record<string, unknown>)) {
      cooldowns[categoryId] = this.timestampToIso(timestamp);
    }
    return cooldowns;
  }

  private mapMoveState(value: unknown): GameBlueprint['currentTurn']['moveState'] {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const move = value as Record<string, unknown>;
    const status = move['status'];
    if (status !== 'ACTIVE' && status !== 'COMPLETED') {
      return null;
    }

    return {
      status,
      cardId: String(move['cardId'] ?? ''),
      startedAtIso: this.timestampToIso(move['startedAt']),
      endsAtIso: this.timestampToIso(move['endsAt']),
      previousStationId: String(move['previousStationId'] ?? ''),
      targetStationId: typeof move['targetStationId'] === 'string' ? move['targetStationId'] : null,
      completedAtIso: this.timestampToIso(move['completedAt']),
      remainingPhaseSeconds: Number(move['remainingPhaseSeconds'] ?? 0),
    };
  }
  private mapEndgameConsultation(value: unknown): GameBlueprint['currentTurn']['endgameConsultation'] {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const consultation = value as Record<string, unknown>;
    const status = consultation['status'];
    if (status !== 'PENDING_HIDER' && status !== 'CONFIRMED' && status !== 'REJECTED') {
      return null;
    }

    return {
      status,
      requestedByUid: String(consultation['requestedByUid'] ?? ''),
      requestedByTeamId: String(consultation['requestedByTeamId'] ?? ''),
      requestedAtIso: this.timestampToIso(consultation['requestedAt']),
      resolvedByUid: typeof consultation['resolvedByUid'] === 'string' ? consultation['resolvedByUid'] : null,
      resolvedAtIso: this.timestampToIso(consultation['resolvedAt']),
    };
  }
  private mapLastQuestionResult(value: unknown): GameBlueprint['currentTurn']['lastQuestionResult'] {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const result = value as Record<string, unknown>;
    const resolution = result['resolution'];
    if (resolution !== 'ANSWER' && resolution !== 'VETO' && resolution !== 'RANDOMIZE' && resolution !== 'TIMEOUT') {
      return null;
    }

    return {
      questionId: String(result['questionId'] ?? ''),
      categoryId: String(result['categoryId'] ?? ''),
      prompt: String(result['prompt'] ?? ''),
      resolution,
      answerText: typeof result['answerText'] === 'string' ? result['answerText'] : null,
      resolvedAtIso: this.timestampToIso(result['resolvedAt']),
    };
  }

  private mapOperationalState(value: unknown): GameBlueprint['operational'] {
    if (!value || typeof value !== 'object') {
      return {
        mode: 'NORMAL',
        reason: null,
        changedAtIso: null,
        phaseRemainingSeconds: null,
        pendingQuestionRemainingSeconds: null,
        canceledAtIso: null,
        cancellationReason: null,
      };
    }

    const operational = value as Record<string, unknown>;
    const mode = operational['mode'];
    return {
      mode: mode === 'PAUSED' || mode === 'EMERGENCY' ? mode : 'NORMAL',
      reason: typeof operational['reason'] === 'string' ? operational['reason'] : null,
      changedAtIso: this.timestampToIso(operational['changedAt']),
      phaseRemainingSeconds: typeof operational['phaseRemainingSeconds'] === 'number'
        ? operational['phaseRemainingSeconds']
        : null,
      pendingQuestionRemainingSeconds: typeof operational['pendingQuestionRemainingSeconds'] === 'number'
        ? operational['pendingQuestionRemainingSeconds']
        : null,
      canceledAtIso: this.timestampToIso(operational['canceledAt']),
      cancellationReason: typeof operational['cancellationReason'] === 'string'
        ? operational['cancellationReason']
        : null,
    };
  }

  private timestampToIso(value: unknown): string | null {
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
      return value.toDate().toISOString();
    }
    return null;
  }

  private getPendingQuestionId(game: Record<string, unknown>): string | null {
    const currentTurn = game['currentTurn'] as Record<string, unknown> | undefined;
    const pendingQuestionId = currentTurn?.['pendingQuestionId'];
    return typeof pendingQuestionId === 'string' && pendingQuestionId.trim() ? pendingQuestionId : null;
  }

  private syncTurnQuestionHistory(gameId: string, game: Record<string, unknown>): void {
    const currentTurn = game['currentTurn'] as Record<string, unknown> | undefined;
    const nextRunNumber = Number(currentTurn?.['runNumber'] ?? 0);
    const turnStartedAtIso = this.timestampToIso(currentTurn?.['phaseStartedAt']);
    const nextStartedAt = turnStartedAtIso ? Date.parse(turnStartedAtIso) : null;
    const turnChanged = nextRunNumber !== this.turnQuestionHistoryRunNumber || nextStartedAt !== this.turnQuestionHistoryStartedAt;
    this.turnQuestionHistoryRunNumber = nextRunNumber;
    this.turnQuestionHistoryStartedAt = nextStartedAt;
    if (turnChanged) {
      this.turnQuestionHistorySubject.next([]);
    }

    if (this.questionsSubscription) {
      return;
    }

    this.questionsSubscription = this.firebaseClient.questions$(gameId).subscribe({
      next: questions => {
        const mapped = questions
          .map(question => this.mapTurnQuestionHistoryItem(question))
          .filter(question => {
            if (question.runNumber !== null) {
              return question.runNumber === this.turnQuestionHistoryRunNumber;
            }
            if (this.turnQuestionHistoryStartedAt !== null && question.createdAtIso) {
              return Date.parse(question.createdAtIso) >= this.turnQuestionHistoryStartedAt;
            }
            return true;
          })
          .sort((first, second) => Date.parse(second.createdAtIso ?? '') - Date.parse(first.createdAtIso ?? ''));
        this.turnQuestionHistorySubject.next(mapped);
      },
      error: error => {
        console.warn('[firebase-game] No se pudo cargar el historial de preguntas', error);
        this.turnQuestionHistorySubject.next([]);
      },
    });
  }
  private syncPendingQuestion(gameId: string, questionId: string | null): void {
    const questionKey = questionId ? `${gameId}/${questionId}` : null;
    if (this.loadedPendingQuestionKey === questionKey) {
      return;
    }

    this.loadedPendingQuestionKey = questionKey;
    this.questionSubscription?.unsubscribe();
    this.questionSubscription = null;

    if (!questionId) {
      this.pendingQuestionSubject.next(null);
      return;
    }

    this.questionSubscription = this.firebaseClient.questionDoc$(gameId, questionId).subscribe({
      next: question => this.pendingQuestionSubject.next(question ? this.mapQuestionDoc(question) : null),
      error: error => {
        console.warn('[firebase-game] No se pudo cargar la pregunta pendiente', error);
        this.pendingQuestionSubject.next(null);
      },
    });
  }

  private mapTurnQuestionHistoryItem(question: Record<string, unknown> & { id: string }): TurnQuestionHistoryItem {
    const resolution = question['resolution'];
    const status = question['status'];
    return {
      id: question.id,
      categoryId: String(question['categoryId'] ?? ''),
      prompt: String(question['prompt'] ?? ''),
      isPhoto: Boolean(question['isPhoto']),
      distanceM: typeof question['distanceM'] === 'number' ? question['distanceM'] : null,
      customDistanceM: typeof question['customDistanceM'] === 'number' ? question['customDistanceM'] : null,
      status: status === 'RESOLVED' || status === 'EXPIRED' ? status : 'PENDING',
      resolution: resolution === 'ANSWER' || resolution === 'VETO' || resolution === 'RANDOMIZE' || resolution === 'TIMEOUT' ? resolution : null,
      answerText: typeof question['answerText'] === 'string' ? question['answerText'] : null,
      runNumber: typeof question['runNumber'] === 'number' ? question['runNumber'] : null,
      createdAtIso: this.timestampToIso(question['createdAt']),
      resolvedAtIso: this.timestampToIso(question['resolvedAt']),
      expiresAtIso: this.timestampToIso(question['expiresAt']),
    };
  }
  private mapQuestionDoc(question: Record<string, unknown> & { id: string }): PendingQuestion {
    return {
      id: question.id,
      categoryId: String(question['categoryId'] ?? ''),
      prompt: String(question['prompt'] ?? ''),
      isPhoto: Boolean(question['isPhoto']),
      distanceM: typeof question['distanceM'] === 'number' ? question['distanceM'] : null,
      customDistanceM: typeof question['customDistanceM'] === 'number' ? question['customDistanceM'] : null,
      answerText: typeof question['answerText'] === 'string' ? question['answerText'] : null,
      status: (question['status'] as PendingQuestion['status'] | undefined) ?? 'PENDING',
      createdAtIso: this.timestampToIso(question['createdAt']),
      expiresAtIso: this.timestampToIso(question['expiresAt']),
    };
  }

  private mapLootOffer(value: unknown): GameBlueprint['currentTurn']['lootOffer'] {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const lootOffer = value as Record<string, unknown>;
    return {
      questionId: String(lootOffer['questionId'] ?? ''),
      categoryId: String(lootOffer['categoryId'] ?? ''),
      drawnCardIds: this.stringArray(lootOffer['drawnCardIds']),
      takeLimit: Number(lootOffer['takeLimit'] ?? 0),
      createdAtIso: this.timestampToIso(lootOffer['createdAt']),
    };
  }

  private mapHidingZone(value: unknown): GameBlueprint['currentTurn']['hidingZone'] {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const zone = value as Record<string, unknown>;
    const center = zone['center'] as Record<string, unknown> | undefined;
    const lat = Number(center?.['lat']);
    const lng = Number(center?.['lng']);
    const radiusM = Number(zone['radiusM']);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusM)) {
      return null;
    }

    return {
      stationId: typeof zone['stationId'] === 'string' ? zone['stationId'] : undefined,
      center: { lat, lng },
      radiusM,
    };
  }
  private mapCaptureAttempt(value: unknown): GameBlueprint['currentTurn']['captureAttempt'] {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const attempt = value as Record<string, unknown>;
    const status = attempt['status'];
    if (status !== 'PENDING_HIDER' && status !== 'CONFIRMED' && status !== 'REJECTED') {
      return null;
    }

    return {
      id: String(attempt['id'] ?? ''),
      status,
      createdByUid: String(attempt['createdByUid'] ?? ''),
      createdByTeamId: String(attempt['createdByTeamId'] ?? ''),
      createdAtIso: this.timestampToIso(attempt['createdAt']),
      hiderResolvedByUid: typeof attempt['hiderResolvedByUid'] === 'string' ? attempt['hiderResolvedByUid'] : null,
      hiderResolvedAtIso: this.timestampToIso(attempt['hiderResolvedAt']),
      seekerConfirmations: this.stringArray(attempt['seekerConfirmations']),
      completedAtIso: this.timestampToIso(attempt['completedAt']),
    };
  }

  private mapActiveEffects(value: unknown): GameBlueprint['currentTurn']['activeEffects'] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map(effect => {
      const effectRecord = effect as Record<string, unknown>;
      return {
        id: String(effectRecord['id'] ?? ''),
        curseId: String(effectRecord['curseId'] ?? ''),
        createdByUid: String(effectRecord['createdByUid'] ?? ''),
        createdAtIso: this.timestampToIso(effectRecord['createdAt']),
        expiresAtIso: this.timestampToIso(effectRecord['expiresAt']),
        blocksQuestions: Boolean(effectRecord['blocksQuestions']),
        blocksTransport: Boolean(effectRecord['blocksTransport']),
      };
    });
  }

  private stringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(item => String(item)) : [];
  }

  private firstNameFromGoogleUser(user: { displayName: string | null; email: string | null }): string {
    const displayName = user.displayName?.trim();
    if (displayName) {
      return displayName.split(/\s+/)[0];
    }

    return user.email?.split('@')[0] ?? '';
  }

  private buildPlayerRole(uid: string | null, lobby: LobbyState | null, blueprint: GameBlueprint): PlayerRole {
    const seat = uid && lobby ? lobby.seats.find(item => item.uid === uid || item.id === uid) ?? null : null;
    const teamId = seat?.teamId || null;
    const isParticipant = Boolean(seat);
    const isHider = Boolean(teamId && teamId === blueprint.currentTurn.hiderTeamId);

    return {
      uid,
      seat,
      teamId,
      isHost: Boolean(uid && lobby?.hostUid === uid),
      isHider,
      isSeeker: isParticipant && !isHider,
      isParticipant,
    };
  }
}


