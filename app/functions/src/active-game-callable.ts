import {onCall} from "firebase-functions/v2/https";
import {db} from "./firebase";
import {
  GameDoc,
  assertUserRateLimit,
  requireAuthUid,
} from "./game-core";

export const getMyActiveGame = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  await assertUserRateLimit(db, uid, "get_my_active_game", 1);
  const nowMillis = Date.now();
  const scheduledTickGraceMillis = 10 * 60 * 1000;

  const seatsSnap = await db.collectionGroup("seats")
    .where("uid", "==", uid)
    .limit(20)
    .get();

  const memberships = seatsSnap.docs
    .map((seatDoc) => ({seat: seatDoc.data(), gameRef: seatDoc.ref.parent.parent}))
    .filter((membership): membership is {seat: FirebaseFirestore.DocumentData; gameRef: FirebaseFirestore.DocumentReference} =>
      membership.gameRef !== null,
    );

  const gameSnaps = memberships.length > 0
    ? await db.getAll(...memberships.map((membership) => membership.gameRef))
    : [];

  const candidates = gameSnaps.flatMap((gameSnap, index) => {
    if (!gameSnap.exists) return [];
    const game = gameSnap.data() as GameDoc;
    if (game.status !== "LIVE" || !game.currentTurn) return [];
    const isPaused = game.operational?.mode === "PAUSED" || game.operational?.mode === "EMERGENCY";
    const phaseIsStillCurrent = game.currentTurn.phaseEndsAt.toMillis() >= nowMillis - scheduledTickGraceMillis;
    if (!isPaused && !phaseIsStillCurrent) return [];
    const seat = memberships[index].seat;
    const teamId = String(seat.teamId ?? "") || null;
    const hiderTeamId = String(game.currentTurn?.hiderTeamId ?? "") || null;
    const isHost = game.hostUid === uid || Boolean(seat.isHost);
    const updatedAtMillis = game.updatedAt?.toMillis?.() ?? 0;
    const role = teamId && teamId === hiderTeamId ? "HIDER" : "SEEKER";

    return [{
      updatedAtMillis,
      summary: {
        gameId: gameSnap.id,
        gameName: String(game.gameName ?? "Hide & Seek"),
        status: game.status,
        mode: game.mode,
        phase: game.currentTurn?.phase ?? null,
        teamId,
        role,
        isHost,
      },
    }];
  });

  candidates.sort((left, right) => {
    const statusDifference = Number(right.summary.status === "LIVE") - Number(left.summary.status === "LIVE");
    return statusDifference || right.updatedAtMillis - left.updatedAtMillis;
  });

  const selected = candidates[0]?.summary;
  if (!selected) return {ok: true, activeGame: null};

  const selectedGame = gameSnaps.find((snapshot) => snapshot.id === selected.gameId)?.data() as GameDoc;
  const hostSeat = await db.collection("games").doc(selected.gameId)
    .collection("seats").doc(selectedGame.hostUid).get();
  const hostFirstName = String(hostSeat.data()?.displayName ?? "").trim().split(/\s+/)[0] || "Sin nombre";

  return {ok: true, activeGame: {...selected, hostFirstName}};
});
