import {initializeApp} from "firebase-admin/app";
import {
  Filter,
  Firestore,
  Timestamp,
  getFirestore,
} from "firebase-admin/firestore";
import {setGlobalOptions} from "firebase-functions/v2";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";

initializeApp();
setGlobalOptions({maxInstances: 10});

const db = getFirestore();

const GAME_ID_LENGTH = 6;
const SEAT_OFFLINE_SECONDS = 90;

type GameMode = "INDIVIDUAL_3" | "TEAMS_2v2" | "TEAMS_2v2v2";
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
  endgameRequestCooldownSeconds: number;
}

interface TeamStanding {
  totalTimeSeconds: number;
  bestSingleRunSeconds: number;
  runsCompleted: number;
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
  intermissionSeconds: 120,
  escapeSeconds: 3600,
  chaseMaxSeconds: 21600,
  zoneRadiusM: 500,
  eligibleBufferM: 100,
  endgameRequestCooldownSeconds: 600,
};

const modeTeamIds = (mode: GameMode): string[] => {
  if (mode === "TEAMS_2v2") return ["A", "B"];
  return ["A", "B", "C"];
};

const modeMaxSeats = (mode: GameMode): number => {
  if (mode === "INDIVIDUAL_3") return 3;
  if (mode === "TEAMS_2v2") return 4;
  return 6;
};

const nowTs = (): Timestamp => Timestamp.now();

const randomCode = (): string => Math.random().toString(36).slice(2, 2 + GAME_ID_LENGTH).toUpperCase();

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
  const timeoutPenaltySeconds = turn.expirations * 1800;
  const finalTime = Math.max(0, chaseDurationSeconds - timeoutPenaltySeconds);

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

export const sendQuestion = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const prompt = String(request.data?.prompt ?? "").trim();
  const isPhoto = Boolean(request.data?.isPhoto);

  if (!gameId || !prompt) {
    throw new HttpsError("invalid-argument", "gameId y prompt son obligatorios.");
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

    const now = nowTs();
    const timeoutSeconds = isPhoto ? 600 : 300;
    const questionRef = gameRef.collection("questions").doc();
    tx.set(questionRef, {
      askedByUid: uid,
      prompt,
      isPhoto,
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
  const resolution = String(request.data?.resolution ?? "ANSWER").trim();

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

    const qRef = gameRef.collection("questions").doc(turn.pendingQuestionId);
    tx.update(qRef, {
      status: "RESOLVED",
      resolution,
      resolvedByUid: uid,
      resolvedAt: nowTs(),
    });
    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        pendingQuestionId: null,
        pendingQuestionEndsAt: null,
      },
      updatedAt: nowTs(),
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

export const scheduledTick = onSchedule("every 1 minutes", async () => {
  const now = nowTs();
  const gamesSnap = await db.collection("games")
    .where("status", "==", "LIVE")
    .where(Filter.or(
      Filter.where("currentTurn.phaseEndsAt", "<=", now),
      Filter.where("currentTurn.pendingQuestionEndsAt", "<=", now),
    ))
    .get();

  const tasks = gamesSnap.docs.map(async (docSnap) => {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(docSnap.ref);
      if (!fresh.exists) return;
      const game = fresh.data() as GameDoc;
      const turn = game.currentTurn;
      if (!turn || game.status !== "LIVE") return;

      const txNow = nowTs();
      let changed = false;

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