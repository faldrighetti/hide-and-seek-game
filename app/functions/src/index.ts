import {initializeApp} from "firebase-admin/app";
import {
  DocumentData,
  DocumentReference,
  Filter,
  Firestore,
  Timestamp,
  Transaction,
  getFirestore,
} from "firebase-admin/firestore";
import {setGlobalOptions} from "firebase-functions/v2";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";

initializeApp();
setGlobalOptions({maxInstances: 10});

const db = getFirestore();

const GAME_ID_LENGTH = 6;
const SEAT_OFFLINE_SECONDS = 90;
const HIDING_ZONE_RADIUS_M = 600;
const INTERVAL_PHASE_SECONDS = 300;
const ESCAPE_PHASE_SECONDS = 3600;
const CHASE_MAX_SECONDS = 18000;
const ENDGAME_DWELL_SECONDS = 60;
const LOCATION_FRESH_SECONDS = 60;
const ENDGAME_QUESTIONS_CONSULT_COOLDOWN_SECONDS = 60;

type GameMode = "INDIVIDUAL_1v1" | "INDIVIDUAL_3" | "TEAMS_2v2" | "TEAMS_2v2v2";
type WinCondition = "TOTAL_TIME" | "BEST_SINGLE_RUN";
type Phase = "INTERMISSION" | "ESCAPE" | "CHASE" | "ENDED";
type GameStatus = "LOBBY" | "LIVE" | "FINISHED";

interface GameSettings {
  turnsPerTeam: 1 | 2 | 3;
  winCondition: WinCondition;
  ukMode: boolean;
  intermissionSeconds: number;
  escapeSeconds: number;
  chaseMaxSeconds: number;
  zoneRadiusM: number;
  eligibleBufferM: number;
  endgameVerificationCooldownSeconds: number;
}

interface TeamStanding {
  totalTimeSeconds: number;
  bestSingleRunSeconds: number;
  runsCompleted: number;
}

interface ActiveEffect {
  id: string;
  curseId: string;
  createdByUid: string;
  createdAt: Timestamp;
  expiresAt?: Timestamp | null;
  blocksQuestions: boolean;
  blocksTransport: boolean;
}

interface LootOffer {
  questionId: string;
  categoryId: string;
  drawnCardIds: string[];
  takeLimit: number;
  createdAt: Timestamp;
}

interface LatLng {
  lat: number;
  lng: number;
}

interface HidingZone {
  stationId?: string;
  center: LatLng;
  radiusM: number;
}

interface TurnState {
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
  endgameActive?: boolean;
  endgameAnchorPoint?: LatLng | null;
  endgameLastChangedAt?: Timestamp | null;
  lastEndgameVerificationAt?: Timestamp | null;
  endgameQuestionsUnlocked?: boolean;
  lastEndgameQuestionsConsultAt?: Timestamp | null;
  expirations: number;
  foundVotes: string[];
}

interface GameDoc {
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
  teamOrder: string[];
  currentTurn?: TurnState;
  standings: Record<string, TeamStanding>;
  winnerTeamIds?: string[];
}

const DEFAULT_SETTINGS: GameSettings = {
  turnsPerTeam: 2,
  winCondition: "TOTAL_TIME",
  ukMode: false,
  intermissionSeconds: INTERVAL_PHASE_SECONDS,
  escapeSeconds: ESCAPE_PHASE_SECONDS,
  chaseMaxSeconds: CHASE_MAX_SECONDS,
  zoneRadiusM: HIDING_ZONE_RADIUS_M,
  eligibleBufferM: 0,
  endgameVerificationCooldownSeconds: ENDGAME_DWELL_SECONDS * 10,
};

const DECK_MAX_SIZE = 6;

const QUESTION_DRAW_RULES: Record<string, {draw: number; take: number}> = {
  matching: {draw: 3, take: 1},
  measuring: {draw: 3, take: 1},
  thermometer: {draw: 1, take: 1},
  radar: {draw: 1, take: 1},
  tentacles: {draw: 4, take: 2},
  endgame: {draw: 1, take: 1},
  photos: {draw: 1, take: 1},
};

const expandCopies = (cardId: string, copies: number): string[] =>
  Array.from({length: copies}, (_, index) => `${cardId}#${index + 1}`);

const BASE_HIDER_DECK = [
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
  ...expandCopies("curse_1", 1),
  ...expandCopies("curse_2", 1),
  ...expandCopies("curse_3", 1),
  ...expandCopies("curse_4", 1),
  ...expandCopies("curse_5", 1),
  ...expandCopies("curse_6", 1),
  ...expandCopies("curse_7", 1),
  ...expandCopies("curse_8", 1),
  ...expandCopies("curse_9", 1),
  ...expandCopies("curse_10", 1),
  ...expandCopies("curse_11", 1),
  ...expandCopies("curse_17", 1),
  ...expandCopies("curse_18", 1),
  ...expandCopies("curse_19", 1),
  ...expandCopies("curse_24", 1),
  ...expandCopies("curse_25", 1),
  ...expandCopies("curse_26", 1),
];

const timeBonusSecondsByCardPrefix: Record<string, number> = {
  time_bonus_red_3m: 180,
  time_bonus_orange_5m: 300,
  time_bonus_yellow_10m: 600,
  time_bonus_green_15m: 900,
  time_bonus_blue_20m: 1200,
};

