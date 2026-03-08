export type GameMode = 'INDIVIDUAL_3' | 'TEAMS_2v2' | 'TEAMS_2v2v2';
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
  endgameRequestCooldownSeconds: number;
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
  pendingQuestion: boolean;
  expirations: number;
  foundVotes: string[];
  foundConfirmed: boolean;
  endgameEligible: boolean;
  endgameActive: boolean;
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
  serverDice: boolean;
}

export interface EndgamePolicy {
  eligibleRadiusM: number;
  requestCooldownSeconds: number;
  canRequestAnytimeDuringChase: boolean;
  tentaclesOnlyInEndgame: boolean;
}

export interface Seat {
  id: string;
  displayName: string;
  teamId: string;
  host: boolean;
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
  intermissionSeconds: 120,
  escapeSeconds: 3600,
  chaseMaxSeconds: 21600,
  zoneRadiusM: 500,
  eligibleBufferM: 100,
  arrivalRadiusM: 100,
  endgameRequestCooldownSeconds: 600,
  deckMaxSize: 6,
};