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
    if (game.status !== "LOBBY" && game.status !== "LIVE") return [];
    const seat = memberships[index].seat;
    const teamId = String(seat.teamId ?? "") || null;
    const hiderTeamId = String(game.currentTurn?.hiderTeamId ?? "") || null;
    const isHost = game.hostUid === uid || Boolean(seat.isHost);
    const updatedAtMillis = game.updatedAt?.toMillis?.() ?? 0;
    const role = game.status === "LOBBY" ? (isHost ? "HOST" : "PLAYER") :
      teamId && teamId === hiderTeamId ? "HIDER" : "SEEKER";

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

  return {ok: true, activeGame: candidates[0]?.summary ?? null};
});
