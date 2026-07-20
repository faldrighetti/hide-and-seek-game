export const GAME_CONFIG = {
  minDisplacementM: 2500,
  hidingZoneRadiusM: 600,
  escapePhaseSeconds: 3600,
  endgameDwellSeconds: 60,
  captainFailoverSeconds: 60,
  endgameVerificationCooldownMinutes: 10,
  allowedTransportModes: ['SUBTE', 'TREN', 'COLECTIVO', 'CAMINATA'],
  prohibitedTransportModes: ['UBER', 'TAXI', 'BICICLETA', 'ECOBICI', 'VEHICULO_PARTICULAR', 'EQUIVALENTE'],
  maxDistanceFromGeneralPazM: 1000,
  maxDistanceFromRiachueloM: 1000,
} as const;

export type GameConfig = typeof GAME_CONFIG;
