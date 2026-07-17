import { FeatureCollection, Polygon } from 'geojson';
import {
  applyConfiguredHubs,
  assignBarriosToStations,
  classifyPlayableStations,
  extractStations,
  findDuplicates,
} from './station-processing';
import { RawStationsFile } from './station-processing';
import { groupStationsByLine } from './station-groups';

describe('station processing', () => {
  const barrios: FeatureCollection<Polygon> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { nombre: 'Test Barrio', comuna: 1 },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-58.5, -34.7],
            [-58.3, -34.7],
            [-58.3, -34.5],
            [-58.5, -34.5],
            [-58.5, -34.7],
          ]],
        },
      },
    ],
  };

  it('detects duplicate ids', () => {
    expect(findDuplicates(['a', 'b', 'a'])).toEqual(['a']);
  });

  it('assigns barrio by point-in-polygon', () => {
    const result = assignBarriosToStations([
      { id: 'inside', name: 'Inside', line: 'A', mode: 'SUBTE', lat: -34.6, lng: -58.4 },
    ], barrios);

    expect(result.assignedCount).toBe(1);
    expect(result.stations[0].barrio).toBe('Test Barrio');
    expect(result.stations[0].comuna).toBe(1);
  });

  it('reports stations outside CABA polygons', () => {
    const result = assignBarriosToStations([
      { id: 'outside', name: 'Outside', line: 'A', mode: 'SUBTE', lat: -35.2, lng: -58.4 },
    ], barrios);

    expect(result.assignedCount).toBe(0);
    expect(result.outsidePolygonIds).toEqual(['outside']);
  });

  it('applies configured hubs without linking Callao or Pueyrredon by name', () => {
    const raw: RawStationsFile = {
      transport: [
        {
          SUBTE: [
            {
              line: 'A',
              stations: [{ id: 'subte_a_plaza_miserere', name: 'Plaza Miserere', lat: -34.61, lng: -58.41 }],
            },
            {
              line: 'B',
              stations: [
                { id: 'subte_b_federico_lacroze', name: 'Federico Lacroze', lat: -34.61, lng: -58.45 },
                { id: 'subte_b_callao', name: 'Callao (B)', lat: -34.6, lng: -58.39 },
                { id: 'subte_b_pueyrredon', name: 'Pueyrredon (B)', lat: -34.6, lng: -58.4 },
              ],
            },
            {
              line: 'C',
              stations: [
                { id: 'subte_c_retiro', name: 'Retiro', lat: -34.59, lng: -58.37 },
                { id: 'subte_c_constitucion', name: 'Constitucion', lat: -34.62, lng: -58.38 },
                { id: 'subte_c_independencia', name: 'Independencia', lat: -34.6182, lng: -58.3774 },
              ],
            },
            {
              line: 'D',
              stations: [
                { id: 'subte_d_ministro_carranza', name: 'Ministro Carranza', lat: -34.57, lng: -58.43 },
                { id: 'subte_d_palermo', name: 'Palermo', lat: -34.58, lng: -58.42 },
                { id: 'subte_d_callao', name: 'Callao (D)', lat: -34.59, lng: -58.39 },
                { id: 'subte_d_pueyrredon', name: 'Pueyrredon (D)', lat: -34.59, lng: -58.4 },
              ],
            },
            {
              line: 'E',
              stations: [
                { id: 'subte_e_retiro', name: 'Retiro', lat: -34.59, lng: -58.37 },
                { id: 'subte_e_independencia', name: 'Independencia', lat: -34.6179, lng: -58.3812 },
              ],
            },
            {
              line: 'H',
              stations: [{ id: 'subte_h_once', name: 'Once', lat: -34.6, lng: -58.4 }],
            },
          ],
          TREN: [
            {
              line: 'Mitre',
              stations: [
                { id: 'tren_mitre_retiro', name: 'Retiro', lat: -34.59, lng: -58.37 },
                { id: 'tren_mitre_ministro_carranza', name: 'Ministro Carranza', lat: -34.56, lng: -58.43 },
              ],
            },
            {
              line: 'Belgrano Norte',
              stations: [{ id: 'tren_belgrano_norte_retiro', name: 'Retiro', lat: -34.58, lng: -58.37 }],
            },
            {
              line: 'San Martin',
              stations: [
                { id: 'tren_san_martin_retiro', name: 'Retiro', lat: -34.58, lng: -58.37 },
                { id: 'tren_san_martin_palermo', name: 'Palermo', lat: -34.58, lng: -58.43 },
              ],
            },
            {
              line: 'Sarmiento',
              stations: [{ id: 'tren_sarmiento_once', name: 'Once', lat: -34.6, lng: -58.4 }],
            },
            {
              line: 'Roca',
              stations: [{ id: 'tren_roca_constitucion', name: 'Constitucion', lat: -34.63, lng: -58.39 }],
            },
            {
              line: 'Urquiza',
              stations: [{ id: 'tren_urquiza_federico_lacroze', name: 'Federico Lacroze', lat: -34.58, lng: -58.45 }],
            },
          ],
        },
      ],
    };

    const result = applyConfiguredHubs(extractStations(raw));
    expect(result.warnings).toEqual([]);
    expect(result.stations.find(station => station.id === 'subte_c_retiro')?.hub_id).toBe('hub-retiro');
    expect(result.stations.find(station => station.id === 'subte_a_plaza_miserere')?.hub_id).toBe('hub-once');
    expect(result.stations.find(station => station.id === 'subte_b_callao')?.hub_id).toBeUndefined();
    expect(result.stations.find(station => station.id === 'subte_d_callao')?.hub_id).toBeUndefined();
    expect(result.stations.find(station => station.id === 'subte_b_pueyrredon')?.hub_id).toBeUndefined();
    expect(result.stations.find(station => station.id === 'subte_d_pueyrredon')?.hub_id).toBeUndefined();
    expect(result.stations.find(station => station.id === 'subte_c_independencia')?.hub_id).toBe('hub-independencia');
    expect(result.stations.find(station => station.id === 'subte_e_independencia')?.hub_id).toBe('hub-independencia');
  });

  it('groups stations visually by transport line', () => {
    const groups = groupStationsByLine([
      { id: 'a1', name: 'A1', line: 'A', mode: 'SUBTE', lat: 0, lng: 0 },
      { id: 'a2', name: 'A2', line: 'A', mode: 'SUBTE', lat: 0, lng: 0 },
      { id: 'm1', name: 'M1', line: 'Mitre', mode: 'TREN', lat: 0, lng: 0 },
    ]);

    expect(groups.map(group => group.label)).toEqual(['Subte A', 'Tren Mitre']);
    expect(groups[0].stations.map(station => station.id)).toEqual(['a1', 'a2']);
  });

  it('marks stations inside CABA as playable', () => {
    const result = classifyPlayableStations([
      { id: 'inside', name: 'Inside', line: 'A', mode: 'SUBTE', lat: -34.6, lng: -58.4, barrio: 'Test' },
    ], testGeneralPazLine());

    expect(result.stations[0].isInsideCaba).toBeTrue();
    expect(result.stations[0].isPlayable).toBeTrue();
  });

  it('marks a station exactly 1000m from General Paz as playable', () => {
    const lat = 1000 / 111_320;
    const result = classifyPlayableStations([
      { id: 'near', name: 'Near', line: 'Mitre', mode: 'TREN', lat, lng: 0 },
    ], testGeneralPazLine(), 1000);

    expect(result.stations[0].distanceToGeneralPazM).toBe(1000);
    expect(result.stations[0].isPlayable).toBeTrue();
  });

  it('marks a station farther than 1000m from General Paz as not playable', () => {
    const lat = 1001 / 111_320;
    const result = classifyPlayableStations([
      { id: 'far', name: 'Far', line: 'Mitre', mode: 'TREN', lat, lng: 0 },
    ], testGeneralPazLine(), 1000);

    expect(result.stations[0].isPlayable).toBeFalse();
    expect(result.stations[0].exclusionReason).toBe('TOO_FAR_FROM_GENERAL_PAZ');
  });

  it('always excludes Belgrano Sur', () => {
    const result = classifyPlayableStations([
      { id: 'bs', name: 'BS', line: 'Belgrano Sur', mode: 'TREN', lat: 0, lng: 0, barrio: 'Test' },
    ], testGeneralPazLine(), 1000);

    expect(result.stations[0].isPlayable).toBeFalse();
    expect(result.stations[0].exclusionReason).toBe('BELGRANO_SUR_EXCLUDED');
  });
});

function testGeneralPazLine() {
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: [[-1, 0], [1, 0]],
        },
      },
    ],
  };
}
