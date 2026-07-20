import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import * as L from 'leaflet';
import { FeatureCollection, Geometry } from 'geojson';
import { getStationComparisonKey, Station, StationsProcessedFile } from '../models/station.model';
import { groupStationsByLine, StationLineGroup } from '../data/station-groups';
import {
  ConstraintRecord,
  HidingZone,
  ManualCircleConstraint,
  MapGeneratorMode,
  SeekerMapState,
  StationCandidateView,
  StationEvaluation,
} from './models/map-constraints.model';
import { SeekerMapStateService } from './services/seeker-map-state.service';
import { StationEvaluatorService } from './services/station-evaluator.service';
import { createHidingZone } from './services/hiding-zone';

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

@Component({
  selector: 'app-map-generator',
  templateUrl: './map-generator.page.html',
  styleUrls: ['./map-generator.page.scss'],
  standalone: false,
})
export class MapGeneratorPage implements AfterViewInit, OnDestroy {
  mode: MapGeneratorMode = 'HIDER';
  stations: Station[] = [];
  allProcessedStations: Station[] = [];
  evaluations: StationEvaluation[] = [];
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

  private map?: L.Map;
  private barriosLayer?: L.GeoJSON;
  private stationsLayer = L.layerGroup();
  private restrictionsLayer = L.layerGroup();
  private stationMarkers = new Map<string, L.CircleMarker>();
  private readonly minZoom = 11;
  private readonly maxZoom = 18;

  constructor(
    private readonly seekerMapState: SeekerMapStateService,
    private readonly stationEvaluator: StationEvaluatorService,
  ) {}

