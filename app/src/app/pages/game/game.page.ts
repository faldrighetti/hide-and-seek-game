import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable } from 'rxjs';
import { GameFacadeService } from '../../services/game-facade';
import { GameBlueprint, LobbyState, PendingQuestion, PlayerRole, QuestionResolution, Seat } from '../../models/core-model';
import { HiderCardData } from 'src/app/models/hider-card-data';
import { CardCatalogService } from '../../cards/card-catalog.service';
import { CardDefinition } from 'src/app/models/card-definition.model';

interface DrawRule {
  categoryKey: string;
  categoryName: string;
  draw: number;
  take: number;
}

interface QuestionItem {
  label?: string;
  prompt?: string;
  asunto?: string;
  requisito?: string;
  places?: string;
  distance?: string;
  availability?: string;
  resolutionMode?: string;
}

interface QuestionCategory {
  key: string;
  name: string;
  cost: string | null;
  time: string | null;
  prompt?: string;
  placeholder?: string;
  items: QuestionItem[];
}

interface QuestionsCatalog {
  questions: Record<string, {
    name: string;
    cost: string | null;
    time: string | null;
    prompt?: string;
    placeholder?: string;
    items?: QuestionItem[];
  }>;
}

@Component({
  selector: 'app-game',
  templateUrl: './game.page.html',
  styleUrls: ['./game.page.scss'],
  standalone: false,
})
export class GamePage {
  private readonly route = inject(ActivatedRoute);
  private readonly gameFacade = inject(GameFacadeService);
  private readonly cardCatalog = inject(CardCatalogService);

  readonly gameId = this.route.snapshot.paramMap.get('gameId') ?? '';
  readonly blueprint$: Observable<GameBlueprint> = this.gameFacade.blueprint$;
  readonly lobby$: Observable<LobbyState | null> = this.gameFacade.lobby$;
  readonly pendingQuestion$: Observable<PendingQuestion | null> = this.gameFacade.pendingQuestion$;
  readonly playerRole$: Observable<PlayerRole> = this.gameFacade.playerRole$;

  drawRulesByCategory: DrawRule[] = [];
  cardById = new Map<string, HiderCardData>();
  fallbackCardByBaseId = new Map<string, HiderCardData>();
  questionCategories: QuestionCategory[] = [];
  selectedSeekerQuestion: { category: QuestionCategory; question: QuestionItem } | null = null;
  sendingQuestion = false;
  resolvingQuestion: QuestionResolution | null = null;
  selectingLoot = false;
  selectedLootCardIds: string[] = [];
  discardFromHandIds: string[] = [];
  lootErrorMessage = '';
  questionErrorMessage = '';
  resolveQuestionErrorMessage = '';

  constructor() {
    this.gameFacade.loadGame(this.gameId);
    void this.loadCardsFromCatalog();
    void this.loadQuestionsCatalog();
  }

  async loadCardsFromCatalog(): Promise<void> {
    const catalog = await this.cardCatalog.loadHiderDeck();
    for (const issue of catalog.issues) {
      console.warn(`[cards:${issue.level}] ${issue.message}`);
    }

    const deckCards = catalog.deckCards.map(card => this.toHiderCardData(card));
    this.cardById = new Map(deckCards.map(card => [card.id, card]));
    this.fallbackCardByBaseId = new Map(
      catalog.enabledCards.map(card => {
        const data = this.toHiderCardData(card);
        return [String(card.id), data];
      }),
    );
  }

