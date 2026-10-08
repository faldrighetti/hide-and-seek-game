import {
  DocumentReference,
  Timestamp,
  Transaction,
} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
export {deliverGameNotification, registerPushToken, unregisterPushToken} from "./push-notifications";
import {db} from "./firebase";
import {STADIUMS} from "./venue-data";
import {
  ActiveEffect,
  CaptureAttempt,
  DECK_MAX_SIZE,
  DEFAULT_SETTINGS,
  ENDGAME_QUESTIONS_CONSULT_COOLDOWN_SECONDS,
  GameDoc,
  GameMode,
  GameSettings,
  LOOT_SELECTION_SECONDS,
  MOVE_DURATION_SECONDS,

  QUESTION_DRAW_RULES,
  SEAT_OFFLINE_SECONDS,
  TeamStanding,
  TurnState,
  WinCondition,

  appendGameEventInTx,
  assertValidCoordinate,
  assertGlobalPlayEnabled,
  assertRateLimitInTx,
  assertUserRateLimit,
  assertOperationalPlayAllowed,

  buildHidingZoneForStation,
  createInitialDeckState,

  drawFromDeck,
  distanceMeters,
  endTurnInTx,

  getNextHiderTeamId,

  hasDuplicates,
  isFoundMajorityReached,

  isOperationallyStopped,
  modeMaxSeats,
  modeTeamIds,
  nowTs,
  pickInitialHider,
  randomCode,

  requireAuthUid,
  requireGameMembership,
  requireHost,
  requiredSeekerCaptureConfirmations,
  resolveBaseStationAtEscapeEndInTx,
  resolveSeatTeamId,
  setNextPhase,
  shuffle,
  validateLobbyTeams,
} from "./game-core";

export const createGame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "create_game", 30);
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
    operational: {
      mode: "NORMAL",
      reason: null,
      changedByUid: uid,
      changedAt: createdAt,
    },
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
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "join_game", 10);
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
    const seatsRef = gameRef.collection("seats");
    const existingSeat = await tx.get(seatsRef.doc(uid));
    const now = nowTs();
    if (existingSeat.exists) {
      tx.update(existingSeat.ref, {online: true, lastSeenAt: now, updatedAt: now});
      tx.update(gameRef, {updatedAt: now});
      return;
    }

    if (game.status !== "LOBBY") throw new HttpsError("failed-precondition", "La partida ya empezó.");

    const exactNameQuery = seatsRef.where("displayNameLower", "==", displayNameRaw.toLowerCase()).limit(1);
    const matchingName = await tx.get(exactNameQuery);

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
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "set_teams", 10);
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
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "randomize_teams", 10);
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
    if (game.teamsLocked) throw new HttpsError("failed-precondition", "Los equipos están bloqueados.");

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
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "lock_teams", 10);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const lock = Boolean(request.data?.lock);
  await requireHost(db, gameId, uid);

  await db.collection("games").doc(gameId).update({
    teamsLocked: lock,
    updatedAt: nowTs(),
  });
  return {ok: true, teamsLocked: lock};
});

export const setUkMode = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "set_uk_mode", 10);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const ukMode = Boolean(request.data?.ukMode);
  if (!gameId) {
    throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  }
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    if (game.status !== "LOBBY") {
      throw new HttpsError("failed-precondition", "ukMode solo se puede cambiar en el lobby.");
    }
    if (modeTeamIds(game.mode).length <= 2 && ukMode) {
      throw new HttpsError("failed-precondition", "ukMode solo aplica con más de 2 equipos.");
    }

    tx.update(gameRef, {
      "settings.ukMode": ukMode,
      updatedAt: nowTs(),
    });
  });

  return {ok: true, ukMode};
});
export const startGame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "start_game", 10);
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

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
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
      askedQuestionPrompts: [],
      askedQuestionKeys: [],
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
      expirations: 0,
      timeoutPenaltyAppliedSeconds: 0,
      foundVotes: [],
      captureAttempt: null,
    };

    tx.update(gameRef, {
      status: "LIVE",
      teamsLocked: true,
      startedAt: now,
      currentTurn,
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, {...game, currentTurn}, {
      type: "GAME_STARTED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId || null,
      payload: {
        hiderTeamId,
      },
    });
  });

  return {ok: true};
});

export const confirmBaseStation = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "confirm_base_station", 10);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const stationId = String(request.data?.stationId ?? "").trim();

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  if (!stationId) {
    throw new HttpsError("invalid-argument", "stationId es obligatorio.");
  }
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn) {
      throw new HttpsError("failed-precondition", "La partida no esta en juego activo.");
    }
    const activeMove = turn.moveState?.status === "ACTIVE" ? turn.moveState : null;
    if (turn.phase !== "ESCAPE" && !(turn.phase === "CHASE" && turn.baseStationSelectionRequired) && !activeMove) {
      throw new HttpsError("failed-precondition", "La estacion base solo se confirma durante ESCAPE, Move o si quedo pendiente.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (seatTeamId !== turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo el hider puede confirmar estacion base.");
    }

    const radiusM = game.settings.zoneRadiusM;
    const hidingZone = buildHidingZoneForStation(stationId, radiusM);

    if (turn.phase === "CHASE" && turn.baseStationSelectionRequired && !activeMove) {
      const allowedCandidateIds = turn.baseStationCandidateIds ?? [];
      if (allowedCandidateIds.length > 0 && !allowedCandidateIds.includes(stationId)) {
        throw new HttpsError("failed-precondition", "Esa estacion no esta entre las opciones detectadas al final del escape.");
      }
    }

    const now = nowTs();
    const currentTurn = activeMove ? {
      ...turn,
      moveState: {
        ...activeMove,
        targetStationId: stationId,
      },
    } : {
      ...turn,
      hidingZone,
      baseStationCandidateIds: [],
      baseStationSelectionRequired: false,
      endgameActive: false,
      endgameAnchorPoint: null,
      endgameLastChangedAt: null,
      lastEndgameVerificationAt: null,
      endgameQuestionsUnlocked: false,
      lastEndgameQuestionsConsultAt: null,
      foundVotes: [],
      captureAttempt: null,
    };
    tx.update(gameRef, {
      currentTurn,
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "BASE_STATION_CONFIRMED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        stationId,
        radiusM,
        moveActive: Boolean(activeMove),
        selectionWasPending: turn.baseStationSelectionRequired ?? false,
      },
    });
  });

  return {ok: true};
});

export const verifyEndgame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "verify_endgame", 10);
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
    assertOperationalPlayAllowed(game);
    if (!turn.hidingZone) {
      throw new HttpsError("failed-precondition", "La zona del hider todavía no está fijada.");
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

    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        endgameActive: true,
        endgameLastChangedAt: turn.endgameActive ? turn.endgameLastChangedAt ?? now : now,
        lastEndgameVerificationAt: now,
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "ENDGAME_VERIFIED_ACTIVE",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        source: "manual_verification",
      },
    });
  });

  return {ok: true};
});