const modeTeamIds = (mode: GameMode): string[] => {
  if (mode === "INDIVIDUAL_1v1" || mode === "TEAMS_2v2") return ["A", "B"];
  return ["A", "B", "C"];
};

const modeMaxSeats = (mode: GameMode): number => {
  if (mode === "INDIVIDUAL_1v1") return 2;
  if (mode === "INDIVIDUAL_3") return 3;
  if (mode === "TEAMS_2v2") return 4;
  return 6;
};

const validateLobbyTeams = (mode: GameMode, seats: DocumentData[]): void => {
  const teamIds = modeTeamIds(mode);
  const validTeams = new Set(teamIds);
  if (seats.length < teamIds.length) {
    throw new HttpsError("failed-precondition", "Faltan jugadores para cubrir todos los equipos.");
  }

  const countsByTeam = new Map(teamIds.map((teamId) => [teamId, 0]));
  for (const seat of seats) {
    const teamId = String(seat.teamId ?? "");
    if (!validTeams.has(teamId)) {
      throw new HttpsError("failed-precondition", "Todos los jugadores deben tener un equipo vÃ¡lido.");
    }
    countsByTeam.set(teamId, (countsByTeam.get(teamId) ?? 0) + 1);
  }

  const emptyTeamIds = teamIds.filter((teamId) => (countsByTeam.get(teamId) ?? 0) === 0);
  if (emptyTeamIds.length > 0) {
    throw new HttpsError("failed-precondition", `Hay equipos sin jugadores: ${emptyTeamIds.join(", ")}.`);
  }
};

const nowTs = (): Timestamp => Timestamp.now();

const randomCode = (): string => Math.random().toString(36).slice(2, 2 + GAME_ID_LENGTH).toUpperCase();

const shuffle = <T>(items: T[]): T[] => {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
};

const createInitialDeckState = (): Pick<TurnState, "hiderHand" | "drawPile" | "discardPile" | "lootOffer"> => ({
  hiderHand: [],
  drawPile: shuffle(BASE_HIDER_DECK),
  discardPile: [],
  lootOffer: null,
});

const pickInitialHider = (teamOrder: string[]): string => {
  const idx = Math.floor(Math.random() * teamOrder.length);
  return teamOrder[idx];
};

const requireAuthUid = (uid: string | undefined): string => {
  if (!uid) throw new HttpsError("unauthenticated", "Debes estar autenticado.");
  return uid;
};

const requireGameMembership = async (firestore: Firestore, gameId: string, uid: string): Promise<void> => {
  const seats = await firestore.collection("games").doc(gameId).collection("seats")
    .where("uid", "==", uid)
    .limit(1)
    .get();
  if (seats.empty) throw new HttpsError("permission-denied", "No perteneces a esta partida.");
};

const requireHost = async (firestore: Firestore, gameId: string, uid: string): Promise<void> => {
  const gameSnap = await firestore.collection("games").doc(gameId).get();
  if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
  const game = gameSnap.data() as GameDoc;
  if (game.hostUid !== uid) throw new HttpsError("permission-denied", "Solo el host puede ejecutar esta acción.");
};

const isFoundMajorityReached = (teamCount: number, votedTeams: string[]): boolean => {
  if (teamCount <= 2) return votedTeams.length >= 2;
  return votedTeams.length >= 2;
};

const getPhaseDurationSeconds = (settings: GameSettings, phase: Phase): number => {
  if (phase === "INTERMISSION") return settings.intermissionSeconds;
  if (phase === "ESCAPE") return settings.escapeSeconds;
  if (phase === "CHASE") return settings.chaseMaxSeconds;
  return 0;
};

const setNextPhase = (turn: TurnState, settings: GameSettings, phase: Phase, baseNow: Timestamp): TurnState => {
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
  };
};

const findWinnerIds = (game: GameDoc): string[] => {
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

const getNextHiderTeamId = (game: GameDoc, currentHider: string): string => {
  const order = game.teamOrder;
  const idx = order.indexOf(currentHider);
  if (idx < 0) return order[0];
  return order[(idx + 1) % order.length];
};

const cardBaseId = (cardId: string): string => cardId.split("#")[0];

const getTimeBonusSeconds = (hand: string[] = []): number =>
  hand.reduce((total, cardId) => total + (timeBonusSecondsByCardPrefix[cardBaseId(cardId)] ?? 0), 0);

const hasDuplicates = (items: string[]): boolean => new Set(items).size !== items.length;

const assertValidCoordinate = (lat: number, lng: number): void => {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new HttpsError("invalid-argument", "Coordenadas invÃ¡lidas.");
  }
};

