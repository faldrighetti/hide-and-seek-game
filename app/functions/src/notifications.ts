import {
  DocumentReference,
  Timestamp,
  Transaction,
} from "firebase-admin/firestore";

type NotificationImportance = "CRITICAL" | "MEDIUM" | "LOW";
type NotificationAudience = "HIDER" | "SEEKERS" | "ALL";

interface NotificationTurn {
  runNumber: number;
  hiderTeamId: string;
  phase: string;
}

interface NotificationGame {
  teamOrder: string[];
  currentTurn?: NotificationTurn | null;
}

export interface GameEventInput {
  type: string;
  createdAt: Timestamp;
  actorUid?: string | null;
  actorTeamId?: string | null;
  payload?: Record<string, unknown>;
}

interface NotificationDraft {
  importance: NotificationImportance;
  audience: NotificationAudience;
  requiresAction: boolean;
  category: string;
  title: string;
  body: string;
}

export const sanitizeNotificationCategoryPreferences = (value: unknown): Record<string, boolean> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, preference]) => /^[a-z_]+$/.test(key) && typeof preference === "boolean"),
  ) as Record<string, boolean>;
};

const eventPayloadString = (event: GameEventInput, key: string): string | null => {
  const value = event.payload?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const eventPayloadBoolean = (event: GameEventInput, key: string): boolean =>
  Boolean(event.payload?.[key]);

const notificationAudienceTeamIds = (
  game: NotificationGame,
  turn: NotificationTurn | undefined | null,
  audience: NotificationAudience,
): string[] => {
  if (audience === "ALL") return game.teamOrder;
  const hiderTeamId = turn?.hiderTeamId;
  if (!hiderTeamId) return [];
  if (audience === "HIDER") return [hiderTeamId];
  return game.teamOrder.filter((teamId) => teamId !== hiderTeamId);
};

const buildNotificationDrafts = (
  game: NotificationGame,
  event: GameEventInput,
): NotificationDraft[] => {
  const turn = game.currentTurn;
  const phaseTo = eventPayloadString(event, "toPhase");
  const reason = eventPayloadString(event, "reason");
  const curseId = eventPayloadString(event, "curseId");
  const stationId = eventPayloadString(event, "stationId");

  switch (event.type) {
  case "GAME_STARTED":
    return [{
      importance: "CRITICAL",
      audience: "ALL",
      requiresAction: true,
      category: "phase",
      title: "Partida iniciada",
      body: `Empieza el turno ${turn?.runNumber ?? 1}. Hider: Team ${turn?.hiderTeamId ?? "-"}.`,
    }];
  case "PHASE_ADVANCED":
    return [
      {
        importance: "CRITICAL",
        audience: "ALL",
        requiresAction: true,
        category: "phase",
        title: phaseTo === "CHASE" ? "Empieza CHASE" : phaseTo === "ESCAPE" ? "Empieza ESCAPE" : "Cambio de fase",
        body: phaseTo === "CHASE" ?
          "La búsqueda está activa. Seekers pueden preguntar cuando la estación base esté lista." :
          "El hider entra en fase de escape.",
      },
      ...(phaseTo === "CHASE" && eventPayloadBoolean(event, "baseStationSelectionRequired") ? [{
        importance: "CRITICAL" as const,
        audience: "HIDER" as const,
        requiresAction: true,
        category: "base_station",
        title: "Estación base pendiente",
        body: "Hay varias estaciones posibles. Elegí una para habilitar preguntas.",
      }] : []),
    ];
  case "TURN_STARTED":
    return [{
      importance: "CRITICAL",
      audience: "ALL",
      requiresAction: true,
      category: "turn",
      title: "Nuevo turno iniciado",
      body: `Nuevo hider: Team ${eventPayloadString(event, "hiderTeamId") ?? turn?.hiderTeamId ?? "-"}.`,
    }];
  case "TURN_ENDED_MANUALLY":
  case "TURN_ENDED_BY_TIMEOUT":
    return [{
      importance: "CRITICAL",
      audience: "ALL",
      requiresAction: true,
      category: "turn",
      title: "Turno cerrado",
      body: event.type === "TURN_ENDED_BY_TIMEOUT" ? "El turno terminó por tiempo." : "El host cerró el turno.",
    }];
  case "GAME_PAUSED":
  case "GAME_RESUMED":
    return [{
      importance: "CRITICAL",
      audience: "ALL",
      requiresAction: false,
      category: "operations",
      title: event.type === "GAME_PAUSED" ? "Partida pausada" : "Partida reanudada",
      body: reason ? `Motivo: ${reason}.` : "Cambio operativo de la partida.",
    }];
  case "EMERGENCY_DECLARED":
    return [{
      importance: "CRITICAL",
      audience: "ALL",
      requiresAction: true,
      category: "operations",
      title: "Emergencia declarada",
      body: reason ? `Motivo: ${reason}.` : "La partida queda en emergencia hasta reanudación o cancelación.",
    }];
  case "GAME_CANCELED":
    return [{
      importance: "CRITICAL",
      audience: "ALL",
      requiresAction: false,
      category: "operations",
      title: "Partida cancelada",
      body: reason ? `Motivo: ${reason}.` : "La partida fue cancelada por el host.",
    }];
  case "BASE_STATION_CONFIRMED":
    return [{
      importance: "MEDIUM",
      audience: "SEEKERS",
      requiresAction: false,
      category: "base_station",
      title: "Estación base confirmada",
      body: stationId ? `Estación: ${stationId}.` : "El hider confirmó su estación base.",
    }];
  case "QUESTION_SENT":
    return [{
      importance: "CRITICAL",
      audience: "HIDER",
      requiresAction: true,
      category: "question",
      title: "Nueva pregunta",
      body: "Tenés una pregunta pendiente para responder.",
    }];
  case "QUESTION_RESOLVED":
    return [
      {
        importance: "CRITICAL",
        audience: "SEEKERS",
        requiresAction: true,
        category: "question",
        title: "Respuesta recibida",
        body: `Resolución: ${eventPayloadString(event, "resolution") ?? "ANSWER"}.`,
      },
      {
        importance: "CRITICAL",
        audience: "HIDER",
        requiresAction: true,
        category: "loot",
        title: "Loot disponible",
        body: "Elegí cartas del loot y descartá si la mano supera el máximo.",
      },
    ];
  case "QUESTION_EXPIRED":
    return [{
      importance: "CRITICAL",
      audience: "ALL",
      requiresAction: false,
      category: "question",
      title: "Pregunta vencida",
      body: "La pregunta pendiente venció.",
    }];
  case "LOOT_SELECTED":
    return [{
      importance: "CRITICAL",
      audience: "SEEKERS",
      requiresAction: true,
      category: "loot",
      title: "Loot resuelto",
      body: "El hider terminó de resolver el loot.",
    }];
  case "CURSE_PLAYED":
    return [
      {
        importance: "CRITICAL",
        audience: "SEEKERS",
        requiresAction: true,
        category: "curse",
        title: "Maldición activada",
        body: curseId ? `Resolver ${curseId}. Revisen evidencia o condición por WhatsApp.` : "Revisen la condición de la maldición.",
      },
      {
        importance: "CRITICAL",
        audience: "SEEKERS",
        requiresAction: true,
        category: "curse",
        title: "Confirmación requerida",
        body: "La evidencia o condición de la maldición se confirma por WhatsApp.",
      },
    ];
  case "CURSE_COMPLETED":
    return [{
      importance: "CRITICAL",
      audience: "ALL",
      requiresAction: false,
      category: "curse",
      title: "Maldición completada",
      body: curseId ? `${curseId} fue cerrada.` : "La maldición activa fue cerrada.",
    }];
  case "ENDGAME_ACTIVATED":
  case "ENDGAME_VERIFIED_ACTIVE":
    return [{
      importance: "CRITICAL",
      audience: "ALL",
      requiresAction: true,
      category: "endgame",
      title: "Endgame activo",
      body: "La partida entró en endgame.",
    }];
  case "ENDGAME_DEACTIVATED":
  case "ENDGAME_VERIFIED_INACTIVE":
    return [{
      importance: "MEDIUM",
      audience: "ALL",
      requiresAction: false,
      category: "endgame",
      title: "Endgame desactivado",
      body: "Las condiciones de endgame ya no están activas.",
    }];
  case "ENDGAME_QUESTIONS_CONSULTED":
    return eventPayloadBoolean(event, "unlocked") ? [{
      importance: "MEDIUM",
      audience: "SEEKERS",
      requiresAction: true,
      category: "endgame",
      title: "Preguntas de endgame habilitadas",
      body: "Ya pueden usar preguntas de endgame.",
    }] : [];
  case "CAPTURE_ATTEMPT_STARTED":
    return [{
      importance: "CRITICAL",
      audience: "HIDER",
      requiresAction: true,
      category: "capture",
      title: "Intento de captura",
      body: "Confirmá o rechazá la captura.",
    }];
  case "CAPTURE_REJECTED_BY_HIDER":
    return [{
      importance: "CRITICAL",
      audience: "SEEKERS",
      requiresAction: true,
      category: "capture",
      title: "Captura rechazada",
      body: "Los seekers pueden ratificar si corresponde.",
    }];
  case "CAPTURE_RATIFIED_BY_SEEKER":
    return [{
      importance: "CRITICAL",
      audience: "SEEKERS",
      requiresAction: true,
      category: "capture",
      title: "Captura ratificada",
      body: "Puede requerirse otra ratificación seeker.",
    }];
  case "CAPTURE_CONFIRMED_BY_HIDER":
  case "CAPTURE_CONFIRMED_BY_SEEKERS":
    return [{
      importance: "CRITICAL",
      audience: "ALL",
      requiresAction: false,
      category: "capture",
      title: "Captura confirmada",
      body: "La captura fue confirmada y el turno se cierra.",
    }];
  case "OUT_OF_AREA_SUSPECTED":
  case "OUT_OF_AREA_REPORTED":
    return [{
      importance: "CRITICAL",
      audience: "HIDER",
      requiresAction: true,
      category: "safety",
      title: "Salida de área sospechada",
      body: "Confirmá que estás bien y volviendo al área jugable.",
    }];
  case "OUT_OF_AREA_ALERTED":
    return [{
      importance: "CRITICAL",
      audience: "ALL",
      requiresAction: true,
      category: "safety",
      title: "Salida de área alertada",
      body: "El hider figura fuera del área jugable.",
    }];
  case "OUT_OF_AREA_SAFETY_CONFIRMED":
    return [{
      importance: "MEDIUM",
      audience: "SEEKERS",
      requiresAction: false,
      category: "safety",
      title: "Seguridad confirmada",
      body: "El hider confirmó que está bien o volviendo.",
    }];
  case "OUT_OF_AREA_CLEARED_BY_LOCATION":
  case "OUT_OF_AREA_CLEARED_MANUALLY":
    return [{
      importance: "MEDIUM",
      audience: "ALL",
      requiresAction: false,
      category: "safety",
      title: "Salida de área resuelta",
      body: "El incidente de salida de área fue cerrado.",
    }];
  case "PLAYER_TEMPORARILY_DISCONNECTED":
    return [{
      importance: "MEDIUM",
      audience: "ALL",
      requiresAction: false,
      category: "presence",
      title: "Desconexión temporal",
      body: "Un jugador reportó desconexión temporal.",
    }];
  case "PLAYER_RECONNECTED":
    return [{
      importance: "MEDIUM",
      audience: "ALL",
      requiresAction: false,
      category: "presence",
      title: "Jugador reconectado",
      body: "Un jugador volvió a conectarse.",
    }];
  default:
    return [];
  }
};

export const appendGameNotificationsForEventInTx = (
  tx: Transaction,
  gameRef: DocumentReference,
  game: NotificationGame,
  event: GameEventInput,
  eventId: string,
  payload: Record<string, unknown>,
): void => {
  const turn = game.currentTurn;
  const notifications = buildNotificationDrafts(game, event);
  notifications.forEach((notification, index) => {
    const notificationId = index === 0 ? eventId : `${eventId}_${index + 1}`;
    tx.set(gameRef.collection("notifications").doc(notificationId), {
      eventId,
      id: notificationId,
      eventType: event.type,
      createdAt: event.createdAt,
      actorUid: event.actorUid ?? null,
      actorTeamId: event.actorTeamId ?? null,
      runNumber: turn?.runNumber ?? null,
      phase: turn?.phase ?? null,
      hiderTeamId: turn?.hiderTeamId ?? null,
      importance: notification.importance,
      audience: notification.audience,
      recipientTeamIds: notificationAudienceTeamIds(game, turn, notification.audience),
      requiresAction: notification.requiresAction,
      category: notification.category,
      title: notification.title,
      body: notification.body,
      payload,
      deliveryStatus: "PENDING",
    });
  });
};
