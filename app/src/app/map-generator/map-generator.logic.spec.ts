import { Station } from '../models/station.model';
import { evaluateStationsFromHistory } from './evaluators/manual-evaluator';
import { classifyRadarRelation } from './evaluators/radar-evaluator';
import { GeometryService } from './services/geometry.service';
import { createHidingZone } from './services/hiding-zone';
import { SeekerMapStateService } from './services/seeker-map-state.service';
import { ConstraintRecord } from './models/map-constraints.model';

describe('map generator logic', () => {
  const retiroC: Station = {
    id: 'subte_c_retiro',
    name: 'Retiro',
    line: 'C',
    mode: 'SUBTE',
    lat: -34.5924,
    lng: -58.3759,
    hub_id: 'hub-retiro',
  };
  const retiroE: Station = {
    ...retiroC,
    id: 'subte_e_retiro',
    line: 'E',
  };
  const callaoB: Station = {
    id: 'subte_b_callao',
    name: 'Callao (B)',
    line: 'B',
    mode: 'SUBTE',
    lat: -34.6043,
    lng: -58.3925,
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('creates a 600 meter hiding circle centered on the station', () => {
    const zone = createHidingZone(retiroC);
    expect(zone.stationId).toBe('subte_c_retiro');
    expect(zone.center).toEqual({ lat: retiroC.lat, lng: retiroC.lng });
    expect(zone.radiusM).toBe(600);
  });

  it('eliminates and restores by hub key', () => {
    const elimination = record('MANUAL_ELIMINATION', ['hub-retiro']);
    const restore = record('MANUAL_RESTORE', ['hub-retiro']);

    const eliminated = evaluateStationsFromHistory([retiroC, retiroE, callaoB], [elimination]);
    expect(eliminated.find(item => item.stationId === retiroC.id)?.status).toBe('ELIMINATED');
    expect(eliminated.find(item => item.stationId === retiroE.id)?.status).toBe('ELIMINATED');
    expect(eliminated.find(item => item.stationId === callaoB.id)?.status).toBe('POSSIBLE');

    const restored = evaluateStationsFromHistory([retiroC, retiroE], [elimination, restore]);
    expect(restored.every(item => item.status === 'POSSIBLE')).toBeTrue();
  });

  it('eliminates a station without hub individually', () => {
    const eliminated = evaluateStationsFromHistory([retiroC, callaoB], [
      record('MANUAL_ELIMINATION', ['subte_b_callao']),
    ]);

    expect(eliminated.find(item => item.stationId === retiroC.id)?.status).toBe('POSSIBLE');
    expect(eliminated.find(item => item.stationId === callaoB.id)?.status).toBe('ELIMINATED');
  });

  it('supports undo, redo, persistence and recovery for propagated hub eliminations', () => {
    const service = new SeekerMapStateService();
    let state = service.load();
    state = service.append(state, record('MANUAL_ELIMINATION', ['hub-retiro']));
    expect(service.load().records.length).toBe(1);
    expect(evaluateStationsFromHistory([retiroC, retiroE], service.load().records).every(item => item.status === 'ELIMINATED')).toBeTrue();

    state = service.undo(state);
    expect(state.cursor).toBe(0);
    expect(service.load().cursor).toBe(0);
    expect(evaluateStationsFromHistory([retiroC, retiroE], service.load().records.slice(0, service.load().cursor)).every(item => item.status === 'POSSIBLE')).toBeTrue();

    state = service.redo(state);
    expect(state.cursor).toBe(1);
    expect(service.load().cursor).toBe(1);
    expect(evaluateStationsFromHistory([retiroC, retiroE], service.load().records.slice(0, service.load().cursor)).every(item => item.status === 'ELIMINATED')).toBeTrue();
  });

  it('classifies radar relation using station hiding circles', () => {
    const geometry = new GeometryService();
    const relation = classifyRadarRelation(retiroC, {
      id: 'radar-1',
      type: 'RADAR',
      origin: { lat: retiroC.lat, lng: retiroC.lng },
      radiusM: 700,
      answer: 'INSIDE',
    }, geometry);

    expect(relation).toBe('FULLY_INSIDE');
  });
});

function record(type: 'MANUAL_ELIMINATION' | 'MANUAL_RESTORE', stationKeys: string[]): ConstraintRecord {
  return {
    id: `${type}-${stationKeys.join('-')}`,
    category: 'manual',
    createdAt: '2026-07-17T00:00:00.000Z',
    enabled: true,
    data: { type, stationKeys },
  };
}
