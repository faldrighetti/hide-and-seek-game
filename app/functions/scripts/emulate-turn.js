/* eslint-disable no-console */
"use strict";

process.env.GCLOUD_PROJECT ||= "hide-and-seek-game-2026";
process.env.FIREBASE_CONFIG ||= JSON.stringify({projectId: process.env.GCLOUD_PROJECT});

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Falta FIRESTORE_EMULATOR_HOST. Ejemplo: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run emulate:turn");
  process.exit(1);
}

const {getFirestore, Timestamp} = require("firebase-admin/firestore");
const functions = require("../lib/index.js");

const db = getFirestore();

const USERS = {
  host: "emu-host",
  seekerB: "emu-seeker-b",
  seekerC: "emu-seeker-c",
};

const BASE_STATION = {
  id: "subte_a_plaza_de_mayo",
  lat: -34.6088,
  lng: -58.3711,
};

const nowTs = () => Timestamp.now();

const call = async (name, uid, data = {}) => {
  const fn = functions[name];
  if (!fn?.run) throw new Error(`Callable no encontrado: ${name}`);
  console.log(`-> ${name} as ${uid}`);
  return fn.run({
    auth: {uid},
    data,
    rawRequest: {headers: {origin: "http://localhost:8100"}},
  });
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const readGame = async (gameId) => {
  const snap = await db.collection("games").doc(gameId).get();
  assert(snap.exists, `No existe game ${gameId}`);
  return snap.data();
};

const readSeatTeam = async (gameId, uid) => {
  const snap = await db.collection("games").doc(gameId).collection("seats")
    .where("uid", "==", uid)
    .limit(1)
    .get();
  assert(!snap.empty, `No existe seat para ${uid}`);
  return snap.docs[0].data().teamId;
};

const forceTurn = async (gameId, patch) => {
  const gameRef = db.collection("games").doc(gameId);
  const game = (await gameRef.get()).data();
  await gameRef.update({
    currentTurn: {
      ...game.currentTurn,
      ...patch,
    },
    updatedAt: nowTs(),
  });
};

const forceEscapeWithHostAsHider = async (gameId) => {
  const now = nowTs();
  await forceTurn(gameId, {
    hiderTeamId: "A",
    phase: "ESCAPE",
    phaseStartedAt: now,
    phaseEndsAt: Timestamp.fromMillis(now.toMillis() + 60 * 60 * 1000),
  });
};

const forceChase = async (gameId) => {
  const now = nowTs();
  await forceTurn(gameId, {
    phase: "CHASE",
    phaseStartedAt: now,
    chaseStartedAt: now,
    phaseEndsAt: Timestamp.fromMillis(now.toMillis() + 5 * 60 * 60 * 1000),
    pendingQuestionId: null,
    pendingQuestionEndsAt: null,
    endgameActive: false,
    endgameQuestionsUnlocked: false,
    foundVotes: [],
    captureAttempt: null,
  });
};

const main = async () => {
  console.log(`Firestore emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);

  const created = await call("createGame", USERS.host, {
    gameName: "Emulación técnica",
    mode: "INDIVIDUAL_3",
    turnsPerTeam: 1,
    winCondition: "TOTAL_TIME",
    displayName: "Host Hider",
  });
  const gameId = created.gameId;
  console.log(`Game creado: ${gameId}`);

  await call("joinGame", USERS.seekerB, {gameId, displayName: "Seeker B"});
  await call("joinGame", USERS.seekerC, {gameId, displayName: "Seeker C"});
  await call("startGame", USERS.host, {gameId});

  assert(await readSeatTeam(gameId, USERS.host) === "A", "Host debería quedar en Team A.");
  assert(await readSeatTeam(gameId, USERS.seekerB) === "B", "Seeker B debería quedar en Team B.");
  assert(await readSeatTeam(gameId, USERS.seekerC) === "C", "Seeker C debería quedar en Team C.");

  await forceEscapeWithHostAsHider(gameId);
  await call("publishHiderPrivateLocation", USERS.host, {
    gameId,
    lat: BASE_STATION.lat,
    lng: BASE_STATION.lng,
    accuracyM: 20,
  });
  await call("confirmBaseStation", USERS.host, {gameId, stationId: BASE_STATION.id});
  let game = await readGame(gameId);
  assert(game.currentTurn.hidingZone?.stationId === BASE_STATION.id, "La estación base no quedó confirmada.");

  await forceChase(gameId);
  await call("sendQuestion", USERS.seekerB, {
    gameId,
    categoryId: "matching",
    prompt: "¿Estás al norte de Avenida de Mayo?",
    isPhoto: false,
  });
  game = await readGame(gameId);
  assert(game.currentTurn.pendingQuestionId, "No quedó pregunta pendiente.");

  await call("resolveQuestion", USERS.host, {gameId, resolution: "ANSWER"});
  game = await readGame(gameId);
  assert(game.currentTurn.lootOffer, "No se generó lootOffer.");

  await call("selectLoot", USERS.host, {
    gameId,
    selectedCardIds: [],
    discardFromHandIds: [],
  });
  game = await readGame(gameId);
  assert(!game.currentTurn.lootOffer, "El loot debería quedar resuelto.");

  await call("publishSeekerLocation", USERS.seekerB, {
    gameId,
    lat: BASE_STATION.lat,
    lng: BASE_STATION.lng,
    isOnPublicTransport: false,
  });
  await call("publishSeekerLocation", USERS.seekerC, {
    gameId,
    lat: BASE_STATION.lat,
    lng: BASE_STATION.lng,
    isOnPublicTransport: false,
  });
  game = await readGame(gameId);
  assert(game.currentTurn.endgameActive === true, "Endgame debería quedar activo.");

  await call("startCaptureAttempt", USERS.seekerB, {gameId});
  game = await readGame(gameId);
  assert(game.currentTurn.captureAttempt?.status === "PENDING_HIDER", "Captura debería quedar pendiente del hider.");

  await call("resolveCaptureAttempt", USERS.host, {gameId, confirmed: false});
  game = await readGame(gameId);
  assert(game.currentTurn.captureAttempt?.status === "REJECTED", "Captura debería quedar rechazada.");

  await call("confirmCaptureBySeeker", USERS.seekerC, {gameId});
  game = await readGame(gameId);
  assert(game.currentTurn.phase === "INTERMISSION" || game.currentTurn.phase === "ENDED", "La ratificación debería cerrar el turno.");

  const events = await db.collection("games").doc(gameId).collection("events").get();
  const notifications = await db.collection("games").doc(gameId).collection("notifications").get();
  assert(events.size > 0, "No se escribieron eventos.");
  assert(notifications.size > 0, "No se escribieron notificaciones.");

  console.log("OK emulación técnica completa.");
  console.log(`gameId=${gameId}, events=${events.size}, notifications=${notifications.size}, finalPhase=${game.currentTurn.phase}`);
};

main().catch((error) => {
  console.error("Falló la emulación técnica:");
  console.error(error);
  process.exit(1);
});
