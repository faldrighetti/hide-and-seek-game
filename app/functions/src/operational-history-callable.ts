import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db} from "./firebase";
import {
  assertUserRateLimit,
  requireAuthUid,
  requireGameMembership,
  serializeEventValue,
} from "./game-core";

const safePayload = (type: string, value: unknown): Record<string, unknown> => {
  const payload = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (type === "QUESTION_SENT") {
    return {
      questionId: payload.questionId ?? null,
      categoryId: payload.categoryId ?? null,
      prompt: payload.prompt ?? "",
      isPhoto: payload.isPhoto ?? false,
    };
  }
  if (type === "QUESTION_RESOLVED") {
    return {
      questionId: payload.questionId ?? null,
      categoryId: payload.categoryId ?? null,
      resolution: payload.resolution ?? null,
    };
  }
  if (type === "PHASE_ADVANCED") {
    return {
      fromPhase: payload.fromPhase ?? null,
      toPhase: payload.toPhase ?? null,
    };
  }
  return {};
};

export const listOperationalHistory = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  const limitRaw = Number(request.data?.limit ?? 200);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, Math.floor(limitRaw))) : 200;

  if (!gameId) throw new HttpsError("invalid-argument", "gameId es obligatorio.");
  await assertUserRateLimit(db, uid, "list_operational_history", 5);
  await requireGameMembership(db, gameId, uid);

  const eventsSnap = await db.collection("games").doc(gameId).collection("events")
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return {
    ok: true,
    events: eventsSnap.docs.map((eventDoc) => {
      const event = eventDoc.data();
      const type = String(event.type ?? "");
      return {
        id: eventDoc.id,
        type,
        createdAt: serializeEventValue(event.createdAt),
        actorUid: null,
        actorTeamId: event.actorTeamId ?? null,
        runNumber: event.runNumber ?? null,
        phase: event.phase ?? null,
        hiderTeamId: null,
        payload: serializeEventValue(safePayload(type, event.payload)),
      };
    }),
  };
});
