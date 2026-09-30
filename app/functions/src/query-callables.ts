import {Timestamp} from "firebase-admin/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db} from "./firebase";
import {sanitizeNotificationCategoryPreferences} from "./notifications";
import {
  GameDoc,
  FINISHED_GAME_RETENTION_SECONDS,
  assertUserRateLimit,
  findWinnerIds,
  nowTs,
  requireAuthUid,
  requireGameMembership,
  requireHost,
  serializeEventValue,
} from "./game-core";
const serializedTimestampIso = (value: unknown): string | null => {
  const serialized = serializeEventValue(value);
  return serialized && typeof serialized === "object" && "iso" in serialized
    ? String((serialized as {iso?: unknown}).iso ?? "") || null
    : null;
};

export const scoring = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  await assertUserRateLimit(db, uid, "scoring", 5);
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

export const listQuestionHistory = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const limitRaw = Number(request.data?.limit ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 100;

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await assertUserRateLimit(db, uid, "list_question_history", 5);
  await requireGameMembership(db, gameId, uid);

  const questionsSnap = await db.collection("games").doc(gameId).collection("questions")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return {
    ok: true,
    questions: questionsSnap.docs.map((questionDoc) => {
      const question = questionDoc.data();
      const resolution = String(question.resolution ?? "");
      return {
        id: questionDoc.id,
        categoryId: String(question.categoryId ?? ""),
        prompt: String(question.prompt ?? ""),
        isPhoto: Boolean(question.isPhoto),
        distanceM: typeof question.distanceM === "number" ? question.distanceM : null,
        customDistanceM: typeof question.customDistanceM === "number" ? question.customDistanceM : null,
        status: String(question.status ?? "PENDING"),
        resolution: resolution || null,
        answerText: typeof question.answerText === "string" ? question.answerText : null,
        runNumber: typeof question.runNumber === "number" ? question.runNumber : null,
        createdAtIso: serializedTimestampIso(question.createdAt),
        resolvedAtIso: serializedTimestampIso(question.resolvedAt),
        expiresAtIso: serializedTimestampIso(question.expiresAt),
      };
    }),
  };
});
export const listGameEvents = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const limitRaw = Number(request.data?.limit ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 100;

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await assertUserRateLimit(db, uid, "list_game_events", 5);
  await requireGameMembership(db, gameId, uid);

  const eventsSnap = await db.collection("games").doc(gameId).collection("events")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  const safeQuestionEvents = eventsSnap.docs.filter((eventDoc) => {
    const type = String(eventDoc.data().type ?? "");
    return type === "QUESTION_SENT" || type === "QUESTION_RESOLVED";
  });

  return {
    ok: true,
    events: safeQuestionEvents.map((eventDoc) => {
      const event = eventDoc.data();
      const type = String(event.type ?? "");
      const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
      return {
        id: eventDoc.id,
        type,
        createdAt: serializeEventValue(event.createdAt),
        actorUid: event.actorUid ?? null,
        actorTeamId: event.actorTeamId ?? null,
        runNumber: event.runNumber ?? null,
        phase: event.phase ?? null,
        hiderTeamId: null,
        payload: serializeEventValue(type === "QUESTION_SENT" ? {
          questionId: payload.questionId ?? null,
          categoryId: payload.categoryId ?? null,
          isPhoto: payload.isPhoto ?? false,
          prompt: payload.prompt ?? "",
          distanceM: payload.distanceM ?? null,
          customDistanceM: payload.customDistanceM ?? null,
          expiresAt: payload.expiresAt ?? null,
        } : {
          questionId: payload.questionId ?? null,
          categoryId: payload.categoryId ?? null,
          resolution: payload.resolution ?? null,
        }),
      };
    }),
  };
});