export const consultEndgameQuestions = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "consult_endgame_questions", 10);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  let unlocked = false;
  let cooldownActive = false;
  let pendingConfirmation = false;
  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn || turn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "Las preguntas de endgame solo se consultan en CHASE.");
    }
    assertOperationalPlayAllowed(game);
    if (!turn.hidingZone) {
      throw new HttpsError("failed-precondition", "La zona del hider todavía no está fijada.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (!seatTeamId || seatTeamId === turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo seekers pueden consultar preguntas de endgame.");
    }

    const now = nowTs();
    const refreshedTurn = turn;
    unlocked = Boolean(refreshedTurn.endgameActive);

    if (!unlocked) {
      const lastConsultMillis = refreshedTurn.lastEndgameQuestionsConsultAt?.toMillis() ?? 0;
      cooldownActive = lastConsultMillis > 0 &&
        now.toMillis() - lastConsultMillis < ENDGAME_QUESTIONS_CONSULT_COOLDOWN_SECONDS * 1000;
    }

    const currentTurn = {
      ...refreshedTurn,
      endgameQuestionsUnlocked: unlocked ? true : refreshedTurn.endgameQuestionsUnlocked ?? false,
      lastEndgameQuestionsConsultAt: cooldownActive ? refreshedTurn.lastEndgameQuestionsConsultAt ?? null : now,
      endgameConsultation: refreshedTurn.endgameConsultation ?? null,
    };
    if (!unlocked && !cooldownActive && refreshedTurn.endgameConsultation?.status !== "PENDING_HIDER") {
      pendingConfirmation = true;
      currentTurn.endgameConsultation = {
        status: "PENDING_HIDER",
        requestedByUid: uid,
        requestedByTeamId: seatTeamId,
        requestedAt: now,
        resolvedByUid: null,
        resolvedAt: null,
      };
    }

    tx.update(gameRef, {
      currentTurn,
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "ENDGAME_QUESTIONS_CONSULTED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        unlocked,
        cooldownActive,
        pendingConfirmation,
      },
    });
  });

  return {ok: true, unlocked, cooldownActive, pendingConfirmation};
});

export const resolveEndgameConsultation = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const confirmed = Boolean(request.data?.confirmed);
  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn || turn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "La consulta de endgame solo se responde en CHASE.");
    }
    assertOperationalPlayAllowed(game);
    if (turn.endgameConsultation?.status !== "PENDING_HIDER") {
      throw new HttpsError("failed-precondition", "No hay consulta de endgame pendiente.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (seatTeamId !== turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo el hider puede responder la consulta de endgame.");
    }

    const now = nowTs();
    await assertRateLimitInTx(tx, gameRef, uid, "resolve_endgame_consultation", now, 5);
    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        endgameActive: confirmed ? true : turn.endgameActive ?? false,
        endgameLastChangedAt: confirmed ? turn.endgameLastChangedAt ?? now : turn.endgameLastChangedAt ?? null,
        endgameQuestionsUnlocked: confirmed ? true : turn.endgameQuestionsUnlocked ?? false,
        endgameConsultation: {
          ...turn.endgameConsultation,
          status: confirmed ? "CONFIRMED" : "REJECTED",
          resolvedByUid: uid,
          resolvedAt: now,
        },
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: confirmed ? "ENDGAME_CONSULTATION_CONFIRMED" : "ENDGAME_CONSULTATION_REJECTED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        requestedByTeamId: turn.endgameConsultation.requestedByTeamId,
      },
    });
  });

  return {ok: true};
});

interface LocationSample {
  lat: number;
  lng: number;
  accuracyM: number;
}

const readLocationSample = (value: unknown): LocationSample => {
  const sample = value as Record<string, unknown> | null;
  const lat = Number(sample?.lat);
  const lng = Number(sample?.lng);
  const accuracyM = Number(sample?.accuracyM);
  assertValidCoordinate(lat, lng);
  if (!Number.isFinite(accuracyM) || accuracyM < 0 || accuracyM > 50) {
    throw new HttpsError("failed-precondition", "La ubicación debe tener una precisión de 50 metros o mejor.");
  }
  return {lat, lng, accuracyM};
};

const isValidThermometerDistance = (distanceM: number): boolean =>
  [500, 1000, 1500, 2000].includes(distanceM) || (distanceM >= 500 && distanceM <= 4000);

export const activateThermometer = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const targetDistanceM = Number(request.data?.targetDistanceM);
  const requestedQuestionKey = String(request.data?.questionKey ?? "").trim().toLocaleLowerCase("es-AR");
  const questionKey = requestedQuestionKey || `thermometer:${targetDistanceM}`;
  const origin = readLocationSample(request.data?.origin);
  if (!gameId || questionKey.length > 300 || !Number.isInteger(targetDistanceM) || !isValidThermometerDistance(targetDistanceM)) {
    throw new HttpsError("invalid-argument", "La distancia del termómetro es inválida.");
  }
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn || turn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "Solo se puede activar el termómetro durante CHASE.");
    }
    assertOperationalPlayAllowed(game);
    if (!turn.hidingZone || turn.baseStationSelectionRequired || turn.pendingQuestionId || turn.lootOffer || turn.moveState?.status === "ACTIVE") {
      throw new HttpsError("failed-precondition", "No se puede activar el termómetro en este momento.");
    }
    if (turn.thermometerState) {
      throw new HttpsError("already-exists", "THERMOMETER_ALREADY_ACTIVE");
    }
    if ((turn.askedQuestionKeys ?? []).includes(questionKey)) {
      throw new HttpsError("already-exists", "QUESTION_ALREADY_ASKED");
    }
    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (!seatTeamId || seatTeamId === turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo los seekers pueden activar el termómetro.");
    }
    const now = nowTs();
    await assertRateLimitInTx(tx, gameRef, uid, "activate_thermometer", now, 10);
    const sessionRef = gameRef.collection("thermometerSessions").doc();
    tx.set(sessionRef, {
      origin: {lat: origin.lat, lng: origin.lng},
      originAccuracyM: origin.accuracyM,
      createdAt: now,
    });
    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        thermometerState: {
          status: "ACTIVE",
          targetDistanceM,
          startedByUid: uid,
          startedByTeamId: seatTeamId,
          startedAt: now,
          sessionId: sessionRef.id,
          questionKey,
        },
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "THERMOMETER_ACTIVATED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {targetDistanceM},
    });
  });
  return {ok: true};
});

export const completeThermometer = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const destination = readLocationSample(request.data?.destination);
  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  let actualDistanceM = 0;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    const turn = game.currentTurn;
    const thermometer = turn?.thermometerState;
    if (game.status !== "LIVE" || !turn || turn.phase !== "CHASE" || !thermometer) {
      throw new HttpsError("failed-precondition", "No hay un termómetro activo.");
    }
    assertOperationalPlayAllowed(game);
    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (!seatTeamId || seatTeamId !== thermometer.startedByTeamId) {
      throw new HttpsError("permission-denied", "Debe completarlo el equipo que activó el termómetro.");
    }
    const now = nowTs();
    await assertRateLimitInTx(tx, gameRef, uid, "complete_thermometer", now, 5);
    const sessionRef = gameRef.collection("thermometerSessions").doc(thermometer.sessionId);
    const sessionSnap = await tx.get(sessionRef);
    const originData = sessionSnap.data()?.origin as {lat?: unknown; lng?: unknown} | undefined;
    const origin = {lat: Number(originData?.lat), lng: Number(originData?.lng)};
    assertValidCoordinate(origin.lat, origin.lng);
    actualDistanceM = distanceMeters(origin, destination);
    const toleranceM = Math.max(20, thermometer.targetDistanceM * 0.1);
    if (Math.abs(actualDistanceM - thermometer.targetDistanceM) > toleranceM) {
      throw new HttpsError("failed-precondition", "THERMOMETER_DISTANCE_OUT_OF_RANGE");
    }
    if (turn.pendingQuestionId || turn.lootOffer) {
      throw new HttpsError("failed-precondition", "No se puede completar el termómetro en este momento.");
    }
    const questionRef = gameRef.collection("questions").doc();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + 300 * 1000);
    const prompt = `Los seekers se desplazaron ${thermometer.targetDistanceM} m en línea recta. ¿Ahora están más cerca o más lejos?`;
    tx.set(questionRef, {
      askedByUid: uid,
      prompt,
      isPhoto: false,
      categoryId: "thermometer",
      distanceM: thermometer.targetDistanceM,
      customDistanceM: [500, 1000, 1500, 2000].includes(thermometer.targetDistanceM) ? null : thermometer.targetDistanceM,
      status: "PENDING",
      randomizePool: [],
      runNumber: turn.runNumber,
      createdAt: now,
      expiresAt,
    });
    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        thermometerState: null,
        pendingQuestionId: questionRef.id,
        pendingQuestionEndsAt: expiresAt,
        askedQuestionPrompts: [...new Set([...(turn.askedQuestionPrompts ?? []), prompt])],
        askedQuestionKeys: [...new Set([...(turn.askedQuestionKeys ?? []), thermometer.questionKey])],
      },
      updatedAt: now,
    });
    tx.delete(sessionRef);
    appendGameEventInTx(tx, gameRef, game, {
      type: "THERMOMETER_COMPLETED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {questionId: questionRef.id, targetDistanceM: thermometer.targetDistanceM},
    });
  });
  return {ok: true, actualDistanceM: Math.round(actualDistanceM)};
});

