import {Filter, Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {db} from "./firebase";
import {evaluatePlayableArea} from "./playable-area";
import {
  ActiveEffect,
  CaptureAttempt,
  DECK_MAX_SIZE,
  DEFAULT_SETTINGS,
  ENDGAME_QUESTIONS_CONSULT_COOLDOWN_SECONDS,
  GameDoc,
  GameMode,
  GameSettings,
  HIDING_ZONE_RADIUS_M,
  OutOfAreaState,
  QUESTION_DRAW_RULES,
  SEAT_OFFLINE_SECONDS,
  TeamStanding,
  TurnState,
  WinCondition,
  alertOutOfAreaIfExpired,
  appendGameEventInTx,
  assertOperationalPlayAllowed,
  assertValidCoordinate,
  buildHidingZoneForStation,
  createInitialDeckState,
  createOutOfAreaState,
  distanceMeters,
  drawFromDeck,
  endTurnInTx,
  getMaxGeofenceAccuracyM,
  getNextHiderTeamId,
  getOutOfAreaConfirmationSeconds,
  getOutOfAreaSustainedSeconds,
  hasDuplicates,
  isFoundMajorityReached,
  isFreshLocation,
  isOperationallyStopped,
  modeMaxSeats,
  modeTeamIds,
  nowTs,
  pickInitialHider,
  randomCode,
  readLocationPoint,
  refreshEndgameStateInTx,
  requireAuthUid,
  requireCurrentHiderInTx,
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

export const setTurnHidingZone = onCall(async (request) => {
  throw new HttpsError("failed-precondition", "Usar confirmBaseStation.");
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const stationId = String(request.data?.stationId ?? "").trim();
  const lat = Number(request.data?.lat);
  const lng = Number(request.data?.lng);
  const radiusM = Number(request.data?.radiusM ?? HIDING_ZONE_RADIUS_M);

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  assertValidCoordinate(lat, lng);
  if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > 5000) {
    throw new HttpsError("invalid-argument", "radiusM inválido.");
  }
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn) {
      throw new HttpsError("failed-precondition", "La partida no está en juego activo.");
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
        outOfArea: null,
        foundVotes: [],
      captureAttempt: null,
      },
      updatedAt: now,
    });
  });

  return {ok: true};
});

export const confirmBaseStation = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
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
    if (turn.phase !== "ESCAPE" && !(turn.phase === "CHASE" && turn.baseStationSelectionRequired)) {
      throw new HttpsError("failed-precondition", "La estacion base solo se confirma durante ESCAPE o si quedo pendiente.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (seatTeamId !== turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "Solo el hider puede confirmar estacion base.");
    }

    const radiusM = game.settings.zoneRadiusM;
    const hidingZone = buildHidingZoneForStation(stationId, radiusM);

    if (turn.phase === "CHASE" && turn.baseStationSelectionRequired) {
      const allowedCandidateIds = turn.baseStationCandidateIds ?? [];
      if (allowedCandidateIds.length > 0 && !allowedCandidateIds.includes(stationId)) {
        throw new HttpsError("failed-precondition", "Esa estacion no esta entre las opciones detectadas al final del escape.");
      }
    } else {
      const privateLocation = (await tx.get(gameRef.collection("privateLocations").doc(uid))).data();
      const point = readLocationPoint(privateLocation);
      const updatedAt = privateLocation?.updatedAt as Timestamp | undefined;
      const geofenceReliable = privateLocation?.geofenceReliable !== false;
      if (!point || !updatedAt || !isFreshLocation(updatedAt, nowTs()) || !geofenceReliable) {
        throw new HttpsError("failed-precondition", "Necesitas una ubicacion reciente y confiable para confirmar estacion base.");
      }

      if (distanceMeters(point, hidingZone.center) > radiusM) {
        throw new HttpsError("failed-precondition", "Todavia no estas dentro de la zona de esa estacion.");
      }
    }

    const now = nowTs();
    tx.update(gameRef, {
      currentTurn: {
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
        outOfArea: null,
        foundVotes: [],
      captureAttempt: null,
      },
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
        selectionWasPending: turn.baseStationSelectionRequired ?? false,
      },
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
      throw new HttpsError("failed-precondition", "La partida no está en juego activo.");
    }

    const seatTeamId = await resolveSeatTeamId(tx, gameRef, uid);
    if (!seatTeamId) throw new HttpsError("permission-denied", "No tenés seat en esta partida.");
    if (seatTeamId === turn.hiderTeamId) {
      throw new HttpsError("permission-denied", "El hider no publica ubicación exacta.");
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
      appendGameEventInTx(tx, gameRef, game, {
        type: game.currentTurn?.endgameActive ? "ENDGAME_ACTIVATED" : "ENDGAME_DEACTIVATED",
        createdAt: now,
        actorUid: uid,
        actorTeamId: seatTeamId,
        payload: {
          source: "seeker_location",
        },
      });
    }
  });

  return {ok: true};
});