export const listGameNotifications = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const limitRaw = Number(request.data?.limit ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.floor(limitRaw))) : 100;
  const importance = String(request.data?.importance ?? "").trim().toUpperCase();
  const category = String(request.data?.category ?? "").trim();

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await assertUserRateLimit(db, uid, "list_game_notifications", 5);
  await requireGameMembership(db, gameId, uid);

  const query = db.collection("games").doc(gameId).collection("notifications")
    .orderBy("createdAt", "desc")
    .limit(limit);

  const notificationsSnap = await query.get();
  const notifications = notificationsSnap.docs.filter((notificationDoc) => {
    const notification = notificationDoc.data();
    if (importance && notification.importance !== importance) return false;
    if (category && notification.category !== category) return false;
    return true;
  });
  return {
    ok: true,
    notifications: notifications.map((notificationDoc) => {
      const notification = notificationDoc.data();
      return {
        id: notificationDoc.id,
        eventId: String(notification.eventId ?? ""),
        eventType: String(notification.eventType ?? ""),
        createdAt: serializeEventValue(notification.createdAt),
        actorUid: notification.actorUid ?? null,
        actorTeamId: notification.actorTeamId ?? null,
        runNumber: notification.runNumber ?? null,
        phase: notification.phase ?? null,
        hiderTeamId: notification.hiderTeamId ?? null,
        importance: notification.importance ?? "LOW",
        audience: notification.audience ?? "ALL",
        recipientTeamIds: Array.isArray(notification.recipientTeamIds) ? notification.recipientTeamIds : [],
        requiresAction: Boolean(notification.requiresAction),
        category: String(notification.category ?? ""),
        title: String(notification.title ?? ""),
        body: String(notification.body ?? ""),
        deliveryStatus: String(notification.deliveryStatus ?? "PENDING"),
        payload: serializeEventValue(notification.payload ?? {}),
      };
    }),
  };
});

export const getNotificationPreferences = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertUserRateLimit(db, uid, "get_notification_preferences", 10);
  const preferencesSnap = await db.collection("users").doc(uid)
    .collection("notificationPreferences")
    .doc("default")
    .get();

  const preferences = preferencesSnap.data() ?? {};
  return {
    ok: true,
    criticalAlwaysEnabled: true,
    medium: sanitizeNotificationCategoryPreferences(preferences.medium),
    low: sanitizeNotificationCategoryPreferences(preferences.low),
  };
});

export const updateNotificationPreferences = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const medium = sanitizeNotificationCategoryPreferences(request.data?.medium);
  const low = sanitizeNotificationCategoryPreferences(request.data?.low);
  await assertUserRateLimit(db, uid, "update_notification_preferences", 10);
  const now = nowTs();

  await db.collection("users").doc(uid)
    .collection("notificationPreferences")
    .doc("default")
    .set({
      criticalAlwaysEnabled: true,
      medium,
      low,
      updatedAt: now,
    }, {merge: true});

  return {
    ok: true,
    criticalAlwaysEnabled: true,
    medium,
    low,
  };
});

export const finishGame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  await assertUserRateLimit(db, uid, "finish_game", 10);
  await requireHost(db, gameId, uid);

  const gameRef = db.collection("games").doc(gameId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpsError("not-found", "Partida no encontrada.");
    const game = snap.data() as GameDoc;
    game.status = "FINISHED";
    game.finishedAt = nowTs();
    game.expiresAt = Timestamp.fromMillis(game.finishedAt.toMillis() + FINISHED_GAME_RETENTION_SECONDS * 1000);
    game.winnerTeamIds = findWinnerIds(game);
    if (game.currentTurn) {
      game.currentTurn.phase = "ENDED";
      game.currentTurn.phaseStartedAt = game.finishedAt;
      game.currentTurn.phaseEndsAt = game.finishedAt;
    }

    tx.update(gameRef, {
      status: game.status,
      finishedAt: game.finishedAt,
      expiresAt: game.expiresAt,
      winnerTeamIds: game.winnerTeamIds,
      currentTurn: game.currentTurn ?? null,
      updatedAt: nowTs(),
    });
  });

  return {ok: true};
});