const distanceMeters = (a: LatLng, b: LatLng): number => {
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

const readLocationPoint = (data: DocumentData | undefined): LatLng | null => {
  const lat = data?.lat;
  const lng = data?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {lat, lng};
};

const isFreshLocation = (updatedAt: Timestamp | undefined, baseNow: Timestamp): boolean =>
  !!updatedAt && baseNow.toMillis() - updatedAt.toMillis() <= LOCATION_FRESH_SECONDS * 1000;

const resolveSeatTeamId = async (
  firestore: Transaction,
  gameRef: DocumentReference,
  uid: string,
): Promise<string> => {
  const seatSnap = await firestore.get(gameRef.collection("seats").where("uid", "==", uid).limit(1));
  return String(seatSnap.docs[0]?.data()?.teamId ?? "");
};

const refreshEndgameStateInTx = async (
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

const drawFromDeck = (
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

const allRunsCompleted = (game: GameDoc): boolean =>
  Object.values(game.standings).every((standing) => standing.runsCompleted >= game.settings.turnsPerTeam);

const ukModeCanFinish = (game: GameDoc): boolean => {
  if (!game.settings.ukMode) return false;
  const entries = Object.entries(game.standings);
  if (entries.length < 2) return false;
  const sorted = [...entries].sort((a, b) => b[1].totalTimeSeconds - a[1].totalTimeSeconds);
  const [leaderId, leader] = sorted[0];
  const everyoneElseDone = sorted.slice(1).every(([, standing]) => standing.runsCompleted >= game.settings.turnsPerTeam);
  const nobodyCanPass = sorted.slice(1).every(([, standing]) => standing.totalTimeSeconds <= leader.totalTimeSeconds);
  return everyoneElseDone && nobodyCanPass && !!leaderId;
};

const endTurnInTx = (game: GameDoc, txNow: Timestamp): GameDoc => {
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
      endgameActive: false,
      endgameAnchorPoint: null,
      endgameLastChangedAt: null,
      lastEndgameVerificationAt: null,
      endgameQuestionsUnlocked: false,
      lastEndgameQuestionsConsultAt: null,
      foundVotes: [],
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
    endgameActive: false,
    endgameAnchorPoint: null,
    endgameLastChangedAt: null,
    lastEndgameVerificationAt: null,
    endgameQuestionsUnlocked: false,
    lastEndgameQuestionsConsultAt: null,
    expirations: 0,
    foundVotes: [],
  };
  return game;
};

export const createGame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const mode = (request.data?.mode ?? "INDIVIDUAL_3") as GameMode;
  const turnsPerTeam = (request.data?.turnsPerTeam ?? 2) as 1 | 2 | 3;
  const winCondition = (request.data?.winCondition ?? "TOTAL_TIME") as WinCondition;
  const ukMode = Boolean(request.data?.ukMode ?? false);
  const displayNameRaw = String(request.data?.displayName ?? "Host").trim();
  const displayName = displayNameRaw.length > 0 ? displayNameRaw : "Host";

  const settings: GameSettings = {
    ...DEFAULT_SETTINGS,
    turnsPerTeam,
    winCondition,
    ukMode,
  };

  const teamIds = modeTeamIds(mode);
  const standings: Record<string, TeamStanding> = {};
  for (const teamId of teamIds) {
    standings[teamId] = {totalTimeSeconds: 0, bestSingleRunSeconds: 0, runsCompleted: 0};
  }

  let gameId = randomCode();
  while ((await db.collection("games").doc(gameId).get()).exists) {
    gameId = randomCode();
  }

  const createdAt = nowTs();
  const payload: GameDoc = {
    gameName: String(request.data?.gameName ?? "Jet Lag Hide & Seek"),
    mode,
    status: "LOBBY",
    hostUid: uid,
    teamsLocked: false,
    createdAt,
    updatedAt: createdAt,
    settings,
    teamOrder: teamIds,
    standings,
  };

  const gameRef = db.collection("games").doc(gameId);
  await gameRef.set(payload);
  await gameRef.collection("seats").doc(uid).set({
    uid,
    displayName,
    displayNameLower: displayName.toLowerCase(),
    teamId: teamIds[0],
    isHost: true,
    online: true,
    lastSeenAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  });

  return {
    gameId,
    joinUrl: `${request.rawRequest.headers.origin ?? ""}/join/${gameId}`,
    mode,
    settings,
  };
});

export const joinGame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const displayNameRaw = String(request.data?.displayName ?? "").trim();
  if (!gameId || !displayNameRaw) {
    throw new HttpsError("invalid-argument", "gameId y displayName son obligatorios.");
  }

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    if (game.status !== "LOBBY") throw new HttpsError("failed-precondition", "La partida ya empezó.");

    const seatsRef = gameRef.collection("seats");
    const exactNameQuery = seatsRef.where("displayNameLower", "==", displayNameRaw.toLowerCase()).limit(1);
    const matchingName = await tx.get(exactNameQuery);

    const now = nowTs();

    if (!matchingName.empty) {
      const seatDoc = matchingName.docs[0];
      const seat = seatDoc.data();
      const lastSeen = (seat.lastSeenAt as Timestamp | undefined)?.toMillis() ?? 0;
      const stale = now.toMillis() - lastSeen > SEAT_OFFLINE_SECONDS * 1000;
      const isSameUid = seat.uid === uid;
      if (!isSameUid && seat.online && !stale) {
        throw new HttpsError("already-exists", "Ese nombre está en uso por un jugador online.");
      }
      tx.update(seatDoc.ref, {
        uid,
        displayName: displayNameRaw,
        displayNameLower: displayNameRaw.toLowerCase(),
        online: true,
        lastSeenAt: now,
        updatedAt: now,
      });
      tx.update(gameRef, {updatedAt: now});
      return;
    }

    const allSeats = await tx.get(seatsRef);
    if (allSeats.size >= modeMaxSeats(game.mode)) {
      throw new HttpsError("resource-exhausted", "La partida alcanzó el máximo de jugadores.");
    }

    const teamIds = modeTeamIds(game.mode);
    const teamId = teamIds[allSeats.size % teamIds.length];
    tx.set(seatsRef.doc(uid), {
      uid,
      displayName: displayNameRaw,
      displayNameLower: displayNameRaw.toLowerCase(),
      teamId,
      isHost: false,
      online: true,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    });
    tx.update(gameRef, {updatedAt: now});
  });

  return {ok: true};
});

