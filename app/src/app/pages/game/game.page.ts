import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable } from 'rxjs';
import { GameFacadeService } from '../../services/game-facade';
import { GameBlueprint, LobbyState, Seat } from '../../models/core-model';
import { HiderCardData } from 'src/app/models/hider-card-data';
import { CardCatalogService } from '../../cards/card-catalog.service';

interface DrawRule {
  categoryKey: string;
  categoryName: string;
  draw: number;
  take: number;
}

interface QuestionsCatalog {
  questions: Record<string, { name: string; cost: string | null }>;
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

constructor() {
    this.gameFacade.loadGame(this.gameId);
    void this.loadCardsFromCatalog();
    void this.loadDrawRulesFromQuestions();
  }

  async loadCardsFromCatalog(): Promise<void> {
    const catalog = await this.cardCatalog.loadHiderDeck();
    for (const issue of catalog.issues) {
      console.warn(`[cards:${issue.level}] ${issue.message}`);
    }

    this.hiderDeck = catalog.enabledCards.map(card => ({
      title: card.name,
      description: card.description,
      castingCost: card.effectType ?? '',
    }));

    this.hiderHand = this.hiderDeck.slice(0, 3);
    this.updateDrawPreview();
  }

  async loadDrawRulesFromQuestions(): Promise<void> {
    const res = await fetch('assets/questions/Preguntas_CABA.json', { cache: 'force-cache' });
    const catalog = (await res.json()) as QuestionsCatalog;

    const expectedOrder = ['matching', 'measuring', 'thermometer', 'radar', 'tentacles', 'photos'];
    this.drawRulesByCategory = expectedOrder
      .filter(categoryKey => Boolean(catalog.questions[categoryKey]))
      .map(categoryKey => {
        const category = catalog.questions[categoryKey];
        const { draw, take } = this.parseDrawTakeFromCost(category.cost);
        return {
          categoryKey,
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

  updateDrawPreview(): void {
    const takeCount = this.selectedRule?.take ?? 0;
    this.drawPreviewCards = this.hiderDeck.slice(0, takeCount);
  }

  setPhase(phase: GameBlueprint['currentTurn']['phase']): void {
    this.gameFacade.setPhase(phase);
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
}