export const sendQuestion = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  let prompt = String(request.data?.prompt ?? "").trim();
  const categoryId = String(request.data?.categoryId ?? "").trim();
  const requestedQuestionKey = String(request.data?.questionKey ?? "").trim().toLocaleLowerCase("es-AR");
  const isPhoto = Boolean(request.data?.isPhoto);
  const distanceMRaw = request.data?.distanceM;
  const distanceM = distanceMRaw === undefined || distanceMRaw === null ?
    null :
    Number(distanceMRaw);
  const customDistanceMRaw = request.data?.customDistanceM;
  const customDistanceM = customDistanceMRaw === undefined || customDistanceMRaw === null ?
    null :
    Number(customDistanceMRaw);
  const venueType = String(request.data?.venueType ?? "").trim();
  const requestedVenue = String(request.data?.venueSelection ?? "").trim();
  const selectedStadium = venueType === "stadium" ? STADIUMS.find((stadium) => stadium.name === requestedVenue) : undefined;
  if (venueType === "stadium" && !selectedStadium) {
    throw new HttpsError("invalid-argument", "Estadio inválido.");
  }
  if (selectedStadium) {
    prompt = `¿El estadio de fútbol profesional más cercano a tu estación base es ${selectedStadium.name}?`;
  }

  const questionKey = requestedQuestionKey || `${categoryId}:${prompt}`.toLocaleLowerCase("es-AR");
  if (!gameId || !prompt || !categoryId || questionKey.length > 300) {
    throw new HttpsError("invalid-argument", "gameId, prompt y categoryId son obligatorios.");
  }
  if (categoryId === "thermometer") {
    throw new HttpsError("failed-precondition", "THERMOMETER_REQUIRES_GEOLOCATION");
  }
  if (distanceM !== null && (!Number.isFinite(distanceM) || distanceM <= 0 || distanceM > 10000)) {
    throw new HttpsError("invalid-argument", "distanceM invalida.");
  }
  if (
    customDistanceM !== null &&
    (!Number.isFinite(customDistanceM) || customDistanceM < 200 || customDistanceM > 4000)
  ) {
    throw new HttpsError("invalid-argument", "customDistanceM debe estar entre 200 y 4000 metros.");
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
    assertOperationalPlayAllowed(game);
    if (game.currentTurn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "Solo se puede preguntar en CHASE.");
    }
    if (!game.currentTurn.hidingZone || game.currentTurn.baseStationSelectionRequired) {
      throw new HttpsError("failed-precondition", "BASE_STATION_REQUIRED");
    }
    if (game.currentTurn.pendingQuestionId) {
      throw new HttpsError("failed-precondition", "Ya existe una pregunta pendiente.");
    }
    if (game.currentTurn.thermometerState) {
      throw new HttpsError("failed-precondition", "THERMOMETER_ALREADY_ACTIVE");
    }
    if (game.currentTurn.moveState?.status === "ACTIVE") {
      throw new HttpsError("failed-precondition", "No se pueden hacer preguntas durante Move.");
    }
    if (game.currentTurn.lootOffer) {
      throw new HttpsError("failed-precondition", "Hay loot pendiente de resolver.");
    }
    if (
      (game.currentTurn.askedQuestionKeys ?? []).includes(questionKey) ||
      (game.currentTurn.askedQuestionPrompts ?? []).includes(prompt)
    ) {
      throw new HttpsError("already-exists", "QUESTION_ALREADY_ASKED");
    }
    if (categoryId === "endgame" && (!game.currentTurn.endgameActive || !game.currentTurn.endgameQuestionsUnlocked)) {
      throw new HttpsError("failed-precondition", "ENDGAME_QUESTIONS_LOCKED");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
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

    await assertRateLimitInTx(tx, gameRef, uid, "send_question", now, 10);
    const timeoutSeconds = isPhoto ? 600 : 300;
    const questionRef = gameRef.collection("questions").doc();
    tx.set(questionRef, {
      askedByUid: uid,
      prompt,
      isPhoto,
      categoryId,
      distanceM,
      customDistanceM,
      venueType: selectedStadium ? "stadium" : null,
      venueSelection: selectedStadium?.name ?? null,
      status: "PENDING",
      randomizePool: Array.isArray(request.data?.randomizePool) ?
        request.data.randomizePool.filter((value: unknown) => typeof value === "string" && value.trim() && value !== prompt).slice(0, 100) : [],
      runNumber: game.currentTurn.runNumber,
      createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + timeoutSeconds * 1000),
    });

    tx.update(gameRef, {
      currentTurn: {
        ...game.currentTurn,
        pendingQuestionId: questionRef.id,
        pendingQuestionEndsAt: Timestamp.fromMillis(now.toMillis() + timeoutSeconds * 1000),
        askedQuestionPrompts: [...new Set([...(game.currentTurn.askedQuestionPrompts ?? []), prompt])],
        askedQuestionKeys: [...new Set([...(game.currentTurn.askedQuestionKeys ?? []), questionKey])],
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "QUESTION_SENT",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId || null,
      payload: {
        questionId: questionRef.id,
        categoryId,
        isPhoto,
        prompt,
        distanceM,
        customDistanceM,
        expiresAt: Timestamp.fromMillis(now.toMillis() + timeoutSeconds * 1000),
      },
    });
  });

  return {ok: true};
});

