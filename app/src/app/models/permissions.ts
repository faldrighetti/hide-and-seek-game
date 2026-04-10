export const PERMISSIONS = {
  VIEW_DECK: 'viewDeck',
  DRAW_CARDS: 'drawCards',
  ANSWER_QUESTIONS: 'answerQuestions',
  ADD_CARDS_TO_DECK: 'addCardsToDeck',
  ASK_QUESTIONS: 'askQuestions',
  VIEW_QUESTION_LIST: 'viewQuestionList',
  VIEW_MAP: 'viewMap',
  CREATE_GAME: 'createGame',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export type PermissionSet = Record<Permission, boolean>;
export type PermissionPatch = Partial<PermissionSet>;

export const EMPTY_PERMISSIONS: PermissionSet = {
  [PERMISSIONS.VIEW_DECK]: false,
  [PERMISSIONS.DRAW_CARDS]: false,
  [PERMISSIONS.ANSWER_QUESTIONS]: false,
  [PERMISSIONS.ADD_CARDS_TO_DECK]: false,
  [PERMISSIONS.ASK_QUESTIONS]: false,
  [PERMISSIONS.VIEW_QUESTION_LIST]: false,
  [PERMISSIONS.VIEW_MAP]: false,
  [PERMISSIONS.CREATE_GAME]: false,
};