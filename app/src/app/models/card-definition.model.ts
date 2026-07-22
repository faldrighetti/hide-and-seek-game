export type CardDefinitionType = 'TIME_BONUS' | 'POWERUP' | 'CURSE';

export interface CardDefinition {
  id: number | string;
  type: CardDefinitionType;
  name: string;
  description: string;
  effectType?: string;
  castingCost?: string;
  timeBonusMinutes?: number;
  blocksQuestions?: boolean;
  blocksTransport?: boolean;
  durationMinutes?: number | null;
  quantity: number;
  enabled: boolean;
}

export interface CardValidationIssue {
  level: 'warning' | 'error';
  message: string;
}

export interface CardValidationResult {
  cards: CardDefinition[];
  enabledCards: CardDefinition[];
  deckCards: CardDefinition[];
  issues: CardValidationIssue[];
}
