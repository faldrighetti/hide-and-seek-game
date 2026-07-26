import {
  DocumentData,
  DocumentReference,
  Firestore,
  Timestamp,
  Transaction,
} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {
  findNearestPlayableStation,
  findPlayableStationZones,
  getPlayableStationById,
} from "./playable-area";
import {
  GameEventInput,
  appendGameNotificationsForEventInTx,
} from "./notifications";

export const GAME_ID_LENGTH = 6;
export const SEAT_OFFLINE_SECONDS = 90;
export const HIDING_ZONE_RADIUS_M = 600;
export const INTERVAL_PHASE_SECONDS = 300;
export const ESCAPE_PHASE_SECONDS = 3600;
export const CHASE_MAX_SECONDS = 18000;
export const ENDGAME_DWELL_SECONDS = 60;
export const LOCATION_FRESH_SECONDS = 60;
export const ENDGAME_QUESTIONS_CONSULT_COOLDOWN_SECONDS = 60;
export const OUT_OF_AREA_CONFIRMATION_SECONDS = 60;
export const OUT_OF_AREA_MAX_GRACE_SECONDS = 180;
export const OUT_OF_AREA_SUSTAINED_SECONDS = 30;
export const MAX_GEOFENCE_ACCURACY_M = 100;

export type GameMode = "INDIVIDUAL_1v1" | "INDIVIDUAL_3" | "TEAMS_2v2" | "TEAMS_2v2v2";
export type WinCondition = "TOTAL_TIME" | "BEST_SINGLE_RUN";
export type Phase = "INTERMISSION" | "ESCAPE" | "CHASE" | "ENDED";
export type GameStatus = "LOBBY" | "LIVE" | "FINISHED";
export type OperationalMode = "NORMAL" | "PAUSED" | "EMERGENCY";

export interface GameSettings {
  turnsPerTeam: 1 | 2 | 3;
  winCondition: WinCondition;
  ukMode: boolean;
  intermissionSeconds: number;
  escapeSeconds: number;
  chaseMaxSeconds: number;
  zoneRadiusM: number;
  eligibleBufferM: number;
  endgameVerificationCooldownSeconds: number;
  outOfAreaConfirmationSeconds: number;
  outOfAreaMaxGraceSeconds: number;
  outOfAreaSustainedSeconds: number;
  maxGeofenceAccuracyM: number;
}

export interface TeamStanding {
  totalTimeSeconds: number;
  bestSingleRunSeconds: number;
  runsCompleted: number;
}

export interface ActiveEffect {
  id: string;
  curseId: string;
  createdByUid: string;
  createdAt: Timestamp;
  expiresAt?: Timestamp | null;
  blocksQuestions: boolean;
  blocksTransport: boolean;
}