export const setTeams = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const assignments = request.data?.assignments as Record<string, string>;
  if (!gameId || !assignments || typeof assignments !== "object") {
    throw new HttpsError("invalid-argument", "gameId y assignments son obligatorios.");
  }
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    if (game.teamsLocked) throw new HttpsError("failed-precondition", "Los equipos están bloqueados.");

    const validTeams = new Set(modeTeamIds(game.mode));
    const seatsSnap = await tx.get(gameRef.collection("seats"));
    for (const seatDoc of seatsSnap.docs) {
      const teamId = assignments[seatDoc.id];
      if (!teamId) continue;
      if (!validTeams.has(teamId)) {
        throw new HttpsError("invalid-argument", `Team inválido para seat ${seatDoc.id}.`);
      }
      tx.update(seatDoc.ref, {teamId, updatedAt: nowTs()});
    }
    tx.update(gameRef, {updatedAt: nowTs()});
  });

  return {ok: true};
});

export const randomizeTeams = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  if (!gameId) {
    throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  }
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    if (game.teamsLocked) throw new HttpsError("failed-precondition", "Los equipos estÃ¡n bloqueados.");

    const teamIds = modeTeamIds(game.mode);
    const seatsSnap = await tx.get(gameRef.collection("seats"));
    const shuffledSeats = shuffle(seatsSnap.docs);

    shuffledSeats.forEach((seatDoc, index) => {
      tx.update(seatDoc.ref, {
        teamId: teamIds[index % teamIds.length],
        updatedAt: nowTs(),
      });
    });
    tx.update(gameRef, {updatedAt: nowTs()});
  });

  return {ok: true};
});

export const lockTeams = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const lock = Boolean(request.data?.lock);
  await requireHost(db, gameId, uid);

  await db.collection("games").doc(gameId).update({
    teamsLocked: lock,
    updatedAt: nowTs(),
  });
  return {ok: true, teamsLocked: lock};
});

export const startGame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    if (game.status !== "LOBBY") throw new HttpsError("failed-precondition", "La partida ya comenzó.");

    const seatsSnap = await tx.get(gameRef.collection("seats"));
    validateLobbyTeams(game.mode, seatsSnap.docs.map((seatDoc) => seatDoc.data()));

    const now = nowTs();
    const hiderTeamId = pickInitialHider(game.teamOrder);
    const currentTurn: TurnState = {
      runNumber: 1,
      hiderTeamId,
      phase: "INTERMISSION",
      phaseStartedAt: now,
      phaseEndsAt: Timestamp.fromMillis(now.toMillis() + game.settings.intermissionSeconds * 1000),
      pendingQuestionId: null,
      pendingQuestionEndsAt: null,
      categoryCooldowns: {},
      activeEffects: [],
      ...createInitialDeckState(),
      hidingZone: null,
      endgameActive: false,
      endgameAnchorPoint: null,
      endgameLastChangedAt: null,
      lastEndgameVerificationAt: null,
      endgameQuestionsUnlocked: false,
      lastEndgameQuestionsConsultAt: null,
      expirations: 0,
      foundVotes: [],
    };

    tx.update(gameRef, {
      status: "LIVE",
      teamsLocked: true,
      startedAt: now,
      currentTurn,
      updatedAt: now,
    });
  });

  return {ok: true};
});

export const setTurnHidingZone = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const stationId = String(request.data?.stationId ?? "").trim();
  const lat = Number(request.data?.lat);
  const lng = Number(request.data?.lng);
  const radiusM = Number(request.data?.radiusM ?? HIDING_ZONE_RADIUS_M);

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  assertValidCoordinate(lat, lng);
  if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > 5000) {
    throw new HttpsError("invalid-argument", "radiusM invÃ¡lido.");
  }
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn) {
      throw new HttpsError("failed-precondition", "La partida no estÃ¡ en juego activo.");
    }

    const now = nowTs();
    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        hidingZone: {
          ...(stationId ? {stationId} : {}),
          center: {lat, lng},
          radiusM,
        },
        endgameActive: false,
        endgameAnchorPoint: null,
        endgameLastChangedAt: null,
        lastEndgameVerificationAt: null,
        endgameQuestionsUnlocked: false,
        lastEndgameQuestionsConsultAt: null,
        foundVotes: [],
      },
      updatedAt: now,
    });
  });

  return {ok: true};
});