export const publishHiderPrivateLocation = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const lat = Number(request.data?.lat);
  const lng = Number(request.data?.lng);
  const accuracyM = Number(request.data?.accuracyM);

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  assertValidCoordinate(lat, lng);
  if (!Number.isFinite(accuracyM) || accuracyM < 0) {
    throw new HttpsError("invalid-argument", "accuracyM inválida.");
  }
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  let response: {
    ok: boolean;
    isInsidePlayableArea: boolean | null;
    geofenceReliable: boolean;
    outOfAreaStatus: OutOfAreaState["status"] | null;
  } = {
    ok: true,
    isInsidePlayableArea: null,
    geofenceReliable: false,
    outOfAreaStatus: null,
  };

  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = await requireCurrentHiderInTx(tx, gameRef, game, uid);
    if (turn.phase !== "ESCAPE" && turn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "La ubicación privada del hider solo aplica en ESCAPE o CHASE.");
    }

    const now = nowTs();
    const privateLocationRef = gameRef.collection("privateLocations").doc(uid);
    const privateLocationSnap = await tx.get(privateLocationRef);
    const previousOutsideSinceAt = privateLocationSnap.data()?.outsideSinceAt as Timestamp | undefined;
    const geofenceReliable = accuracyM <= getMaxGeofenceAccuracyM(game.settings);
    let isInsidePlayableArea: boolean | null = null;
    let outsideSinceAt: Timestamp | null = previousOutsideSinceAt ?? null;
    let nextTurn: TurnState | null = null;

    if (geofenceReliable) {
      const evaluation = evaluatePlayableArea({lat, lng});
      isInsidePlayableArea = evaluation.isInsidePlayableArea;

      if (isInsidePlayableArea) {
        outsideSinceAt = null;
        if (turn.outOfArea) {
          nextTurn = {
            ...turn,
            outOfArea: null,
          };
        }
      } else {
        outsideSinceAt ??= now;
        const sustainedMillis = getOutOfAreaSustainedSeconds(game.settings) * 1000;
        const hasSustainedExit = now.toMillis() - outsideSinceAt.toMillis() >= sustainedMillis;
        if (hasSustainedExit) {
          nextTurn = {
            ...turn,
            outOfArea: turn.outOfArea ?? createOutOfAreaState(uid, game.settings, now),
          };
          alertOutOfAreaIfExpired(nextTurn, now);
        } else if (turn.outOfArea?.status === "SUSPECTED") {
          nextTurn = {...turn};
          alertOutOfAreaIfExpired(nextTurn, now);
        }
      }
    }

    tx.set(privateLocationRef, {
      uid,
      teamId: turn.hiderTeamId,
      lat,
      lng,
      accuracyM,
      updatedAt: now,
      geofenceReliable,
      isInsidePlayableArea,
      outsideSinceAt,
    }, {merge: true});

    if (nextTurn) {
      const previousStatus = turn.outOfArea?.status ?? null;
      const nextStatus = nextTurn.outOfArea?.status ?? null;
      tx.update(gameRef, {
        currentTurn: nextTurn,
        updatedAt: now,
      });
      response.outOfAreaStatus = nextTurn.outOfArea?.status ?? null;
      if (previousStatus !== nextStatus) {
        appendGameEventInTx(tx, gameRef, {...game, currentTurn: nextTurn}, {
          type: nextStatus ? `OUT_OF_AREA_${nextStatus}` : "OUT_OF_AREA_CLEARED_BY_LOCATION",
          createdAt: now,
          actorUid: uid,
          actorTeamId: turn.hiderTeamId,
          payload: {
            geofenceReliable,
            isInsidePlayableArea,
          },
        });
      }
    } else {
      response.outOfAreaStatus = turn.outOfArea?.status ?? null;
    }
    response = {
      ok: true,
      isInsidePlayableArea,
      geofenceReliable,
      outOfAreaStatus: response.outOfAreaStatus,
    };
  });

  return response;
});