  async ngAfterViewInit(): Promise<void> {
    await this.loadMapData();
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  get visibleRecords(): ConstraintRecord[] {
    return this.seekerState.records.slice(0, this.seekerState.cursor);
  }

  get eliminationHistoryGroups(): EliminationHistoryGroup[] {
    const groups: EliminationHistoryGroup[] = [];
    for (let index = 0; index < this.visibleRecords.length; index += 1) {
      const record = this.visibleRecords[index];
      if (!this.isEliminationRecord(record)) {
        continue;
      }
      const previousRecords = this.visibleRecords.slice(0, index).filter(item => item.enabled);
      const recordsWithCurrent = record.enabled ? [...previousRecords, record] : previousRecords;
      const before = this.stationEvaluator.evaluate(this.stations, previousRecords);
      const after = this.stationEvaluator.evaluate(this.stations, recordsWithCurrent);
      const beforeByStationId = new Map(before.map(evaluation => [evaluation.stationId, evaluation.status]));
      const eliminatedStations = this.stations.filter(station =>
        beforeByStationId.get(station.id) !== 'ELIMINATED'
        && after.find(evaluation => evaluation.stationId === station.id)?.status === 'ELIMINATED',
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

  get possibleCount(): number {
    return this.evaluations.filter(evaluation => evaluation.status === 'POSSIBLE').length;
  }

  get eliminatedCount(): number {
    return this.evaluations.filter(evaluation => evaluation.status === 'ELIMINATED').length;
  }

  get unknownCount(): number {
    return this.evaluations.filter(evaluation => evaluation.status === 'UNKNOWN').length;
  }

  get candidateViews(): StationCandidateView[] {
    return this.stations.map(station => ({
      station,
      status: this.getEvaluation(station.id)?.status ?? 'POSSIBLE',
      selected: this.selectedStationIds.has(station.id),
    }));
  }

  get canUndo(): boolean {
    return this.seekerState.cursor > 0;
  }

  get canRedo(): boolean {
    return this.seekerState.cursor < this.seekerState.records.length;
  }

  get hiderStationGroups(): StationLineGroup[] {
    return groupStationsByLine(this.stations, this.stationFilter);
  }

  get seekerStationGroups(): StationLineGroup<CandidateStationView>[] {
    return groupStationsByLine(this.candidateViews.map(view => ({
      ...view.station,
      status: view.status,
      selected: view.selected,
    })), this.stationFilter);
  }

  get selectedImpactStations(): Station[] {
    const selectedKeys = this.getSelectedStationKeys();
    return this.stations.filter(station => selectedKeys.includes(getStationComparisonKey(station)));
  }

  get selectedHubSummaries(): string[] {
    const selected = this.stations.filter(station => this.selectedStationIds.has(station.id) && station.hub_id);
    return selected.map(station => {
      const affected = this.stations
        .filter(candidate => candidate.hub_id === station.hub_id)
        .map(candidate => `${candidate.name} (${candidate.mode} ${candidate.line})`);
      return `${station.name} pertenece a ${station.hub_id}: ${affected.join(', ')}`;
    });
  }

  setMode(mode: MapGeneratorMode): void {
    this.mode = mode;
    this.selectedStationIds.clear();
    setTimeout(() => this.map?.invalidateSize(), 0);
    this.renderStations();
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
  }

  eliminateSelected(): void {
    this.appendManualRecord('MANUAL_ELIMINATION', 'Seleccion manual');
  }

  restoreSelected(): void {
    this.appendManualRecord('MANUAL_RESTORE', 'Restauracion manual');
  }

  undo(): void {
    this.seekerState = this.seekerMapState.undo(this.seekerState);
    this.recalculateEvaluations();
  }

  redo(): void {
    this.seekerState = this.seekerMapState.redo(this.seekerState);
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

    this.seekerState = this.seekerMapState.append(this.seekerState, record);
    this.circleReason = '';
    this.recalculateEvaluations();
  }

  toggleRecordEnabled(record: ConstraintRecord): void {
    this.seekerState = this.seekerMapState.setRecordEnabled(this.seekerState, record.id, !record.enabled);
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
      }
    });
    this.map.fitBounds(maxBounds, { padding: [12, 12], animate: false });
  }

  private async loadMapData(): Promise<void> {
    try {
      const loadStartedAt = performance.now();
      const [boundsResponse, barriosResponse, stationsResponse] = await Promise.all([
        fetch('assets/map-generator.bounds.json', { cache: 'no-store' }),
        fetch('assets/barrios_caba.simplified.json', { cache: 'force-cache' }),
        fetch('assets/stations.processed.json', { cache: 'no-store' }),
      ]);

      if (!boundsResponse.ok || !barriosResponse.ok || !stationsResponse.ok) {
        throw new Error('Generated map assets are missing. Run npm run data:process-barrios.');
      }

      const boundsAsset = (await boundsResponse.json()) as MapNavigationBoundsAsset;
      const barrios = (await barriosResponse.json()) as FeatureCollection<Geometry>;
      const stationsFile = (await stationsResponse.json()) as StationsProcessedFile;
      this.initMap(boundsAsset);
      this.allProcessedStations = stationsFile.stations;
      this.stations = stationsFile.stations.filter(station => station.isPlayable);
      this.seekerState = this.seekerMapState.load();
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
    }).addTo(this.restrictionsLayer);
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

  private appendManualRecord(type: 'MANUAL_ELIMINATION' | 'MANUAL_RESTORE', reason: string): void {
    const stationKeys = this.getSelectedStationKeys();
    if (stationKeys.length === 0) {
      return;
    }

    const record: ConstraintRecord = {
      id: `manual-${Date.now()}`,
      category: 'manual',
      createdAt: new Date().toISOString(),
      enabled: true,
      data: {
        type,
        stationKeys,
        reason: this.circleReason.trim() || reason,
      },
    };

    this.seekerState = this.seekerMapState.append(this.seekerState, record);
    this.selectedStationIds.clear();
    this.recalculateEvaluations();
  }

  private getSelectedStationKeys(): string[] {
    return this.getSelectedStationKeysForScope('HUB');
  }

  private getSelectedStationKeysForScope(scope: 'HUB' | 'STATION'): string[] {
    const selected = this.stations.filter(station => this.selectedStationIds.has(station.id));
    const keys = selected.map(station => (scope === 'HUB' ? getStationComparisonKey(station) : station.id));
    return [...new Set(keys)].sort();
  }

  private recalculateEvaluations(): void {
    this.evaluations = this.stationEvaluator.evaluate(this.stations, this.visibleRecords);
    this.renderStations();
  }

  private getEvaluation(stationId: string): StationEvaluation | undefined {
    return this.evaluations.find(evaluation => evaluation.stationId === stationId);
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
    return record.data.type === 'MANUAL_ELIMINATION' || record.data.type === 'MANUAL_CIRCLE';
  }

  private getRecordTitle(record: ConstraintRecord): string {
    if (record.data.type === 'MANUAL_CIRCLE') {
      return 'Círculo manual';
    }
    if (record.data.type === 'MANUAL_ELIMINATION') {
      return 'Selección manual';
    }
    if (record.data.type === 'RADAR') {
      return `Radar de ${record.data.radiusM} m`;
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
    return record.questionId ?? record.category;
  }

  private getPropagatedHubStations(record: ConstraintRecord, eliminatedStations: Station[]): Station[] {
    if (record.data.type !== 'MANUAL_ELIMINATION') {
      return [];
    }
    const stationKeys = new Set(record.data.stationKeys);
    return eliminatedStations.filter(station => Boolean(station.hub_id) && stationKeys.has(station.hub_id ?? '') && !stationKeys.has(station.id));
  }
}