export const publishSeekerLocation = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const lat = Number(request.data?.lat);
  const lng = Number(request.data?.lng);
  const isOnPublicTransport = Boolean(request.data?.isOnPublicTransport);

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  assertValidCoordinate(lat, lng);
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn) {
      throw new HttpsError("failed-precondition", "La partida no estÃ¡ en juego activo.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (!seatTeamId) throw new HttpsError("permission-denied", "No tenÃ©s seat en esta partida.");
    if (seatTeamId === turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "El hider no publica ubicaciÃ³n exacta.");
    }

    const now = nowTs();
    const locationPayload = {
      uid,
      teamId: seatTeamId,
      lat,
      lng,
      isOnPublicTransport,
      updatedAt: now,
    };

    const endgameChanged = await refreshEndgameStateInTx(tx, gameRef, game, now, {
      [uid]: locationPayload,
    });
    tx.set(gameRef.collection("locations").doc(uid), locationPayload, {merge: true});
    if (endgameChanged) {
      tx.update(gameRef, {
        currentTurn: game.currentTurn,
        updatedAt: now,
      });
    }
  });

  return {ok: true};
});

export const verifyEndgame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn || turn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "Endgame solo se verifica en CHASE.");
    }
    if (!turn.hidingZone) {
      throw new HttpsError("failed-precondition", "La zona del hider todavÃ­a no estÃ¡ fijada.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (!seatTeamId || seatTeamId === turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo seekers pueden verificar endgame.");
    }

    const now = nowTs();
    const lastVerificationMillis = turn.lastEndgameVerificationAt?.toMillis() ?? 0;
    if (lastVerificationMillis > 0 &&
      now.toMillis() - lastVerificationMillis < game.settings.endgameVerificationCooldownSeconds * 1000) {
      throw new HttpsError("resource-exhausted", "ENDGAME_VERIFICATION_COOLDOWN");
    }

    await refreshEndgameStateInTx(tx, gameRef, game, now);
    tx.update(gameRef, {
      currentTurn: {
        ...game.currentTurn!,
        lastEndgameVerificationAt: now,
      },
      updatedAt: now,
    });
  });

  return {ok: true};
});

export const consultEndgameQuestions = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  let unlocked = false;
  let cooldownActive = false;
  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn || turn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "Las preguntas de endgame solo se consultan en CHASE.");
    }
    if (!turn.hidingZone) {
      throw new HttpsError("failed-precondition", "La zona del hider todavÃƒÂ­a no estÃƒÂ¡ fijada.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (!seatTeamId || seatTeamId === turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo seekers pueden consultar preguntas de endgame.");
    }

    const now = nowTs();
    await refreshEndgameStateInTx(tx, gameRef, game, now);
    const refreshedTurn = game.currentTurn!;
    unlocked = Boolean(refreshedTurn.endgameActive);

    if (!unlocked) {
      const lastConsultMillis = refreshedTurn.lastEndgameQuestionsConsultAt?.toMillis() ?? 0;
      cooldownActive = lastConsultMillis > 0 &&
        now.toMillis() - lastConsultMillis < ENDGAME_QUESTIONS_CONSULT_COOLDOWN_SECONDS * 1000;
    }

    tx.update(gameRef, {
      currentTurn: {
        ...refreshedTurn,
        endgameQuestionsUnlocked: unlocked ? true : refreshedTurn.endgameQuestionsUnlocked ?? false,
        lastEndgameQuestionsConsultAt: cooldownActive ? refreshedTurn.lastEndgameQuestionsConsultAt ?? null : now,
      },
      updatedAt: now,
    });
  });

  return {ok: true, unlocked, cooldownActive};
});

export const sendQuestion = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const prompt = String(request.data?.prompt ?? "").trim();
  const categoryId = String(request.data?.categoryId ?? "").trim();
  const isPhoto = Boolean(request.data?.isPhoto);

  if (!gameId || !prompt || !categoryId) {
    throw new HttpsError("invalid-argument", "gameId, prompt y categoryId son obligatorios.");
  }

  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    if (game.status !== "LIVE" || !game.currentTurn) {
      throw new HttpsError("failed-precondition", "La partida no está en juego activo.");
    }
    if (game.currentTurn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "Solo se puede preguntar en CHASE.");
    }
    if (game.currentTurn.pendingQuestionId) {
      throw new HttpsError("failed-precondition", "Ya existe una pregunta pendiente.");
    }
    if (game.currentTurn.lootOffer) {
      throw new HttpsError("failed-precondition", "Hay loot pendiente de resolver.");
    }
    if (categoryId === "endgame" && (!game.currentTurn.endgameActive || !game.currentTurn.endgameQuestionsUnlocked)) {
      throw new HttpsError("failed-precondition", "ENDGAME_QUESTIONS_LOCKED");
    }

    const now = nowTs();
    const activeEffects = (game.currentTurn.activeEffects ?? []).filter((effect) =>
      !effect.expiresAt || effect.expiresAt.toMillis() > now.toMillis(),
    );
    if (activeEffects.some((effect) => effect.blocksQuestions)) {
      throw new HttpsError("failed-precondition", "CURSE_QUESTIONS_BLOCKED");
    }

    const cooldownUntil = game.currentTurn.categoryCooldowns?.[categoryId];
    if (cooldownUntil && cooldownUntil.toMillis() > now.toMillis()) {
      throw new HttpsError("failed-precondition", "CATEGORY_COOLDOWN_ACTIVE");
    }

    const timeoutSeconds = isPhoto ? 600 : 300;
    const questionRef = gameRef.collection("questions").doc();
    tx.set(questionRef, {
      askedByUid: uid,
      prompt,
      isPhoto,
      categoryId,
      status: "PENDING",
      createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + timeoutSeconds * 1000),
    });

    tx.update(gameRef, {
      currentTurn: {
        ...game.currentTurn,
        pendingQuestionId: questionRef.id,
        pendingQuestionEndsAt: Timestamp.fromMillis(now.toMillis() + timeoutSeconds * 1000),
      },
      updatedAt: now,
    });
  });

  return {ok: true};
});

