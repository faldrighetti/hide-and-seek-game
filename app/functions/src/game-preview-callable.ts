import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db} from "./firebase";
import {GameDoc, modeMaxSeats} from "./game-core";

export const previewGame = onCall(async (request) => {
  const gameId = String(request.data?.gameId ?? "").trim().toUpperCase();
  if (!gameId) throw new HttpsError("invalid-argument", "Ingresá un código de partida.");

  const gameRef = db.collection("games").doc(gameId);
  const [gameSnap, seatsSnap] = await Promise.all([gameRef.get(), gameRef.collection("seats").get()]);
  if (!gameSnap.exists) throw new HttpsError("not-found", "No encontramos una partida con ese código.");

  const game = gameSnap.data() as GameDoc;
  const uid = request.auth?.uid;
  const alreadyMember = Boolean(uid && seatsSnap.docs.some((seat) => seat.id === uid || seat.data().uid === uid));
  return {
    ok: true,
    preview: {
      gameId,
      gameName: String(game.gameName ?? "Hide & Seek"),
      mode: game.mode,
      status: game.status,
      currentSeats: seatsSnap.size,
      maxSeats: modeMaxSeats(game.mode),
      alreadyMember,
    },
  };
});