  async loadQuestionsCatalog(): Promise<void> {
    const res = await fetch('assets/questions/Preguntas_CABA.json', { cache: 'force-cache' });
    const catalog = (await res.json()) as QuestionsCatalog;

    const expectedOrder = ['matching', 'measuring', 'thermometer', 'radar', 'tentacles', 'photos'];
    const orderedCategoryKeys = [
      ...expectedOrder.filter(categoryKey => Boolean(catalog.questions[categoryKey])),
      ...Object.keys(catalog.questions).filter(categoryKey => !expectedOrder.includes(categoryKey)),
    ];

    this.questionCategories = orderedCategoryKeys.map(categoryKey => {
      const category = catalog.questions[categoryKey];
      return {
        key: categoryKey,
        name: category.name,
        cost: category.cost,
        time: category.time,
        prompt: category.prompt,
        placeholder: category.placeholder,
        items: category.items ?? [],
      };
    });

    this.drawRulesByCategory = this.questionCategories
      .map(category => {
        const { draw, take } = this.parseDrawTakeFromCost(category.cost);
        return {
          categoryKey: category.key,
          categoryName: category.name,
          draw,
          take,
        };
      });

  }

  parseDrawTakeFromCost(cost: string | null): { draw: number; take: number } {
    if (!cost) {
      return { draw: 1, take: 1 };
    }

    const drawMatch = cost.match(/Robá\s*(\d+)/i);
    const takeMatch = cost.match(/elegí\s*(\d+)/i);

    const draw = drawMatch ? Number(drawMatch[1]) : 1;
    const take = takeMatch ? Number(takeMatch[1]) : 1;
    return { draw, take };
  }

  selectSeekerQuestion(category: QuestionCategory, question: QuestionItem): void {
    this.selectedSeekerQuestion = { category, question };
    this.questionErrorMessage = '';
  }

  async sendSelectedQuestion(role: PlayerRole): Promise<void> {
    if (!role.isSeeker) {
      this.questionErrorMessage = 'Solo los seekers pueden enviar preguntas.';
      return;
    }

    if (!this.selectedSeekerQuestion) {
      return;
    }

    const { category, question } = this.selectedSeekerQuestion;
    const prompt = this.questionText(category, question);
    if (!prompt.trim()) {
      this.questionErrorMessage = 'La pregunta seleccionada no tiene texto.';
      return;
    }

    this.sendingQuestion = true;
    this.questionErrorMessage = '';
    try {
      await this.gameFacade.sendQuestion(this.gameId, category.key, prompt, category.key === 'photos');
      this.selectedSeekerQuestion = null;
    } catch (error) {
      this.questionErrorMessage = error instanceof Error ? error.message : 'No se pudo enviar la pregunta.';
    } finally {
      this.sendingQuestion = false;
    }
  }

  async resolvePendingQuestion(resolution: QuestionResolution, role: PlayerRole): Promise<void> {
    if (!role.isHider) {
      this.resolveQuestionErrorMessage = 'Solo el hider puede responder preguntas.';
      return;
    }

    this.resolvingQuestion = resolution;
    this.resolveQuestionErrorMessage = '';
    try {
      await this.gameFacade.resolveQuestion(this.gameId, resolution);
    } catch (error) {
      this.resolveQuestionErrorMessage = error instanceof Error ? error.message : 'No se pudo resolver la pregunta.';
    } finally {
      this.resolvingQuestion = null;
    }
  }

  toggleLootSelection(cardId: string, takeLimit: number): void {
    this.lootErrorMessage = '';
    if (this.selectedLootCardIds.includes(cardId)) {
      this.selectedLootCardIds = this.selectedLootCardIds.filter(selectedId => selectedId !== cardId);
      return;
    }

    if (this.selectedLootCardIds.length >= takeLimit) {
      this.lootErrorMessage = `Podés elegir hasta ${takeLimit} carta${takeLimit === 1 ? '' : 's'}.`;
      return;
    }

    this.selectedLootCardIds = [...this.selectedLootCardIds, cardId];
  }

  async confirmLootSelection(role: PlayerRole): Promise<void> {
    if (!role.isHider) {
      this.lootErrorMessage = 'Solo el hider puede elegir loot.';
      return;
    }

    this.selectingLoot = true;
    this.lootErrorMessage = '';
    try {
      await this.gameFacade.selectLoot(this.gameId, this.selectedLootCardIds, this.discardFromHandIds);
      this.selectedLootCardIds = [];
      this.discardFromHandIds = [];
    } catch (error) {
      this.lootErrorMessage = error instanceof Error ? error.message : 'No se pudo elegir loot.';
    } finally {
      this.selectingLoot = false;
    }
  }