export const resolveQuestion = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
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
    assertOperationalPlayAllowed(game);
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
    await assertRateLimitInTx(tx, gameRef, uid, "resolve_question", now, 5);
    if (!qSnap.exists) throw new HttpsError("not-found", "Pregunta no encontrada.");
    const questionData = qSnap.data() ?? {};
    const categoryId = String(questionData.categoryId ?? "").trim();
    const prompt = String(questionData.prompt ?? "");
    const answerText = typeof request.data?.answerText === "string" ? String(request.data.answerText).trim() : "";
    const drawRule = QUESTION_DRAW_RULES[categoryId] ?? {draw: 1, take: 1};
    const hand = [...(turn.hiderHand ?? [])];
    const powerupId = resolution === "ANSWER" ? undefined :
      hand.find((id) => id.split("#")[0] === (resolution === "VETO" ? "powerup_veto" : "powerup_randomize"));
    if (resolution !== "ANSWER" && !powerupId) {
      throw new HttpsError("failed-precondition", "No tenés la carta necesaria en la mano.");
    }
    const pool: string[] = Array.isArray(questionData.randomizePool) ?
      questionData.randomizePool.filter((value: unknown) => typeof value === "string" && value !== prompt) : [];
    if (resolution === "RANDOMIZE" && !pool.length) {
      throw new HttpsError("failed-precondition", "Esta pregunta no tiene alternativas para randomizar. Volvé a enviarla con la versión actualizada.");
    }
    const replacementRef = resolution === "RANDOMIZE" ? gameRef.collection("questions").doc() : null;
    const replacementPrompt = replacementRef ? pool[Math.floor(Math.random() * pool.length)] : null;
    const replacementExpiry = Timestamp.fromMillis(now.toMillis() + (questionData.isPhoto ? 600 : 300) * 1000);
    if (replacementRef && replacementPrompt) {
      tx.set(replacementRef, {
        askedByUid: questionData.askedByUid,
        prompt: replacementPrompt,
        categoryId,
        isPhoto: Boolean(questionData.isPhoto),
        distanceM: null,
        customDistanceM: null,
        randomizePool: [...pool.filter((value) => value !== replacementPrompt), prompt],
        status: "PENDING",
        runNumber: turn.runNumber,
        createdAt: now,
        expiresAt: replacementExpiry,
      });
    }
    const rewardsLoot = resolution === "ANSWER" || resolution === "VETO";
    const resolvedAnswerText = resolution === "VETO" ? "Veto" : answerText;
    const deckDraw = drawFromDeck(turn, rewardsLoot ? drawRule.draw : 0);

    tx.update(qRef, {
      status: "RESOLVED",
      resolution,
      resolvedByUid: uid,
      resolvedAt: now,
      answerText: rewardsLoot ? resolvedAnswerText : null,
    });

    const categoryCooldowns = {...(turn.categoryCooldowns ?? {})};
    if (categoryId) {
      categoryCooldowns[categoryId] = Timestamp.fromMillis(now.toMillis() + 15 * 60 * 1000);
    }

    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        pendingQuestionId: replacementRef?.id ?? null,
        pendingQuestionEndsAt: replacementRef ? replacementExpiry : null,
        askedQuestionPrompts: replacementPrompt
          ? [...new Set([...(turn.askedQuestionPrompts ?? []), replacementPrompt])]
          : turn.askedQuestionPrompts ?? [],
        hiderHand: hand.filter((id) => id !== powerupId),
        categoryCooldowns,
        drawPile: deckDraw.drawPile,
        discardPile: [...deckDraw.discardPile, ...(powerupId ? [powerupId] : [])],
        lastQuestionResult: {
          questionId: qRef.id,
          categoryId,
          prompt,
          resolution: resolution as "ANSWER" | "VETO" | "RANDOMIZE",
          answerText: rewardsLoot ? resolvedAnswerText : null,
          resolvedAt: now,
        },
        lootOffer: rewardsLoot ? {
          questionId: qRef.id,
          categoryId,
          drawnCardIds: deckDraw.drawnCardIds,
          takeLimit: drawRule.take,
          createdAt: now,
          expiresAt: Timestamp.fromMillis(now.toMillis() + LOOT_SELECTION_SECONDS * 1000),
        } : null,
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "QUESTION_RESOLVED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        questionId: qRef.id,
        categoryId,
        resolution,
        drawnCardIds: deckDraw.drawnCardIds,
        takeLimit: drawRule.take,
      },
    });
  });

  return {ok: true};
});

export const selectLoot = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
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
    assertOperationalPlayAllowed(game);
    const seatSnap = await tx.get(
      gameRef.collection("seats").where("uid", "==", uid).limit(1),
    );
    const seatTeamId = String(seatSnap.docs[0]?.data()?.teamId ?? "");
    if (seatTeamId !== turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo el hider puede elegir loot.");
    }

    const now = nowTs();
    await assertRateLimitInTx(tx, gameRef, uid, "select_loot", now, 5);
    const drawn = turn.lootOffer.drawnCardIds;
    const lootExpiresAt = turn.lootOffer.expiresAt ?? Timestamp.fromMillis(
      turn.lootOffer.createdAt.toMillis() + LOOT_SELECTION_SECONDS * 1000,
    );
    if (lootExpiresAt.toMillis() <= now.toMillis()) {
      tx.update(gameRef, {
        currentTurn: {
          ...turn,
          discardPile: [...(turn.discardPile ?? []), ...drawn],
          lootOffer: null,
        },
        updatedAt: now,
      });
      appendGameEventInTx(tx, gameRef, game, {
        type: "LOOT_SELECTION_EXPIRED",
        createdAt: now,
        actorUid: null,
        actorTeamId: turn.hiderTeamId,
        payload: {
          questionId: turn.lootOffer.questionId,
          selectedCardIds: [],
          discardedDrawnCardIds: drawn,
        },
      });
      return;
    }
    if (selectedCardIds.length > turn.lootOffer.takeLimit) {
      throw new HttpsError("invalid-argument", "Seleccionaste más cartas que el límite.");
    }
    if (!selectedCardIds.every((cardId) => drawn.includes(cardId))) {
      throw new HttpsError("invalid-argument", "Solo podés elegir cartas del loot actual.");
    }

    const hand = [...(turn.hiderHand ?? [])];
    const remainingHand = [...hand];
    for (const cardId of discardFromHandIds) {
      const index = remainingHand.indexOf(cardId);
      if (index < 0) throw new HttpsError("invalid-argument", "No podés descartar una carta que no está en la mano.");
      remainingHand.splice(index, 1);
    }

    const selected = [...selectedCardIds];
    const nextHand = [...remainingHand, ...selected];
    if (nextHand.length > DECK_MAX_SIZE) {
      throw new HttpsError("failed-precondition", "La mano supera el máximo de 6 cartas.");
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
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "LOOT_SELECTED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        questionId: turn.lootOffer.questionId,
        selectedCardIds,
        discardedDrawnCardIds: unselectedDrawn,
        discardFromHandIds,
        nextHandSize: nextHand.length,
      },
    });
  });

  return {ok: true};
});

export const playCurse = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const cardId = String(request.data?.cardId ?? request.data?.curseId ?? "").trim();
  const curseId = cardId.split("#")[0];
  const blocksQuestions = Boolean(request.data?.blocksQuestions);
  const blocksTransport = Boolean(request.data?.blocksTransport);
  const expiresAtMillisRaw = request.data?.expiresAtMillis;
  const expiresAtMillis = typeof expiresAtMillisRaw === "number" ? expiresAtMillisRaw : null;

  if (!gameId || !cardId || !curseId.startsWith("curse_")) {
    throw new HttpsError("invalid-argument", "gameId y cardId de maldición son obligatorios.");
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
    await assertRateLimitInTx(tx, gameRef, uid, "play_curse", now, 5);
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
    appendGameEventInTx(tx, gameRef, game, {
      type: "CURSE_PLAYED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        effectId: newEffect.id,
        cardId,
        curseId,
        blocksQuestions,
        blocksTransport,
        expiresAt: newEffect.expiresAt ?? null,
      },
    });
  });

  return {ok: true};
});

