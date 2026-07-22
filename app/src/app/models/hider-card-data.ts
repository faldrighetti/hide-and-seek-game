export interface HiderCardData {
  id: string;
  type: 'TIME_BONUS' | 'POWERUP' | 'CURSE' | 'BACK';
  title: string;
  description: string;
  castingCost?: string;
  timeBonusMinutes?: number;
  blocksQuestions?: boolean;
  blocksTransport?: boolean;
  durationMinutes?: number | null;
}
