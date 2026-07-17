import { AfterViewInit, Component, OnDestroy } from '@angular/core';
import * as L from 'leaflet';
import { FeatureCollection, Geometry } from 'geojson';
import { getStationComparisonKey, Station, StationsProcessedFile } from '../models/station.model';
import { groupStationsByLine, StationLineGroup } from '../data/station-groups';
import {
  ConstraintRecord,
  HidingZone,
  MapGeneratorMode,
  SeekerMapState,
  StationCandidateView,
  StationEvaluation,
} from './models/map-constraints.model';
import { SeekerMapStateService } from './services/seeker-map-state.service';
import { StationEvaluatorService } from './services/station-evaluator.service';
import { createHidingZone } from './services/hiding-zone';

type CandidateStationView = Station & Pick<StationCandidateView, 'status' | 'selected'>;

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

  private map?: L.Map;
  private barriosLayer?: L.GeoJSON;
  private stationsLayer = L.layerGroup();
  private selectedZoneLayer = L.layerGroup();

  constructor(
    private readonly seekerMapState: SeekerMapStateService,
    private readonly stationEvaluator: StationEvaluatorService,
  ) {}

  async ngAfterViewInit(): Promise<void> {
    this.initMap();
    await this.loadMapData();
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  get visibleRecords(): ConstraintRecord[] {
    return this.seekerState.records.slice(0, this.seekerState.cursor);
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
    this.appendManualRecord('MANUAL_ELIMINATION', 'Eliminacion manual');
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

  private initMap(): void {
    this.map = L.map('map-generator-leaflet', {
      preferCanvas: true,
      zoomControl: true,
    }).setView([-34.6037, -58.3816], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);

    this.stationsLayer.addTo(this.map);
    this.selectedZoneLayer.addTo(this.map);
  }

  private async loadMapData(): Promise<void> {
    try {
      const [barriosResponse, stationsResponse] = await Promise.all([
        fetch('assets/barrios_caba.simplified.json', { cache: 'force-cache' }),
        fetch('assets/stations.processed.json', { cache: 'force-cache' }),
      ]);

      if (!barriosResponse.ok || !stationsResponse.ok) {
        throw new Error('Generated map assets are missing. Run npm run data:process-barrios.');
      }

      const barrios = (await barriosResponse.json()) as FeatureCollection<Geometry>;
      const stationsFile = (await stationsResponse.json()) as StationsProcessedFile;
      this.allProcessedStations = stationsFile.stations;
      this.stations = stationsFile.stations.filter(station => station.isPlayable);
      this.seekerState = this.seekerMapState.load();
      this.recalculateEvaluations();

      this.renderBarrios(barrios);
      this.renderStations();
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
      style: {
        color: '#315f73',
        weight: 1,
        fillColor: '#d6ece6',
        fillOpacity: 0.18,
      },
    }).addTo(this.map);
    this.map.fitBounds(this.barriosLayer.getBounds(), { padding: [16, 16] });
  }

  private renderStations(): void {
    this.stationsLayer.clearLayers();
    for (const station of this.stations) {
      const evaluation = this.getEvaluation(station.id);
      const selected = this.selectedStationIds.has(station.id);
      const marker = L.circleMarker([station.lat, station.lng], {
        radius: selected ? 7 : 5,
        weight: selected ? 3 : 1,
        color: this.getStationColor(evaluation?.status ?? 'POSSIBLE'),
        fillColor: this.getStationColor(evaluation?.status ?? 'POSSIBLE'),
        fillOpacity: selected ? 0.95 : 0.7,
      });

      marker.bindTooltip(`${station.name} (${station.line})`);
      marker.on('click', () => {
        if (this.mode === 'HIDER') {
          this.selectHiderStation(station);
        } else {
          this.toggleSeekerStation(station);
        }
      });
      marker.addTo(this.stationsLayer);
    }
  }

  private renderSelectedZone(): void {
    this.selectedZoneLayer.clearLayers();
    if (!this.selectedHidingZone) {
      return;
    }
    L.circle([this.selectedHidingZone.center.lat, this.selectedHidingZone.center.lng], {
      radius: this.selectedHidingZone.radiusM,
      color: '#0b6e69',
      fillColor: '#2dd4bf',
      fillOpacity: 0.18,
      weight: 2,
    }).addTo(this.selectedZoneLayer);
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
        reason,
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
}
