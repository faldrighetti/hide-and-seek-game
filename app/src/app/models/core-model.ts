import { GAME_CONFIG } from '../config/game-config';

export type GameMode = 'INDIVIDUAL_1v1' | 'INDIVIDUAL_3' | 'TEAMS_2v2' | 'TEAMS_2v2v2';
export type WinCondition = 'TOTAL_TIME' | 'BEST_SINGLE_RUN';
export type Phase = 'INTERMISSION' | 'ESCAPE' | 'CHASE' | 'ENDED';

export interface GameSettings {
  turnsPerTeam: 1 | 2 | 3;
  winCondition: WinCondition;
  ukMode: boolean;
  intermissionSeconds: number;
  escapeSeconds: number;
  chaseMaxSeconds: number;
  zoneRadiusM: number;
  eligibleBufferM: number;
  arrivalRadiusM: number;
  endgameVerificationCooldownSeconds: number;
  outOfAreaConfirmationSeconds: number;
  outOfAreaMaxGraceSeconds: number;
  deckMaxSize: number;
}

export interface TeamStanding {
  id: string;
  name: string;
  totalTimeSeconds: number;
  bestSingleRunSeconds: number;
  runsCompleted: number;
}

export interface TurnStatus {
  runNumber: number;
  hiderTeamId: string;
  phase: Phase;
  endsAtIso: string;
  pendingQuestionId: string | null;
  pendingQuestionEndsAtIso: string | null;
  pendingQuestion: boolean;
  hiderHandIds: string[];
  drawPileCount: number;
  discardPileCount: number;
  lootOffer: LootOffer | null;
  activeEffects: ActiveEffect[];
  expirations: number;
  foundVotes: string[];
  foundConfirmed: boolean;
  endgameEligible: boolean;
  endgameActive: boolean;
  endgameQuestionsUnlocked: boolean;
  outOfArea: OutOfAreaStatus | null;
}

export interface OutOfAreaStatus {
  status: 'SUSPECTED' | 'ALERTED';
  playerUid: string;
  startedAtIso: string | null;
  confirmationExpiresAtIso: string | null;
  maxExpiresAtIso: string | null;
  lastConfirmedAtIso: string | null;
  alertedAtIso: string | null;
}

export type QuestionResolution = 'ANSWER' | 'VETO' | 'RANDOMIZE';

export interface PendingQuestion {
  id: string;
  categoryId: string;
  prompt: string;
  isPhoto: boolean;
  status: 'PENDING' | 'RESOLVED' | 'EXPIRED';
  createdAtIso: string | null;
  expiresAtIso: string | null;
}

export interface LootOffer {
  questionId: string;
  categoryId: string;
  drawnCardIds: string[];
  takeLimit: number;
  createdAtIso: string | null;
}

export interface ActiveEffect {
  id: string;
  curseId: string;
  createdByUid: string;
  createdAtIso: string | null;
  expiresAtIso: string | null;
  blocksQuestions: boolean;
  blocksTransport: boolean;
}

export interface QuestionPolicy {
  maxPendingQuestions: number;
  photoTimeoutSeconds: number;
  regularTimeoutSeconds: number;
  timeoutPenaltySeconds: number;
}

export interface DeckPolicy {
  maxSize: number;
  reshuffleEnabled: boolean;
  duplicateReplacesItself: boolean;
}

export interface EffectPolicy {
  allowOnlyInChaseOrEndgame: boolean;
  blockIfQuestionPending: boolean;
  uniqueByEffectType: boolean;
}

export interface EndgamePolicy {
  eligibleRadiusM: number;
  verificationCooldownSeconds: number;
  canVerifyAnytimeDuringChase: boolean;
  tentaclesOnlyInEndgame: boolean;
}

export interface Seat {
  id: string;
  uid: string;
  displayName: string;
  teamId: string;
  host: boolean;
}

export interface PlayerRole {
  uid: string | null;
  seat: Seat | null;
  teamId: string | null;
  isHost: boolean;
  isHider: boolean;
  isSeeker: boolean;
  isParticipant: boolean;
}

export interface LobbyState {
  gameId: string;
  joinLink: string;
  seats: Seat[];
  teamsLocked: boolean;
}

export interface GameBlueprint {
  gameName: string;
  mode: GameMode;
  settings: GameSettings;
  currentTurn: TurnStatus;
  standings: TeamStanding[];
  questionPolicy: QuestionPolicy;
  deckPolicy: DeckPolicy;
  effectPolicy: EffectPolicy;
  endgamePolicy: EndgamePolicy;
}

export const DEFAULT_SETTINGS: GameSettings = {
  turnsPerTeam: 2,
  winCondition: 'TOTAL_TIME',
  ukMode: false,
  intermissionSeconds: GAME_CONFIG.intervalPhaseSeconds,
  escapeSeconds: GAME_CONFIG.escapePhaseSeconds,
  chaseMaxSeconds: GAME_CONFIG.chaseMaxSeconds,
  zoneRadiusM: GAME_CONFIG.hidingZoneRadiusM,
  eligibleBufferM: 0,
  arrivalRadiusM: 100,
  endgameVerificationCooldownSeconds: GAME_CONFIG.endgameVerificationCooldownMinutes * 60,
  outOfAreaConfirmationSeconds: GAME_CONFIG.outOfAreaConfirmationSeconds,
  outOfAreaMaxGraceSeconds: GAME_CONFIG.outOfAreaMaxGraceSeconds,
  deckMaxSize: 6,
};
