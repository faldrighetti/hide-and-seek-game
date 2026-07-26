import {Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db} from "./firebase";
import {
  GameDoc,
  OperationalState,
  TurnState,
  appendGameEventInTx,
  nowTs,
  requireAuthUid,
  requireGameMembership,
  requireHost,
  secondsRemaining,
} from "./game-core";

export const pauseGame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const reason = String(request.data?.reason ?? "").trim() || null;
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    if (game.status !== "LIVE" || !game.currentTurn) {
      throw new HttpsError("failed-precondition", "Solo se puede pausar una partida activa.");
    }
    if (game.operational?.mode === "PAUSED") {
      throw new HttpsError("failed-precondition", "La partida ya esta pausada.");
    }
    if (game.operational?.mode === "EMERGENCY") {
      throw new HttpsError("failed-precondition", "La partida esta en emergencia.");
    }

    const now = nowTs();
    const operational: OperationalState = {
      mode: "PAUSED",
      reason,
      changedByUid: uid,
      changedAt: now,
      pausedAt: now,
      phaseRemainingSeconds: secondsRemaining(game.currentTurn.phaseEndsAt, now),
      pendingQuestionRemainingSeconds: secondsRemaining(game.currentTurn.pendingQuestionEndsAt, now),
      emergency: null,
    };

    tx.update(gameRef, {
      operational,
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "GAME_PAUSED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: null,
      payload: {
        reason,
        phaseRemainingSeconds: operational.phaseRemainingSeconds,
        pendingQuestionRemainingSeconds: operational.pendingQuestionRemainingSeconds,
      },
    });
  });

  return {ok: true};
});

export const resumeGame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    const turn = game.currentTurn;
    if (game.status !== "LIVE" || !turn) {
      throw new HttpsError("failed-precondition", "Solo se puede reanudar una partida activa.");
    }
    if (game.operational?.mode !== "PAUSED" && game.operational?.mode !== "EMERGENCY") {
      throw new HttpsError("failed-precondition", "La partida no esta pausada.");
    }

    const now = nowTs();
    const phaseRemainingSeconds = game.operational.phaseRemainingSeconds ?? secondsRemaining(turn.phaseEndsAt, now) ?? 0;
    const pendingQuestionRemainingSeconds = game.operational.pendingQuestionRemainingSeconds;
    const nextTurn: TurnState = {
      ...turn,
      phaseStartedAt: now,
      phaseEndsAt: Timestamp.fromMillis(now.toMillis() + phaseRemainingSeconds * 1000),
      pendingQuestionEndsAt: pendingQuestionRemainingSeconds === null || pendingQuestionRemainingSeconds === undefined ?
        turn.pendingQuestionEndsAt ?? null :
        Timestamp.fromMillis(now.toMillis() + pendingQuestionRemainingSeconds * 1000),
    };

    tx.update(gameRef, {
      currentTurn: nextTurn,
      operational: {
        mode: "NORMAL",
        reason: null,
        changedByUid: uid,
        changedAt: now,
        pausedAt: null,
        phaseRemainingSeconds: null,
        pendingQuestionRemainingSeconds: null,
        emergency: null,
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, {...game, currentTurn: nextTurn}, {
      type: "GAME_RESUMED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: null,
      payload: {
        previousMode: game.operational.mode,
      },
    });
  });

  return {ok: true};
});

export const declareEmergency = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const reason = String(request.data?.reason ?? "").trim() || null;
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    if (game.status !== "LIVE" || !game.currentTurn) {
      throw new HttpsError("failed-precondition", "Solo se puede declarar emergencia en partida activa.");
    }

    const now = nowTs();
    const operational: OperationalState = {
      mode: "EMERGENCY",
      reason,
      changedByUid: uid,
      changedAt: now,
      pausedAt: now,
      phaseRemainingSeconds: secondsRemaining(game.currentTurn.phaseEndsAt, now),
      pendingQuestionRemainingSeconds: secondsRemaining(game.currentTurn.pendingQuestionEndsAt, now),
      emergency: {
        declaredByUid: uid,
        declaredAt: now,
        reason,
      },
    };

    tx.update(gameRef, {
      operational,
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, game, {
      type: "EMERGENCY_DECLARED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: null,
      payload: {
        reason,
      },
    });
  });

  return {ok: true};
});

export const cancelGame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const reason = String(request.data?.reason ?? "").trim() || null;
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    if (game.status === "FINISHED") {
      throw new HttpsError("failed-precondition", "La partida ya esta cerrada.");
    }

    const now = nowTs();
    const previousTurn = game.currentTurn;
    if (game.currentTurn) {
      game.currentTurn = {
        ...game.currentTurn,
        phase: "ENDED",
        phaseStartedAt: now,
        phaseEndsAt: now,
      };
    }

    tx.update(gameRef, {
      status: "FINISHED",
      finishedAt: now,
      currentTurn: game.currentTurn ?? null,
      operational: {
        mode: "NORMAL",
        reason: null,
        changedByUid: uid,
        changedAt: now,
        canceledAt: now,
        canceledByUid: uid,
        cancellationReason: reason,
      },
      updatedAt: now,
    });
    appendGameEventInTx(tx, gameRef, {...game, currentTurn: previousTurn}, {
      type: "GAME_CANCELED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: null,
      payload: {
        reason,
      },
    });
  });

  return {ok: true};
});

export const reportTemporaryDisconnect = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const reason = String(request.data?.reason ?? "").trim() || null;
  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    const seatSnap = await tx.get(gameRef.collection("seats").where("uid", "==", uid).limit(1));
    if (seatSnap.empty) throw new HttpsError("permission-denied", "No tenes seat en esta partida.");
    const seatDoc = seatSnap.docs[0];
    const seatTeamId = String(seatDoc.data()?.teamId ?? "");
    const now = nowTs();

    tx.update(seatDoc.ref, {
      online: false,
      connectionStatus: "TEMPORARILY_DISCONNECTED",
      disconnectReason: reason,
      disconnectedAt: now,
      updatedAt: now,
    });
    tx.update(gameRef, {updatedAt: now});
    appendGameEventInTx(tx, gameRef, game, {
      type: "PLAYER_TEMPORARILY_DISCONNECTED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId || null,
      payload: {
        reason,
      },
    });
  });

  return {ok: true};
});

export const clearTemporaryDisconnect = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await requireGameMembership(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    const seatSnap = await tx.get(gameRef.collection("seats").where("uid", "==", uid).limit(1));
    if (seatSnap.empty) throw new HttpsError("permission-denied", "No tenes seat en esta partida.");
    const seatDoc = seatSnap.docs[0];
    const seatTeamId = String(seatDoc.data()?.teamId ?? "");
    const now = nowTs();

    tx.update(seatDoc.ref, {
      online: true,
      connectionStatus: "ONLINE",
      disconnectReason: null,
      disconnectedAt: null,
      lastSeenAt: now,
      updatedAt: now,
    });
    tx.update(gameRef, {updatedAt: now});
    appendGameEventInTx(tx, gameRef, game, {
      type: "PLAYER_RECONNECTED",
      createdAt: now,
      actorUid: uid,
      actorTeamId: seatTeamId || null,
    });
  });

  return {ok: true};
});


