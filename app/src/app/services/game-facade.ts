import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  DEFAULT_SETTINGS,
  GameBlueprint,
  GameMode,
  LobbyState,
  PendingQuestion,
  PlayerRole,
  QuestionResolution,
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
      pendingQuestionId: null,
      pendingQuestionEndsAtIso: null,
      pendingQuestion: false,
      hiderHandIds: [],
      drawPileCount: 0,
      discardPileCount: 0,
      lootOffer: null,
      hidingZone: null,
      baseStationCandidateIds: [],
      baseStationSelectionRequired: false,
      activeEffects: [],
      expirations: 0,
      foundVotes: [],
      foundConfirmed: false,
      captureAttempt: null,
      endgameEligible: false,
      endgameActive: false,
      endgameQuestionsUnlocked: false,
      outOfArea: null,
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

@Injectable({ providedIn: 'root' })
export class GameFacadeService {
  constructor(private readonly firebaseClient: FirebaseGameClientService) {}

  private readonly games = new Map<string, { blueprint: GameBlueprint; lobby: LobbyState }>();
  private loadedGameId: string | null = null;
  private gameSubscription: Subscription | null = null;
  private questionSubscription: Subscription | null = null;
  private loadedPendingQuestionKey: string | null = null;

  private readonly blueprintSubject = new BehaviorSubject<GameBlueprint>(
    buildBlueprint('INDIVIDUAL_3', 2, 'TOTAL_TIME'),
  );
  readonly blueprint$ = this.blueprintSubject.asObservable();

  private readonly lobbySubject = new BehaviorSubject<LobbyState | null>(null);
  readonly lobby$ = this.lobbySubject.asObservable();