export const completeCurseEffect = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
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
      throw new HttpsError("failed-precondition", "La partida no está en juego activo.");
    }
    assertOperationalPlayAllowed(game);

    const seatSnap = await tx.get(
      gameRef.collection("seats").where("uid", "==", uid).limit(1),
    );
    const seatTeamId = String(seatSnap.docs[0]?.data()?.teamId ?? "");
    const isCurrentHider = seatTeamId === turn.hiderTeamId;
    const isCurrentSeeker = Boolean(seatTeamId) && seatTeamId !== turn.hiderTeamId;
    if (!isCurrentHider && !isCurrentSeeker) {
      throw new HttpsError("permission-denied", "Solo jugadores del turno pueden completar maldiciones.");
    }

    const now = nowTs();
    await assertRateLimitInTx(tx, gameRef, uid, "complete_curse", now, 5);
    const activeEffects = (turn.activeEffects ?? []).filter((effect) =>
      !effect.expiresAt || effect.expiresAt.toMillis() > now.toMillis(),
    );
    if (!activeEffects.some((effect) => effect.id === effectId)) {
      throw new HttpsError("not-found", "Efecto activo no encontrado.");
    }
    const completedEffect = activeEffects.find((effect) => effect.id === effectId)!;

    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        activeEffects: activeEffects.filter((effect) => effect.id !== effectId),
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "CURSE_COMPLETED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId || null,
      payload: {
        effectId,
        curseId: completedEffect.curseId,
        completedByRole: isCurrentHider ? "HIDER" : "SEEKER",
      },
    });
  });

  return {ok: true};
});

export const playDiscardDrawPowerup = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const cardId = String(request.data?.cardId ?? "").trim();
  const discardCardIds: string[] = Array.isArray(request.data?.discardCardIds) ?
    request.data.discardCardIds.map((value: unknown) => String(value)) :
    [];

  if (!gameId || !cardId) {
    throw new HttpsError("invalid-argument", "gameId y cardId son obligatorios.");
  }
  const baseCardId = cardId.split("#")[0];
  const rule = baseCardId === "powerup_discard1_draw2" ?
    {discard: 1, draw: 2} :
    baseCardId === "powerup_discard2_draw3" ?
      {discard: 2, draw: 3} :
      null;
  if (!rule) {
    throw new HttpsError("invalid-argument", "Carta de descarte/robo invalida.");
  }
  if (discardCardIds.length !== rule.discard || hasDuplicates(discardCardIds)) {
    throw new HttpsError("invalid-argument", `Tenés que descartar exactamente ${rule.discard} carta(s).`);
  }
  if (discardCardIds.includes(cardId)) {
    throw new HttpsError("invalid-argument", "La carta jugada se descarta automaticamente; elegí otras cartas.");
  }

  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (!turn || game.status !== "LIVE" || turn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "La carta solo se juega en CHASE.");
    }
    assertOperationalPlayAllowed(game);
    if (turn.lootOffer) {
      throw new HttpsError("failed-precondition", "Primero resolvé el loot pendiente.");
    }
    if (turn.moveState?.status === "ACTIVE") {
      throw new HttpsError("failed-precondition", "No se puede jugar esta carta durante Move.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (seatTeamId !== turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo el hider puede jugar esta carta.");
    }

    const hand = [...(turn.hiderHand ?? [])];
    const powerupIndex = hand.indexOf(cardId);
    if (powerupIndex < 0) {
      throw new HttpsError("invalid-argument", "La carta no esta en la mano del hider.");
    }
    const discardSet = new Set(discardCardIds);
    for (const discardCardId of discardSet) {
      if (!hand.includes(discardCardId)) {
        throw new HttpsError("invalid-argument", "Todas las cartas a descartar deben estar en la mano.");
      }
    }

    const handAfterDiscard = hand.filter((heldCardId) => heldCardId !== cardId && !discardSet.has(heldCardId));
    if (handAfterDiscard.length !== hand.length - rule.discard - 1) {
      throw new HttpsError("invalid-argument", "Selección de descarte invalida.");
    }

    // Keep this play's discards out of the reshuffle until the draw finishes.
    const drawResult = drawFromDeck(turn, rule.draw);
    const now = nowTs();
    await assertRateLimitInTx(tx, gameRef, uid, "play_discard_draw_powerup", now, 5);

    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        hiderHand: [
          ...handAfterDiscard,
          ...drawResult.drawnCardIds,
        ],
        drawPile: drawResult.drawPile,
        discardPile: [...drawResult.discardPile, cardId, ...discardCardIds],
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "DISCARD_DRAW_POWERUP_PLAYED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        cardId,
        discardedCardIds: discardCardIds,
        drawnCount: drawResult.drawnCardIds.length,
      },
    });
  });

  return {ok: true};
});

export const getQuestionHint = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const questionId = String(request.data?.questionId ?? "").trim();
  await requireGameMembership(db, gameId, uid);
  const gameRef = db.collection("games").doc(gameId);
  return db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    const game = gameSnap.data() as GameDoc | undefined;
    const turn = game?.currentTurn;
    if (!game || !turn || turn.pendingQuestionId !== questionId) throw new HttpsError("failed-precondition", "La pregunta ya no está pendiente.");
    const teamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (teamId !== turn.hiderTeamId) throw new HttpsError("permission-denied", "Solo el hider puede ver esta pista.");
    const question = (await tx.get(gameRef.collection("questions").doc(questionId))).data() ?? {};
    if (question.venueType !== "stadium" || !turn.hidingZone) throw new HttpsError("not-found", "No hay pista para esta pregunta.");
    const nearest = [...STADIUMS].sort((a, b) => distanceMeters(turn.hidingZone!.center, a) - distanceMeters(turn.hidingZone!.center, b))[0];
    return {hint: `Pista privada: el estadio más cercano a tu estación base es ${nearest.name}.`};
  });
});

export const playDuplicatePowerup = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const cardId = String(request.data?.cardId ?? "").trim();
  const targetCardId = String(request.data?.targetCardId ?? "").trim();
  if (!gameId || cardId.split("#")[0] !== "powerup_duplicate" || !targetCardId || cardId === targetCardId) {
    throw new HttpsError("invalid-argument", "Elegí Duplicar y otra carta de tu mano.");
  }
  await requireGameMembership(db, gameId, uid);
  const gameRef = db.collection("games").doc(gameId);
  const copyId = `${targetCardId.split("#")[0]}#${gameRef.collection("events").doc().id}`;
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(gameRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snapshot.data() as GameDoc;
    const turn = game.currentTurn;
    assertOperationalPlayAllowed(game);
    if (game.status !== "LIVE" || !turn || turn.phase !== "CHASE" || turn.pendingQuestionId || turn.lootOffer || turn.moveState?.status === "ACTIVE") {
      throw new HttpsError("failed-precondition", "Duplicar requiere estar en persecución, sin pregunta ni loot pendiente.");
    }
    const teamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (teamId !== turn.hiderTeamId) throw new HttpsError("permission-denied", "Solo el hider puede duplicar.");
    const hand = turn.hiderHand ?? [];
    if (!hand.includes(cardId) || !hand.includes(targetCardId)) {
      throw new HttpsError("failed-precondition", "Ambas cartas deben estar en tu mano.");
    }
    const now = nowTs();
    tx.update(gameRef, {
      currentTurn: {...turn, hiderHand: hand.map((id) => id === cardId ? copyId : id), discardPile: [...(turn.discardPile ?? []), cardId]},
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "DUPLICATE_POWERUP_PLAYED", createdAt: now, actorUid: uid, actorTeamId: teamId,
      payload: {cardId, targetCardId, copyId},
    });
  });
  return {ok: true};
});

