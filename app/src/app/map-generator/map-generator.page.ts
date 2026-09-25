import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import * as L from 'leaflet';
import { FeatureCollection, Geometry } from 'geojson';
import { Subscription } from 'rxjs';
import { PendingQuestion } from '../models/core-model';
import { getStationComparisonKey, Station, StationsProcessedFile } from '../models/station.model';
import { groupStationsByLine, StationLineGroup } from '../data/station-groups';
import {
  ConstraintRecord,
  HidingZone,
  ManualCircleConstraint,
  ManualDirectionConstraint,
  MapGeneratorMode,
  MatchingConstraint,
  MeasuringConstraint,
  RadarConstraint,
  SeekerMapState,
  StationCandidateView,
  StationEvaluation,
  ThermometerConstraint,
} from './models/map-constraints.model';
import { SeekerMapStateService } from './services/seeker-map-state.service';
import { StationEvaluatorService } from './services/station-evaluator.service';
import { createHidingZone } from './services/hiding-zone';
import { GeometryService } from './services/geometry.service';
import {
  SeekerLocationReferenceService,
  SeekerLocationReferenceState,
} from './services/seeker-location-reference.service';
import { CabaLocationClassification, classifyCabaLocation } from './services/seeker-location-classifier';
import { GameFacadeService } from '../services/game-facade';

type CandidateStationView = Station & Pick<StationCandidateView, 'status' | 'selected'>;

interface EliminationHistoryGroup {
  record: ConstraintRecord;
  title: string;
  reason: string;
  eliminatedStations: Station[];
  propagatedHubStations: Station[];
}

interface MapNavigationBoundsAsset {
  bbox: [number, number, number, number];
  southWest: { lat: number; lng: number };
  northEast: { lat: number; lng: number };
  bufferM: number;
  sources: string[];
}

interface CabaGeographyAsset {
  barrios?: Array<{ nombre?: string }>;
  comunas?: Array<{ id?: number; nombre?: string; barrios?: string[] }>;
}

interface QuestionCatalogAsset {
  questions?: {
    radar?: {
      items?: Array<{ label?: string; distanceM?: number | null; customDistance?: boolean }>;
    };
    thermometer?: {
      items?: Array<{ label?: string; distanceM?: number }>;
    };
    measuring?: {
      items?: Array<{ label?: string; resolutionMode?: string }>;
    };
    matching?: {
      items?: Array<{ label?: string; resolutionMode?: string }>;
    };
  };
}

interface QuestionCatalogOption {
  id: string;
  category: 'radar' | 'thermometer' | 'measuring' | 'matching';
  label: string;
  distanceM?: number;
  automation: 'AUTOMATIC' | 'MANUAL_CIRCLE' | 'MANUAL_STATIONS' | 'MANUAL';
}

interface ReferenceLineAsset {
  features?: Array<{
    geometry?: {
      type?: string;
      coordinates?: number[][];
    };
  }>;
}

@Component({
  selector: 'app-map-generator',
  templateUrl: './map-generator.page.html',
  styleUrls: ['./map-generator.page.scss'],
  standalone: false,
})
export class MapGeneratorPage implements AfterViewInit, OnDestroy {
  mode: MapGeneratorMode = 'HIDER';
  lockedMode: MapGeneratorMode | null = null;
  stations: Station[] = [];
  allProcessedStations: Station[] = [];
  evaluations: StationEvaluation[] = [];
  evaluationByStationId = new Map<string, StationEvaluation>();
  candidateViews: CandidateStationView[] = [];
  hiderStationGroups: StationLineGroup[] = [];
  seekerStationGroups: StationLineGroup<CandidateStationView>[] = [];
  selectedImpactStations: Station[] = [];
  selectedHubSummaries: string[] = [];
  eliminationHistoryGroups: EliminationHistoryGroup[] = [];
  possibleCount = 0;
  eliminatedCount = 0;
  unknownCount = 0;
  selectedStation: Station | null = null;
  selectedStationIds = new Set<string>();
  selectedHidingZone: HidingZone | null = null;
  seekerState: SeekerMapState = { records: [], cursor: 0 };
  loadError = '';
  stationFilter = '';
  circleCenterLat: number | null = null;
  circleCenterLng: number | null = null;
  circleRadiusM: number | null = 1000;
  circleMode: ManualCircleConstraint['mode'] = 'ELIMINATE_INSIDE';
  circleReason = '';
  circleValidationError = '';
  directionOriginLat: number | null = null;
  directionOriginLng: number | null = null;
  directionReason = '';
  directionValidationError = '';
  barrioOptions: string[] = [];
  comunaOptions: Array<{ id: number; label: string }> = [];
  answeredQuestionOptions: QuestionCatalogOption[] = [];
  selectedQuestionOptionId = '';
  questionOriginLat: number | null = null;
  questionOriginLng: number | null = null;
  previousSeekerLat: number | null = null;
  previousSeekerLng: number | null = null;
  currentSeekerLat: number | null = null;
  currentSeekerLng: number | null = null;
  questionRadiusM: number | null = null;
  questionAnswer: RadarConstraint['answer'] | ThermometerConstraint['answer'] | MeasuringConstraint['answer'] | MatchingConstraint['answer'] = 'INSIDE';
  measuringTarget: MeasuringConstraint['target'] = 'GENERAL_PAZ';
  matchingField: MatchingConstraint['field'] = 'BARRIO';
  matchingValue = '';
  questionValidationError = '';
  activeGameId = '';
  pendingGameQuestion: PendingQuestion | null = null;
  loadedGameQuestion: PendingQuestion | null = null;
  questionCatalogLoaded = false;
  seekerLocationState: SeekerLocationReferenceState | null = null;
  seekerLocationClassification: CabaLocationClassification = { barrio: null, comuna: null };
  referenceLines: Record<'GENERAL_PAZ' | 'RIACHUELO', Array<{ lat: number; lng: number }>> = {
    GENERAL_PAZ: [],
    RIACHUELO: [],
  };