  private readonly pendingQuestionSubject = new BehaviorSubject<PendingQuestion | null>(null);
  readonly pendingQuestion$ = this.pendingQuestionSubject.asObservable();

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
          this.syncPendingQuestion(gameId, null);
          return;
        }
        this.syncPendingQuestion(gameId, this.getPendingQuestionId(game));
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

  toggleTeamsLock(gameId: string): Promise<{ ok: boolean; teamsLocked: boolean }> {
    const current = this.lobbySubject.value;
    return this.firebaseClient.callFunction<{ gameId: string; lock: boolean }, { ok: boolean; teamsLocked: boolean }>(
      'lockTeams',
      { gameId, lock: !current?.teamsLocked },
    );
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

  sendQuestion(gameId: string, categoryId: string, prompt: string, isPhoto: boolean): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<
      { gameId: string; categoryId: string; prompt: string; isPhoto: boolean },
      { ok: boolean }
    >('sendQuestion', { gameId, categoryId, prompt, isPhoto });
  }

  publishSeekerLocation(
    gameId: string,
    lat: number,
    lng: number,
    isOnPublicTransport: boolean,
  ): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<
      { gameId: string; lat: number; lng: number; isOnPublicTransport: boolean },
      { ok: boolean }
    >('publishSeekerLocation', { gameId, lat, lng, isOnPublicTransport });
  }

  publishHiderPrivateLocation(
    gameId: string,
    lat: number,
    lng: number,
    accuracyM: number,
  ): Promise<{
    ok: boolean;
    isInsidePlayableArea: boolean | null;
    geofenceReliable: boolean;
    outOfAreaStatus: 'SUSPECTED' | 'ALERTED' | null;
  }> {
    return this.firebaseClient.callFunction<
      { gameId: string; lat: number; lng: number; accuracyM: number },
      {
        ok: boolean;
        isInsidePlayableArea: boolean | null;
        geofenceReliable: boolean;
        outOfAreaStatus: 'SUSPECTED' | 'ALERTED' | null;
      }
    >('publishHiderPrivateLocation', { gameId, lat, lng, accuracyM });
  }

  confirmBaseStation(gameId: string, stationId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; stationId: string }, { ok: boolean }>(
      'confirmBaseStation',
      { gameId, stationId },
    );
  }

  consultEndgameQuestions(gameId: string): Promise<{ ok: boolean; unlocked: boolean; cooldownActive?: boolean }> {
    return this.firebaseClient.callFunction<
      { gameId: string },
      { ok: boolean; unlocked: boolean; cooldownActive?: boolean }
    >(
      'consultEndgameQuestions',
      { gameId },
    );
  }

  resolveQuestion(gameId: string, resolution: QuestionResolution): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string; resolution: QuestionResolution }, { ok: boolean }>(
      'resolveQuestion',
      { gameId, resolution },
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

  reportHiderOutOfArea(gameId: string): Promise<{ ok: boolean; status: 'SUSPECTED' | 'ALERTED' }> {
    return this.firebaseClient.callFunction<{ gameId: string }, { ok: boolean; status: 'SUSPECTED' | 'ALERTED' }>(
      'reportHiderOutOfArea',
      { gameId },
    );
  }

  confirmHiderOutOfAreaSafety(gameId: string): Promise<{ ok: boolean; status: 'SUSPECTED' | 'ALERTED' }> {
    return this.firebaseClient.callFunction<{ gameId: string }, { ok: boolean; status: 'SUSPECTED' | 'ALERTED' }>(
      'confirmHiderOutOfAreaSafety',
      { gameId },
    );
  }

  clearHiderOutOfArea(gameId: string): Promise<{ ok: boolean }> {
    return this.firebaseClient.callFunction<{ gameId: string }, { ok: boolean }>(
      'clearHiderOutOfArea',
      { gameId },
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
        pendingQuestionId: this.getPendingQuestionId(game),
        pendingQuestionEndsAtIso: this.timestampToIso(currentTurn?.['pendingQuestionEndsAt']),
        pendingQuestion: Boolean(currentTurn?.['pendingQuestionId']),
        hiderHandIds: this.stringArray(currentTurn?.['hiderHand']),
        drawPileCount: this.stringArray(currentTurn?.['drawPile']).length,
        discardPileCount: this.stringArray(currentTurn?.['discardPile']).length,
        lootOffer: this.mapLootOffer(currentTurn?.['lootOffer']),
        hidingZone: this.mapHidingZone(currentTurn?.['hidingZone']),
        baseStationCandidateIds: this.stringArray(currentTurn?.['baseStationCandidateIds']),
        baseStationSelectionRequired: Boolean(currentTurn?.['baseStationSelectionRequired']),
        activeEffects: this.mapActiveEffects(currentTurn?.['activeEffects']),
        expirations: Number(currentTurn?.['expirations'] ?? 0),
        foundVotes: Array.isArray(currentTurn?.['foundVotes']) ? currentTurn['foundVotes'] as string[] : [],
        captureAttempt: this.mapCaptureAttempt(currentTurn?.['captureAttempt']),
        endgameActive: Boolean(currentTurn?.['endgameActive']),
        endgameQuestionsUnlocked: Boolean(currentTurn?.['endgameQuestionsUnlocked']),
        outOfArea: this.mapOutOfAreaStatus(currentTurn?.['outOfArea']),
      },
    };
  }

  private mapOutOfAreaStatus(value: unknown): GameBlueprint['currentTurn']['outOfArea'] {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const status = value as Record<string, unknown>;
    const statusValue = status['status'];
    if (statusValue !== 'SUSPECTED' && statusValue !== 'ALERTED') {
      return null;
    }

    return {
      status: statusValue,
      playerUid: String(status['playerUid'] ?? ''),
      startedAtIso: this.timestampToIso(status['startedAt']),
      confirmationExpiresAtIso: this.timestampToIso(status['confirmationExpiresAt']),
      maxExpiresAtIso: this.timestampToIso(status['maxExpiresAt']),
      lastConfirmedAtIso: this.timestampToIso(status['lastConfirmedAt']),
      alertedAtIso: this.timestampToIso(status['alertedAt']),
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

  private mapQuestionDoc(question: Record<string, unknown> & { id: string }): PendingQuestion {
    return {
      id: question.id,
      categoryId: String(question['categoryId'] ?? ''),
      prompt: String(question['prompt'] ?? ''),
      isPhoto: Boolean(question['isPhoto']),
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

  private buildPlayerRole(uid: string | null, lobby: LobbyState | null, blueprint: GameBlueprint): PlayerRole {
    const seat = uid && lobby ? lobby.seats.find(item => item.uid === uid || item.id === uid) ?? null : null;
    const teamId = seat?.teamId || null;
    const isParticipant = Boolean(seat);
    const isHider = Boolean(teamId && teamId === blueprint.currentTurn.hiderTeamId);

    return {
      uid,
      seat,
      teamId,
      isHost: Boolean(seat?.host),
      isHider,
      isSeeker: isParticipant && !isHider,
      isParticipant,
    };
  }
}