export const playMovePowerup = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const cardId = String(request.data?.cardId ?? "").trim();

  if (!gameId || !cardId) {
    throw new HttpsError("invalid-argument", "gameId y cardId son obligatorios.");
  }
  if (cardId.split("#")[0] !== "powerup_move") {
    throw new HttpsError("invalid-argument", "Carta Move invalida.");
  }

  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (!turn || game.status !== "LIVE" || turn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "SALÍ DE AHÍ solo se juega en CHASE.");
    }
    assertOperationalPlayAllowed(game);
    if (!turn.hidingZone?.stationId) {
      throw new HttpsError("failed-precondition", "La base actual todavia no esta fijada.");
    }
    if (turn.pendingQuestionId) {
      throw new HttpsError("failed-precondition", "No se puede jugar SALÍ DE AHÍ con una pregunta pendiente.");
    }
    if (turn.lootOffer) {
      throw new HttpsError("failed-precondition", "Primero resolvé el loot pendiente.");
    }
    if (turn.endgameActive) {
      throw new HttpsError("failed-precondition", "No se puede jugar SALÍ DE AHÍ durante endgame.");
    }
    if (turn.moveState?.status === "ACTIVE") {
      throw new HttpsError("failed-precondition", "SALÍ DE AHÍ ya está activo.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (seatTeamId !== turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo el hider puede jugar SALÍ DE AHÍ.");
    }

    const hand = [...(turn.hiderHand ?? [])];
    const cardIndex = hand.indexOf(cardId);
    if (cardIndex < 0) {
      throw new HttpsError("invalid-argument", "La carta no esta en la mano del hider.");
    }
    hand.splice(cardIndex, 1);

    const now = nowTs();
    await assertRateLimitInTx(tx, gameRef, uid, "play_move_powerup", now, 5);
    const remainingPhaseSeconds = Math.max(0, Math.ceil((turn.phaseEndsAt.toMillis() - now.toMillis()) / 1000));
    const endsAt = Timestamp.fromMillis(now.toMillis() + MOVE_DURATION_SECONDS * 1000);

    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        hiderHand: hand,
        discardPile: [...(turn.discardPile ?? []), cardId],
        moveState: {
          status: "ACTIVE",
          cardId,
          startedAt: now,
          endsAt,
          previousStationId: turn.hidingZone.stationId,
          targetStationId: null,
          completedAt: null,
          remainingPhaseSeconds,
        },
        baseStationCandidateIds: [],
        baseStationSelectionRequired: true,
        endgameActive: false,
        endgameAnchorPoint: null,
        endgameLastChangedAt: null,
        lastEndgameVerificationAt: null,
        endgameQuestionsUnlocked: false,
        lastEndgameQuestionsConsultAt: null,
        foundVotes: [],
        captureAttempt: null,
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "MOVE_STARTED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        cardId,
        previousStationId: turn.hidingZone.stationId,
        endsAt,
        remainingPhaseSeconds,
      },
    });
  });

  return {ok: true};
});

export const startCaptureAttempt = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  let attemptId = "";
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (!turn || game.status !== "LIVE" || turn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "La captura solo se intenta en CHASE.");
    }
    assertOperationalPlayAllowed(game);
    if (!turn.endgameActive) {
      throw new HttpsError("failed-precondition", "CAPTURE_REQUIRES_ENDGAME");
    }
    if (turn.captureAttempt?.status === "PENDING_HIDER") {
      throw new HttpsError("failed-precondition", "CAPTURE_ATTEMPT_ALREADY_ACTIVE");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (!seatTeamId || seatTeamId === turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo seekers pueden iniciar captura.");
    }

    const now = nowTs();
    await assertRateLimitInTx(tx, gameRef, uid, "start_capture", now, 5);
    attemptId = gameRef.collection("captureAttempts").doc().id;
    const captureAttempt: CaptureAttempt = {
      id: attemptId,
      status: "PENDING_HIDER",
      createdByUid: uid,
      createdByTeamId: seatTeamId,
      createdAt: now,
      hiderResolvedByUid: null,
      hiderResolvedAt: null,
      seekerConfirmations: [seatTeamId],
      completedAt: null,
    };

    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        captureAttempt,
        foundVotes: [seatTeamId],
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "CAPTURE_ATTEMPT_STARTED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        attemptId,
        requiredSeekerConfirmations: requiredSeekerCaptureConfirmations(game),
      },
    });
  });

  return {ok: true, attemptId};
});

export const resolveCaptureAttempt = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const confirmed = Boolean(request.data?.confirmed);
  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (!turn || game.status !== "LIVE" || turn.phase !== "CHASE" || !turn.captureAttempt) {
      throw new HttpsError("failed-precondition", "No hay intento de captura activo.");
    }
    assertOperationalPlayAllowed(game);
    if (turn.captureAttempt.status !== "PENDING_HIDER") {
      throw new HttpsError("failed-precondition", "El intento de captura ya fue resuelto.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (seatTeamId !== turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo el hider puede responder el intento.");
    }

    const now = nowTs();
    await assertRateLimitInTx(tx, gameRef, uid, "resolve_capture", now, 5);
    game.currentTurn = {
      ...turn,
      captureAttempt: {
        ...turn.captureAttempt,
        status: confirmed ? "CONFIRMED" : "REJECTED",
        hiderResolvedByUid: uid,
        hiderResolvedAt: now,
        completedAt: confirmed ? now : null,
      },
    };

    if (confirmed) {
      endTurnInTx(game, now);
    }

    tx.update(gameRef, {
      currentTurn: game.currentTurn,
      standings: game.standings,
      status: game.status,
      finishedAt: game.finishedAt ?? null,
      winnerTeamIds: game.winnerTeamIds ?? null,
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, {...game, currentTurn: turn}, {
      type: confirmed ? "CAPTURE_CONFIRMED_BY_HIDER" : "CAPTURE_REJECTED_BY_HIDER",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        attemptId: turn.captureAttempt.id,
        turnEnded: confirmed,
      },
    });
  });

  return {ok: true};
});

export const confirmCaptureBySeeker = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (!turn || game.status !== "LIVE" || turn.phase !== "CHASE" || !turn.captureAttempt) {
      throw new HttpsError("failed-precondition", "No hay intento de captura activo.");
    }
    assertOperationalPlayAllowed(game);
    if (turn.captureAttempt.status === "CONFIRMED") {
      throw new HttpsError("failed-precondition", "La captura ya fue confirmada.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (!seatTeamId || seatTeamId === turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo seekers pueden confirmar captura.");
    }

    await assertRateLimitInTx(tx, gameRef, uid, "confirm_capture", nowTs(), 5);
    const confirmations = turn.captureAttempt.seekerConfirmations.includes(seatTeamId) ?
      turn.captureAttempt.seekerConfirmations :
      [...turn.captureAttempt.seekerConfirmations, seatTeamId];
    const now = nowTs();
    const shouldEnd = confirmations.length >= requiredSeekerCaptureConfirmations(game);

    game.currentTurn = {
      ...turn,
      foundVotes: confirmations,
      captureAttempt: {
        ...turn.captureAttempt,
        status: shouldEnd ? "CONFIRMED" : turn.captureAttempt.status,
        seekerConfirmations: confirmations,
        completedAt: shouldEnd ? now : turn.captureAttempt.completedAt ?? null,
      },
    };

    if (shouldEnd) {
      endTurnInTx(game, now);
    }

    tx.update(gameRef, {
      currentTurn: game.currentTurn,
      standings: game.standings,
      status: game.status,
      finishedAt: game.finishedAt ?? null,
      winnerTeamIds: game.winnerTeamIds ?? null,
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, {...game, currentTurn: turn}, {
      type: shouldEnd ? "CAPTURE_CONFIRMED_BY_SEEKERS" : "CAPTURE_RATIFIED_BY_SEEKER",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        attemptId: turn.captureAttempt.id,
        confirmations,
        requiredSeekerConfirmations: requiredSeekerCaptureConfirmations(game),
        turnEnded: shouldEnd,
      },
    });
  });

  return {ok: true};
});

