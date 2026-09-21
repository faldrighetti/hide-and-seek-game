import { AfterViewInit, Component, OnDestroy, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { Observable, Subscription } from 'rxjs';
import * as L from 'leaflet';
import { GameFacadeService } from '../../services/game-facade';
import {
  ActiveEffect,
  GameBlueprint,
  LobbyState,
  PendingQuestion,
  PlayerRole,
  QuestionResolution,
  TeamStanding,
} from '../../models/core-model';
import { HiderCardData } from 'src/app/models/hider-card-data';
import { CardCatalogService } from '../../cards/card-catalog.service';
import { CardDefinition } from 'src/app/models/card-definition.model';
import { GAME_CONFIG } from '../../config/game-config';
import { Station, StationsProcessedFile } from '../../models/station.model';

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
  distanceM?: number | null;
  customDistance?: boolean;
  availability?: string;
  answerGroups?: AnswerGroup[];
  endgameOnly?: boolean;
  resolutionMode?: string;
}

interface AnswerGroup {
  label: string;
  options: string[];
  dependsOn?: string;
  optionsByAnswer?: Record<string, string[]>;
}

interface QuestionCategory {
  key: string;
  name: string;
  cost: string | null;
  time: string | null;
  prompt?: string;
  placeholder?: string;
  placeholders?: string[];
  endgameOnly?: boolean;
  items: QuestionItem[];
}

interface QuestionsCatalog {
  questions: Record<string, {
    name: string;
    cost: string | null;
    time: string | null;
    prompt?: string;
    placeholder?: string;
    placeholders?: string[];
    endgameOnly?: boolean;
    items?: QuestionItem[];
  }>;
}

interface TurnActionState {
  title: string;
  detail: string;
  color: string;
}

interface MapNavigationBoundsAsset {
  southWest: { lat: number; lng: number };
  northEast: { lat: number; lng: number };
}

