import {
  EMPTY_PERMISSIONS,
  PERMISSIONS,
  type PermissionPatch,
  type PermissionSet,
} from './permissions';

export type TeamRole = 'HIDER' | 'SEEKER';
export type LobbyRole = 'HOST' | 'NON_HOST';

export const TEAM_ROLE_PERMISSIONS: Record<TeamRole, PermissionPatch> = {
  HIDER: {
    [PERMISSIONS.VIEW_DECK]: true,
    [PERMISSIONS.DRAW_CARDS]: true,
    [PERMISSIONS.ANSWER_QUESTIONS]: true,
    [PERMISSIONS.ADD_CARDS_TO_DECK]: true,
    [PERMISSIONS.ASK_QUESTIONS]: false,
    [PERMISSIONS.VIEW_QUESTION_LIST]: false,
    [PERMISSIONS.VIEW_MAP]: false,
  },
  SEEKER: {
    [PERMISSIONS.VIEW_DECK]: false,
    [PERMISSIONS.DRAW_CARDS]: false,
    [PERMISSIONS.ANSWER_QUESTIONS]: false,
    [PERMISSIONS.ADD_CARDS_TO_DECK]: false,
    [PERMISSIONS.ASK_QUESTIONS]: true,
    [PERMISSIONS.VIEW_QUESTION_LIST]: true,
    [PERMISSIONS.VIEW_MAP]: true,
  },
};

export const LOBBY_ROLE_PERMISSIONS: Record<LobbyRole, PermissionPatch> = {
  HOST: {
    [PERMISSIONS.CREATE_GAME]: true,
  },
  NON_HOST: {
    [PERMISSIONS.CREATE_GAME]: false,
  },
};

export const getPermissionsForPlayer = (
  teamRole: TeamRole,
  lobbyRole: LobbyRole
): PermissionSet => ({
  ...EMPTY_PERMISSIONS,
  ...TEAM_ROLE_PERMISSIONS[teamRole],
  ...LOBBY_ROLE_PERMISSIONS[lobbyRole],
});