export const castFoundVote = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "cast_found_vote", 10);
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
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "end_turn", 10);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    if (game.status !== "LIVE") throw new HttpsError("failed-precondition", "Partida no activa.");
    const turn = game.currentTurn;
    const now = nowTs();
    endTurnInTx(game, now);

    tx.update(gameRef, {
      currentTurn: game.currentTurn,
      standings: game.standings,
      status: game.status,
      finishedAt: game.finishedAt ?? null,
      winnerTeamIds: game.winnerTeamIds ?? null,
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, {...game, currentTurn: turn}, {
      type: "TURN_ENDED_MANUALLY",
      createdAt: now,
      actorUid: uid,
      actorTeamId: null,
      payload: {
        nextPhase: game.currentTurn?.phase ?? null,
        gameStatus: game.status,
      },
    });
  });

  return {ok: true};
});

export const nextTurn = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  await assertUserRateLimit(db, uid, "next_turn", 10);
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
      askedQuestionPrompts: [],
      askedQuestionKeys: [],
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
      expirations: 0,
      timeoutPenaltyAppliedSeconds: 0,
      foundVotes: [],
      captureAttempt: null,
    };

    tx.update(gameRef, {
      currentTurn: game.currentTurn,
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "TURN_STARTED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: null,
      payload: {
        hiderTeamId: nextHider,
      },
    });
  });

  return {ok: true};
});

export {
  pauseGame,
  resumeGame,
  declareEmergency,
  cancelGame,
  reportTemporaryDisconnect,
  clearTemporaryDisconnect,
} from "./control-callables";

export {
  scoring,
  listQuestionHistory,
  listGameEvents,
  listGameNotifications,
  getNotificationPreferences,
  updateNotificationPreferences,
  finishGame,
} from "./query-callables";

export {getMyActiveGame} from "./active-game-callable";
export {listOperationalHistory} from "./operational-history-callable";
export {previewGame} from "./game-preview-callable";

const completeMoveIfDueInTx = (
  tx: Transaction,
  gameRef: DocumentReference,
  game: GameDoc,
  turn: TurnState,
  txNow: Timestamp,
): TurnState => {
  const moveState = turn.moveState;
  if (!moveState || moveState.status !== "ACTIVE" || moveState.endsAt.toMillis() > txNow.toMillis()) {
    return turn;
  }

  const nextStationId = moveState.targetStationId || moveState.previousStationId;
  const hidingZone = buildHidingZoneForStation(nextStationId, game.settings.zoneRadiusM);
  const nextTurn: TurnState = {
    ...turn,
    phaseEndsAt: Timestamp.fromMillis(txNow.toMillis() + moveState.remainingPhaseSeconds * 1000),
    hidingZone,
    baseStationCandidateIds: [],
    baseStationSelectionRequired: false,
    moveState: {
      ...moveState,
      status: "COMPLETED",
      targetStationId: nextStationId,
      completedAt: txNow,
    },
    endgameActive: false,
    endgameAnchorPoint: null,
    endgameLastChangedAt: null,
    lastEndgameVerificationAt: null,
    endgameQuestionsUnlocked: false,
    lastEndgameQuestionsConsultAt: null,
    foundVotes: [],
    captureAttempt: null,
  };

  appendGameEventInTx(tx, gameRef, game, {
    type: "MOVE_COMPLETED",
    createdAt: txNow,
    actorUid: null,
    actorTeamId: turn.hiderTeamId,
    payload: {
      previousStationId: moveState.previousStationId,
      stationId: nextStationId,
      targetWasSelected: Boolean(moveState.targetStationId),
    },
  });

  return nextTurn;
};

const lootOfferExpiresAtMillis = (turn: TurnState): number | null => {
  const offer = turn.lootOffer;
  if (!offer) return null;
  return (offer.expiresAt ?? Timestamp.fromMillis(
    offer.createdAt.toMillis() + LOOT_SELECTION_SECONDS * 1000,
  )).toMillis();
};

const expireLootOfferIfDueInTx = (
  tx: Transaction,
  gameRef: DocumentReference,
  game: GameDoc,
  turn: TurnState,
  txNow: Timestamp,
): boolean => {
  const expiresAtMillis = lootOfferExpiresAtMillis(turn);
  if (!turn.lootOffer || expiresAtMillis === null || expiresAtMillis > txNow.toMillis()) return false;

  const expiredOffer = turn.lootOffer;
  turn.discardPile = [...(turn.discardPile ?? []), ...expiredOffer.drawnCardIds];
  turn.lootOffer = null;
  appendGameEventInTx(tx, gameRef, game, {
    type: "LOOT_SELECTION_EXPIRED",
    createdAt: txNow,
    actorUid: null,
    actorTeamId: turn.hiderTeamId,
    payload: {
      questionId: expiredOffer.questionId,
      selectedCardIds: [],
      discardedDrawnCardIds: expiredOffer.drawnCardIds,
    },
  });
  return true;
};

const applyQuestionTimeoutPenalty = (turn: TurnState, txNow: Timestamp): void => {
  if (turn.phase !== "CHASE") return;
  const previousEndsAtMillis = turn.phaseEndsAt.toMillis();
  const nextEndsAtMillis = Math.max(
    txNow.toMillis(),
    previousEndsAtMillis - 30 * 60 * 1000,
  );
  turn.phaseEndsAt = Timestamp.fromMillis(nextEndsAtMillis);
  turn.timeoutPenaltyAppliedSeconds = (turn.timeoutPenaltyAppliedSeconds ?? 0) +
    Math.floor((previousEndsAtMillis - nextEndsAtMillis) / 1000);
};