@Component({
  selector: 'app-game',
  templateUrl: './game.page.html',
  styleUrls: ['./game.page.scss'],
  standalone: false,
})
export class GamePage implements AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly gameFacade = inject(GameFacadeService);
  private readonly cardCatalog = inject(CardCatalogService);
  private readonly alertController = inject(AlertController);

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
  playingDiscardDrawPowerup = false;
  playingMovePowerupCardId: string | null = null;
  playingCurseCardId: string | null = null;
  completingEffectId: string | null = null;
  consultingEndgameQuestions = false;
  selectedLootCardIds: string[] = [];
  discardFromHandIds: string[] = [];
  activeDiscardDrawPowerupId: string | null = null;
  discardDrawSelectedCardIds: string[] = [];
  lootErrorMessage = '';
  powerupErrorMessage = '';
  curseErrorMessage = '';
  effectErrorMessage = '';
  endgameQuestionsMessage = '';
  endgameConsultationInFlight = false;
  endgameConsultationErrorMessage = '';
  questionErrorMessage = '';
  resolveQuestionErrorMessage = '';
  pendingAnswerText = '';
  operationalActionInFlight = false;
  operationalMessage = '';
  foundActionInFlight = false;
  foundErrorMessage = '';
  stations: Station[] = [];
  stationFilter = '';
  selectedBaseStation: Station | null = null;
  confirmingBaseStation = false;
  baseStationMessage = '';
  baseStationLoadError = '';
  now = Date.now();

  private readonly timerId = window.setInterval(() => {
    this.now = Date.now();
    void this.processDueTickIfNeeded();
  }, 1000);
  private readonly blueprintSubscription: Subscription;
  private readonly playerRoleSubscription: Subscription;
  private latestGameBlueprint: GameBlueprint | null = null;
  private latestPlayerRole: PlayerRole | null = null;
  private tickInFlight = false;
  private lastTickKey: string | null = null;
  private lastLootKey: string | null = null;
  private lastTurnIdentityKey: string | null = null;
  private baseStationMap?: L.Map;
  private baseStationMarkers = new Map<string, L.CircleMarker>();
  private baseStationZoneLayer = L.layerGroup();
  private baseStationBounds: L.LatLngBoundsExpression | null = null;
  private confirmedBaseStationMap?: L.Map;
  private confirmedBaseStationLayer = L.layerGroup();

  constructor() {
    this.gameFacade.loadGame(this.gameId);
    this.blueprintSubscription = this.blueprint$.subscribe(vm => {
      this.latestGameBlueprint = vm;
      this.syncTurnLocalState(vm);
      this.syncLootSelections(vm);
      setTimeout(() => {
        this.ensureBaseStationMap();
        this.renderBaseStationMarkers(vm);
        this.ensureConfirmedBaseStationMap();
        this.renderConfirmedBaseStationMap(vm);
      }, 0);
    });
    this.playerRoleSubscription = this.playerRole$.subscribe(role => {
      this.latestPlayerRole = role;
    });
    void this.loadCardsFromCatalog();
    void this.loadQuestionsCatalog();
    void this.loadBaseStationMapData();
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.ensureBaseStationMap(), 0);
  }

  ngOnDestroy(): void {
    window.clearInterval(this.timerId);
    this.blueprintSubscription.unsubscribe();
    this.playerRoleSubscription.unsubscribe();
    this.baseStationMap?.remove();
    this.confirmedBaseStationMap?.remove();
  }

  private async processDueTickIfNeeded(): Promise<void> {
    const vm = this.latestGameBlueprint;
    const role = this.latestPlayerRole;
    if (!vm || vm.status !== 'LIVE' || !role?.isParticipant || this.tickInFlight || vm.operational.mode !== 'NORMAL') {
      return;
    }

    const phaseDue = this.secondsUntil(vm.currentTurn.endsAtIso) <= 0;
    const questionDue = Boolean(vm.currentTurn.pendingQuestionEndsAtIso && this.secondsUntil(vm.currentTurn.pendingQuestionEndsAtIso) <= 0);
    const moveDue = Boolean(vm.currentTurn.moveState?.status === 'ACTIVE' && vm.currentTurn.moveState.endsAtIso && this.secondsUntil(vm.currentTurn.moveState.endsAtIso) <= 0);
    if (!phaseDue && !questionDue && !moveDue) {
      return;
    }

    const tickKey = `${vm.currentTurn.runNumber}:${vm.currentTurn.phase}:${vm.currentTurn.endsAtIso}:${vm.currentTurn.pendingQuestionId ?? ''}:${vm.currentTurn.pendingQuestionEndsAtIso ?? ''}:${vm.currentTurn.moveState?.endsAtIso ?? ''}`;
    if (this.lastTickKey === tickKey) {
      return;
    }

    this.tickInFlight = true;
    this.lastTickKey = tickKey;
    try {
      await this.gameFacade.processGameTick(this.gameId);
    } catch (error) {
      console.warn('[game] No se pudo procesar el vencimiento de turno', error);
    } finally {
      this.tickInFlight = false;
    }
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

    const expectedOrder = ['matching', 'measuring', 'thermometer', 'radar', 'tentacles', 'endgame', 'photos'];
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
        placeholders: category.placeholders,
        endgameOnly: category.endgameOnly,
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

  async loadBaseStationMapData(): Promise<void> {
    try {
      const [boundsResponse, stationsResponse] = await Promise.all([
        fetch('assets/map-generator.bounds.json', { cache: 'force-cache' }),
        fetch('assets/stations.processed.json', { cache: 'force-cache' }),
      ]);
      if (!boundsResponse.ok || !stationsResponse.ok) {
        throw new Error('No se pudieron cargar las estaciones.');
      }

      const bounds = (await boundsResponse.json()) as MapNavigationBoundsAsset;
      const stationsFile = (await stationsResponse.json()) as StationsProcessedFile;
      this.baseStationBounds = [
        [bounds.southWest.lat, bounds.southWest.lng],
        [bounds.northEast.lat, bounds.northEast.lng],
      ];
      this.stations = stationsFile.stations.filter(station => station.isPlayable);
      this.ensureBaseStationMap();
      this.renderBaseStationMarkers(this.latestBlueprint());
    } catch (error) {
      this.baseStationLoadError = error instanceof Error ? error.message : 'No se pudieron cargar las estaciones.';
    }
  }

  baseStationFlowVisible(vm: GameBlueprint, role: PlayerRole): boolean {
    return role.isHider && (vm.currentTurn.phase === 'ESCAPE' || vm.currentTurn.baseStationSelectionRequired);
  }

  baseStationStatusText(vm: GameBlueprint): string {
    if (vm.currentTurn.hidingZone?.stationId) {
      const station = this.stationById(vm.currentTurn.hidingZone.stationId);
      return `Confirmada: ${station ? this.stationLabel(station) : vm.currentTurn.hidingZone.stationId}.`;
    }
    if (vm.currentTurn.baseStationSelectionRequired) {
      return 'Quedaron varias estaciones posibles al terminar ESCAPE. Elegí una para habilitar preguntas.';
    }
    return 'Durante ESCAPE podés marcar una estación como objetivo y confirmarla cuando estés dentro de su zona.';
  }

  pendingBaseStationCandidates(vm: GameBlueprint): Station[] {
    const ids = new Set(vm.currentTurn.baseStationCandidateIds);
    return this.stations.filter(station => ids.has(station.id));
  }

  visibleBaseStationList(vm: GameBlueprint): Station[] {
    const source = vm.currentTurn.baseStationSelectionRequired
      ? this.pendingBaseStationCandidates(vm)
      : this.stations;
    const normalizedFilter = this.normalizeText(this.stationFilter);
    const stations = normalizedFilter
      ? this.stations.filter(station =>
        this.normalizeText(station.name).includes(normalizedFilter)
        || this.normalizeText(station.line).includes(normalizedFilter)
        || this.normalizeText(station.mode).includes(normalizedFilter),
      )
      : source;
    return stations.slice(0, normalizedFilter ? 12 : 8);
  }

  selectBaseStation(station: Station, vm?: GameBlueprint): void {
    this.selectedBaseStation = station;
    this.baseStationMessage = '';
    this.renderBaseStationMarkers(vm ?? this.latestBlueprint());
    this.renderSelectedBaseStationZone();
    this.baseStationMap?.setView([station.lat, station.lng], Math.max(this.baseStationMap.getZoom(), 14), {
      animate: true,
    });
  }

  onBaseStationSearch(event: Event): void {
    const value = (event as CustomEvent<{ value?: string }>).detail?.value ?? '';
    this.stationFilter = value;
  }

  async confirmSelectedBaseStation(vm: GameBlueprint, role: PlayerRole): Promise<void> {
    if (!role.isHider) {
      this.baseStationMessage = 'Solo el hider puede confirmar estación base.';
      return;
    }
    if (!this.selectedBaseStation) {
      this.baseStationMessage = 'Seleccioná una estación primero.';
      return;
    }

    const ok = window.confirm(`¿Confirmar ${this.selectedBaseStation.name} como estación base?`);
    if (!ok) {
      return;
    }

    this.confirmingBaseStation = true;
    this.baseStationMessage = '';
    try {
      await this.gameFacade.confirmBaseStation(this.gameId, this.selectedBaseStation.id);
      this.baseStationMessage = `${this.selectedBaseStation.name} confirmada como estación base.`;
    } catch (error) {
      this.baseStationMessage = error instanceof Error ? error.message : 'No se pudo confirmar estación base.';
    } finally {
      this.confirmingBaseStation = false;
      this.renderBaseStationMarkers(vm);
    }
  }

  selectSeekerQuestion(category: QuestionCategory, question: QuestionItem): void {
    const vm = this.latestBlueprint();
    if (vm && this.isQuestionAlreadyAsked(category, question, vm)) {
      this.questionErrorMessage = 'Esa pregunta ya fue hecha en este turno.';
      return;
    }
    if (vm && this.isQuestionCategoryOnCooldown(category, vm)) {
      this.questionErrorMessage = this.categoryCooldownLabel(category, vm);
      return;
    }

    this.selectedSeekerQuestion = { category, question };
    this.questionErrorMessage = '';
  }

  visibleQuestionCategories(vm: GameBlueprint): QuestionCategory[] {
    return this.questionCategories.filter(category => !category.endgameOnly || vm.currentTurn.endgameQuestionsUnlocked);
  }

  async consultEndgameQuestions(role: PlayerRole): Promise<void> {
    if (!role.isSeeker) {
      this.endgameQuestionsMessage = 'Solo los seekers pueden consultar endgame.';
      return;
    }

    this.consultingEndgameQuestions = true;
    this.endgameQuestionsMessage = '';
    try {
      const result = await this.gameFacade.consultEndgameQuestions(this.gameId);
      this.endgameQuestionsMessage = result.cooldownActive
        ? 'Esperá un momento antes de volver a consultar endgame.'
        : result.unlocked
        ? 'Preguntas de endgame disponibles.'
        : 'Todavía no hay preguntas de endgame disponibles.';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo consultar endgame.';
      this.endgameQuestionsMessage = message;
    } finally {
      this.consultingEndgameQuestions = false;
    }
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
    const vm = this.latestBlueprint();
    if (vm && this.isQuestionAlreadyAsked(category, question, vm)) {
      this.questionErrorMessage = 'Esa pregunta ya fue hecha en este turno.';
      return;
    }
    if (vm && this.isQuestionCategoryOnCooldown(category, vm)) {
      this.questionErrorMessage = this.categoryCooldownLabel(category, vm);
      return;
    }

    const customDistanceM = await this.customRadarDistanceM(category, question);
    if (customDistanceM === null && this.isCustomRadarQuestion(category, question)) {
      return;
    }

    const prompt = this.questionPromptText(category, question, customDistanceM ?? undefined);
    if (!prompt.trim()) {
      this.questionErrorMessage = 'La pregunta seleccionada no tiene texto.';
      return;
    }
    const distanceM = this.selectedQuestionDistanceM(question, customDistanceM);

    this.sendingQuestion = true;
    this.questionErrorMessage = '';
    try {
      await this.gameFacade.sendQuestion(this.gameId, category.key, prompt, category.key === 'photos', {
        distanceM,
        customDistanceM: customDistanceM ?? undefined,
        randomizePool: this.randomizePoolForQuestion(category, question, customDistanceM ?? undefined),
      });
      this.selectedSeekerQuestion = null;
    } catch (error) {
      this.questionErrorMessage = this.friendlyFunctionError(error, 'No se pudo enviar la pregunta.');
    } finally {
      this.sendingQuestion = false;
    }
  }

  async resolvePendingQuestion(resolution: QuestionResolution, role: PlayerRole): Promise<void> {
    if (!role.isHider) {
      this.resolveQuestionErrorMessage = 'Solo el hider puede responder preguntas.';
      return;
    }

    const answerText = this.pendingAnswerText.trim();
    if (resolution === 'ANSWER' && !answerText) {
      this.resolveQuestionErrorMessage = 'Escribí la respuesta antes de enviarla.';
      return;
    }
    if ((resolution === 'VETO' || resolution === 'RANDOMIZE') && !(await this.confirmPowerResolution(resolution))) {
      return;
    }

    this.resolvingQuestion = resolution;
    this.resolveQuestionErrorMessage = '';
    try {
      await this.gameFacade.resolveQuestion(this.gameId, resolution, answerText || undefined);
      this.pendingAnswerText = '';
    } catch (error) {
      this.resolveQuestionErrorMessage = this.friendlyFunctionError(error, 'No se pudo resolver la pregunta.');
    } finally {
      this.resolvingQuestion = null;
    }
  }

  toggleLootSelection(cardId: string, takeLimit: number): void {
    this.lootErrorMessage = '';
    if (this.selectedLootCardIds.includes(cardId)) {
      this.selectedLootCardIds = this.selectedLootCardIds.filter(selectedId => selectedId !== cardId);
      if (this.selectedLootCardIds.length === 0) {
        this.discardFromHandIds = [];
      }
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

  lootConfirmLabel(): string {
    if (this.selectingLoot) {
      return 'Guardando...';
    }
    if (this.selectedLootCardIds.length > 0) {
      return 'Guardar seleccion';
    }
    if (this.discardFromHandIds.length > 0) {
      return 'Confirmar descartes';
    }
    return 'Descartar loot';
  }

  canConfirmLoot(vm: GameBlueprint): boolean {
    return (
      !this.selectingLoot
      && Boolean(vm.currentTurn.lootOffer)
      && this.projectedHandSize(vm.currentTurn.hiderHandIds.length) <= vm.deckPolicy.maxSize
    );
  }

  lootInstruction(vm: GameBlueprint): string {
    const lootOffer = vm.currentTurn.lootOffer;
    if (!lootOffer) {
      return '';
    }

    const projectedSize = this.projectedHandSize(vm.currentTurn.hiderHandIds.length);
    if (this.selectedLootCardIds.length === 0) {
      return 'Primero elegí cartas del loot. La mano se habilita después, solo si necesitás descartar para hacer lugar.';
    }

    if (projectedSize > vm.deckPolicy.maxSize) {
      const excess = projectedSize - vm.deckPolicy.maxSize;
      return `Descarta ${excess} carta${excess === 1 ? '' : 's'} mas de tu mano para respetar el maximo de ${vm.deckPolicy.maxSize}.`;
    }

    return 'Listo para guardar esta seleccion.';
  }


  movePowerupCards(handIds: string[]): HiderCardData[] {
    return this.cardsForIds(handIds).filter(card => this.baseCardId(card.id) === 'powerup_move');
  }

  moveRemainingSeconds(vm: GameBlueprint): number {
    const endsAtIso = vm.currentTurn.moveState?.endsAtIso;
    return endsAtIso ? this.secondsUntil(endsAtIso) : 0;
  }

  async playMovePowerup(card: HiderCardData, role: PlayerRole, vm: GameBlueprint): Promise<void> {
    this.powerupErrorMessage = '';
    if (!role.isHider) {
      this.powerupErrorMessage = 'Solo el hider puede jugar esta carta.';
      return;
    }
    if (vm.currentTurn.lootOffer) {
      this.powerupErrorMessage = 'Primero resolvé el loot pendiente.';
      return;
    }
    if (vm.currentTurn.pendingQuestion) {
      this.powerupErrorMessage = 'No podés jugar SALÍ DE AHÍ con una pregunta pendiente.';
      return;
    }
    if (vm.currentTurn.endgameActive) {
      this.powerupErrorMessage = 'No podés jugar SALÍ DE AHÍ durante endgame.';
      return;
    }

    const confirmed = await this.confirmMovePowerup();

    if (!confirmed) {
      return;
    }

    this.playingMovePowerupCardId = card.id;
    try {
      await this.gameFacade.playMovePowerup(this.gameId, card.id);
    } catch (error) {
      this.powerupErrorMessage = this.friendlyFunctionError(error, 'No se pudo jugar SALÍ DE AHÍ.');
    } finally {
      this.playingMovePowerupCardId = null;
    }
  }
  discardDrawPowerupCards(handIds: string[]): HiderCardData[] {
    return this.cardsForIds(handIds).filter(card => {
      const baseId = this.baseCardId(card.id);
      return baseId === 'powerup_discard1_draw2' || baseId === 'powerup_discard2_draw3';
    });
  }

  startDiscardDrawPowerup(cardId: string, vm: GameBlueprint): void {
    this.powerupErrorMessage = '';
    if (vm.currentTurn.lootOffer) {
      this.powerupErrorMessage = 'Primero resolvé el loot pendiente.';
      return;
    }

    this.activeDiscardDrawPowerupId = cardId;
    this.discardDrawSelectedCardIds = [];
  }

  cancelDiscardDrawPowerup(): void {
    this.activeDiscardDrawPowerupId = null;
    this.discardDrawSelectedCardIds = [];
    this.powerupErrorMessage = '';
  }

  canConfirmDiscardDrawPowerup(role: PlayerRole): boolean {
    const required = this.activeDiscardDrawRequiredCount();
    return role.isHider
      && !this.playingDiscardDrawPowerup
      && Boolean(this.activeDiscardDrawPowerupId)
      && required > 0
      && this.discardDrawSelectedCardIds.length === required;
  }

  async confirmDiscardDrawPowerup(role: PlayerRole): Promise<void> {
    if (!role.isHider || !this.activeDiscardDrawPowerupId) {
      this.powerupErrorMessage = 'Solo el hider puede jugar esta carta.';
      return;
    }

    const required = this.activeDiscardDrawRequiredCount();
    if (this.discardDrawSelectedCardIds.length !== required) {
      this.powerupErrorMessage = `Elegí exactamente ${required} carta${required === 1 ? '' : 's'} para descartar.`;
      return;
    }

    this.playingDiscardDrawPowerup = true;
    this.powerupErrorMessage = '';
    try {
      await this.gameFacade.playDiscardDrawPowerup(
        this.gameId,
        this.activeDiscardDrawPowerupId,
        this.discardDrawSelectedCardIds,
      );
      this.cancelDiscardDrawPowerup();
    } catch (error) {
      this.powerupErrorMessage = this.friendlyFunctionError(error, 'No se pudo jugar la carta.');
    } finally {
      this.playingDiscardDrawPowerup = false;
    }
  }

  async playCurse(card: HiderCardData, role: PlayerRole): Promise<void> {
    if (!role.isHider) {
      this.curseErrorMessage = 'Solo el hider puede activar maldiciones.';
      return;
    }

    this.playingCurseCardId = card.id;
    this.curseErrorMessage = '';
    try {
      await this.gameFacade.playCurse(
        this.gameId,
        card.id,
        Boolean(card.blocksQuestions),
        Boolean(card.blocksTransport),
        this.expiresAtMillis(card.durationMinutes),
      );
    } catch (error) {
      this.curseErrorMessage = error instanceof Error ? error.message : 'No se pudo activar la maldición.';
    } finally {
      this.playingCurseCardId = null;
    }
  }

  async completeCurseEffect(effect: ActiveEffect, role: PlayerRole): Promise<void> {
    if (!role.isSeeker && !role.isHider) {
      this.effectErrorMessage = 'Solo jugadores del turno pueden confirmar maldiciones.';
      return;
    }

    this.completingEffectId = effect.id;
    this.effectErrorMessage = '';
    try {
      await this.gameFacade.completeCurseEffect(this.gameId, effect.id);
    } catch (error) {
      this.effectErrorMessage = error instanceof Error ? error.message : 'No se pudo confirmar la maldición.';
    } finally {
      this.completingEffectId = null;
    }
  }

  async pauseGame(role: PlayerRole): Promise<void> {
    if (!role.isParticipant) {
      this.operationalMessage = 'Solo jugadores de la partida pueden pausar.';
      return;
    }
    const reason = window.prompt('Motivo de pausa')?.trim() || null;
    await this.runOperationalAction(() => this.gameFacade.pauseGame(this.gameId, reason), 'Partida pausada.');
  }

  async resumeGame(role: PlayerRole): Promise<void> {
    if (!role.isHost) {
      this.operationalMessage = 'Solo el host puede reanudar.';
      return;
    }
    await this.runOperationalAction(() => this.gameFacade.resumeGame(this.gameId), 'Partida reanudada.');
  }

  async declareEmergency(role: PlayerRole): Promise<void> {
    if (!role.isParticipant) {
      this.operationalMessage = 'Solo jugadores de la partida pueden declarar emergencia.';
      return;
    }
    const reason = window.prompt('Motivo de emergencia')?.trim() || null;
    await this.runOperationalAction(() => this.gameFacade.declareEmergency(this.gameId, reason), 'Emergencia declarada.');
  }

  async cancelGame(role: PlayerRole): Promise<void> {
    if (!role.isHost) {
      this.operationalMessage = 'Solo el host puede finalizar la partida.';
      return;
    }
    const reason = window.prompt('Motivo de finalización')?.trim() || null;
    const confirmed = window.confirm('¿Finalizar y cerrar la partida? Esta acción no continúa el turno.');
    if (!confirmed) {
      return;
    }
    await this.runOperationalAction(() => this.gameFacade.cancelGame(this.gameId, reason), 'Partida finalizada.');
  }

  private async runOperationalAction(action: () => Promise<{ ok: boolean }>, successMessage: string): Promise<void> {
    this.operationalActionInFlight = true;
    this.operationalMessage = '';
    try {
      await action();
      this.operationalMessage = successMessage;
    } catch (error) {
      this.operationalMessage = error instanceof Error ? error.message : 'No se pudo ejecutar la acción operativa.';
    } finally {
      this.operationalActionInFlight = false;
    }
  }

  curseCards(cardIds: string[]): HiderCardData[] {
    return this.cardsForIds(cardIds).filter(card => card.type === 'CURSE');
  }

  hasQuestionBlockingEffect(effects: ActiveEffect[]): boolean {
    return effects.some(effect => effect.blocksQuestions);
  }

  curseActivationHint(card: HiderCardData): string {
    const curseId = this.baseCardId(card.id);
    const specific: Record<string, string> = {
      curse_2: 'Prepará la imagen de Street View y mandala por WhatsApp; no se automatiza la búsqueda.',
      curse_5: 'No bloquea acciones: dejala activa como recordatorio durante las próximas 3 preguntas.',
      curse_8: 'Aplicación inmediata: los seekers bajan en la próxima estación si hay alternativa dentro de 30 minutos.',
      curse_19: 'Antes de activarla, filmá el pájaro y acordá por WhatsApp la duración objetivo.',
      curse_26: 'Ubicación manual: los seekers confirman por WhatsApp cuando cruzan a otro barrio.',
      curse_29: 'Ubicación manual: los seekers confirman por WhatsApp cuando llegan a una avenida.',
      curse_34: 'Aplica a las próximas 5 preguntas; cada mensaje empieza con audios y lista de animales.',
      curse_39: 'El personaje se define manualmente entre jugadores; el sistema sólo controla los 15 minutos.',
    };

    if (specific[curseId]) {
      return specific[curseId];
    }
    if (card.blocksQuestions || card.blocksTransport) {
      return 'Bloqueo hasta completar: la prueba se manda y confirma por WhatsApp.';
    }
    return 'Efecto recordatorio: usalo para dejar visible la regla mientras esté activa.';
  }

  curseCompletionHint(curseIdWithCopy: string): string {
    const curseId = this.baseCardId(curseIdWithCopy);
    const specific: Record<string, string> = {
      curse_2: 'Completar cuando una foto del lugar real sea aceptada por hider o seekers.',
      curse_5: 'Completar manualmente después de resolver 3 preguntas bajo este modificador.',
      curse_8: 'Completar cuando los seekers informen que bajaron o que no había alternativa válida.',
      curse_19: 'Completar cuando el video seeker iguale o supere la duración objetivo.',
      curse_26: 'Completar cuando al menos un lado confirme el cambio de barrio por WhatsApp.',
      curse_29: 'Completar cuando al menos un lado confirme llegada a una avenida por WhatsApp.',
      curse_34: 'Completar después de 5 preguntas con audios/lista de animales aceptados.',
      curse_39: 'Se completa solo por tiempo o manualmente si ambas partes lo dan por terminado.',
    };

    if (specific[curseId]) {
      return specific[curseId];
    }
    return 'Completar cuando la evidencia enviada por WhatsApp quede aceptada por al menos un lado.';
  }

  activeCurseProgressLabel(effect: ActiveEffect): string {
    const curseId = this.baseCardId(effect.curseId);
    const labels: Record<string, string> = {
      curse_5: 'Progreso manual: próximas 3 preguntas.',
      curse_34: 'Progreso manual: próximas 5 preguntas.',
      curse_39: 'Progreso por tiempo: 15 minutos desde activación.',
      curse_26: 'Validación manual de ubicación: cambio de barrio.',
      curse_29: 'Validación manual de ubicación: avenida.',
    };

    if (labels[curseId]) {
      return labels[curseId];
    }
    if (effect.blocksQuestions || effect.blocksTransport) {
      return 'Pendiente de evidencia/confirmación.';
    }
    return 'Activo como recordatorio operativo.';
  }

  effectTitle(curseId: string): string {
    return this.fallbackCardByBaseId.get(curseId)?.title ?? curseId;
  }

  effectCompletionLabel(effect: ActiveEffect, role: PlayerRole): string {
    if (this.completingEffectId === effect.id) {
      return 'Confirmando...';
    }

    const curseId = this.baseCardId(effect.curseId);
    if (curseId === 'curse_5' || curseId === 'curse_34') {
      return 'Marcar completada';
    }
    if (curseId === 'curse_26' || curseId === 'curse_29') {
      return 'Confirmar ubicación';
    }

    if (role.isHider) {
      return effect.expiresAtIso ? 'Cerrar efecto' : 'Aceptar evidencia';
    }

    return effect.expiresAtIso ? 'Cerrar manualmente' : 'Confirmar por WhatsApp';
  }

  toggleHandDiscard(cardId: string): void {
    if (this.activeDiscardDrawPowerupId) {
      this.toggleDiscardDrawSelection(cardId);
      return;
    }

    this.lootErrorMessage = '';
    const vm = this.latestBlueprint();
    if (vm?.currentTurn.lootOffer && this.selectedLootCardIds.length === 0) {
      this.lootErrorMessage = 'Primero elegí una carta del loot; después podés descartar de tu mano si hace falta.';
      return;
    }
    if (this.baseCardId(cardId).startsWith('powerup_')) {
      this.lootErrorMessage = 'Las cartas de poder se juegan desde su accion, no como descarte de loot.';
      return;
    }
    if (this.discardFromHandIds.includes(cardId)) {
      this.discardFromHandIds = this.discardFromHandIds.filter(selectedId => selectedId !== cardId);
      return;
    }

    this.discardFromHandIds = [...this.discardFromHandIds, cardId];
  }

  handTitle(vm: GameBlueprint): string {
    if (this.activeDiscardDrawPowerupId) {
      const required = this.activeDiscardDrawRequiredCount();
      return `Mano (elegí ${required} para descartar)`;
    }
    if (vm.currentTurn.lootOffer) {
      return this.selectedLootCardIds.length > 0 ? 'Mano (tocá para descartar)' : 'Mano (elegí loot primero)';
    }
    return 'Mano';
  }

  handSelectable(vm: GameBlueprint): boolean {
    if (this.activeDiscardDrawPowerupId !== null) {
      return true;
    }
    return vm.currentTurn.lootOffer !== null && this.selectedLootCardIds.length > 0;
  }

  selectedHandCardIds(): string[] {
    return this.activeDiscardDrawPowerupId ? this.discardDrawSelectedCardIds : this.discardFromHandIds;
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

  isQuestionCategoryOnCooldown(category: QuestionCategory, vm: GameBlueprint): boolean {
    return this.categoryCooldownRemainingSeconds(category, vm) > 0;
  }

  isQuestionAlreadyAsked(category: QuestionCategory, question: QuestionItem, vm: GameBlueprint): boolean {
    const prompt = this.questionPromptText(category, question).trim();
    return prompt.length > 0 && vm.currentTurn.askedQuestionPrompts.includes(prompt);
  }

  availableQuestionCount(category: QuestionCategory, vm: GameBlueprint): number {
    return category.items.filter(question => !this.isQuestionAlreadyAsked(category, question, vm)).length;
  }

  categoryCooldownLabel(category: QuestionCategory, vm: GameBlueprint): string {
    const remainingSeconds = this.categoryCooldownRemainingSeconds(category, vm);
    if (remainingSeconds <= 0) {
      return '';
    }

    const cooldownIso = vm.currentTurn.categoryCooldowns[category.key];
    const availableAt = cooldownIso
      ? new Date(cooldownIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    return `No disponible por ${this.formatTime(remainingSeconds)}${availableAt ? `. Disponible a las ${availableAt}` : ''}.`;
  }

  private categoryCooldownRemainingSeconds(category: QuestionCategory, vm: GameBlueprint): number {
    const cooldownIso = vm.currentTurn.categoryCooldowns[category.key];
    return this.secondsUntil(cooldownIso ?? null);
  }

  questionText(category: QuestionCategory, question: QuestionItem, customDistanceM?: number): string {
    if (question.prompt) {
      return question.prompt;
    }

    if (category.prompt && category.placeholder && question.distance) {
      return category.prompt.replace(category.placeholder, question.distance);
    }

    if (category.prompt && category.placeholder && customDistanceM !== undefined) {
      return category.prompt.replace(category.placeholder, `${customDistanceM} metros`);
    }

    if (category.prompt && category.placeholder && question.customDistance) {
      return category.prompt.replace(category.placeholder, 'una distancia personalizada');
    }

    if (category.prompt && category.placeholder && question.asunto) {
      return category.prompt.replace(category.placeholder, question.asunto);
    }

    if (category.prompt && category.placeholders?.length) {
      return category.placeholders.reduce((text, placeholder) => {
        if (placeholder === '[Lugares]' && question.places) {
          return text.replace(placeholder, question.places);
        }
        if (placeholder === '[Distancia]' && question.distance) {
          return text.replace(placeholder, question.distance);
        }
        return text;
      }, category.prompt);
    }

    return question.asunto ?? '';
  }

  questionResultTitle(vm: GameBlueprint): string {
    const result = vm.currentTurn.lastQuestionResult;
    if (!result) {
      return '';
    }

    const labels: Record<string, string> = {
      ANSWER: 'Respuesta recibida',
      VETO: 'Pregunta vetada',
      RANDOMIZE: 'Pregunta randomizada',
      TIMEOUT: 'Pregunta vencida',
    };
    return labels[result.resolution] ?? 'Pregunta resuelta';
  }

  questionResultBody(vm: GameBlueprint): string {
    const result = vm.currentTurn.lastQuestionResult;
    if (!result) {
      return '';
    }

    if (result.resolution === 'ANSWER') {
      return result.answerText || 'El hider registró la respuesta.';
    }
    if (result.resolution === 'VETO') {
      return 'El hider usó Veto. La pregunta queda resuelta sin respuesta.';
    }
    if (result.resolution === 'TIMEOUT') {
      return 'El hider no respondió a tiempo. La pregunta queda resuelta y los seekers reciben 30 minutos de bonus.';
    }
    return 'El hider usó Randomizar. La pregunta original queda resuelta.';
  }

  randomizedQuestionText(pendingQuestion: PendingQuestion | null): string {
    return pendingQuestion?.prompt ?? '';
  }

  questionPromptText(category: QuestionCategory, question: QuestionItem, customDistanceM?: number): string {
    const questionText = this.questionText(category, question, customDistanceM);
    const answerText = this.answerGroupsText(question);
    return answerText ? `${questionText} ${answerText}` : questionText;
  }

  answerGroupsText(question: QuestionItem): string {
    if (!question.answerGroups?.length) {
      return '';
    }

    return question.answerGroups
      .map(group => this.answerGroupText(group))
      .join(' ');
  }

  answerGroupText(group: AnswerGroup): string {
    if (group.optionsByAnswer) {
      const options = Object.entries(group.optionsByAnswer)
        .map(([answer, values]) => `si ${answer}: ${values.join(' / ')}`)
        .join('; ');
      return `${group.label}: ${options}.`;
    }

    return `${group.label}: ${group.options.join(' / ')}.`;
  }

  cardsForIds(cardIds: string[]): HiderCardData[] {
    return cardIds.map(cardId => this.cardForId(cardId));
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


  async resolveEndgameConsultation(confirmed: boolean, role: PlayerRole): Promise<void> {
    if (!role.isHider) {
      this.endgameConsultationErrorMessage = 'Solo el hider puede responder la consulta de endgame.';
      return;
    }

    this.endgameConsultationInFlight = true;
    this.endgameConsultationErrorMessage = '';
    try {
      await this.gameFacade.resolveEndgameConsultation(this.gameId, confirmed);
    } catch (error) {
      this.endgameConsultationErrorMessage = this.friendlyFunctionError(error, 'No se pudo responder la consulta de endgame.');
    } finally {
      this.endgameConsultationInFlight = false;
    }
  }
  async startCaptureAttempt(role: PlayerRole): Promise<void> {
    if (!role.isSeeker || !role.teamId) {
      this.foundErrorMessage = 'Solo los seekers pueden iniciar captura.';
      return;
    }

    this.foundActionInFlight = true;
    this.foundErrorMessage = '';
    try {
      await this.gameFacade.startCaptureAttempt(this.gameId);
    } catch (error) {
      this.foundErrorMessage = error instanceof Error ? error.message : 'No se pudo iniciar captura.';
    } finally {
      this.foundActionInFlight = false;
    }
  }

  async resolveCaptureAttempt(confirmed: boolean, role: PlayerRole): Promise<void> {
    if (!role.isHider) {
      this.foundErrorMessage = 'Solo el hider puede responder el intento.';
      return;
    }

    this.foundActionInFlight = true;
    this.foundErrorMessage = '';
    try {
      await this.gameFacade.resolveCaptureAttempt(this.gameId, confirmed);
    } catch (error) {
      this.foundErrorMessage = error instanceof Error ? error.message : 'No se pudo responder captura.';
    } finally {
      this.foundActionInFlight = false;
    }
  }

  async confirmCaptureBySeeker(role: PlayerRole): Promise<void> {
    if (!role.isSeeker) {
      this.foundErrorMessage = 'Solo seekers pueden confirmar captura.';
      return;
    }

    this.foundActionInFlight = true;
    this.foundErrorMessage = '';
    try {
      await this.gameFacade.confirmCaptureBySeeker(this.gameId);
    } catch (error) {
      this.foundErrorMessage = error instanceof Error ? error.message : 'No se pudo confirmar captura.';
    } finally {
      this.foundActionInFlight = false;
    }
  }

  captureStatusLabel(vm: GameBlueprint): string {
    const attempt = vm.currentTurn.captureAttempt;
    if (!attempt) {
      return 'Sin intento activo';
    }
    if (attempt.status === 'PENDING_HIDER') {
      return `Pendiente del hider. Iniciado por Equipo ${attempt.createdByTeamId}.`;
    }
    if (attempt.status === 'REJECTED') {
      return 'Rechazado por el hider. Seekers pueden ratificar.';
    }
    return 'Captura confirmada.';
  }

  seekerAlreadyConfirmedCapture(vm: GameBlueprint, role: PlayerRole): boolean {
    return Boolean(role.teamId && vm.currentTurn.captureAttempt?.seekerConfirmations.includes(role.teamId));
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

  sortedStandings(standings: TeamStanding[]): TeamStanding[] {
    return [...standings].sort((a, b) => {
      const totalDiff = b.totalTimeSeconds - a.totalTimeSeconds;
      if (totalDiff !== 0) {
        return totalDiff;
      }
      return b.bestSingleRunSeconds - a.bestSingleRunSeconds;
    });
  }

  winnerStandings(vm: GameBlueprint): TeamStanding[] {
    const winnerIds = new Set(vm.winnerTeamIds);
    const winners = vm.standings.filter(team => winnerIds.has(team.id));
    if (winners.length > 0) {
      return this.sortedStandings(winners);
    }

    return this.sortedStandings(vm.standings).slice(0, 1);
  }

  teamDisplayName(team: TeamStanding, lobby: LobbyState | null): string {
    const teamName = team.name.startsWith('Team ') ? team.name.replace(/^Team /, 'Equipo ') : team.name;
    const members = lobby?.seats
      .filter(seat => seat.teamId === team.id)
      .map(seat => seat.displayName.trim())
      .filter(Boolean) ?? [];

    return members.length > 0 ? `${teamName} - ${this.joinNames(members)}` : teamName;
  }

  winnerTitle(vm: GameBlueprint, lobby: LobbyState | null): string {
    const winners = this.winnerStandings(vm);
    if (winners.length === 0) {
      return 'Partida finalizada';
    }

    if (winners.length === 1) {
      return `Ganador: ${this.teamDisplayName(winners[0], lobby)}`;
    }

    return `Ganadores: ${winners.map(team => this.teamDisplayName(team, lobby)).join(', ')}`;
  }

  private joinNames(names: string[]): string {
    if (names.length <= 1) {
      return names[0] ?? '';
    }

    return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
  }

  standingResultLabel(vm: GameBlueprint, team: TeamStanding): string {
    return vm.winnerTeamIds.includes(team.id) ? 'Ganador' : 'Finalizado';
  }

  secondsUntil(iso: string | null): number {
    if (!iso) {
      return 0;
    }
    return Math.max(0, Math.ceil((new Date(iso).getTime() - this.now) / 1000));
  }

  phaseRemainingSeconds(vm: GameBlueprint): number {
    if (vm.status !== 'LIVE' || vm.currentTurn.phase === 'ENDED') {
      return 0;
    }

    if (vm.operational.mode !== 'NORMAL' && vm.operational.phaseRemainingSeconds !== null) {
      return Math.max(0, vm.operational.phaseRemainingSeconds);
    }

    return this.secondsUntil(vm.currentTurn.endsAtIso);
  }

  phaseElapsedSeconds(vm: GameBlueprint): number {
    if (vm.status !== 'LIVE' || vm.currentTurn.phase === 'ENDED') {
      return 0;
    }

    if (!vm.currentTurn.startedAtIso) {
      const totalByPhase: Record<GameBlueprint['currentTurn']['phase'], number> = {
        INTERMISSION: vm.settings.intermissionSeconds,
        ESCAPE: vm.settings.escapeSeconds,
        CHASE: vm.settings.chaseMaxSeconds,
        ENDED: 0,
      };
      return Math.max(0, totalByPhase[vm.currentTurn.phase] - this.phaseRemainingSeconds(vm));
    }

    return Math.max(0, Math.floor((this.now - new Date(vm.currentTurn.startedAtIso).getTime()) / 1000));
  }

  roleLabel(role: PlayerRole): string {
    if (role.isHider) {
      return 'Hider';
    }
    if (role.isSeeker) {
      return 'Seeker';
    }
    if (role.isHost) {
      return 'Host';
    }
    return 'Sin seat';
  }

  baseStationSummary(vm: GameBlueprint): string {
    const stationId = vm.currentTurn.hidingZone?.stationId;
    if (!stationId) {
      return vm.currentTurn.baseStationSelectionRequired ? 'Pendiente' : '-';
    }

    const station = this.stationById(stationId);
    return station ? this.baseStationLabel(station) : stationId;
  }

  pendingQuestionRemainingSeconds(vm: GameBlueprint, pendingQuestion: PendingQuestion | null = null): number {
    if (vm.status !== 'LIVE' || vm.currentTurn.phase === 'ENDED') {
      return 0;
    }

    if (vm.operational.mode !== 'NORMAL' && vm.operational.pendingQuestionRemainingSeconds !== null) {
      return Math.max(0, vm.operational.pendingQuestionRemainingSeconds);
    }

    return this.secondsUntil(pendingQuestion?.expiresAtIso ?? vm.currentTurn.pendingQuestionEndsAtIso);
  }

  turnActionState(vm: GameBlueprint, role: PlayerRole, pendingQuestion: PendingQuestion | null): TurnActionState {
    if (vm.status === 'FINISHED') {
      return {
        title: 'Partida finalizada',
        detail: 'Revisen el resultado final.',
        color: 'success',
      };
    }

    if (!role.isParticipant) {
      return {
        title: 'Sin asiento en esta partida',
        detail: 'Unite desde el lobby con tu cuenta de Google para poder actuar.',
        color: 'medium',
      };
    }

    if (vm.currentTurn.phase === 'INTERMISSION') {
      return {
        title: 'Intervalo',
        detail: 'El proximo escape empieza cuando termine el contador.',
        color: 'tertiary',
      };
    }

    if (vm.currentTurn.phase === 'ESCAPE') {
      return role.isHider
        ? {
          title: 'Escape en curso',
          detail: 'Marcá una estación como objetivo y confirmala cuando estés dentro de su zona.',
          color: 'warning',
        }
        : {
          title: 'Esperando al hider',
          detail: 'Durante ESCAPE no se pueden enviar preguntas.',
          color: 'medium',
        };
    }

    if (vm.currentTurn.phase === 'ENDED') {
      return {
        title: 'Turno cerrado',
        detail: 'Revisen el scoreboard antes de pasar al siguiente turno.',
        color: 'medium',
      };
    }

    if (vm.currentTurn.baseStationSelectionRequired) {
      return role.isHider
        ? {
          title: 'Elegí estación base',
          detail: 'Hay varias estaciones posibles. Confirmá una para habilitar la búsqueda.',
          color: 'warning',
        }
        : {
          title: 'Estación base pendiente',
          detail: 'El hider debe elegir entre las estaciones detectadas antes de responder preguntas.',
          color: 'warning',
        };
    }

    const captureAttempt = vm.currentTurn.captureAttempt;
    if (vm.currentTurn.endgameConsultation?.status === 'PENDING_HIDER') {
      return role.isHider
        ? {
          title: 'Consulta de endgame',
          detail: 'Confirmá si los seekers ya están en endgame.',
          color: 'warning',
        }
        : {
          title: 'Esperando endgame',
          detail: 'El hider tiene que confirmar o negar la consulta.',
          color: 'warning',
        };
    }

    if (captureAttempt?.status === 'PENDING_HIDER') {
      return role.isHider
        ? {
          title: 'Intento de captura',
          detail: 'Confirmá si te encontraron o rechazá el intento.',
          color: 'danger',
        }
        : {
          title: 'Esperando confirmación',
          detail: 'El hider tiene que confirmar o rechazar la captura.',
          color: 'warning',
        };
    }

    if (captureAttempt?.status === 'REJECTED') {
      return role.isSeeker
        ? {
          title: 'Captura rechazada',
          detail: 'Si corresponde, otro seeker puede ratificar la captura.',
          color: 'warning',
        }
        : {
          title: 'Captura rechazada',
          detail: 'El intento queda visible para que los seekers lo ratifiquen si hace falta.',
          color: 'medium',
        };
    }

    if (pendingQuestion) {
      return role.isHider
        ? {
          title: 'Tenes una pregunta pendiente',
          detail: 'Responde, veta o randomiza antes de que venza el timer.',
          color: 'warning',
        }
        : {
          title: 'Esperando respuesta',
          detail: 'El hider esta resolviendo la pregunta pendiente.',
          color: 'warning',
        };
    }

    if (role.isHider && vm.currentTurn.lootOffer) {
      return {
        title: 'Loot pendiente',
        detail: 'Elegi cartas nuevas y descarta de tu mano si hace falta.',
        color: 'success',
      };
    }

    if (role.isSeeker && this.hasQuestionBlockingEffect(vm.currentTurn.activeEffects)) {
      return {
        title: 'Pregunta bloqueada',
        detail: 'Completen la condicion de la maldicion activa para volver a preguntar.',
        color: 'warning',
      };
    }

    if (role.isSeeker) {
      return {
        title: 'Elegi una pregunta',
        detail: 'Selecciona una categoria y envia una pregunta al hider.',
        color: 'primary',
      };
    }

    return {
      title: 'Sin acción pendiente',
      detail: 'Espera la proxima pregunta de los seekers.',
      color: 'medium',
    };
  }

  phaseProgress(vm: GameBlueprint): number {
    if (vm.status !== 'LIVE' || vm.currentTurn.phase === 'ENDED') {
      return 1;
    }

    const totalByPhase: Record<GameBlueprint['currentTurn']['phase'], number> = {
      INTERMISSION: vm.settings.intermissionSeconds,
      ESCAPE: vm.settings.escapeSeconds,
      CHASE: vm.settings.chaseMaxSeconds,
      ENDED: 0,
    };
    const total = totalByPhase[vm.currentTurn.phase];
    if (!total) {
      return 1;
    }

    const remaining = this.phaseRemainingSeconds(vm);
    return Math.min(1, Math.max(0, 1 - remaining / total));
  }

  pendingQuestionProgress(vm: GameBlueprint): number {
    if (vm.status !== 'LIVE' || vm.currentTurn.phase === 'ENDED') {
      return 1;
    }

    const remaining = this.pendingQuestionRemainingSeconds(vm);
    const total = vm.currentTurn.pendingQuestionEndsAtIso && remaining > vm.questionPolicy.regularTimeoutSeconds
      ? vm.questionPolicy.photoTimeoutSeconds
      : vm.questionPolicy.regularTimeoutSeconds;
    return Math.min(1, Math.max(0, 1 - remaining / total));
  }

  questionResolutionHint(resolution: QuestionResolution): string {
    const hints: Record<QuestionResolution, string> = {
      ANSWER: 'Registra que la respuesta fue enviada.',
      VETO: 'Requiere tener carta Veto en mano.',
      RANDOMIZE: 'Requiere tener carta Randomizar en mano.',
    };

    return hints[resolution];
  }

  canUseResolution(resolution: QuestionResolution, vm: GameBlueprint): boolean {
    if (resolution === 'ANSWER') {
      return true;
    }

    const requiredPrefix = resolution === 'VETO' ? 'powerup_veto' : 'powerup_randomize';
    return vm.currentTurn.hiderHandIds.some(cardId => cardId.split('#')[0] === requiredPrefix);
  }

  inactiveResolutionMessage(resolution: QuestionResolution, vm: GameBlueprint): string {
    if (this.canUseResolution(resolution, vm)) {
      return '';
    }

    return resolution === 'VETO'
      ? 'Necesitas una carta Veto en mano.'
      : 'Necesitas una carta Randomizar en mano.';
  }

  onPendingAnswerInput(event: Event): void {
    this.pendingAnswerText = (event as CustomEvent<{ value?: string }>).detail?.value ?? '';
    this.resolveQuestionErrorMessage = '';
  }

  stationLabel(station: Station): string {
    return `${station.name} (${station.mode} ${station.line})`;
  }

  baseStationLabel(station: Station): string {
    const lineLabel = station.mode === 'SUBTE' ? `Línea ${station.line}` : `${station.mode} ${station.line}`;
    return `${station.name}, ${lineLabel}`;
  }

  private toHiderCardData(card: CardDefinition): HiderCardData {
    return {
      id: String(card.id),
      type: card.type,
      title: card.name,
      description: card.description,
      castingCost: card.castingCost,
      timeBonusMinutes: card.timeBonusMinutes,
      blocksQuestions: card.blocksQuestions,
      blocksTransport: card.blocksTransport,
      durationMinutes: card.durationMinutes,
    };
  }

  private expiresAtMillis(durationMinutes: number | null | undefined): number | null {
    return typeof durationMinutes === 'number' && durationMinutes > 0
      ? Date.now() + durationMinutes * 60 * 1000
      : null;
  }

  private cardForId(cardId: string): HiderCardData {
    const card = this.cardById.get(cardId);
    if (card) {
      return card;
    }

    const baseId = this.baseCardId(cardId);
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

  private baseCardId(cardId: string): string {
    return cardId.split('#')[0];
  }

  activeDiscardDrawRequiredCount(): number {
    const baseId = this.activeDiscardDrawPowerupId ? this.baseCardId(this.activeDiscardDrawPowerupId) : '';
    if (baseId === 'powerup_discard1_draw2') {
      return 1;
    }
    if (baseId === 'powerup_discard2_draw3') {
      return 2;
    }
    return 0;
  }

  private toggleDiscardDrawSelection(cardId: string): void {
    this.powerupErrorMessage = '';
    if (cardId === this.activeDiscardDrawPowerupId) {
      this.powerupErrorMessage = 'Esa carta se descarta automaticamente al jugarla. Elegí otras cartas.';
      return;
    }

    if (this.discardDrawSelectedCardIds.includes(cardId)) {
      this.discardDrawSelectedCardIds = this.discardDrawSelectedCardIds.filter(selectedId => selectedId !== cardId);
      return;
    }

    const required = this.activeDiscardDrawRequiredCount();
    if (this.discardDrawSelectedCardIds.length >= required) {
      this.powerupErrorMessage = `Podés elegir exactamente ${required} carta${required === 1 ? '' : 's'}.`;
      return;
    }

    this.discardDrawSelectedCardIds = [...this.discardDrawSelectedCardIds, cardId];
  }

  private syncLootSelections(vm: GameBlueprint): void {
    const lootOffer = vm.currentTurn.lootOffer;
    const lootKey = lootOffer
      ? `${lootOffer.questionId}:${lootOffer.drawnCardIds.join('|')}:${lootOffer.takeLimit}`
      : null;

    if (lootKey !== this.lastLootKey) {
      this.selectedLootCardIds = [];
      this.discardFromHandIds = [];
      this.lootErrorMessage = '';
      this.lastLootKey = lootKey;
      return;
    }

    const hand = new Set(vm.currentTurn.hiderHandIds);
    if (this.activeDiscardDrawPowerupId && !hand.has(this.activeDiscardDrawPowerupId)) {
      this.activeDiscardDrawPowerupId = null;
      this.discardDrawSelectedCardIds = [];
      this.powerupErrorMessage = '';
    } else {
      this.discardDrawSelectedCardIds = this.discardDrawSelectedCardIds.filter(cardId => hand.has(cardId));
    }

    if (!lootOffer) {
      return;
    }

    const drawn = new Set(lootOffer.drawnCardIds);
    this.selectedLootCardIds = this.selectedLootCardIds.filter(cardId => drawn.has(cardId));
    this.discardFromHandIds = this.discardFromHandIds.filter(cardId => hand.has(cardId));
  }

  private syncTurnLocalState(vm: GameBlueprint): void {
    const turnKey = `${vm.currentTurn.runNumber}:${vm.currentTurn.hiderTeamId}`;
    if (this.lastTurnIdentityKey !== turnKey) {
      this.selectedBaseStation = null;
      this.stationFilter = '';
      this.baseStationMessage = '';
      this.baseStationZoneLayer.clearLayers();
      this.confirmedBaseStationLayer.clearLayers();
      this.lastTurnIdentityKey = turnKey;
    }

    const confirmedStationId = vm.currentTurn.hidingZone?.stationId;
    if (confirmedStationId) {
      this.selectedBaseStation = this.stationById(confirmedStationId) ?? this.selectedBaseStation;
      return;
    }

    if (!vm.currentTurn.baseStationSelectionRequired) {
      this.selectedBaseStation = null;
      this.baseStationZoneLayer.clearLayers();
    }
  }

  private latestBlueprint(): GameBlueprint | undefined {
    return this.latestGameBlueprint ?? undefined;
  }

  private isCustomRadarQuestion(category: QuestionCategory, question: QuestionItem): boolean {
    return category.key === 'radar' && question.customDistance === true;
  }

  private selectedQuestionDistanceM(question: QuestionItem, customDistanceM?: number | null): number | undefined {
    if (customDistanceM !== null && customDistanceM !== undefined) {
      return customDistanceM;
    }

    return typeof question.distanceM === 'number' ? question.distanceM : undefined;
  }

  private randomizePoolForQuestion(
    category: QuestionCategory,
    selectedQuestion: QuestionItem,
    customDistanceM?: number,
  ): string[] {
    const selectedPrompt = this.questionPromptText(category, selectedQuestion, customDistanceM);
    return category.items
      .map(question => this.questionPromptText(category, question))
      .map(prompt => prompt.trim())
      .filter(prompt => prompt.length > 0 && prompt !== selectedPrompt)
      .slice(0, 100);
  }

  private async customRadarDistanceM(
    category: QuestionCategory,
    question: QuestionItem,
  ): Promise<number | null | undefined> {
    if (!this.isCustomRadarQuestion(category, question)) {
      return undefined;
    }

    let distanceM: number | null = null;
    const alert = await this.alertController.create({
      header: 'Radar personalizado',
      message: 'Ingresá una distancia entre 200 y 4000 metros.',
      inputs: [
        {
          name: 'distanceM',
          type: 'number',
          placeholder: 'Metros',
          min: 200,
          max: 4000,
          attributes: {
            inputmode: 'numeric',
            step: '1',
          },
        },
      ],
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel',
        },
        {
          text: 'Enviar',
          role: 'confirm',
          handler: data => {
            const parsed = Number(data?.distanceM);
            if (!Number.isFinite(parsed) || parsed < 200 || parsed > 4000) {
              this.questionErrorMessage = 'La distancia del radar personalizado debe estar entre 200 y 4000 metros.';
              return false;
            }

            distanceM = parsed;
            return true;
          },
        },
      ],
    });

    await alert.present();
    const result = await alert.onDidDismiss();
    return result.role === 'confirm' ? distanceM : null;
  }

  private async confirmPowerResolution(resolution: Extract<QuestionResolution, 'VETO' | 'RANDOMIZE'>): Promise<boolean> {
    const copy: Record<Extract<QuestionResolution, 'VETO' | 'RANDOMIZE'>, { header: string; message: string; confirm: string }> = {
      VETO: {
        header: 'Confirmar veto',
        message: 'Vetar consume una carta Veto y resuelve la pregunta sin respuesta. ¿Querés continuar?',
        confirm: 'Vetar',
      },
      RANDOMIZE: {
        header: 'Confirmar randomizar',
        message: 'Randomizar consume una carta Randomizar y reemplaza esta pregunta por una Q2. ¿Querés continuar?',
        confirm: 'Randomizar',
      },
    };
    const selected = copy[resolution];
    const alert = await this.alertController.create({
      header: selected.header,
      message: selected.message,
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel',
        },
        {
          text: selected.confirm,
          role: 'confirm',
        },
      ],
    });

    await alert.present();
    const result = await alert.onDidDismiss();
    return result.role === 'confirm';
  }


  private async confirmMovePowerup(): Promise<boolean> {
    const alert = await this.alertController.create({
      header: 'Jugar SALÍ DE AHÍ',
      message: 'Vas a consumir la carta y abrir una ventana de 20 minutos para cambiar tu estación base. Los seekers no reciben la nueva base hasta que termine la ventana.',
      buttons: [
        {
          text: 'Cancelar',
          role: 'cancel',
        },
        {
          text: 'Jugar',
          role: 'confirm',
        },
      ],
    });

    await alert.present();
    const result = await alert.onDidDismiss();
    return result.role === 'confirm';
  }
  private ensureBaseStationMap(): void {
    if (this.baseStationMap || !this.baseStationBounds || !document.getElementById('base-station-map')) {
      return;
    }

    this.baseStationMap = L.map('base-station-map', {
      preferCanvas: true,
      zoomControl: true,
      minZoom: 11,
      maxZoom: 18,
      maxBounds: this.baseStationBounds,
      maxBoundsViscosity: 1,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      minZoom: 11,
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.baseStationMap);
    this.baseStationZoneLayer.addTo(this.baseStationMap);
    this.baseStationMap.fitBounds(this.baseStationBounds, { padding: [12, 12], animate: false });
    this.renderBaseStationMarkers(this.latestBlueprint());
  }

  private renderBaseStationMarkers(vm?: GameBlueprint): void {
    if (!this.baseStationMap) {
      return;
    }

    const activeIds = new Set(this.stations.map(station => station.id));
    for (const [stationId, marker] of this.baseStationMarkers.entries()) {
      if (!activeIds.has(stationId)) {
        marker.remove();
        this.baseStationMarkers.delete(stationId);
      }
    }

    const confirmedStationId = vm?.currentTurn.hidingZone?.stationId;
    const pendingIds = new Set(vm?.currentTurn.baseStationCandidateIds ?? []);
    for (const station of this.stations) {
      const marker = this.getOrCreateBaseStationMarker(station);
      const selected = this.selectedBaseStation?.id === station.id;
      const confirmed = confirmedStationId === station.id;
      const pending = pendingIds.has(station.id);
      marker.setRadius(selected || confirmed ? 8 : pending ? 7 : 5);
      marker.setStyle({
        color: confirmed ? '#1f7a4d' : selected ? '#0b6e69' : pending ? '#b7791f' : '#315f73',
        fillColor: confirmed ? '#2f855a' : selected ? '#2dd4bf' : pending ? '#f6ad55' : '#4f8fa8',
        fillOpacity: selected || confirmed || pending ? 0.95 : 0.68,
        weight: selected || confirmed ? 3 : pending ? 2 : 1,
      });
    }
    this.renderSelectedBaseStationZone();
  }

  private getOrCreateBaseStationMarker(station: Station): L.CircleMarker {
    const existing = this.baseStationMarkers.get(station.id);
    if (existing) {
      return existing;
    }

    const marker = L.circleMarker([station.lat, station.lng], { radius: 5, weight: 1 });
    marker.bindTooltip(this.stationLabel(station));
    marker.on('click', () => this.selectBaseStation(station));
    marker.addTo(this.baseStationMap!);
    this.baseStationMarkers.set(station.id, marker);
    return marker;
  }

  private renderSelectedBaseStationZone(): void {
    this.baseStationZoneLayer.clearLayers();
    const station = this.selectedBaseStation;
    if (!station) {
      return;
    }

    L.circle([station.lat, station.lng], {
      radius: GAME_CONFIG.hidingZoneRadiusM,
      color: '#0b6e69',
      fillColor: '#2dd4bf',
      fillOpacity: 0.16,
      weight: 2,
      interactive: false,
    }).addTo(this.baseStationZoneLayer);
  }

  private ensureConfirmedBaseStationMap(): void {
    if (
      this.confirmedBaseStationMap
      || !this.baseStationBounds
      || !document.getElementById('confirmed-base-station-map')
    ) {
      return;
    }

    this.confirmedBaseStationMap = L.map('confirmed-base-station-map', {
      preferCanvas: true,
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      touchZoom: false,
      keyboard: false,
      minZoom: 11,
      maxZoom: 18,
      maxBounds: this.baseStationBounds,
      maxBoundsViscosity: 1,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      minZoom: 11,
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.confirmedBaseStationMap);
    this.confirmedBaseStationLayer.addTo(this.confirmedBaseStationMap);
  }

  private renderConfirmedBaseStationMap(vm?: GameBlueprint): void {
    if (!this.confirmedBaseStationMap) {
      return;
    }

    this.confirmedBaseStationLayer.clearLayers();
    const stationId = vm?.currentTurn.hidingZone?.stationId;
    const station = stationId ? this.stationById(stationId) : undefined;
    if (!station) {
      return;
    }

    L.circle([station.lat, station.lng], {
      radius: GAME_CONFIG.hidingZoneRadiusM,
      color: '#0b6e69',
      fillColor: '#2dd4bf',
      fillOpacity: 0.18,
      weight: 2,
      interactive: false,
    }).addTo(this.confirmedBaseStationLayer);

    L.circleMarker([station.lat, station.lng], {
      radius: 7,
      color: '#1f7a4d',
      fillColor: '#2f855a',
      fillOpacity: 0.95,
      weight: 3,
      interactive: false,
    }).addTo(this.confirmedBaseStationLayer);

    const bounds = L.latLng(station.lat, station.lng).toBounds(GAME_CONFIG.hidingZoneRadiusM * 1.35);
    this.confirmedBaseStationMap.fitBounds(bounds, { padding: [12, 12], animate: false });
    setTimeout(() => this.confirmedBaseStationMap?.invalidateSize(), 0);
  }

  private stationById(stationId: string): Station | undefined {
    return this.stations.find(station => station.id === stationId);
  }

  private normalizeText(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  private distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const earthRadiusM = 6371000;
    const toRad = (value: number) => value * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadiusM * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  private friendlyFunctionError(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message : '';
    const knownMessages: Record<string, string> = {
      CATEGORY_COOLDOWN_ACTIVE: 'Esa categoría está en cooldown. Elegí otra categoría por ahora.',
      BASE_STATION_REQUIRED: 'Falta confirmar la estación base del hider.',
      ENDGAME_QUESTIONS_LOCKED: 'Las preguntas de endgame todavía no están desbloqueadas.',
      CURSE_QUESTIONS_BLOCKED: 'Hay una maldición activa que bloquea preguntas.',
    };

    for (const [code, friendly] of Object.entries(knownMessages)) {
      if (message.includes(code)) {
        return friendly;
      }
    }

    return message || fallback;
  }
}