  private map?: L.Map;
  private barriosLayer?: L.GeoJSON;
  private stationsLayer = L.layerGroup();
  private restrictionsLayer = L.layerGroup();
  private stationMarkers = new Map<string, L.CircleMarker>();
  private seekerLocationSubscription?: Subscription;
  private pendingQuestionSubscription?: Subscription;
  private barrios: FeatureCollection<Geometry> | null = null;
  private readonly minZoom = 11;
  private readonly maxZoom = 18;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly seekerMapState: SeekerMapStateService,
    private readonly stationEvaluator: StationEvaluatorService,
    private readonly geometry: GeometryService,
    private readonly seekerLocationReference: SeekerLocationReferenceService,
    private readonly gameFacade: GameFacadeService,
  ) {}

  async ngAfterViewInit(): Promise<void> {
    this.startSeekerLocationReference();
    await this.loadMapData();
  }

  ngOnDestroy(): void {
    this.seekerLocationSubscription?.unsubscribe();
    this.pendingQuestionSubscription?.unsubscribe();
    this.map?.remove();
  }

  get isModeLocked(): boolean {
    return this.lockedMode !== null;
  }

  get backHref(): string {
    const gameId = this.activeGameId || (this.route.snapshot.queryParamMap.get('gameId') ?? '').trim().toUpperCase();
    return gameId ? '/game/' + gameId : '/';
  }

  get visibleRecords(): ConstraintRecord[] {
    return this.seekerState.records.slice(0, this.seekerState.cursor);
  }

  private buildEliminationHistoryGroups(): EliminationHistoryGroup[] {
    const groups: EliminationHistoryGroup[] = [];
    const visibleRecords = this.visibleRecords;
    for (let index = 0; index < visibleRecords.length; index += 1) {
      const record = visibleRecords[index];
      if (!this.isEliminationRecord(record)) {
        continue;
      }
      const previousRecords = visibleRecords.slice(0, index).filter(item => item.enabled);
      const recordsWithCurrent = record.enabled ? [...previousRecords, record] : previousRecords;
      const before = this.stationEvaluator.evaluate(this.stations, previousRecords);
      const after = this.stationEvaluator.evaluate(this.stations, recordsWithCurrent);
      const beforeByStationId = new Map(before.map(evaluation => [evaluation.stationId, evaluation.status]));
      const afterByStationId = new Map(after.map(evaluation => [evaluation.stationId, evaluation.status]));
      const eliminatedStations = this.stations.filter(station =>
        beforeByStationId.get(station.id) !== 'ELIMINATED'
        && afterByStationId.get(station.id) === 'ELIMINATED',
      );

      groups.push({
        record,
        title: this.getRecordTitle(record),
        reason: this.getRecordReason(record),
        eliminatedStations,
        propagatedHubStations: this.getPropagatedHubStations(record, eliminatedStations),
      });
    }
    return groups;
  }
  get totalCount(): number {
    return this.stations.length;
  }



  get canUndo(): boolean {
    return this.seekerState.cursor > 0;
  }

  get canRedo(): boolean {
    return this.seekerState.cursor < this.seekerState.records.length;
  }

  get canEliminateSelected(): boolean {
    return this.getSelectedStationsByStatus('POSSIBLE').length > 0;
  }

  get canRestoreSelected(): boolean {
    return this.getSelectedStationsByStatus('ELIMINATED').length > 0;
  }

  get canRestoreAll(): boolean {
    return this.eliminatedCount > 0;
  }

  private buildSelectedHubSummaries(): string[] {

    const selected = this.stations.filter(station => this.selectedStationIds.has(station.id) && station.hub_id);
    return selected.map(station => {
      const affected = this.stations
        .filter(candidate => candidate.hub_id === station.hub_id)
        .map(candidate => `${candidate.name} (${candidate.mode} ${candidate.line})`);
      return `${station.name} pertenece a ${station.hub_id}: ${affected.join(', ')}`;
    });
  }

  get computedMeasuringDistanceM(): number | null {
    if (!this.isValidLatLng(this.currentSeekerLat, this.currentSeekerLng)) {
      return null;
    }
    const line = this.referenceLines[this.measuringTarget === 'RIACHUELO' ? 'RIACHUELO' : 'GENERAL_PAZ'];
    const distanceM = this.geometry.distanceToPolylineMeters(
      { lat: Number(this.currentSeekerLat), lng: Number(this.currentSeekerLng) },
      line,
    );
    return Number.isFinite(distanceM) ? Math.round(distanceM) : null;
  }

  get computedMeasuringNearestPoint(): { lat: number; lng: number } | null {
    if (!this.isValidLatLng(this.currentSeekerLat, this.currentSeekerLng)) {
      return null;
    }
    const line = this.referenceLines[this.measuringTarget === 'RIACHUELO' ? 'RIACHUELO' : 'GENERAL_PAZ'];
    const result = this.geometry.closestPointOnPolyline(
      { lat: Number(this.currentSeekerLat), lng: Number(this.currentSeekerLng) },
      line,
    );
    return result?.point ?? null;
  }

  setMode(mode: MapGeneratorMode): void {
    if (this.lockedMode && mode !== this.lockedMode) {
      return;
    }
    this.mode = mode;
    this.selectedStationIds.clear();
    setTimeout(() => this.map?.invalidateSize(), 0);
    this.renderStations();
    this.renderRestrictionOverlays();
  }

  selectHiderStation(station: Station): void {
    this.selectedStation = station;
    this.selectedHidingZone = createHidingZone(station);
    this.renderSelectedZone();
  }

  toggleSeekerStation(station: Station): void {
    if (this.selectedStationIds.has(station.id)) {
      this.selectedStationIds.delete(station.id);
    } else {
      this.selectedStationIds.add(station.id);
    }
    this.renderStations();
    this.renderRestrictionOverlays();
  }

  toggleSeekerStationGroup(group: StationLineGroup<CandidateStationView>): void {
    const allSelected = group.stations.every(station => this.selectedStationIds.has(station.id));
    for (const station of group.stations) {
      if (allSelected) {
        this.selectedStationIds.delete(station.id);
      } else {
        this.selectedStationIds.add(station.id);
      }
    }
    this.renderStations();
    this.renderRestrictionOverlays();
  }

  stationGroupSelectionIcon(group: StationLineGroup<CandidateStationView>): string {
    const selectedCount = group.stations.filter(station => this.selectedStationIds.has(station.id)).length;
    if (selectedCount === 0) {
      return 'square-outline';
    }
    if (selectedCount === group.stations.length) {
      return 'checkbox-outline';
    }
    return 'remove-circle-outline';
  }

  stationGroupSelectionLabel(group: StationLineGroup<CandidateStationView>): string {
    const selectedCount = group.stations.filter(station => this.selectedStationIds.has(station.id)).length;
    if (selectedCount === group.stations.length) {
      return `Destildar ${group.label}`;
    }
    return `Tildar ${group.label}`;
  }

  eliminateSelected(): void {
    this.appendManualRecord('MANUAL_ELIMINATION', 'Seleccion manual', this.getSelectedStationKeysByStatus('POSSIBLE'));
  }

  restoreSelected(): void {
    this.appendManualRecord('MANUAL_RESTORE', 'Restauracion manual', this.getSelectedStationKeysByStatus('ELIMINATED'));
  }

  restoreAllEliminations(): void {
    const stationKeys = this.stations
      .filter(station => this.getEvaluation(station.id)?.status === 'ELIMINATED')
      .map(station => getStationComparisonKey(station));
    this.appendManualRecord('MANUAL_RESTORE', 'Restauracion total', stationKeys);
  }

  undo(): void {
    this.seekerState = this.seekerMapState.undo(this.seekerState, this.stateScopeKey);
    this.recalculateEvaluations();
  }

  redo(): void {
    this.seekerState = this.seekerMapState.redo(this.seekerState, this.stateScopeKey);
    this.recalculateEvaluations();
  }

  saveManualCircle(): void {
    this.circleValidationError = '';
    if (!this.isValidLatLng(this.circleCenterLat, this.circleCenterLng)) {
      this.circleValidationError = 'Ingresá coordenadas válidas.';
      return;
    }
    if (!Number.isFinite(this.circleRadiusM) || Number(this.circleRadiusM) <= 0) {
      this.circleValidationError = 'Ingresá un radio mayor que cero.';
      return;
    }

    const id = `manual-circle-${Date.now()}`;
    const data: ManualCircleConstraint = {
      id,
      type: 'MANUAL_CIRCLE',
      center: {
        lat: Number(this.circleCenterLat),
        lng: Number(this.circleCenterLng),
      },
      radiusM: Number(this.circleRadiusM),
      mode: this.circleMode,
      reason: this.circleReason.trim() || undefined,
      enabled: true,
    };

    const record: ConstraintRecord = {
      id,
      category: 'manual',
      createdAt: new Date().toISOString(),
      enabled: true,
      data,
    };

    this.seekerState = this.seekerMapState.append(this.seekerState, record, this.stateScopeKey);
    this.circleReason = '';
    this.recalculateEvaluations();
  }

  saveManualDirection(direction: ManualDirectionConstraint['direction']): void {
    this.directionValidationError = '';
    this.ensureDirectionOrigin();
    if (!this.isValidLatLng(this.directionOriginLat, this.directionOriginLng)) {
      this.directionValidationError = 'Ingresá coordenadas válidas.';
      return;
    }

    const id = 'manual-direction-' + direction.toLowerCase() + '-' + Date.now();
    const data: ManualDirectionConstraint = {
      id,
      type: 'MANUAL_DIRECTION',
      origin: {
        lat: Number(this.directionOriginLat),
        lng: Number(this.directionOriginLng),
      },
      direction,
      reason: this.directionReason.trim() || undefined,
      enabled: true,
    };

    const record: ConstraintRecord = {
      id,
      category: 'manual',
      createdAt: new Date().toISOString(),
      enabled: true,
      data,
    };

    this.seekerState = this.seekerMapState.append(this.seekerState, record, this.stateScopeKey);
    this.directionReason = '';
    this.recalculateEvaluations();
  }

  toggleRecordEnabled(record: ConstraintRecord): void {
    this.seekerState = this.seekerMapState.setRecordEnabled(this.seekerState, record.id, !record.enabled, this.stateScopeKey);
    this.recalculateEvaluations();
  }

  trackByStationId(_: number, item: StationCandidateView): string {
    return item.station.id;
  }

  trackByGroupId(_: number, group: StationLineGroup): string {
    return group.id;
  }

  getRecordStationKeyCount(record: ConstraintRecord): number {
    if (record.data.type === 'MANUAL_ELIMINATION' || record.data.type === 'MANUAL_RESTORE') {
      return record.data.stationKeys.length;
    }
    return 0;
  }

  private initMap(boundsAsset: MapNavigationBoundsAsset): void {
    if (this.map) {
      return;
    }
    const maxBounds = L.latLngBounds(
      [boundsAsset.southWest.lat, boundsAsset.southWest.lng],
      [boundsAsset.northEast.lat, boundsAsset.northEast.lng],
    );

    this.map = L.map('map-generator-leaflet', {
      preferCanvas: true,
      zoomControl: true,
      minZoom: this.minZoom,
      maxZoom: this.maxZoom,
      maxBounds,
      maxBoundsViscosity: 1,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      minZoom: this.minZoom,
      maxZoom: this.maxZoom,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);

    this.stationsLayer.addTo(this.map);
    this.restrictionsLayer.addTo(this.map);
    this.map.on('click', event => {
      if (this.mode === 'SEEKER') {
        this.circleCenterLat = Number(event.latlng.lat.toFixed(6));
        this.circleCenterLng = Number(event.latlng.lng.toFixed(6));
        this.seekerLocationReference.setManualReference(this.circleCenterLat, this.circleCenterLng);
      }
    });
    this.map.fitBounds(maxBounds, { padding: [12, 12], animate: false });
  }

  private async loadMapData(): Promise<void> {
    try {
      this.syncGameContextFromRoute();
      const loadStartedAt = performance.now();
      const [
        boundsResponse,
        barriosResponse,
        stationsResponse,
        questionsResponse,
        geographyResponse,
        generalPazResponse,
        riachueloResponse,
      ] = await Promise.all([
        fetch('assets/map-generator.bounds.json', { cache: 'no-store' }),
        fetch('assets/barrios_caba.simplified.json', { cache: 'force-cache' }),
        fetch('assets/stations.processed.json', { cache: 'no-store' }),
        fetch('assets/questions/Preguntas_CABA.json', { cache: 'force-cache' }),
        fetch('assets/Geografia_CABA.json', { cache: 'force-cache' }),
        fetch('assets/general_paz.geojson', { cache: 'force-cache' }),
        fetch('assets/riachuelo.geojson', { cache: 'force-cache' }),
      ]);

      if (!boundsResponse.ok || !barriosResponse.ok || !stationsResponse.ok) {
        throw new Error('Generated map assets are missing. Run npm run data:process-barrios.');
      }

      const boundsAsset = (await boundsResponse.json()) as MapNavigationBoundsAsset;
      const barrios = (await barriosResponse.json()) as FeatureCollection<Geometry>;
      this.barrios = barrios;
      this.updateSeekerLocationClassification();
      const stationsFile = (await stationsResponse.json()) as StationsProcessedFile;
      if (geographyResponse.ok) {
        this.configureMatchingOptions((await geographyResponse.json()) as CabaGeographyAsset);
      }
      if (questionsResponse.ok) {
        this.answeredQuestionOptions = this.buildQuestionOptions((await questionsResponse.json()) as QuestionCatalogAsset);
        this.questionCatalogLoaded = true;
        if (this.pendingGameQuestion && !this.loadedGameQuestion && !this.selectedQuestionOptionId) {
          this.loadPendingGameQuestion();
        }
      }
      if (generalPazResponse.ok) {
        this.referenceLines.GENERAL_PAZ = this.extractReferenceLine((await generalPazResponse.json()) as ReferenceLineAsset);
      }
      if (riachueloResponse.ok) {
        this.referenceLines.RIACHUELO = this.extractReferenceLine((await riachueloResponse.json()) as ReferenceLineAsset);
      }
      this.initMap(boundsAsset);
      this.allProcessedStations = stationsFile.stations;
      this.stations = stationsFile.stations.filter(station => station.isPlayable);
      this.seekerState = this.seekerMapState.load(this.stateScopeKey);
      this.recalculateEvaluations();

      this.renderBarrios(barrios);
      this.renderStations();
      console.info('Map generator initial render', {
        elapsedMs: Math.round(performance.now() - loadStartedAt),
        renderedStationMarkers: this.stationMarkers.size,
        renderedLayerGroups: 3,
        playableStations: this.stations.length,
        barriosFeatures: barrios.features.length,
      });
    } catch (error) {
      this.loadError = error instanceof Error ? error.message : 'Could not load map data.';
    }
  }

  onQuestionOptionChange(optionId: string): void {
    this.selectedQuestionOptionId = optionId;
    this.questionValidationError = '';
    const option = this.selectedQuestionOption;
    if (!option) {
      return;
    }

    if (option.category === 'radar') {
      this.questionRadiusM = option.distanceM ?? this.questionRadiusM;
      this.questionAnswer = 'INSIDE';
    } else if (option.category === 'thermometer') {
      this.questionAnswer = 'HOTTER';
    } else if (option.category === 'measuring') {
      this.questionAnswer = 'CLOSER';
      this.measuringTarget = this.getMeasuringTargetFromLabel(option.label);
    } else if (option.category === 'matching') {
      this.questionAnswer = 'MATCH';
      this.matchingField = this.getMatchingFieldFromLabel(option.label);
      this.updateMatchingValueFromSeekerLocation();
    }
  }

  saveAnsweredQuestion(): void {
    this.questionValidationError = '';
    const option = this.selectedQuestionOption;
    if (!option) {
      this.questionValidationError = 'Elegi una pregunta del catalogo.';
      return;
    }

    const data = this.buildAnsweredConstraint(option);
    if (!data) {
      return;
    }

    const record: ConstraintRecord = {
      id: `question-${Date.now()}`,
      questionId: this.loadedGameQuestion?.id ?? this.pendingGameQuestion?.id ?? option.id,
      category: option.category,
      createdAt: new Date().toISOString(),
      enabled: true,
      data,
    };

    this.seekerState = this.seekerMapState.append(this.seekerState, record, this.stateScopeKey);
    if (this.loadedGameQuestion?.id === record.questionId) {
      this.loadedGameQuestion = null;
    }
    this.recalculateEvaluations();
  }

  private renderBarrios(barrios: FeatureCollection<Geometry>): void {
    if (!this.map) {
      return;
    }
    this.barriosLayer?.remove();
    this.barriosLayer = L.geoJSON(barrios, {
      interactive: false,
      style: {
        color: '#315f73',
        weight: 1,
        fillColor: '#d6ece6',
        fillOpacity: 0.18,
      },
    }).addTo(this.map);
    this.bringLayerGroupToFront(this.stationsLayer);
    this.bringLayerGroupToFront(this.restrictionsLayer);
  }

  private startSeekerLocationReference(): void {
    this.seekerLocationSubscription = this.seekerLocationReference.state$.subscribe(state => {
      this.seekerLocationState = state;
      if (state.lastLat === null || state.lastLng === null) {
        return;
      }

      this.questionOriginLat = Number(state.lastLat.toFixed(6));
      this.questionOriginLng = Number(state.lastLng.toFixed(6));
      this.currentSeekerLat = Number(state.lastLat.toFixed(6));
      this.currentSeekerLng = Number(state.lastLng.toFixed(6));
      this.updateSeekerLocationClassification();
    });
  }

  private renderStations(): void {
    const activeStationIds = new Set(this.stations.map(station => station.id));
    for (const [stationId, marker] of this.stationMarkers.entries()) {
      if (!activeStationIds.has(stationId)) {
        marker.remove();
        this.stationMarkers.delete(stationId);
      }
    }

    for (const station of this.stations) {
      const evaluation = this.getEvaluation(station.id);
      const selected = this.selectedStationIds.has(station.id);
      const marker = this.getOrCreateStationMarker(station);
      marker.setRadius(selected ? 7 : 5);
      marker.setStyle({
        weight: selected ? 3 : 1,
        color: this.getStationColor(evaluation?.status ?? 'POSSIBLE'),
        fillColor: this.getStationColor(evaluation?.status ?? 'POSSIBLE'),
        fillOpacity: selected ? 0.95 : 0.7,
      });
    }
    this.refreshSelectionDerivedState();
  }

  private renderSelectedZone(): void {
    this.restrictionsLayer.clearLayers();
    if (!this.selectedHidingZone) {
      return;
    }
    L.circle([this.selectedHidingZone.center.lat, this.selectedHidingZone.center.lng], {
      radius: this.selectedHidingZone.radiusM,
      color: '#0b6e69',
      fillColor: '#2dd4bf',
      fillOpacity: 0.18,
      weight: 2,
      interactive: false,
    }).addTo(this.restrictionsLayer);
    this.bringLayerGroupToFront(this.stationsLayer);
  }

  private renderRestrictionOverlays(): void {
    if (!this.map) {
      return;
    }
    this.restrictionsLayer.clearLayers();
    if (this.mode === 'HIDER') {
      this.renderSelectedZone();
      return;
    }

    for (const record of this.visibleRecords.filter(item => item.enabled)) {
      if (record.data.type === 'MANUAL_CIRCLE') {
        L.circle([record.data.center.lat, record.data.center.lng], {
          radius: record.data.radiusM,
          color: record.data.mode === 'ELIMINATE_INSIDE' ? '#a13f3f' : '#315f73',
          fillColor: record.data.mode === 'ELIMINATE_INSIDE' ? '#e86f68' : '#6aa6c8',
          fillOpacity: 0.08,
          weight: 2,
          interactive: false,
        }).addTo(this.restrictionsLayer);
      }
      if (record.data.type === 'RADAR') {
        L.circle([record.data.origin.lat, record.data.origin.lng], {
          radius: record.data.radiusM,
          color: record.data.answer === 'INSIDE' ? '#1f7a4d' : '#a13f3f',
          fillColor: record.data.answer === 'INSIDE' ? '#4ade80' : '#e86f68',
          fillOpacity: 0.08,
          weight: 2,
          interactive: false,
        }).addTo(this.restrictionsLayer);
      }
    }
    this.renderSelectedSeekerZones();
    this.bringLayerGroupToFront(this.stationsLayer);
  }

  private renderSelectedSeekerZones(): void {
    const selectedStations = this.stations.filter(station => this.selectedStationIds.has(station.id));
    for (const station of selectedStations) {
      const zone = createHidingZone(station);
      L.circle([zone.center.lat, zone.center.lng], {
        radius: zone.radiusM,
        color: '#0b6e69',
        fillColor: '#2dd4bf',
        fillOpacity: 0.12,
        weight: 2,
        interactive: false,
      }).addTo(this.restrictionsLayer);
    }
  }

  private getOrCreateStationMarker(station: Station): L.CircleMarker {
    const existing = this.stationMarkers.get(station.id);
    if (existing) {
      return existing;
    }

    const marker = L.circleMarker([station.lat, station.lng], { radius: 5, weight: 1 });
    marker.bindTooltip(`${station.name} (${station.line})`);
    marker.on('click', () => {
      if (this.mode === 'HIDER') {
        this.selectHiderStation(station);
      } else {
        this.toggleSeekerStation(station);
      }
    });
    marker.addTo(this.stationsLayer);
    this.stationMarkers.set(station.id, marker);
    return marker;
  }

  private bringLayerGroupToFront(layerGroup: L.LayerGroup): void {
    layerGroup.eachLayer(layer => {
      if ('bringToFront' in layer && typeof layer.bringToFront === 'function') {
        layer.bringToFront();
      }
    });
  }

  private appendManualRecord(type: 'MANUAL_ELIMINATION' | 'MANUAL_RESTORE', reason: string, stationKeys = this.getSelectedStationKeys()): void {
    const uniqueStationKeys = [...new Set(stationKeys)].sort();
    if (uniqueStationKeys.length === 0) {
      return;
    }

    const record: ConstraintRecord = {
      id: `manual-${Date.now()}`,
      category: 'manual',
      createdAt: new Date().toISOString(),
      enabled: true,
      data: {
        type,
        stationKeys: uniqueStationKeys,
        reason: this.circleReason.trim() || reason,
      },
    };

    this.seekerState = this.seekerMapState.append(this.seekerState, record, this.stateScopeKey);
    this.selectedStationIds.clear();
    this.recalculateEvaluations();
  }

  private getSelectedStationKeys(): string[] {
    return this.getSelectedStationKeysForScope('HUB');
  }

  private getSelectedStationKeysByStatus(status: StationEvaluation['status']): string[] {
    return this.getSelectedStationsByStatus(status).map(station => getStationComparisonKey(station));
  }

  private getSelectedStationsByStatus(status: StationEvaluation['status']): Station[] {
    return this.stations.filter(station =>
      this.selectedStationIds.has(station.id)
      && (this.getEvaluation(station.id)?.status ?? 'POSSIBLE') === status,
    );
  }

  private getSelectedStationKeysForScope(scope: 'HUB' | 'STATION'): string[] {
    const selected = this.stations.filter(station => this.selectedStationIds.has(station.id));
    const keys = selected.map(station => (scope === 'HUB' ? getStationComparisonKey(station) : station.id));
    return [...new Set(keys)].sort();
  }

  private recalculateEvaluations(): void {
    this.evaluations = this.stationEvaluator.evaluate(this.stations, this.visibleRecords);
    this.evaluationByStationId = new Map(this.evaluations.map(evaluation => [evaluation.stationId, evaluation]));
    this.possibleCount = this.evaluations.filter(evaluation => evaluation.status === 'POSSIBLE').length;
    this.eliminatedCount = this.evaluations.filter(evaluation => evaluation.status === 'ELIMINATED').length;
    this.unknownCount = this.evaluations.filter(evaluation => evaluation.status === 'UNKNOWN').length;
    this.candidateViews = this.stations.map(station => ({
      ...station,
      status: this.getEvaluation(station.id)?.status ?? 'POSSIBLE',
      selected: this.selectedStationIds.has(station.id),
    }));
    this.seekerStationGroups = groupStationsByLine(this.candidateViews);
    this.renderStations();
    this.renderRestrictionOverlays();
  }

  private refreshSelectionDerivedState(): void {
    this.selectedImpactStations = this.stations.filter(station => {
      const stationKey = getStationComparisonKey(station);
      return this.getSelectedStationKeys().includes(stationKey);
    });
    this.selectedHubSummaries = this.buildSelectedHubSummaries();
    this.candidateViews = this.candidateViews.map(station => ({
      ...station,
      selected: this.selectedStationIds.has(station.id),
    }));
    this.seekerStationGroups = groupStationsByLine(this.candidateViews);
  }

  private getEvaluation(stationId: string): StationEvaluation | undefined {
    return this.evaluationByStationId.get(stationId);
  }

  private getStationColor(status: StationEvaluation['status']): string {
    if (status === 'ELIMINATED') {
      return '#a13f3f';
    }
    if (status === 'UNKNOWN') {
      return '#8a6d28';
    }
    return '#1f7a4d';
  }

  private isValidLatLng(lat: number | null, lng: number | null): boolean {
    return Number.isFinite(lat)
      && Number.isFinite(lng)
      && Number(lat) >= -90
      && Number(lat) <= 90
      && Number(lng) >= -180
      && Number(lng) <= 180;
  }

  private isEliminationRecord(record: ConstraintRecord): boolean {
    return record.data.type === 'MANUAL_ELIMINATION' || record.data.type === 'MANUAL_CIRCLE' || record.data.type === 'MANUAL_DIRECTION';
  }

  private getRecordTitle(record: ConstraintRecord): string {
    if (record.data.type === 'MANUAL_CIRCLE') {
      return 'Círculo manual';
    }
    if (record.data.type === 'MANUAL_ELIMINATION') {
      return 'Selección manual';
    }
    if (record.data.type === 'MANUAL_DIRECTION') {
      const labels: Record<ManualDirectionConstraint['direction'], string> = {
        NORTH: 'Norte',
        SOUTH: 'Sur',
        EAST: 'Este',
        WEST: 'Oeste',
      };
      return 'Eliminar al ' + labels[record.data.direction];
    }
    if (record.data.type === 'RADAR') {
      return `Radar de ${record.data.radiusM} m`;
    }
    if (record.data.type === 'THERMOMETER') {
      return 'Termómetro';
    }
    if (record.data.type === 'MEASURING') {
      return `Comparación ${record.data.target}`;
    }
    if (record.data.type === 'MATCHING') {
      return `Matching ${record.data.field}`;
    }
    return record.data.type;
  }

  private getRecordReason(record: ConstraintRecord): string {
    if ('reason' in record.data && record.data.reason) {
      return record.data.reason;
    }
    if (record.data.type === 'MANUAL_CIRCLE') {
      return record.data.mode === 'ELIMINATE_INSIDE' ? 'Eliminar dentro' : 'Eliminar fuera';
    }
    if (record.data.type === 'MANUAL_DIRECTION') {
      return 'Desde ' + record.data.origin.lat.toFixed(5) + ', ' + record.data.origin.lng.toFixed(5);
    }
    if (record.data.type === 'RADAR') {
      return record.data.answer === 'INSIDE' ? 'Respuesta si' : 'Respuesta no';
    }
    if (record.data.type === 'THERMOMETER') {
      return record.data.answer === 'HOTTER' ? 'Mas caliente' : 'Mas frio';
    }
    if (record.data.type === 'MEASURING') {
      return record.data.answer.toLocaleLowerCase('es-AR');
    }
    if (record.data.type === 'MATCHING') {
      return `${record.data.answer === 'MATCH' ? 'Coincide' : 'No coincide'}: ${record.data.seekerValue}`;
    }
    return record.questionId ?? record.category;
  }

  private getPropagatedHubStations(record: ConstraintRecord, eliminatedStations: Station[]): Station[] {
    if (record.data.type !== 'MANUAL_ELIMINATION') {
      return [];
    }
    const stationKeys = new Set(record.data.stationKeys);
    return eliminatedStations.filter(station => Boolean(station.hub_id) && stationKeys.has(station.hub_id ?? '') && !stationKeys.has(station.id));
  }

  private syncDirectionOriginFromSingleSelection(): void {
    if (this.selectedStationIds.size !== 1) {
      return;
    }

    const [stationId] = Array.from(this.selectedStationIds);
    const station = this.stations.find(candidate => candidate.id === stationId);
    if (!station) {
      return;
    }

    this.directionOriginLat = station.lat;
    this.directionOriginLng = station.lng;
  }

  private ensureDirectionOrigin(): void {
    if (this.isValidLatLng(this.directionOriginLat, this.directionOriginLng)) {
      return;
    }
    if (this.isValidLatLng(this.seekerLocationState?.lastLat ?? null, this.seekerLocationState?.lastLng ?? null)) {
      this.directionOriginLat = this.seekerLocationState?.lastLat ?? null;
      this.directionOriginLng = this.seekerLocationState?.lastLng ?? null;
      return;
    }
    if (this.isValidLatLng(this.circleCenterLat, this.circleCenterLng)) {
      this.directionOriginLat = this.circleCenterLat;
      this.directionOriginLng = this.circleCenterLng;
    }
  }

  get selectedQuestionOption(): QuestionCatalogOption | undefined {
    return this.answeredQuestionOptions.find(option => option.id === this.selectedQuestionOptionId);
  }

  loadPendingGameQuestion(): void {
    if (!this.questionCatalogLoaded) {
      return;
    }
    if (!this.pendingGameQuestion) {
      this.questionValidationError = 'No hay pregunta pendiente de partida.';
      return;
    }

    const option = this.findQuestionOptionForPendingQuestion(this.pendingGameQuestion);
    if (!option) {
      this.questionValidationError = 'La pregunta pendiente no tiene motor automatizable en el mapa.';
      return;
    }

    this.loadedGameQuestion = this.pendingGameQuestion;
    this.onQuestionOptionChange(option.id);
    const distanceM = this.pendingGameQuestion.customDistanceM ?? this.pendingGameQuestion.distanceM;
    if (option.category === 'radar' && distanceM) {
      this.questionRadiusM = distanceM;
    }
    this.questionValidationError = '';
  }

  get stateScopeKey(): string | null {
    return this.activeGameId ? `game.${this.activeGameId}` : null;
  }

  private buildQuestionOptions(catalog: QuestionCatalogAsset): QuestionCatalogOption[] {
    const options: QuestionCatalogOption[] = [];
    for (const item of catalog.questions?.radar?.items ?? []) {
      options.push({
        id: `radar:${item.label ?? item.distanceM ?? 'custom'}`,
        category: 'radar',
        label: `Radar - ${item.label ?? 'custom'}`,
        distanceM: item.distanceM ?? undefined,
        automation: 'AUTOMATIC',
      });
    }
    for (const item of catalog.questions?.thermometer?.items ?? []) {
      options.push({
        id: `thermometer:${item.label ?? item.distanceM ?? 'custom'}`,
        category: 'thermometer',
        label: `Termómetro - ${item.label ?? 'custom'}`,
        distanceM: item.distanceM,
        automation: 'AUTOMATIC',
      });
    }
    for (const item of catalog.questions?.measuring?.items ?? []) {
      const label = item.label ?? 'target';
      if (item.resolutionMode === 'AUTOMATIC' && this.isSupportedMeasuringLabel(label)) {
        options.push({
          id: `measuring:${label}`,
          category: 'measuring',
          label: `Comparación - ${label}`,
          automation: 'AUTOMATIC',
        });
      }
    }
    options.push(
      {
        id: 'matching:barrios-caba',
        category: 'matching',
        label: 'Matching - Barrio',
        automation: 'AUTOMATIC',
      },
      {
        id: 'matching:comunas-caba',
        category: 'matching',
        label: 'Matching - Comuna',
        automation: 'AUTOMATIC',
      },
    );
    return options;
  }

  private buildAnsweredConstraint(option: QuestionCatalogOption): RadarConstraint | ThermometerConstraint | MeasuringConstraint | MatchingConstraint | null {
    if (option.category === 'radar') {
      if (!this.isValidLatLng(this.questionOriginLat, this.questionOriginLng) || !Number.isFinite(this.questionRadiusM) || Number(this.questionRadiusM) <= 0) {
        this.questionValidationError = 'Carga origen y radio del radar.';
        return null;
      }
      return {
        id: `radar-${Date.now()}`,
        type: 'RADAR',
        origin: { lat: Number(this.questionOriginLat), lng: Number(this.questionOriginLng) },
        radiusM: Number(this.questionRadiusM),
        answer: this.questionAnswer === 'OUTSIDE' ? 'OUTSIDE' : 'INSIDE',
      };
    }

    if (option.category === 'thermometer') {
      if (!this.isValidLatLng(this.previousSeekerLat, this.previousSeekerLng) || !this.isValidLatLng(this.currentSeekerLat, this.currentSeekerLng)) {
        this.questionValidationError = 'Carga posicion anterior y nueva.';
        return null;
      }
      return {
        type: 'THERMOMETER',
        previousSeekerPosition: { lat: Number(this.previousSeekerLat), lng: Number(this.previousSeekerLng) },
        currentSeekerPosition: { lat: Number(this.currentSeekerLat), lng: Number(this.currentSeekerLng) },
        answer: this.questionAnswer === 'COLDER' ? 'COLDER' : 'HOTTER',
      };
    }

    if (option.category === 'measuring') {
      const calculatedDistanceM = this.computedMeasuringDistanceM;
      const nearestPoint = this.computedMeasuringNearestPoint;
      if (calculatedDistanceM === null) {
        this.questionValidationError = 'Carga la posicion del seeker para calcular la distancia al target.';
        return null;
      }
      return {
        type: 'MEASURING',
        target: this.measuringTarget,
        seekerPosition: { lat: Number(this.currentSeekerLat), lng: Number(this.currentSeekerLng) },
        seekerDistanceM: calculatedDistanceM,
        nearestTargetPoint: nearestPoint ?? undefined,
        answer: this.questionAnswer === 'FARTHER' || this.questionAnswer === 'EQUAL' ? this.questionAnswer : 'CLOSER',
      };
    }

    this.updateMatchingValueFromSeekerLocation();
    const trimmedValue = this.matchingValue.trim();
    if (!trimmedValue) {
      this.questionValidationError = 'Carga el valor observado para matching.';
      return null;
    }
    return {
      type: 'MATCHING',
      field: this.matchingField,
      seekerValue: this.matchingField === 'COMUNA' && Number.isFinite(Number(trimmedValue)) ? Number(trimmedValue) : trimmedValue,
      answer: this.questionAnswer === 'NO_MATCH' ? 'NO_MATCH' : 'MATCH',
    };
  }

  private syncGameContextFromRoute(): void {
    const gameId = (this.route.snapshot.queryParamMap.get('gameId') ?? '').trim().toUpperCase();
    const routeRole = (this.route.snapshot.queryParamMap.get('role') ?? '').trim().toLowerCase();
    const routeMode: MapGeneratorMode | null = routeRole === 'hider'
      ? 'HIDER'
      : routeRole === 'seeker'
        ? 'SEEKER'
        : null;

    this.lockedMode = routeMode ?? (gameId ? 'SEEKER' : null);
    if (this.lockedMode) {
      this.setMode(this.lockedMode);
    }

    if (!gameId || this.activeGameId === gameId) {
      return;
    }

    this.activeGameId = gameId;

    this.gameFacade.loadGame(gameId);
    this.pendingQuestionSubscription?.unsubscribe();
    this.pendingQuestionSubscription = this.gameFacade.pendingQuestion$.subscribe(question => {
      if (!question || question.id !== this.pendingGameQuestion?.id) {
        this.loadedGameQuestion = null;
      }
      this.pendingGameQuestion = question;
      if (question && this.questionCatalogLoaded && !this.loadedGameQuestion && !this.selectedQuestionOptionId) {
        this.loadPendingGameQuestion();
      }
    });
  }

  private findQuestionOptionForPendingQuestion(question: PendingQuestion): QuestionCatalogOption | undefined {
    const category = question.categoryId as QuestionCatalogOption['category'];
    if (!['radar', 'thermometer', 'measuring', 'matching'].includes(category)) {
      return undefined;
    }
    const sameCategory = this.answeredQuestionOptions.filter(option => option.category === category);
    if (category === 'radar' || category === 'thermometer') {
      const distanceM = question.customDistanceM ?? question.distanceM;
      return sameCategory.find(option => option.distanceM === distanceM) ?? sameCategory[0];
    }
    if (category === 'measuring') {
      const normalizedPrompt = question.prompt.toLocaleLowerCase('es-AR');
      return sameCategory.find(option => normalizedPrompt.includes(option.label.toLocaleLowerCase('es-AR').replace('comparación - ', '')))
        ?? sameCategory[0];
    }
    if (category === 'matching') {
      const normalizedPrompt = question.prompt.toLocaleLowerCase('es-AR');
      return sameCategory.find(option => normalizedPrompt.includes(option.label.toLocaleLowerCase('es-AR').replace('matching - ', '')))
        ?? sameCategory[0];
    }
    return undefined;
  }

  private getMeasuringTargetFromLabel(label: string): MeasuringConstraint['target'] {
    const normalized = label.toLocaleLowerCase('es-AR');
    if (normalized.includes('riachuelo')) {
      return 'RIACHUELO';
    }
    return 'GENERAL_PAZ';
  }

  private isSupportedMeasuringLabel(label: string): boolean {
    const normalized = label.toLocaleLowerCase('es-AR');
    return normalized.includes('general paz') || normalized.includes('riachuelo');
  }

  private getMatchingFieldFromLabel(label: string): MatchingConstraint['field'] {
    const normalized = label.toLocaleLowerCase('es-AR');
    if (normalized.includes('comuna')) {
      return 'COMUNA';
    }
    return 'BARRIO';
  }

  private isSupportedMatchingLabel(label: string): boolean {
    const normalized = label.toLocaleLowerCase('es-AR');
    return normalized.includes('barrio') || normalized.includes('comuna');
  }

  private configureMatchingOptions(geography: CabaGeographyAsset): void {
    this.barrioOptions = (geography.barrios ?? [])
      .map(barrio => barrio.nombre?.trim() ?? '')
      .filter((name): name is string => Boolean(name))
      .sort((first, second) => first.localeCompare(second, 'es-AR'));
    this.comunaOptions = (geography.comunas ?? [])
      .map(comuna => ({
        id: Number(comuna.id),
        label: String(comuna.id) + ' - ' + (comuna.barrios ?? []).join(', '),
      }))
      .filter(comuna => Number.isFinite(comuna.id))
      .sort((first, second) => first.id - second.id);
  }

  private updateSeekerLocationClassification(): void {
    if (!this.barrios || !this.isValidLatLng(this.currentSeekerLat, this.currentSeekerLng)) {
      this.seekerLocationClassification = { barrio: null, comuna: null };
      return;
    }

    this.seekerLocationClassification = classifyCabaLocation(
      { lat: Number(this.currentSeekerLat), lng: Number(this.currentSeekerLng) },
      this.barrios,
    );
    this.updateMatchingValueFromSeekerLocation();
  }

  updateMatchingValueFromSeekerLocation(): void {
    if (this.matchingField === 'BARRIO' && this.seekerLocationClassification.barrio) {
      this.matchingValue = this.seekerLocationClassification.barrio;
    }
    if (this.matchingField === 'COMUNA' && this.seekerLocationClassification.comuna !== null) {
      this.matchingValue = String(this.seekerLocationClassification.comuna);
    }
  }

  private extractReferenceLine(asset: ReferenceLineAsset): Array<{ lat: number; lng: number }> {
    const lineFeature = asset.features?.find(feature => feature.geometry?.type === 'LineString');
    return (lineFeature?.geometry?.coordinates ?? [])
      .filter(coordinate => coordinate.length >= 2 && Number.isFinite(coordinate[0]) && Number.isFinite(coordinate[1]))
      .map(([lng, lat]) => ({ lat, lng }));
  }
}