export interface LootOffer {
  questionId: string;
  categoryId: string;
  drawnCardIds: string[];
  takeLimit: number;
  createdAt: Timestamp;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface HidingZone {
  stationId?: string;
  center: LatLng;
  radiusM: number;
}

export interface OutOfAreaState {
  status: "SUSPECTED" | "ALERTED";
  playerUid: string;
  startedAt: Timestamp;
  confirmationExpiresAt: Timestamp;
  maxExpiresAt: Timestamp;
  lastConfirmedAt?: Timestamp | null;
  alertedAt?: Timestamp | null;
}

export interface CaptureAttempt {
  id: string;
  status: "PENDING_HIDER" | "CONFIRMED" | "REJECTED";
  createdByUid: string;
  createdByTeamId: string;
  createdAt: Timestamp;
  hiderResolvedByUid?: string | null;
  hiderResolvedAt?: Timestamp | null;
  seekerConfirmations: string[];
  completedAt?: Timestamp | null;
}

export interface OperationalState {
  mode: OperationalMode;
  reason?: string | null;
  changedByUid?: string | null;
  changedAt?: Timestamp | null;
  pausedAt?: Timestamp | null;
  phaseRemainingSeconds?: number | null;
  pendingQuestionRemainingSeconds?: number | null;
  emergency?: {
    declaredByUid: string;
    declaredAt: Timestamp;
    reason: string | null;
  } | null;
  canceledAt?: Timestamp | null;
  canceledByUid?: string | null;
  cancellationReason?: string | null;
}

export interface TurnState {
  runNumber: number;
  hiderTeamId: string;
  phase: Phase;
  phaseEndsAt: Timestamp;
  phaseStartedAt: Timestamp;
  chaseStartedAt?: Timestamp;
  pendingQuestionId?: string | null;
  pendingQuestionEndsAt?: Timestamp | null;
  categoryCooldowns?: Record<string, Timestamp>;
  activeEffects?: ActiveEffect[];
  hiderHand?: string[];
  drawPile?: string[];
  discardPile?: string[];
  lootOffer?: LootOffer | null;
  hidingZone?: HidingZone | null;
  baseStationCandidateIds?: string[];
  baseStationSelectionRequired?: boolean;
  endgameActive?: boolean;
  endgameAnchorPoint?: LatLng | null;
  endgameLastChangedAt?: Timestamp | null;
  lastEndgameVerificationAt?: Timestamp | null;
  endgameQuestionsUnlocked?: boolean;
  lastEndgameQuestionsConsultAt?: Timestamp | null;
  outOfArea?: OutOfAreaState | null;
  expirations: number;
  foundVotes: string[];
  captureAttempt?: CaptureAttempt | null;
}

export interface GameDoc {
  gameName: string;
  mode: GameMode;
  status: GameStatus;
  hostUid: string;
  teamsLocked: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  startedAt?: Timestamp;
  finishedAt?: Timestamp;
  settings: GameSettings;
  operational?: OperationalState | null;
  teamOrder: string[];
  currentTurn?: TurnState;
  standings: Record<string, TeamStanding>;
  winnerTeamIds?: string[];
}

export const DEFAULT_SETTINGS: GameSettings = {
  turnsPerTeam: 2,
  winCondition: "TOTAL_TIME",
  ukMode: false,
  intermissionSeconds: INTERVAL_PHASE_SECONDS,
  escapeSeconds: ESCAPE_PHASE_SECONDS,
  chaseMaxSeconds: CHASE_MAX_SECONDS,
  zoneRadiusM: HIDING_ZONE_RADIUS_M,
  eligibleBufferM: 0,
  endgameVerificationCooldownSeconds: ENDGAME_DWELL_SECONDS * 10,
  outOfAreaConfirmationSeconds: OUT_OF_AREA_CONFIRMATION_SECONDS,
  outOfAreaMaxGraceSeconds: OUT_OF_AREA_MAX_GRACE_SECONDS,
  outOfAreaSustainedSeconds: OUT_OF_AREA_SUSTAINED_SECONDS,
  maxGeofenceAccuracyM: MAX_GEOFENCE_ACCURACY_M,
};

export const DECK_MAX_SIZE = 6;

export const QUESTION_DRAW_RULES: Record<string, {draw: number; take: number}> = {
  matching: {draw: 3, take: 1},
  measuring: {draw: 3, take: 1},
  thermometer: {draw: 1, take: 1},
  radar: {draw: 1, take: 1},
  tentacles: {draw: 4, take: 2},
  endgame: {draw: 1, take: 1},
  photos: {draw: 1, take: 1},
};

export const expandCopies = (cardId: string, copies: number): string[] =>
  Array.from({length: copies}, (_, index) => `${cardId}#${index + 1}`);

export const BASE_HIDER_DECK = [
  ...expandCopies("time_bonus_red_3m", 25),
  ...expandCopies("time_bonus_orange_5m", 15),
  ...expandCopies("time_bonus_yellow_10m", 10),
  ...expandCopies("time_bonus_green_15m", 3),
  ...expandCopies("time_bonus_blue_20m", 2),
  ...expandCopies("powerup_randomize", 4),
  ...expandCopies("powerup_veto", 4),
  ...expandCopies("powerup_duplicate", 2),
  ...expandCopies("powerup_move", 1),
  ...expandCopies("powerup_discard1_draw2", 4),
  ...expandCopies("powerup_discard2_draw3", 4),
  ...expandCopies("powerup_draw1_expand1", 2),
  ...expandCopies("curse_2", 1),
  ...expandCopies("curse_5", 1),
  ...expandCopies("curse_7", 1),
  ...expandCopies("curse_8", 1),
  ...expandCopies("curse_19", 1),
  ...expandCopies("curse_25", 1),
  ...expandCopies("curse_26", 1),
  ...expandCopies("curse_27", 1),
  ...expandCopies("curse_28", 1),
  ...expandCopies("curse_29", 1),
  ...expandCopies("curse_34", 1),
  ...expandCopies("curse_39", 1),
];

export const timeBonusSecondsByCardPrefix: Record<string, number> = {
  time_bonus_red_3m: 180,
  time_bonus_orange_5m: 300,
  time_bonus_yellow_10m: 600,
  time_bonus_green_15m: 900,
  time_bonus_blue_20m: 1200,
};

export const modeTeamIds = (mode: GameMode): string[] => {
  if (mode === "INDIVIDUAL_1v1" || mode === "TEAMS_2v2") return ["A", "B"];
  return ["A", "B", "C"];
};

export const modeMaxSeats = (mode: GameMode): number => {
  if (mode === "INDIVIDUAL_1v1") return 2;
  if (mode === "INDIVIDUAL_3") return 3;
  if (mode === "TEAMS_2v2") return 4;
  return 6;
};

export const validateLobbyTeams = (mode: GameMode, seats: DocumentData[]): void => {
  const teamIds = modeTeamIds(mode);
  const validTeams = new Set(teamIds);
  if (seats.length < teamIds.length) {
    throw new HttpsError("failed-precondition", "Faltan jugadores para cubrir todos los equipos.");
  }

  const countsByTeam = new Map(teamIds.map((teamId) => [teamId, 0]));
  for (const seat of seats) {
    const teamId = String(seat.teamId ?? "");
    if (!validTeams.has(teamId)) {
      throw new HttpsError("failed-precondition", "Todos los jugadores deben tener un equipo válido.");
    }
    countsByTeam.set(teamId, (countsByTeam.get(teamId) ?? 0) + 1);
  }

  const emptyTeamIds = teamIds.filter((teamId) => (countsByTeam.get(teamId) ?? 0) === 0);
  if (emptyTeamIds.length > 0) {
    throw new HttpsError("failed-precondition", `Hay equipos sin jugadores: ${emptyTeamIds.join(", ")}.`);
  }
};

export const nowTs = (): Timestamp => Timestamp.now();

export const cleanEventPayload = (payload: Record<string, unknown> = {}): Record<string, unknown> =>
  Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined));

