export const GAME_CONFIG = {
  minDisplacementM: 2500,
  hidingZoneRadiusM: 600,
  endgameDwellSeconds: 60,
  captainFailoverSeconds: 60,
  escapeExtensionMinutes: 10,
  maxEscapeExtensions: 3,
  maxDistanceFromGeneralPazM: 1000,
} as const;

export type GameConfig = typeof GAME_CONFIG;