export const resolveQuestion = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const resolution = String(request.data?.resolution ?? "ANSWER").trim().toUpperCase();
  const validResolutions = new Set(["ANSWER", "VETO", "RANDOMIZE"]);

  if (!validResolutions.has(resolution)) {
    throw new HttpsError("invalid-argument", "resolution inválida.");
  }

  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (!turn?.pendingQuestionId) {
      throw new HttpsError("failed-precondition", "No hay pregunta pendiente.");
    }
    const seatSnap = await tx.get(
      gameRef.collection("seats").where("uid", "==", uid).limit(1),
    );
    const seatTeamId = String(seatSnap.docs[0]?.data()?.teamId ?? "");
    if (seatTeamId !== turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo el hider puede responder.");
    }

    const now = nowTs();
    const qRef = gameRef.collection("questions").doc(turn.pendingQuestionId);
    const qSnap = await tx.get(qRef);
    if (!qSnap.exists) throw new HttpsError("not-found", "Pregunta no encontrada.");
    const categoryId = String(qSnap.data()?.categoryId ?? "").trim();
    const drawRule = QUESTION_DRAW_RULES[categoryId] ?? {draw: 1, take: 1};
    const deckDraw = drawFromDeck(turn, drawRule.draw);
    
    tx.update(qRef, {
      status: "RESOLVED",
      resolution,
      resolvedByUid: uid,
      resolvedAt: now,
    });

    const categoryCooldowns = {...(turn.categoryCooldowns ?? {})};
    if (categoryId) {
      categoryCooldowns[categoryId] = Timestamp.fromMillis(now.toMillis() + 15 * 60 * 1000);
    }

    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        pendingQuestionId: null,
        pendingQuestionEndsAt: null,
        categoryCooldowns,
        drawPile: deckDraw.drawPile,
        discardPile: deckDraw.discardPile,
        lootOffer: {
          questionId: qRef.id,
          categoryId,
          drawnCardIds: deckDraw.drawnCardIds,
          takeLimit: drawRule.take,
          createdAt: now,
        },
      },
      updatedAt: now,
    });
  });

  return {ok: true};
});

export const selectLoot = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const selectedCardIds: string[] = Array.isArray(request.data?.selectedCardIds) ?
    request.data.selectedCardIds.map((cardId: unknown) => String(cardId)) :
    [];
  const discardFromHandIds: string[] = Array.isArray(request.data?.discardFromHandIds) ?
    request.data.discardFromHandIds.map((cardId: unknown) => String(cardId)) :
    [];

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  if (hasDuplicates(selectedCardIds) || hasDuplicates(discardFromHandIds)) {
    throw new HttpsError("invalid-argument", "No se permiten IDs de carta duplicados.");
  }
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn?.lootOffer) {
      throw new HttpsError("failed-precondition", "No hay loot pendiente.");
    }
    const seatSnap = await tx.get(
      gameRef.collection("seats").where("uid", "==", uid).limit(1),
    );
    const seatTeamId = String(seatSnap.docs[0]?.data()?.teamId ?? "");
    if (seatTeamId !== turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo el hider puede elegir loot.");
    }

    const drawn = turn.lootOffer.drawnCardIds;
    if (selectedCardIds.length > turn.lootOffer.takeLimit) {
      throw new HttpsError("invalid-argument", "Seleccionaste mÃ¡s cartas que el lÃ­mite.");
    }
    if (!selectedCardIds.every((cardId) => drawn.includes(cardId))) {
      throw new HttpsError("invalid-argument", "Solo podÃ©s elegir cartas del loot actual.");
    }

    const hand = [...(turn.hiderHand ?? [])];
    const remainingHand = [...hand];
    for (const cardId of discardFromHandIds) {
      const index = remainingHand.indexOf(cardId);
      if (index < 0) throw new HttpsError("invalid-argument", "No podÃ©s descartar una carta que no estÃ¡ en la mano.");
      remainingHand.splice(index, 1);
    }

    const selected = [...selectedCardIds];
    const nextHand = [...remainingHand, ...selected];
    if (nextHand.length > DECK_MAX_SIZE) {
      throw new HttpsError("failed-precondition", "La mano supera el mÃ¡ximo de 6 cartas.");
    }

    const selectedSet = new Set(selected);
    const unselectedDrawn = drawn.filter((cardId) => !selectedSet.has(cardId));
    const nextDiscardPile = [
      ...(turn.discardPile ?? []),
      ...unselectedDrawn,
      ...discardFromHandIds,
    ];

    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        hiderHand: nextHand,
        discardPile: nextDiscardPile,
        lootOffer: null,
      },
      updatedAt: nowTs(),
    });
  });

  return {ok: true};
});

