import { AfterViewInit, Component, OnDestroy, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
} from '../../models/core-model';
import { HiderCardData } from 'src/app/models/hider-card-data';
import { CardCatalogService } from '../../cards/card-catalog.service';
import { CardDefinition } from 'src/app/models/card-definition.model';
import { GAME_CONFIG } from '../../config/game-config';
import { Station, StationsProcessedFile } from '../../models/station.model';
import { LocationMonitorService, LocationMonitorState } from '../../services/location-monitor.service';

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
  private readonly locationMonitor = inject(LocationMonitorService);

  readonly gameId = this.route.snapshot.paramMap.get('gameId') ?? '';
  readonly blueprint$: Observable<GameBlueprint> = this.gameFacade.blueprint$;
  readonly lobby$: Observable<LobbyState | null> = this.gameFacade.lobby$;
  readonly pendingQuestion$: Observable<PendingQuestion | null> = this.gameFacade.pendingQuestion$;
  readonly playerRole$: Observable<PlayerRole> = this.gameFacade.playerRole$;
  readonly locationMonitorState$ = this.locationMonitor.state$;

  drawRulesByCategory: DrawRule[] = [];
  cardById = new Map<string, HiderCardData>();
  fallbackCardByBaseId = new Map<string, HiderCardData>();
  questionCategories: QuestionCategory[] = [];
  selectedSeekerQuestion: { category: QuestionCategory; question: QuestionItem } | null = null;
  sendingQuestion = false;
  resolvingQuestion: QuestionResolution | null = null;
  selectingLoot = false;
  playingCurseCardId: string | null = null;
  completingEffectId: string | null = null;
  consultingEndgameQuestions = false;
  selectedLootCardIds: string[] = [];
  discardFromHandIds: string[] = [];
  lootErrorMessage = '';
  curseErrorMessage = '';
  effectErrorMessage = '';
  endgameQuestionsMessage = '';
  questionErrorMessage = '';
  resolveQuestionErrorMessage = '';
  outOfAreaActionInFlight = false;
  outOfAreaMessage = '';
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
  }, 1000);
  private readonly blueprintSubscription: Subscription;
  private latestGameBlueprint: GameBlueprint | null = null;
  private lastLootKey: string | null = null;
  private baseStationMap?: L.Map;
  private baseStationMarkers = new Map<string, L.CircleMarker>();
  private baseStationZoneLayer = L.layerGroup();
  private baseStationBounds: L.LatLngBoundsExpression | null = null;

  constructor() {
    this.gameFacade.loadGame(this.gameId);
    this.locationMonitor.start(this.gameId, this.playerRole$, this.blueprint$);
    this.blueprintSubscription = this.blueprint$.subscribe(vm => {
      this.latestGameBlueprint = vm;
      this.syncLootSelections(vm);
      setTimeout(() => {
        this.ensureBaseStationMap();
        this.renderBaseStationMarkers(vm);
      }, 0);
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
    this.baseStationMap?.remove();
    this.locationMonitor.stop();
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

  locationCandidateStations(locationState: LocationMonitorState | null): Station[] {
    if (!locationState || locationState.lastLat === null || locationState.lastLng === null) {
      return [];
    }

    return this.stations
      .map(station => ({
        station,
        distanceM: this.distanceMeters(
          { lat: locationState.lastLat!, lng: locationState.lastLng! },
          { lat: station.lat, lng: station.lng },
        ),
      }))
      .filter(item => item.distanceM <= GAME_CONFIG.hidingZoneRadiusM)
      .sort((a, b) => a.distanceM - b.distanceM)
      .map(item => item.station);
  }

  pendingBaseStationCandidates(vm: GameBlueprint): Station[] {
    const ids = new Set(vm.currentTurn.baseStationCandidateIds);
    return this.stations.filter(station => ids.has(station.id));
  }

  visibleBaseStationList(vm: GameBlueprint, locationState: LocationMonitorState | null): Station[] {
    const source = vm.currentTurn.baseStationSelectionRequired
      ? this.pendingBaseStationCandidates(vm)
      : this.locationCandidateStations(locationState);
    const normalizedFilter = this.normalizeText(this.stationFilter);
    if (!normalizedFilter) {
      return source.slice(0, 8);
    }
    return this.stations
      .filter(station =>
        this.normalizeText(station.name).includes(normalizedFilter)
        || this.normalizeText(station.line).includes(normalizedFilter)
        || this.normalizeText(station.mode).includes(normalizedFilter),
      )
      .slice(0, 12);
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
    const prompt = this.questionPromptText(category, question);
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
    if (projectedSize > vm.deckPolicy.maxSize) {
      const excess = projectedSize - vm.deckPolicy.maxSize;
      return `Descarta ${excess} carta${excess === 1 ? '' : 's'} mas de tu mano para respetar el maximo de ${vm.deckPolicy.maxSize}.`;
    }

    if (this.selectedLootCardIds.length === 0) {
      return 'Podes no tomar cartas y mandar todo el loot al descarte.';
    }

    return 'Listo para guardar esta seleccion.';
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

  async confirmOutOfAreaSafety(role: PlayerRole): Promise<void> {
    if (!role.isHider) {
      this.outOfAreaMessage = 'Solo el hider puede confirmar su estado.';
      return;
    }

    this.outOfAreaActionInFlight = true;
    this.outOfAreaMessage = '';
    try {
      const result = await this.gameFacade.confirmHiderOutOfAreaSafety(this.gameId);
      this.outOfAreaMessage = result.status === 'ALERTED'
        ? 'La alerta ya fue enviada.'
        : 'Confirmado. Volve al area jugable antes del limite.';
    } catch (error) {
      this.outOfAreaMessage = error instanceof Error ? error.message : 'No se pudo confirmar.';
    } finally {
      this.outOfAreaActionInFlight = false;
    }
  }

  curseCards(cardIds: string[]): HiderCardData[] {
    return this.cardsForIds(cardIds).filter(card => card.type === 'CURSE');
  }

  hasQuestionBlockingEffect(effects: ActiveEffect[]): boolean {
    return effects.some(effect => effect.blocksQuestions);
  }

  effectTitle(curseId: string): string {
    return this.fallbackCardByBaseId.get(curseId)?.title ?? curseId;
  }

  effectCompletionLabel(effect: ActiveEffect, role: PlayerRole): string {
    if (this.completingEffectId === effect.id) {
      return 'Confirmando...';
    }

    if (role.isHider) {
      return effect.expiresAtIso ? 'Cerrar efecto' : 'Aceptar evidencia';
    }

    return effect.expiresAtIso ? 'Cerrar manualmente' : 'Confirmar por WhatsApp';
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

  questionPromptText(category: QuestionCategory, question: QuestionItem): string {
    const questionText = this.questionText(category, question);
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
      return `Pendiente del hider. Iniciado por Team ${attempt.createdByTeamId}.`;
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

  secondsUntil(iso: string | null): number {
    if (!iso) {
      return 0;
    }
    return Math.max(0, Math.ceil((new Date(iso).getTime() - this.now) / 1000));
  }

  turnActionState(vm: GameBlueprint, role: PlayerRole, pendingQuestion: PendingQuestion | null): TurnActionState {
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
      title: 'Sin accion pendiente',
      detail: 'Espera la proxima pregunta de los seekers.',
      color: 'medium',
    };
  }

  phaseProgress(vm: GameBlueprint): number {
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

    const remaining = this.secondsUntil(vm.currentTurn.endsAtIso);
    return Math.min(1, Math.max(0, 1 - remaining / total));
  }

  pendingQuestionProgress(vm: GameBlueprint): number {
    const remaining = this.secondsUntil(vm.currentTurn.pendingQuestionEndsAtIso);
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

  stationLabel(station: Station): string {
    return `${station.name} (${station.mode} ${station.line})`;
  }

  stationDistanceLabel(station: Station, locationState: LocationMonitorState | null): string {
    if (!locationState || locationState.lastLat === null || locationState.lastLng === null) {
      return '';
    }
    const distanceM = this.distanceMeters(
      { lat: locationState.lastLat, lng: locationState.lastLng },
      { lat: station.lat, lng: station.lng },
    );
    return `${Math.round(distanceM)} m`;
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

    if (!lootOffer) {
      return;
    }

    const drawn = new Set(lootOffer.drawnCardIds);
    const hand = new Set(vm.currentTurn.hiderHandIds);
    this.selectedLootCardIds = this.selectedLootCardIds.filter(cardId => drawn.has(cardId));
    this.discardFromHandIds = this.discardFromHandIds.filter(cardId => hand.has(cardId));
  }

  private latestBlueprint(): GameBlueprint | undefined {
    return this.latestGameBlueprint ?? undefined;
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
}
