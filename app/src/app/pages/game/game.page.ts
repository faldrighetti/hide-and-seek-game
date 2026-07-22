import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable } from 'rxjs';
import { GameFacadeService } from '../../services/game-facade';
import { GameBlueprint, LobbyState, Seat } from '../../models/core-model';
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

  drawRulesByCategory: DrawRule[] = [];
  selectedRule: DrawRule | null = null;
  hiderDeck: HiderCardData[] = [];
  hiderHand: HiderCardData[] = [];
  drawPreviewCards: HiderCardData[] = [];
  questionCategories: QuestionCategory[] = [];
  selectedSeekerQuestion: { category: QuestionCategory; question: QuestionItem } | null = null;
  sendingQuestion = false;
  questionErrorMessage = '';

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

    this.hiderDeck = this.deterministicShuffle(catalog.deckCards).map(card => this.toHiderCardData(card));

    this.hiderHand = this.hiderDeck.slice(0, 3);
    this.updateDrawPreview();
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

    this.selectedRule = this.drawRulesByCategory[0] ?? null;
    this.updateDrawPreview();
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

  selectDrawRule(rule: DrawRule): void {
    this.selectedRule = rule;
    this.updateDrawPreview();
  }

  selectSeekerQuestion(category: QuestionCategory, question: QuestionItem): void {
    this.selectedSeekerQuestion = { category, question };
    this.questionErrorMessage = '';
  }

  async sendSelectedQuestion(): Promise<void> {
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

  updateDrawPreview(): void {
    const drawCount = this.selectedRule?.draw ?? 0;
    this.drawPreviewCards = this.hiderDeck.slice(this.hiderHand.length, this.hiderHand.length + drawCount);
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

  private deterministicShuffle(cards: CardDefinition[]): CardDefinition[] {
    return [...cards].sort((a, b) => this.hashCardId(String(a.id)) - this.hashCardId(String(b.id)));
  }

  private hashCardId(value: string): number {
    return [...value].reduce((hash, char) => ((hash * 31) + char.charCodeAt(0)) % 9973, 7);
  }
}
