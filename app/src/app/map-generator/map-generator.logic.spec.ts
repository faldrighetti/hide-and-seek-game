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

  it('persists manual circle records', () => {
    const service = new SeekerMapStateService();
    const state = service.append(service.load(), manualCircleRecord('ELIMINATE_INSIDE', 700));

    expect(state.records[0].data.type).toBe('MANUAL_CIRCLE');
    expect(service.load().records[0].data.type).toBe('MANUAL_CIRCLE');
  });

  it('can disable a persisted action without deleting it', () => {
    const service = new SeekerMapStateService();
    let state = service.append(service.load(), record('MANUAL_ELIMINATION', ['hub-retiro']));
    state = service.setRecordEnabled(state, state.records[0].id, false);

    expect(state.records[0].enabled).toBeFalse();
    expect(evaluateStationsFromHistory([retiroC, retiroE], state.records).every(item => item.status === 'POSSIBLE')).toBeTrue();
    expect(service.load().records[0].enabled).toBeFalse();
  });

  it('eliminates manual circle fully inside zones only', () => {
    const inside: Station = { id: 'inside', name: 'Inside', line: 'A', mode: 'SUBTE', lat: 0, lng: 0 };
    const intersecting: Station = { id: 'intersects', name: 'Intersects', line: 'A', mode: 'SUBTE', lat: 0.0107, lng: 0 };
    const outside: Station = { id: 'outside', name: 'Outside', line: 'A', mode: 'SUBTE', lat: 0.03, lng: 0 };

    const result = evaluateStationsFromHistory([inside, intersecting, outside], [
      manualCircleRecord('ELIMINATE_INSIDE', 700),
    ]);

    expect(result.find(item => item.stationId === 'inside')?.status).toBe('ELIMINATED');
    expect(result.find(item => item.stationId === 'intersects')?.status).toBe('POSSIBLE');
    expect(result.find(item => item.stationId === 'outside')?.status).toBe('POSSIBLE');
  });

  it('eliminates manual circle fully outside zones only', () => {
    const inside: Station = { id: 'inside', name: 'Inside', line: 'A', mode: 'SUBTE', lat: 0, lng: 0 };
    const intersecting: Station = { id: 'intersects', name: 'Intersects', line: 'A', mode: 'SUBTE', lat: 0.0107, lng: 0 };
    const outside: Station = { id: 'outside', name: 'Outside', line: 'A', mode: 'SUBTE', lat: 0.03, lng: 0 };

    const result = evaluateStationsFromHistory([inside, intersecting, outside], [
      manualCircleRecord('ELIMINATE_OUTSIDE', 700),
    ]);

    expect(result.find(item => item.stationId === 'inside')?.status).toBe('POSSIBLE');
    expect(result.find(item => item.stationId === 'intersects')?.status).toBe('POSSIBLE');
    expect(result.find(item => item.stationId === 'outside')?.status).toBe('ELIMINATED');
  });

  it('classifies fixed station zones conservatively', () => {
    const geometry = new GeometryService();
    const stationZone = { center: { lat: 0, lng: 0 }, radiusM: 600 };

    expect(geometry.classifyCircleRelation(stationZone, { center: { lat: 0, lng: 0 }, radiusM: 700 })).toBe('FULLY_INSIDE');
    expect(geometry.classifyCircleRelation(stationZone, { center: { lat: 0.03, lng: 0 }, radiusM: 700 })).toBe('FULLY_OUTSIDE');
    expect(geometry.classifyCircleRelation(stationZone, { center: { lat: 0.0107, lng: 0 }, radiusM: 700 })).toBe('INTERSECTS');
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

function manualCircleRecord(mode: 'ELIMINATE_INSIDE' | 'ELIMINATE_OUTSIDE', radiusM: number): ConstraintRecord {
  return {
    id: `circle-${mode}-${radiusM}`,
    category: 'manual',
    createdAt: '2026-07-17T00:00:00.000Z',
    enabled: true,
    data: {
      id: `circle-${mode}-${radiusM}`,
      type: 'MANUAL_CIRCLE',
      center: { lat: 0, lng: 0 },
      radiusM,
      mode,
      reason: 'test circle',
      enabled: true,
    },
  };
}
