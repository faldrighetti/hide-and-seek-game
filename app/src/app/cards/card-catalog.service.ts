import { Injectable } from '@angular/core';
import { CardDefinition, CardValidationIssue, CardValidationResult } from '../models/card-definition.model';

interface RawCardsCatalog {
  mazo?: {
    mazo_escondedor?: {
      bonus_tiempo?: Array<{ color?: string; minutos?: number; cantidad?: number; enabled?: boolean }>;
      powerups?: Array<{
        id?: string;
        nombre?: string;
        cantidad?: number;
        pista_reglas?: string;
        enabled?: boolean;
      }>;
      cantidad_maldiciones_en_mazo?: number;
    };
  };
  maldiciones?: Array<{
    id?: number;
    nombre?: string;
    enabled?: boolean;
    texto_ui?: {
      efecto?: string;
      costo_lanzamiento?: string;
    };
    motor?: {
      tipo?: string;
    };
  }>;
}

@Injectable({ providedIn: 'root' })
export class CardCatalogService {
  async loadHiderDeck(): Promise<CardValidationResult> {
    const response = await fetch('assets/cards/Tarjetas_CABA.json', { cache: 'force-cache' });
    const catalog = (await response.json()) as RawCardsCatalog;
    return validateCardsCatalog(catalog);
  }
}

export function validateCardsCatalog(catalog: RawCardsCatalog): CardValidationResult {
  const cards: CardDefinition[] = [
    ...expandTimeBonusCards(catalog),
    ...expandPowerupCards(catalog),
    ...(catalog.maldiciones ?? []).map(curse => ({
      id: typeof curse.id === 'number' ? `curse_${curse.id}` : '',
      type: 'CURSE' as const,
      name: curse.nombre ?? '',
      description: curse.texto_ui?.efecto ?? '',
      effectType: curse.motor?.tipo,
      castingCost: curse.texto_ui?.costo_lanzamiento,
      quantity: 1,
      enabled: curse.enabled ?? true,
    })),
  ];

  const issues: CardValidationIssue[] = [];
  const ids = cards.map(card => String(card.id)).filter(Boolean);
  const duplicatedIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  for (const id of [...new Set(duplicatedIds)]) {
    issues.push({ level: 'error', message: `Duplicate card id: ${id}.` });
  }

  const curseIds = (catalog.maldiciones ?? [])
    .map(card => card.id)
    .filter((id): id is number => typeof id === 'number')
    .sort((a, b) => a - b);
  const maxCurseId = curseIds.length > 0 ? curseIds[curseIds.length - 1] : 0;
  for (let id = 1; id <= maxCurseId; id += 1) {
    if (!curseIds.includes(id)) {
      issues.push({ level: 'warning', message: `Missing curse card id: ${id}.` });
    }
  }

  for (const card of cards) {
    if (!['TIME_BONUS', 'POWERUP', 'CURSE'].includes(card.type)) {
      issues.push({ level: 'error', message: `Invalid card type for ${card.id}.` });
    }
    if (!card.name.trim()) {
      issues.push({ level: 'error', message: `Card ${card.id} has an empty name.` });
    }
    if (card.enabled && !card.description.trim()) {
      issues.push({ level: 'warning', message: `Enabled card ${card.id} has an empty description.` });
    }
  }

  const declaredCurseCount = catalog.mazo?.mazo_escondedor?.cantidad_maldiciones_en_mazo;
  const enabledCurseCount = cards.filter(card => card.type === 'CURSE' && card.enabled).length;
  if (typeof declaredCurseCount === 'number' && declaredCurseCount !== enabledCurseCount) {
    issues.push({
      level: 'warning',
      message: `Declared curse count ${declaredCurseCount} does not match enabled curses ${enabledCurseCount}.`,
    });
  }

  const enabledCards = cards.filter(card => card.enabled);
  return { cards, enabledCards, deckCards: expandDeckCards(enabledCards), issues };
}

function expandTimeBonusCards(catalog: RawCardsCatalog): CardDefinition[] {
  return (catalog.mazo?.mazo_escondedor?.bonus_tiempo ?? []).map(card => ({
    id: `time_bonus_${normalizeBonusColor(card.color)}_${card.minutos ?? 0}m`,
    type: 'TIME_BONUS' as const,
    name: `${card.minutos ?? 0} minute bonus`,
    description: `Suma ${card.minutos ?? 0} minutos al final del turno.`,
    effectType: 'time_bonus',
    timeBonusMinutes: card.minutos ?? 0,
    quantity: Math.max(card.cantidad ?? 1, 0),
    enabled: card.enabled ?? true,
  }));
}

function normalizeBonusColor(color: string | undefined): string {
  const normalized = (color ?? 'unknown').trim().toLowerCase();
  const backendColors: Record<string, string> = {
    rojo: 'red',
    naranja: 'orange',
    amarillo: 'yellow',
    verde: 'green',
    azul: 'blue',
  };

  return backendColors[normalized] ?? normalized;
}

function expandPowerupCards(catalog: RawCardsCatalog): CardDefinition[] {
  return (catalog.mazo?.mazo_escondedor?.powerups ?? []).map(card => ({
    id: `powerup_${card.id ?? 'missing'}`,
    type: 'POWERUP' as const,
    name: card.nombre ?? '',
    description: card.pista_reglas ?? '',
    effectType: card.id,
    quantity: Math.max(card.cantidad ?? 1, 0),
    enabled: card.enabled ?? true,
  }));
}

function expandDeckCards(cards: CardDefinition[]): CardDefinition[] {
  const expandedCards: CardDefinition[] = [];
  for (const card of cards) {
    for (let index = 0; index < card.quantity; index += 1) {
      expandedCards.push({
      ...card,
      id: `${card.id}#${index + 1}`,
      quantity: 1,
      });
    }
  }
  return expandedCards;
}