export const reportHiderOutOfArea = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  let status: OutOfAreaState["status"] = "SUSPECTED";
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = await requireCurrentHiderInTx(tx, gameRef, game, uid);
    if (turn.phase !== "ESCAPE" && turn.phase !== "CHASE") {
      throw new HttpsError("failed-precondition", "La salida de área del hider solo se gestiona en ESCAPE o CHASE.");
    }

    const now = nowTs();
    const activeState = turn.outOfArea?.status === "SUSPECTED" || turn.outOfArea?.status === "ALERTED" ?
      turn.outOfArea :
      createOutOfAreaState(uid, game.settings, now);

    const nextTurn: TurnState = {
      ...turn,
      outOfArea: activeState,
    };
    alertOutOfAreaIfExpired(nextTurn, now);
    status = nextTurn.outOfArea?.status ?? "SUSPECTED";

    tx.update(gameRef, {
      currentTurn: nextTurn,
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, {...game, currentTurn: nextTurn}, {
      type: "OUT_OF_AREA_REPORTED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: turn.hiderTeamId,
      payload: {
        status,
      },
    });
  });

  return {ok: true, status};
});

export const confirmHiderOutOfAreaSafety = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  let status: OutOfAreaState["status"] = "SUSPECTED";
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = await requireCurrentHiderInTx(tx, gameRef, game, uid);
    const outOfArea = turn.outOfArea;
    if (!outOfArea) {
      throw new HttpsError("failed-precondition", "No hay una salida de área pendiente.");
    }
    if (outOfArea.status === "ALERTED") {
      status = "ALERTED";
      return;
    }

    const now = nowTs();
    const nextTurn: TurnState = {...turn};
    if (alertOutOfAreaIfExpired(nextTurn, now)) {
      status = "ALERTED";
    } else {
      const nextConfirmationMillis = Math.min(
        now.toMillis() + getOutOfAreaConfirmationSeconds(game.settings) * 1000,
        outOfArea.maxExpiresAt.toMillis(),
      );
      nextTurn.outOfArea = {
        ...outOfArea,
        lastConfirmedAt: now,
        confirmationExpiresAt: Timestamp.fromMillis(nextConfirmationMillis),
      };
      status = "SUSPECTED";
    }

    tx.update(gameRef, {
      currentTurn: nextTurn,
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, {...game, currentTurn: nextTurn}, {
      type: status === "ALERTED" ? "OUT_OF_AREA_ALERTED" : "OUT_OF_AREA_SAFETY_CONFIRMED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: turn.hiderTeamId,
      payload: {
        status,
        confirmationExpiresAt: nextTurn.outOfArea?.confirmationExpiresAt ?? null,
      },
    });
  });

  return {ok: true, status};
});