export const serializeEventValue = (value: unknown): unknown => {
  if (value instanceof Timestamp) {
    return {
      iso: value.toDate().toISOString(),
      millis: value.toMillis(),
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeEventValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, serializeEventValue(nestedValue)]),
    );
  }
  return value;
};

export const appendGameEventInTx = (
  tx: Transaction,
  gameRef: DocumentReference,
  game: GameDoc,
  event: GameEventInput,
): DocumentReference => {
  const turn = game.currentTurn;
  const eventRef = gameRef.collection("events").doc();
  const payload = cleanEventPayload(event.payload);
  tx.set(eventRef, {
    type: event.type,
    createdAt: event.createdAt,
    actorUid: event.actorUid ?? null,
    actorTeamId: event.actorTeamId ?? null,
    runNumber: turn?.runNumber ?? null,
    phase: turn?.phase ?? null,
    hiderTeamId: turn?.hiderTeamId ?? null,
    payload,
  });
  appendGameNotificationsForEventInTx(tx, gameRef, game, event, eventRef.id, payload);
  return eventRef;
};

export const randomCode = (): string => Math.random().toString(36).slice(2, 2 + GAME_ID_LENGTH).toUpperCase();

export const shuffle = <T>(items: T[]): T[] => {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

export const createInitialDeckState = (): Pick<TurnState, "hiderHand" | "drawPile" | "discardPile" | "lootOffer"> => ({
  hiderHand: [],
  drawPile: shuffle(BASE_HIDER_DECK),
  discardPile: [],
  lootOffer: null,
});

export const pickInitialHider = (teamOrder: string[]): string => {
  const idx = Math.floor(Math.random() * teamOrder.length);
  return teamOrder[idx];
};

export const requireAuthUid = (uid: string | undefined): string => {
  if (!uid) throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  return uid;
};

export const requireGameMembership = async (firestore: Firestore, gameId: string, uid: string): Promise<void> => {
  const seats = await firestore.collection("games").doc(gameId).collection("seats")
    .where("uid", "==", uid)
    .limit(1)
    .get();
  if (seats.empty) throw new HttpsError("permission-denied", "No perteneces a esta partida.");
};

export const requireHost = async (firestore: Firestore, gameId: string, uid: string): Promise<void> => {
  const gameSnap = await firestore.collection("games").doc(gameId).get();
  if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
  const game = gameSnap.data() as GameDoc;
  if (game.hostUid !== uid) throw new HttpsError("permission-denied", "Solo el host puede ejecutar esta acción.");
};

export const isFoundMajorityReached = (teamCount: number, votedTeams: string[]): boolean => {
  if (teamCount <= 2) return votedTeams.length >= 2;
  return votedTeams.length >= 2;
};

export const requiredSeekerCaptureConfirmations = (game: GameDoc): number =>
  game.teamOrder.length <= 2 ? 1 : 2;

export const isOperationallyStopped = (game: GameDoc): boolean =>
  game.operational?.mode === "PAUSED" || game.operational?.mode === "EMERGENCY";

export const assertOperationalPlayAllowed = (game: GameDoc): void => {
  if (game.operational?.mode === "PAUSED") {
    throw new HttpsError("failed-precondition", "GAME_PAUSED");
  }
  if (game.operational?.mode === "EMERGENCY") {
    throw new HttpsError("failed-precondition", "GAME_EMERGENCY");
  }
};

export const secondsRemaining = (deadline: Timestamp | null | undefined, baseNow: Timestamp): number | null => {
  if (!deadline) return null;
  return Math.max(0, Math.ceil((deadline.toMillis() - baseNow.toMillis()) / 1000));
};

export const getPhaseDurationSeconds = (settings: GameSettings, phase: Phase): number => {
  if (phase === "INTERMISSION") return settings.intermissionSeconds;
  if (phase === "ESCAPE") return settings.escapeSeconds;
  if (phase === "CHASE") return settings.chaseMaxSeconds;
  return 0;
};

export const setNextPhase = (turn: TurnState, settings: GameSettings, phase: Phase, baseNow: Timestamp): TurnState => {
  const duration = getPhaseDurationSeconds(settings, phase);
  const phaseEndsAt = Timestamp.fromMillis(baseNow.toMillis() + duration * 1000);
  return {
    ...turn,
    phase,
    phaseStartedAt: baseNow,
    phaseEndsAt,
    chaseStartedAt: phase === "CHASE" ? baseNow : turn.chaseStartedAt,
    foundVotes: phase === "CHASE" ? [] : turn.foundVotes,
    endgameActive: phase === "CHASE" ? false : turn.endgameActive,
    endgameAnchorPoint: phase === "CHASE" ? null : turn.endgameAnchorPoint,
    endgameLastChangedAt: phase === "CHASE" ? null : turn.endgameLastChangedAt,
    lastEndgameVerificationAt: phase === "CHASE" ? null : turn.lastEndgameVerificationAt,
    endgameQuestionsUnlocked: phase === "CHASE" ? false : turn.endgameQuestionsUnlocked,
    lastEndgameQuestionsConsultAt: phase === "CHASE" ? null : turn.lastEndgameQuestionsConsultAt,
    captureAttempt: phase === "CHASE" ? null : turn.captureAttempt ?? null,
    outOfArea: null,
  };
};

export const findWinnerIds = (game: GameDoc): string[] => {
  const entries = Object.entries(game.standings);
  const primary = game.settings.winCondition === "TOTAL_TIME" ? "totalTimeSeconds" : "bestSingleRunSeconds";
  const secondary = game.settings.winCondition === "TOTAL_TIME" ? "bestSingleRunSeconds" : "totalTimeSeconds";

  const sorted = [...entries].sort((a, b) => {
    const pDiff = b[1][primary] - a[1][primary];
    if (pDiff !== 0) return pDiff;
    return b[1][secondary] - a[1][secondary];
  });

  if (sorted.length === 0) return [];
  const [bestTeamId, best] = sorted[0];
  return sorted
    .filter(([_, standing]) =>
      standing[primary] === best[primary] && standing[secondary] === best[secondary],
    )
    .map(([teamId]) => teamId)
    .includes(bestTeamId) ?
    sorted.filter(([_, standing]) =>
      standing[primary] === best[primary] && standing[secondary] === best[secondary],
    ).map(([teamId]) => teamId) : [bestTeamId];
};

export const getNextHiderTeamId = (game: GameDoc, currentHider: string): string => {
  const order = game.teamOrder;
  const idx = order.indexOf(currentHider);
  if (idx < 0) return order[0];
  return order[(idx + 1) % order.length];
};

export const cardBaseId = (cardId: string): string => cardId.split("#")[0];

export const getTimeBonusSeconds = (hand: string[] = []): number =>
  hand.reduce((total, cardId) => total + (timeBonusSecondsByCardPrefix[cardBaseId(cardId)] ?? 0), 0);

export const hasDuplicates = (items: string[]): boolean => new Set(items).size !== items.length;

export const assertValidCoordinate = (lat: number, lng: number): void => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new HttpsError("invalid-argument", "Coordenadas inválidas.");
  }
};