  toggleHandDiscard(cardId: string): void {
    this.lootErrorMessage = '';
    if (this.discardFromHandIds.includes(cardId)) {
      this.discardFromHandIds = this.discardFromHandIds.filter(selectedId => selectedId !== cardId);
      return;
    }

    this.discardFromHandIds = [...this.discardFromHandIds, cardId];
  }

  projectedHandSize(currentHandSize: number): number {
    return currentHandSize - this.discardFromHandIds.length + this.selectedLootCardIds.length;
  }

  resolutionLabel(resolution: QuestionResolution): string {
    const labels: Record<QuestionResolution, string> = {
      ANSWER: 'Responder',
      VETO: 'Vetar',
      RANDOMIZE: 'Randomizar',
    };

    return labels[resolution];
  }

  trackByQuestionCategory(_: number, category: QuestionCategory): string {
    return category.key;
  }

  trackByQuestionItem(index: number, question: QuestionItem): string {
    return `${question.label ?? question.asunto ?? question.prompt ?? 'question'}-${index}`;
  }

  questionTitle(question: QuestionItem): string {
    return question.label ?? question.asunto ?? 'Pregunta';
  }

  questionText(category: QuestionCategory, question: QuestionItem): string {
    if (question.prompt) {
      return question.prompt;
    }

    if (category.prompt && category.placeholder && question.asunto) {
      return category.prompt.replace(category.placeholder, question.asunto);
    }

    return question.asunto ?? '';
  }

  cardsForIds(cardIds: string[]): HiderCardData[] {
    return cardIds.map(cardId => this.cardForId(cardId));
  }

  setPhase(phase: GameBlueprint['currentTurn']['phase']): void {
    this.gameFacade.setPhase(phase);
  }

  phaseLabel(phase: GameBlueprint['currentTurn']['phase']): string {
    const labels: Record<GameBlueprint['currentTurn']['phase'], string> = {
      INTERMISSION: 'Intervalo',
      ESCAPE: 'Escape',
      CHASE: 'Búsqueda',
      ENDED: 'Fin',
    };

    return labels[phase];
  }

  voteFound(seatId: string): void {
    this.gameFacade.voteFound(seatId);
  }

  setEndgameActive(active: boolean): void {
    this.gameFacade.setEndgameActive(active);
  }

  getSeekerSeats(vm: GameBlueprint, lobby: LobbyState | null): Seat[] {
    if (!lobby) {
      return [];
    }

    return lobby.seats.filter(seat => seat.teamId !== vm.currentTurn.hiderTeamId);
  }

  currentSeekerSeat(role: PlayerRole): Seat[] {
    return role.isSeeker && role.seat ? [role.seat] : [];
  }

  formatTime(seconds: number): string {
    const sign = seconds < 0 ? '-' : '';
    const absolute = Math.abs(seconds);
    const hrs = Math.floor(absolute / 3600);
    const mins = Math.floor((absolute % 3600) / 60);
    const secs = absolute % 60;
    return `${sign}${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }

  private toHiderCardData(card: CardDefinition): HiderCardData {
    return {
      id: String(card.id),
      type: card.type,
      title: card.name,
      description: card.description,
      castingCost: card.castingCost,
      timeBonusMinutes: card.timeBonusMinutes,
    };
  }

  private cardForId(cardId: string): HiderCardData {
    const card = this.cardById.get(cardId);
    if (card) {
      return card;
    }

    const baseId = cardId.split('#')[0];
    const fallback = this.fallbackCardByBaseId.get(baseId);
    if (fallback) {
      return { ...fallback, id: cardId };
    }

    return {
      id: cardId,
      type: 'POWERUP',
      title: cardId,
      description: 'Carta no encontrada en Tarjetas_CABA.json.',
    };
  }
}