export const clearHiderOutOfArea = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const gameSnap = await tx.get(gameRef);
    if (!gameSnap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = gameSnap.data() as GameDoc;
    const turn = await requireCurrentHiderInTx(tx, gameRef, game, uid);
    const now = nowTs();

    tx.update(gameRef, {
      currentTurn: {
        ...turn,
        outOfArea: null,
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "OUT_OF_AREA_CLEARED_MANUALLY",
      createdAt: now,
      actorUid: uid,
      actorTeamId: turn.hiderTeamId,
    });
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

    await refreshEndgameStateInTx(tx, gameRef, game, now);
    tx.update(gameRef, {
      currentTurn: {
        ...game.currentTurn!,
        lastEndgameVerificationAt: now,
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: game.currentTurn?.endgameActive ? "ENDGAME_VERIFIED_ACTIVE" : "ENDGAME_VERIFIED_INACTIVE",
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
    assertOperationalPlayAllowed(game);
    if (!turn.hidingZone) {
      throw new HttpsError("failed-precondition", "La zona del hider todavía no está fijada.");
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
    appendGameEventInTx(tx, gameRef, game, {
      type: "ENDGAME_QUESTIONS_CONSULTED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId,
      payload: {
        unlocked,
        cooldownActive,
      },
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
  const distanceMRaw = request.data?.distanceM;
  const distanceM = distanceMRaw === undefined || distanceMRaw === null ?
    null :
    Number(distanceMRaw);
  const customDistanceMRaw = request.data?.customDistanceM;
  const customDistanceM = customDistanceMRaw === undefined || customDistanceMRaw === null ?
    null :
    Number(customDistanceMRaw);

  if (!gameId || !prompt || !categoryId) {
    throw new HttpsError("invalid-argument", "gameId, prompt y categoryId son obligatorios.");
  }
  if (distanceM !== null && (!Number.isFinite(distanceM) || distanceM <= 0 || distanceM > 10000)) {
    throw new HttpsError("invalid-argument", "distanceM invalida.");
  }
  if (categoryId === "thermometer" && ![100, 200, 500, 1000, 2000].includes(distanceM ?? -1)) {
    throw new HttpsError("invalid-argument", "distanceM invalida para termometro.");
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
    if (game.currentTurn.lootOffer) {
      throw new HttpsError("failed-precondition", "Hay loot pendiente de resolver.");
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

    const timeoutSeconds = isPhoto ? 600 : 300;
    const questionRef = gameRef.collection("questions").doc();
    tx.set(questionRef, {
      askedByUid: uid,
      prompt,
      isPhoto,
      categoryId,
      distanceM,
      customDistanceM,
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

    const drawn = turn.lootOffer.drawnCardIds;
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
    const now = nowTs();

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

export const startCaptureAttempt = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
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
  listGameEvents,
  listGameNotifications,
  getNotificationPreferences,
  updateNotificationPreferences,
  finishGame,
} from "./query-callables";

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
    appendGameEventInTx(tx, gameRef, game, {
      type: game.currentTurn?.endgameActive ? "ENDGAME_ACTIVATED" : "ENDGAME_DEACTIVATED",
      createdAt: txNow,
      actorUid: null,
      actorTeamId: null,
      payload: {
        source: "location_trigger",
      },
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
      Filter.where("currentTurn.outOfArea.confirmationExpiresAt", "<=", now),
      Filter.where("currentTurn.outOfArea.maxExpiresAt", "<=", now),
    ))
    .get();

  const tasks = gamesSnap.docs.map(async (docSnap) => {
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(docSnap.ref);
      if (!fresh.exists) return;
      const game = fresh.data() as GameDoc;
      let turn = game.currentTurn;
      if (!turn || game.status !== "LIVE") return;
      if (isOperationallyStopped(game)) return;

      const txNow = nowTs();
      let changed = false;

      if (turn.endgameActive) {
        const endgameChanged = await refreshEndgameStateInTx(tx, docSnap.ref, game, txNow);
        changed = endgameChanged || changed;
        turn = game.currentTurn;
        if (!turn) return;
        if (endgameChanged) {
          appendGameEventInTx(tx, docSnap.ref, game, {
            type: turn.endgameActive ? "ENDGAME_ACTIVATED" : "ENDGAME_DEACTIVATED",
            createdAt: txNow,
            actorUid: null,
            actorTeamId: null,
            payload: {
              source: "scheduled_tick",
            },
          });
        }
      }

      if (turn.outOfArea?.status === "SUSPECTED") {
        changed = alertOutOfAreaIfExpired(turn, txNow) || changed;
      }

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
        winnerTeamIds: game.winnerTeamIds ?? null,
        updatedAt: txNow,
      });
    });
  });

  await Promise.all(tasks);
});