export const playCurse = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const cardId = String(request.data?.cardId ?? request.data?.curseId ?? "").trim();
  const curseId = cardId.split("#")[0];
  const blocksQuestions = Boolean(request.data?.blocksQuestions);
  const blocksTransport = Boolean(request.data?.blocksTransport);
  const expiresAtMillisRaw = request.data?.expiresAtMillis;
  const expiresAtMillis = typeof expiresAtMillisRaw === "number" ? expiresAtMillisRaw : null;

  if (!gameId || !cardId || !curseId.startsWith("curse_")) {
    throw new HttpsError("invalid-argument", "gameId y cardId de maldiciÃ³n son obligatorios.");
  }

  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn) {
      throw new HttpsError("failed-precondition", "La partida no está en juego activo.");
    }

    const seatSnap = await tx.get(
      gameRef.collection("seats").where("uid", "==", uid).limit(1),
    );
    const seatTeamId = String(seatSnap.docs[0]?.data()?.teamId ?? "");
    if (seatTeamId !== turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo el hider puede activar maldiciones.");
    }

    const hand = [...(turn.hiderHand ?? [])];
    const cardIndex = hand.indexOf(cardId);
    if (cardIndex < 0) {
      throw new HttpsError("invalid-argument", "La carta no esta en la mano del hider.");
    }

    const now = nowTs();
    const activeEffects = (turn.activeEffects ?? []).filter((effect) =>
      !effect.expiresAt || effect.expiresAt.toMillis() > now.toMillis(),
    );

    if (activeEffects.some((effect) => effect.blocksQuestions || effect.blocksTransport)) {
      throw new HttpsError("failed-precondition", "CURSE_BLOCKING_EFFECT_ACTIVE");
    }

    const newEffect: ActiveEffect = {
      id: gameRef.collection("effects").doc().id,
      curseId,
      createdByUid: uid,
      createdAt: now,
      expiresAt: expiresAtMillis ? Timestamp.fromMillis(expiresAtMillis) : null,
      blocksQuestions,
      blocksTransport,
    };

    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        hiderHand: hand.filter((_, index) => index !== cardIndex),
        discardPile: [...(turn.discardPile ?? []), cardId],
        activeEffects: [...activeEffects, newEffect],
      },
      updatedAt: now,
    });
  });

  return {ok: true};
});

export const completeCurseEffect = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const effectId = String(request.data?.effectId ?? "").trim();

  if (!gameId || !effectId) {
    throw new HttpsError("invalid-argument", "gameId y effectId son obligatorios.");
  }

  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn) {
      throw new HttpsError("failed-precondition", "La partida no estÃ¡ en juego activo.");
    }

    const seatSnap = await tx.get(
      gameRef.collection("seats").where("uid", "==", uid).limit(1),
    );
    const seatTeamId = String(seatSnap.docs[0]?.data()?.teamId ?? "");
    if (!seatTeamId || seatTeamId === turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo los seekers pueden completar maldiciones.");
    }

    const now = nowTs();
    const activeEffects = (turn.activeEffects ?? []).filter((effect) =>
      !effect.expiresAt || effect.expiresAt.toMillis() > now.toMillis(),
    );
    if (!activeEffects.some((effect) => effect.id === effectId)) {
      throw new HttpsError("not-found", "Efecto activo no encontrado.");
    }

    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        activeEffects: activeEffects.filter((effect) => effect.id !== effectId),
      },
      updatedAt: now,
    });
  });

  return {ok: true};
});

export const castFoundVote = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const voterTeamId = String(request.data?.teamId ?? "").trim().toUpperCase();
  if (!gameId || !voterTeamId) {
    throw new HttpsError("invalid-argument", "gameId y teamId son obligatorios.");
  }

  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (!turn || game.status !== "LIVE") throw new HttpsError("failed-precondition", "Juego no activo.");
    if (turn.phase !== "CHASE") throw new HttpsError("failed-precondition", "Solo se vota en CHASE.");

    const voted = turn.foundVotes.includes(voterTeamId) ? turn.foundVotes : [...turn.foundVotes, voterTeamId];
    const shouldEnd = isFoundMajorityReached(game.teamOrder.length, voted);

    game.currentTurn = {
      ...turn,
      foundVotes: voted,
    };

    if (shouldEnd) {
      endTurnInTx(game, nowTs());
    }

    tx.update(gameRef, {
      currentTurn: game.currentTurn,
      standings: game.standings,
      status: game.status,
      finishedAt: game.finishedAt ?? null,
      winnerTeamIds: game.winnerTeamIds ?? null,
      updatedAt: nowTs(),
    });
  });

  return {ok: true};
});

export const endTurn = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    if (game.status !== "LIVE") throw new HttpsError("failed-precondition", "Partida no activa.");
    endTurnInTx(game, nowTs());

    tx.update(gameRef, {
      currentTurn: game.currentTurn,
      standings: game.standings,
      status: game.status,
      finishedAt: game.finishedAt ?? null,
      winnerTeamIds: game.winnerTeamIds ?? null,
      updatedAt: nowTs(),
    });
  });

  return {ok: true};
});