export const processGameTick = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertGlobalPlayEnabled(db);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  let changed = false;
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(gameRef);
    if (!fresh.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = fresh.data() as GameDoc;
    let turn = game.currentTurn;
    if (!turn || game.status !== "LIVE") return;
    if (isOperationallyStopped(game)) return;

    const txNow = nowTs();
    const phaseDueAtStart = turn.phaseEndsAt.toMillis() <= txNow.toMillis();
    const questionDueAtStart = Boolean(turn.pendingQuestionId && turn.pendingQuestionEndsAt && turn.pendingQuestionEndsAt.toMillis() <= txNow.toMillis());
    const moveDueAtStart = Boolean(turn.moveState?.status === "ACTIVE" && turn.moveState.endsAt.toMillis() <= txNow.toMillis());
    const lootDueAtStart = Boolean(lootOfferExpiresAtMillis(turn) !== null && lootOfferExpiresAtMillis(turn)! <= txNow.toMillis());
    if (!phaseDueAtStart && !questionDueAtStart && !moveDueAtStart && !lootDueAtStart) return;

    await assertRateLimitInTx(tx, gameRef, uid, `process_game_tick_${turn.runNumber}_${turn.phase}`, txNow, 3);

    if (turn.pendingQuestionId && turn.pendingQuestionEndsAt && turn.pendingQuestionEndsAt.toMillis() <= txNow.toMillis()) {
      const expiredQuestionId = turn.pendingQuestionId;
      const qRef = gameRef.collection("questions").doc(turn.pendingQuestionId);
      tx.set(qRef, {
        status: "EXPIRED",
        expiredAt: txNow,
      }, {merge: true});
      appendGameEventInTx(tx, gameRef, game, {
        type: "QUESTION_EXPIRED",
        createdAt: txNow,
        actorUid: null,
        actorTeamId: null,
        payload: {
          questionId: expiredQuestionId,
        },
      });
      turn.pendingQuestionId = null;
      turn.pendingQuestionEndsAt = null;
      turn.expirations += 1;
      applyQuestionTimeoutPenalty(turn, txNow);
      changed = true;
    }

    if (expireLootOfferIfDueInTx(tx, gameRef, game, turn, txNow)) {
      changed = true;
    }

    const turnAfterMove = completeMoveIfDueInTx(tx, gameRef, game, turn, txNow);
    if (turnAfterMove !== turn) {
      game.currentTurn = turnAfterMove;
      turn = turnAfterMove;
      changed = true;
    }

    if (turn.phaseEndsAt.toMillis() <= txNow.toMillis()) {
      if (turn.phase === "INTERMISSION") {
        game.currentTurn = setNextPhase(turn, game.settings, "ESCAPE", txNow);
        appendGameEventInTx(tx, gameRef, game, {
          type: "PHASE_ADVANCED",
          createdAt: txNow,
          actorUid: null,
          actorTeamId: null,
          payload: {
            fromPhase: "INTERMISSION",
            toPhase: "ESCAPE",
          },
        });
      } else if (turn.phase === "ESCAPE") {
        const resolvedTurn = await resolveBaseStationAtEscapeEndInTx(tx, gameRef, game, txNow);
        game.currentTurn = setNextPhase(resolvedTurn ?? turn, game.settings, "CHASE", txNow);
        appendGameEventInTx(tx, gameRef, game, {
          type: "PHASE_ADVANCED",
          createdAt: txNow,
          actorUid: null,
          actorTeamId: null,
          payload: {
            fromPhase: "ESCAPE",
            toPhase: "CHASE",
            baseStationSelectionRequired: game.currentTurn.baseStationSelectionRequired ?? false,
            baseStationCandidateIds: game.currentTurn.baseStationCandidateIds ?? [],
            stationId: game.currentTurn.hidingZone?.stationId ?? null,
          },
        });
      } else if (turn.phase === "CHASE") {
        endTurnInTx(game, txNow);
        appendGameEventInTx(tx, gameRef, {...game, currentTurn: turn}, {
          type: "TURN_ENDED_BY_TIMEOUT",
          createdAt: txNow,
          actorUid: null,
          actorTeamId: null,
          payload: {
            gameStatus: game.status,
            nextPhase: game.currentTurn?.phase ?? null,
          },
        });
      }
      changed = true;
    }

    if (!changed) return;

    tx.update(gameRef, {
      currentTurn: game.currentTurn,
      standings: game.standings,
      status: game.status,
      finishedAt: game.finishedAt ?? null,
      expiresAt: game.expiresAt ?? null,
      winnerTeamIds: game.winnerTeamIds ?? null,
      updatedAt: txNow,
    });
  });

  return {ok: true, changed};
});
export const scheduledTick = onSchedule({schedule: "every 5 minutes", maxInstances: 1}, async () => {
  const now = nowTs();
  const gamesSnap = await db.collection("games")
    .where("status", "==", "LIVE")
    .get();

  const dueDocs = gamesSnap.docs.filter((docSnap) => {
    const turn = (docSnap.data() as GameDoc).currentTurn;
    if (!turn) return false;
    const phaseDue = turn.phaseEndsAt.toMillis() <= now.toMillis();
    const questionDue = Boolean(turn.pendingQuestionEndsAt && turn.pendingQuestionEndsAt.toMillis() <= now.toMillis());
    const moveDue = Boolean(turn.moveState?.status === "ACTIVE" && turn.moveState.endsAt.toMillis() <= now.toMillis());
    const lootDue = Boolean(lootOfferExpiresAtMillis(turn) !== null && lootOfferExpiresAtMillis(turn)! <= now.toMillis());
    return phaseDue || questionDue || moveDue || lootDue;
  });

  const tasks = dueDocs.map(async (docSnap) => {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(docSnap.ref);
      if (!fresh.exists) return;
      const game = fresh.data() as GameDoc;
      let turn = game.currentTurn;
      if (!turn || game.status !== "LIVE") return;
      if (isOperationallyStopped(game)) return;

      const txNow = nowTs();
      let changed = false;

      if (turn.pendingQuestionId && turn.pendingQuestionEndsAt && turn.pendingQuestionEndsAt.toMillis() <= txNow.toMillis()) {
        const expiredQuestionId = turn.pendingQuestionId;
        const qRef = docSnap.ref.collection("questions").doc(turn.pendingQuestionId);
        tx.set(qRef, {
          status: "EXPIRED",
          expiredAt: txNow,
        }, {merge: true});
        appendGameEventInTx(tx, docSnap.ref, game, {
          type: "QUESTION_EXPIRED",
          createdAt: txNow,
          actorUid: null,
          actorTeamId: null,
          payload: {
            questionId: expiredQuestionId,
          },
        });
        turn.pendingQuestionId = null;
        turn.pendingQuestionEndsAt = null;
        turn.expirations += 1;
        applyQuestionTimeoutPenalty(turn, txNow);
        changed = true;
      }

      if (expireLootOfferIfDueInTx(tx, docSnap.ref, game, turn, txNow)) {
        changed = true;
      }

      const turnAfterMove = completeMoveIfDueInTx(tx, docSnap.ref, game, turn, txNow);
      if (turnAfterMove !== turn) {
        game.currentTurn = turnAfterMove;
        turn = turnAfterMove;
        changed = true;
      }

      if (turn.phaseEndsAt.toMillis() <= txNow.toMillis()) {
        if (turn.phase === "INTERMISSION") {
          game.currentTurn = setNextPhase(turn, game.settings, "ESCAPE", txNow);
          appendGameEventInTx(tx, docSnap.ref, game, {
            type: "PHASE_ADVANCED",
            createdAt: txNow,
            actorUid: null,
            actorTeamId: null,
            payload: {
              fromPhase: "INTERMISSION",
              toPhase: "ESCAPE",
            },
          });
        } else if (turn.phase === "ESCAPE") {
          const resolvedTurn = await resolveBaseStationAtEscapeEndInTx(tx, docSnap.ref, game, txNow);
          game.currentTurn = setNextPhase(resolvedTurn ?? turn, game.settings, "CHASE", txNow);
          appendGameEventInTx(tx, docSnap.ref, game, {
            type: "PHASE_ADVANCED",
            createdAt: txNow,
            actorUid: null,
            actorTeamId: null,
            payload: {
              fromPhase: "ESCAPE",
              toPhase: "CHASE",
              baseStationSelectionRequired: game.currentTurn.baseStationSelectionRequired ?? false,
              baseStationCandidateIds: game.currentTurn.baseStationCandidateIds ?? [],
              stationId: game.currentTurn.hidingZone?.stationId ?? null,
            },
          });
        } else if (turn.phase === "CHASE") {
          endTurnInTx(game, txNow);
          appendGameEventInTx(tx, docSnap.ref, {...game, currentTurn: turn}, {
            type: "TURN_ENDED_BY_TIMEOUT",
            createdAt: txNow,
            actorUid: null,
            actorTeamId: null,
            payload: {
              gameStatus: game.status,
              nextPhase: game.currentTurn?.phase ?? null,
            },
          });
        }
        changed = true;
      }

      if (!changed) return;

      tx.update(docSnap.ref, {
        currentTurn: game.currentTurn,
        standings: game.standings,
        status: game.status,
        finishedAt: game.finishedAt ?? null,
        expiresAt: game.expiresAt ?? null,
        winnerTeamIds: game.winnerTeamIds ?? null,
        updatedAt: txNow,
      });
    });
  });

  await Promise.all(tasks);
});

export const cleanupFinishedGames = onSchedule({schedule: "every 24 hours", maxInstances: 1}, async () => {
  const now = nowTs();
  const expiredGames = await db.collection("games")
    .where("expiresAt", "<=", now)
    .limit(20)
    .get();

  const finishedDocs = expiredGames.docs.filter((docSnap) => (docSnap.data() as GameDoc).status === "FINISHED");
  await Promise.all(finishedDocs.map((docSnap) => db.recursiveDelete(docSnap.ref)));
});


