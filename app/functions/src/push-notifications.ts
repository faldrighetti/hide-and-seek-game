import {FieldValue} from "firebase-admin/firestore";
import {getMessaging} from "firebase-admin/messaging";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db} from "./firebase";
import {assertUserRateLimit, nowTs, requireAuthUid} from "./game-core";
import {sanitizeNotificationCategoryPreferences} from "./notifications";

const tokenDocumentId = (token: string): string => Buffer.from(token).toString("base64url");

const validateToken = (value: unknown): string => {
  const token = typeof value === "string" ? value.trim() : "";
  if (token.length < 20 || token.length > 4096) throw new HttpsError("invalid-argument", "Token de notificación inválido.");
  return token;
};

export const registerPushToken = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const token = validateToken(request.data?.token);
  await assertUserRateLimit(db, uid, "register_push_token", 10);
  const now = nowTs();
  await db.collection("users").doc(uid).collection("pushTokens").doc(tokenDocumentId(token)).set({token, createdAt: now, updatedAt: now}, {merge: true});
  return {ok: true};
});

export const unregisterPushToken = onCall(async (request) => {
  const uid = requireAuthUid(request.auth?.uid);
  const token = validateToken(request.data?.token);
  await assertUserRateLimit(db, uid, "unregister_push_token", 10);
  await db.collection("users").doc(uid).collection("pushTokens").doc(tokenDocumentId(token)).delete();
  return {ok: true};
});

export const deliverGameNotification = onDocumentCreated("games/{gameId}/notifications/{notificationId}", async (event) => {
  const notificationRef = event.data?.ref;
  const notification = event.data?.data();
  if (!notificationRef || !notification) return;
  const gameId = event.params.gameId;
  const recipientTeamIds = Array.isArray(notification.recipientTeamIds) ? notification.recipientTeamIds : [];
  const seats = await db.collection("games").doc(gameId).collection("seats").get();
  const recipientUids = seats.docs.filter((seat) => recipientTeamIds.includes(String(seat.data().teamId ?? ""))).map((seat) => seat.id);
  const tokens: Array<{uid: string; tokenId: string; token: string}> = [];

  await Promise.all(recipientUids.map(async (uid) => {
    const [preferencesSnap, tokensSnap] = await Promise.all([
      db.collection("users").doc(uid).collection("notificationPreferences").doc("default").get(),
      db.collection("users").doc(uid).collection("pushTokens").get(),
    ]);
    const preferences = preferencesSnap.data() ?? {};
    const importance = String(notification.importance ?? "LOW");
    const category = String(notification.category ?? "");
    const choices = importance === "MEDIUM" ? sanitizeNotificationCategoryPreferences(preferences.medium) : sanitizeNotificationCategoryPreferences(preferences.low);
    if (importance !== "CRITICAL" && choices[category] === false) return;
    tokensSnap.docs.forEach((tokenDoc) => tokens.push({uid, tokenId: tokenDoc.id, token: String(tokenDoc.data().token ?? "")}));
  }));

  if (!tokens.length) {
    console.info("Push omitted: no registered recipient tokens", {gameId, notificationId: event.params.notificationId});
    await notificationRef.set({deliveryStatus: "NO_RECIPIENT_TOKENS", deliveredAt: nowTs()}, {merge: true});
    return;
  }
  const response = await getMessaging().sendEachForMulticast({
    tokens: tokens.map(({token}) => token),
    notification: {title: String(notification.title ?? "Escondidas en la ciudad"), body: String(notification.body ?? "")},
    data: {gameId, notificationId: event.params.notificationId},
    webpush: {notification: {icon: "/assets/icon/favicon.png", badge: "/assets/icon/favicon.png"}},
  });
  const staleTokenDeletes = response.responses.flatMap((result, index) => {
    const code = result.error?.code;
    return code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token"
      ? [db.collection("users").doc(tokens[index].uid).collection("pushTokens").doc(tokens[index].tokenId).delete()] : [];
  });
  await Promise.all(staleTokenDeletes);
  console.info("Push delivery attempted", {gameId, notificationId: event.params.notificationId, attemptedDeviceCount: tokens.length, deliveredDeviceCount: response.successCount, failedDeviceCount: response.failureCount});
  await notificationRef.set({
    deliveryStatus: response.failureCount ? "SENT_WITH_FAILURES" : "SENT",
    deliveredAt: nowTs(), attemptedDeviceCount: tokens.length, deliveredDeviceCount: response.successCount,
    failedDeviceCount: response.failureCount, updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
});