export const nextTurn = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    if (!game.currentTurn || game.status !== "LIVE") {
      throw new HttpsError("failed-precondition", "Partida no activa.");
    }
    if (game.currentTurn.phase !== "ENDED") {
      throw new HttpsError("failed-precondition", "Solo aplica cuando el turno actual está ENDED.");
    }

    const now = nowTs();
    const nextHider = getNextHiderTeamId(game, game.currentTurn.hiderTeamId);
    game.currentTurn = {
      runNumber: game.currentTurn.runNumber + 1,
      hiderTeamId: nextHider,
      phase: "INTERMISSION",
      phaseStartedAt: now,
      phaseEndsAt: Timestamp.fromMillis(now.toMillis() + game.settings.intermissionSeconds * 1000),
      pendingQuestionId: null,
      pendingQuestionEndsAt: null,
      categoryCooldowns: {},
      activeEffects: [],
      ...createInitialDeckState(),
      hidingZone: null,
      endgameActive: false,
      endgameAnchorPoint: null,
      endgameLastChangedAt: null,
      lastEndgameVerificationAt: null,
      endgameQuestionsUnlocked: false,
      lastEndgameQuestionsConsultAt: null,
      expirations: 0,
      foundVotes: [],
    };

    tx.update(gameRef, {
      currentTurn: game.currentTurn,
      updatedAt: now,
    });
  });

  return {ok: true};
});

export const scoring = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  await requireGameMembership(db, gameId, uid);

  const snap = await db.collection("games").doc(gameId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
  const game = snap.data() as GameDoc;

  return {
    standings: game.standings,
    winCondition: game.settings.winCondition,
    winnerTeamIds: game.winnerTeamIds ?? [],
  };
});

export const finishGame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    game.status = "FINISHED";
    game.finishedAt = nowTs();
    game.winnerTeamIds = findWinnerIds(game);
    if (game.currentTurn) {
      game.currentTurn.phase = "ENDED";
      game.currentTurn.phaseStartedAt = game.finishedAt;
      game.currentTurn.phaseEndsAt = game.finishedAt;
    }

    tx.update(gameRef, {
      status: game.status,
      finishedAt: game.finishedAt,
      winnerTeamIds: game.winnerTeamIds,
      currentTurn: game.currentTurn ?? null,
      updatedAt: nowTs(),
    });
  });

  return {ok: true};
});

export const onLocationWritten = onDocumentWritten("games/{gameId}/locations/{uid}", async (event) => {
  const gameId = String(event.params.gameId ?? "").trim().toUpperCase();
  if (!gameId) return;

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) return;
    const game = gameSnap.data() as GameDoc;
    const txNow = nowTs();
    const changed = await refreshEndgameStateInTx(tx, gameRef, game, txNow);
    if (!changed) return;

    tx.update(gameRef, {
      currentTurn: game.currentTurn,
      updatedAt: txNow,
    });
  });
});

export const scheduledTick = onSchedule("every 1 minutes", async () => {
  const now = nowTs();
  const gamesSnap = await db.collection("games")
    .where("status", "==", "LIVE")
    .where(Filter.or(
      Filter.where("currentTurn.phaseEndsAt", "<=", now),
      Filter.where("currentTurn.pendingQuestionEndsAt", "<=", now),
      Filter.where("currentTurn.endgameActive", "==", true),
    ))
    .get();

  const tasks = gamesSnap.docs.map(async (docSnap) => {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(docSnap.ref);
      if (!fresh.exists) return;
      const game = fresh.data() as GameDoc;
      let turn = game.currentTurn;
      if (!turn || game.status !== "LIVE") return;

      const txNow = nowTs();
      let changed = false;

      if (turn.endgameActive) {
        changed = (await refreshEndgameStateInTx(tx, docSnap.ref, game, txNow)) || changed;
        turn = game.currentTurn;
        if (!turn) return;
      }

      if (turn.pendingQuestionId && turn.pendingQuestionEndsAt && turn.pendingQuestionEndsAt.toMillis() <= txNow.toMillis()) {
        const qRef = docSnap.ref.collection("questions").doc(turn.pendingQuestionId);
        tx.set(qRef, {
          status: "EXPIRED",
          expiredAt: txNow,
        }, {merge: true});
        turn.pendingQuestionId = null;
        turn.pendingQuestionEndsAt = null;
        turn.expirations += 1;
        changed = true;
      }

      if (turn.phaseEndsAt.toMillis() <= txNow.toMillis()) {
        if (turn.phase === "INTERMISSION") {
          game.currentTurn = setNextPhase(turn, game.settings, "ESCAPE", txNow);
        } else if (turn.phase === "ESCAPE") {
          game.currentTurn = setNextPhase(turn, game.settings, "CHASE", txNow);
        } else if (turn.phase === "CHASE") {
          endTurnInTx(game, txNow);
        }
        changed = true;
      }

      if (!changed) return;

      tx.update(docSnap.ref, {
        currentTurn: game.currentTurn,
        standings: game.standings,
        status: game.status,
        finishedAt: game.finishedAt ?? null,
        winnerTeamIds: game.winnerTeamIds ?? null,
        updatedAt: txNow,
      });
    });
  });

  await Promise.all(tasks);
});