export const distanceMeters = (a: LatLng, b: LatLng): number => {
  const earthRadiusM = 6371000;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

export const readLocationPoint = (data: DocumentData | undefined): LatLng | null => {
  const lat = data?.lat;
  const lng = data?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {lat, lng};
};

export const buildHidingZoneForStation = (stationId: string, radiusM: number): HidingZone => {
  const station = getPlayableStationById(stationId);
  if (!station) {
    throw new HttpsError("invalid-argument", "La estación no es jugable.");
  }

  return {
    stationId: station.id,
    center: {lat: station.lat, lng: station.lng},
    radiusM,
  };
};

export const isFreshLocation = (updatedAt: Timestamp | undefined, baseNow: Timestamp): boolean =>
  !!updatedAt && baseNow.toMillis() - updatedAt.toMillis() <= LOCATION_FRESH_SECONDS * 1000;

export const resolveSeatTeamId = async (
  firestore: Transaction,
  gameRef: DocumentReference,
  uid: string,
): Promise<string> => {
  const seatSnap = await firestore.get(gameRef.collection("seats").where("uid", "==", uid).limit(1));
  return String(seatSnap.docs[0]?.data()?.teamId ?? "");
};

export const requireCurrentHiderInTx = async (
  tx: Transaction,
  gameRef: DocumentReference,
  game: GameDoc,
  uid: string,
): Promise<TurnState> => {
  const turn = game.currentTurn;
  if (game.status !== "LIVE" || !turn) {
    throw new HttpsError("failed-precondition", "La partida no está en juego activo.");
  }

  const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
  if (seatTeamId !== turn.hiderTeamId) {
    throw new HttpsError("permission-denied", "Solo el hider puede confirmar una salida de área.");
  }

  return turn;
};

export const getOutOfAreaConfirmationSeconds = (settings: GameSettings): number =>
  settings.outOfAreaConfirmationSeconds ?? OUT_OF_AREA_CONFIRMATION_SECONDS;

export const getOutOfAreaMaxGraceSeconds = (settings: GameSettings): number =>
  settings.outOfAreaMaxGraceSeconds ?? OUT_OF_AREA_MAX_GRACE_SECONDS;

export const getOutOfAreaSustainedSeconds = (settings: GameSettings): number =>
  settings.outOfAreaSustainedSeconds ?? OUT_OF_AREA_SUSTAINED_SECONDS;

export const getMaxGeofenceAccuracyM = (settings: GameSettings): number =>
  settings.maxGeofenceAccuracyM ?? MAX_GEOFENCE_ACCURACY_M;

export const createOutOfAreaState = (
  uid: string,
  settings: GameSettings,
  baseNow: Timestamp,
): OutOfAreaState => {
  const maxExpiresAt = Timestamp.fromMillis(baseNow.toMillis() + getOutOfAreaMaxGraceSeconds(settings) * 1000);
  return {
    status: "SUSPECTED",
    playerUid: uid,
    startedAt: baseNow,
    confirmationExpiresAt: Timestamp.fromMillis(
      baseNow.toMillis() + getOutOfAreaConfirmationSeconds(settings) * 1000,
    ),
    maxExpiresAt,
    lastConfirmedAt: null,
    alertedAt: null,
  };
};

export const alertOutOfAreaIfExpired = (turn: TurnState, txNow: Timestamp): boolean => {
  const outOfArea = turn.outOfArea;
  if (!outOfArea || outOfArea.status !== "SUSPECTED") {
    return false;
  }

  if (
    outOfArea.confirmationExpiresAt.toMillis() > txNow.toMillis() &&
    outOfArea.maxExpiresAt.toMillis() > txNow.toMillis()
  ) {
    return false;
  }

  turn.outOfArea = {
    ...outOfArea,
    status: "ALERTED",
    confirmationExpiresAt: txNow,
    alertedAt: txNow,
  };
  return true;
};

export const refreshEndgameStateInTx = async (
  tx: Transaction,
  gameRef: DocumentReference,
  game: GameDoc,
  txNow: Timestamp,
  locationOverrides: Record<string, DocumentData> = {},
): Promise<boolean> => {
  const turn = game.currentTurn;
  if (!turn || game.status !== "LIVE" || turn.phase !== "CHASE" || !turn.hidingZone) {
    return false;
  }

  const seatsSnap = await tx.get(gameRef.collection("seats"));
  const seekerUids = seatsSnap.docs
    .filter((seatDoc) => String(seatDoc.data().teamId ?? "") !== turn.hiderTeamId)
    .map((seatDoc) => String(seatDoc.data().uid ?? seatDoc.id))
    .filter((uid) => uid.length > 0);

  const nextEndgameActive = seekerUids.length > 0 && (await Promise.all(seekerUids.map(async (seekerUid) => {
    const location = locationOverrides[seekerUid] ?? (await tx.get(gameRef.collection("locations").doc(seekerUid))).data();
    const point = readLocationPoint(location);
    const updatedAt = location?.updatedAt as Timestamp | undefined;
    const isOnPublicTransport = Boolean(location?.isOnPublicTransport);
    return (
      !!point &&
      !isOnPublicTransport &&
      isFreshLocation(updatedAt, txNow) &&
      distanceMeters(point, turn.hidingZone!.center) <= turn.hidingZone!.radiusM
    );
  }))).every(Boolean);

  if (Boolean(turn.endgameActive) === nextEndgameActive) {
    return false;
  }

  game.currentTurn = {
    ...turn,
    endgameActive: nextEndgameActive,
    endgameAnchorPoint: null,
    endgameLastChangedAt: txNow,
    endgameQuestionsUnlocked: nextEndgameActive ? turn.endgameQuestionsUnlocked ?? false : false,
    foundVotes: nextEndgameActive ? turn.foundVotes : [],
  };
  return true;
};

export const resolveBaseStationAtEscapeEndInTx = async (
  tx: Transaction,
  gameRef: DocumentReference,
  game: GameDoc,
  txNow: Timestamp,
): Promise<TurnState | null> => {
  const turn = game.currentTurn;
  if (!turn || turn.phase !== "ESCAPE" || turn.hidingZone) {
    return turn ?? null;
  }

  const hiderSeatsSnap = await tx.get(
    gameRef.collection("seats").where("teamId", "==", turn.hiderTeamId),
  );
  const hiderUids = hiderSeatsSnap.docs
    .map((seatDoc) => String(seatDoc.data()?.uid ?? seatDoc.id))
    .filter((uid) => uid.length > 0);

  let latestLocation: DocumentData | undefined;
  for (const hiderUid of hiderUids) {
    const location = (await tx.get(gameRef.collection("privateLocations").doc(hiderUid))).data();
    const updatedAt = location?.updatedAt as Timestamp | undefined;
    if (!location || !isFreshLocation(updatedAt, txNow) || location.geofenceReliable === false) {
      continue;
    }
    if (!latestLocation || updatedAt!.toMillis() > (latestLocation.updatedAt as Timestamp).toMillis()) {
      latestLocation = location;
    }
  }

  const point = readLocationPoint(latestLocation);
  if (!point) {
    return {
      ...turn,
      baseStationCandidateIds: [],
      baseStationSelectionRequired: true,
    };
  }

  const radiusM = game.settings.zoneRadiusM;
  const zoneMatches = findPlayableStationZones(point, radiusM);
  if (zoneMatches.length === 1) {
    return {
      ...turn,
      hidingZone: buildHidingZoneForStation(zoneMatches[0].station.id, radiusM),
      baseStationCandidateIds: [],
      baseStationSelectionRequired: false,
    };
  }

  if (zoneMatches.length > 1) {
    return {
      ...turn,
      baseStationCandidateIds: zoneMatches.map((match) => match.station.id),
      baseStationSelectionRequired: true,
    };
  }

  const nearest = findNearestPlayableStation(point);
  if (!nearest) {
    return {
      ...turn,
      baseStationCandidateIds: [],
      baseStationSelectionRequired: true,
    };
  }

  return {
    ...turn,
    hidingZone: buildHidingZoneForStation(nearest.station.id, radiusM),
    baseStationCandidateIds: [nearest.station.id],
    baseStationSelectionRequired: false,
  };
};

export const drawFromDeck = (
  turn: TurnState,
  requestedCount: number,
): {drawnCardIds: string[]; drawPile: string[]; discardPile: string[]} => {
  let drawPile = [...(turn.drawPile ?? [])];
  let discardPile = [...(turn.discardPile ?? [])];
  const drawnCardIds: string[] = [];

  while (drawnCardIds.length < requestedCount) {
    if (drawPile.length === 0) {
      if (discardPile.length === 0) break;
      drawPile = shuffle(discardPile);
      discardPile = [];
    }

    const next = drawPile.shift();
    if (!next) break;
    drawnCardIds.push(next);
  }

  return {drawnCardIds, drawPile, discardPile};
};

export const allRunsCompleted = (game: GameDoc): boolean =>
  Object.values(game.standings).every((standing) => standing.runsCompleted >= game.settings.turnsPerTeam);

export const ukModeCanFinish = (game: GameDoc): boolean => {
  if (!game.settings.ukMode) return false;
  const entries = Object.entries(game.standings);
  if (entries.length < 2) return false;
  const sorted = [...entries].sort((a, b) => b[1].totalTimeSeconds - a[1].totalTimeSeconds);
  const [leaderId, leader] = sorted[0];
  const everyoneElseDone = sorted.slice(1).every(([, standing]) => standing.runsCompleted >= game.settings.turnsPerTeam);
  const nobodyCanPass = sorted.slice(1).every(([, standing]) => standing.totalTimeSeconds <= leader.totalTimeSeconds);
  return everyoneElseDone && nobodyCanPass && !!leaderId;
};

export const endTurnInTx = (game: GameDoc, txNow: Timestamp): GameDoc => {
  if (!game.currentTurn || game.status !== "LIVE") return game;

  const turn = game.currentTurn;
  const chaseStart = turn.chaseStartedAt?.toMillis() ?? txNow.toMillis();
  const chaseEnd = txNow.toMillis();
  const chaseDurationSeconds = Math.max(0, Math.floor((chaseEnd - chaseStart) / 1000));
  const timeBonusSeconds = getTimeBonusSeconds(turn.hiderHand);
  const timeoutPenaltySeconds = turn.expirations * 1800;
  const finalTime = Math.max(0, chaseDurationSeconds + timeBonusSeconds - timeoutPenaltySeconds);

  const currentStanding = game.standings[turn.hiderTeamId] ?? {
    totalTimeSeconds: 0,
    bestSingleRunSeconds: 0,
    runsCompleted: 0,
  };

  game.standings[turn.hiderTeamId] = {
    totalTimeSeconds: currentStanding.totalTimeSeconds + finalTime,
    bestSingleRunSeconds: Math.max(currentStanding.bestSingleRunSeconds, finalTime),
    runsCompleted: currentStanding.runsCompleted + 1,
  };

  const finishNow = allRunsCompleted(game) || ukModeCanFinish(game);
  if (finishNow) {
    game.status = "FINISHED";
    game.finishedAt = txNow;
    game.currentTurn = {
      ...turn,
      phase: "ENDED",
      phaseStartedAt: txNow,
      phaseEndsAt: txNow,
      pendingQuestionId: null,
      pendingQuestionEndsAt: null,
      categoryCooldowns: {},
      activeEffects: [],
      ...createInitialDeckState(),
      hidingZone: null,
      baseStationCandidateIds: [],
      baseStationSelectionRequired: false,
      endgameActive: false,
      endgameAnchorPoint: null,
      endgameLastChangedAt: null,
      lastEndgameVerificationAt: null,
      endgameQuestionsUnlocked: false,
      lastEndgameQuestionsConsultAt: null,
      outOfArea: null,
      foundVotes: [],
      captureAttempt: null,
    };
    game.winnerTeamIds = findWinnerIds(game);
    return game;
  }

  const nextHider = getNextHiderTeamId(game, turn.hiderTeamId);
  const runNumber = turn.runNumber + 1;
  const intermissionEndsAt = Timestamp.fromMillis(
    txNow.toMillis() + game.settings.intermissionSeconds * 1000,
  );
  game.currentTurn = {
    runNumber,
    hiderTeamId: nextHider,
    phase: "INTERMISSION",
    phaseStartedAt: txNow,
    phaseEndsAt: intermissionEndsAt,
    pendingQuestionId: null,
    pendingQuestionEndsAt: null,
    categoryCooldowns: {},
    activeEffects: [],
    ...createInitialDeckState(),
    hidingZone: null,
    baseStationCandidateIds: [],
    baseStationSelectionRequired: false,
    endgameActive: false,
    endgameAnchorPoint: null,
    endgameLastChangedAt: null,
    lastEndgameVerificationAt: null,
    endgameQuestionsUnlocked: false,
    lastEndgameQuestionsConsultAt: null,
    outOfArea: null,
    expirations: 0,
    foundVotes: [],
      captureAttempt: null,
  };
  return game;
};

