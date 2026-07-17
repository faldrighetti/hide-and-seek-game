export type CardDefinitionType = 'TIME_BONUS' | 'POWERUP' | 'CURSE';

export interface CardDefinition {
  id: number | string;
  type: CardDefinitionType;
  name: string;
  description: string;
  effectType?: string;
  enabled: boolean;
}

export interface CardValidationIssue {
  level: 'warning' | 'error';
  message: string;
}

export interface CardValidationResult {
  cards: CardDefinition[];
  enabledCards: CardDefinition[];
  issues: CardValidationIssue[];
}
