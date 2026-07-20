import { FeatureCollection, Polygon } from 'geojson';
import {
  applyConfiguredHubs,
  assignBarriosToStations,
  classifyPlayableStations,
  deriveMapNavigationBounds,
  extractStations,
  findDuplicates,
  findDuplicateNamesWithoutHub,
  validateHubConfiguration,
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

  it('preserves station input order through processing steps', () => {
    const raw: RawStationsFile = {
      transport: [
        {
          SUBTE: [
            {
              line: 'B',
              stations: [
                { id: 'third', name: 'Zeta', lat: -34.6, lng: -58.4 },
                { id: 'first', name: 'Alfa', lat: -34.61, lng: -58.41 },
                { id: 'second', name: 'Beta', lat: -34.62, lng: -58.42 },
              ],
            },
          ],
        },
      ],
    };

    const extracted = extractStations(raw);
    const barriosResult = assignBarriosToStations(extracted, barrios);

    expect(extracted.map(station => station.id)).toEqual(['third', 'first', 'second']);
    expect(barriosResult.stations.map(station => station.id)).toEqual(['third', 'first', 'second']);
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

  it('derives deterministic map navigation bounds from CABA boundaries plus buffer', () => {
    const caba: FeatureCollection<Polygon> = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
              [0, 0],
            ]],
          },
        },
      ],
    };

    const result = deriveMapNavigationBounds(caba, testGeneralPazLine(), testRiachueloLine(), 1000);

    expect(result.bufferM).toBe(1000);
    expect(result.bbox[0]).toBeLessThanOrEqual(0);
    expect(result.bbox[1]).toBeLessThan(0);
    expect(result.bbox[2]).toBeGreaterThanOrEqual(1);
    expect(result.bbox[3]).toBeGreaterThan(10);
    expect(result.southWest).toEqual({ lat: result.bbox[1], lng: result.bbox[0] });
    expect(result.northEast).toEqual({ lat: result.bbox[3], lng: result.bbox[2] });
  });

  it('validates source-defined hubs without assigning hubs silently', () => {
    const stations = [
      { id: 'retiro-c', name: 'Retiro', line: 'C', mode: 'SUBTE' as const, lat: 0, lng: 0, hub_id: 'hub-retiro' },
      { id: 'retiro-e', name: 'Retiro', line: 'E', mode: 'SUBTE' as const, lat: 0, lng: 0, hub_id: 'hub-retiro' },
      { id: 'solo', name: 'Solo', line: 'A', mode: 'SUBTE' as const, lat: 0, lng: 0, hub_id: 'hub-solo' },
      { id: 'bad', name: 'Bad', line: 'A', mode: 'SUBTE' as const, lat: 0, lng: 0, hub_id: '' },
      { id: 'callao-b', name: 'Callao (B)', line: 'B', mode: 'SUBTE' as const, lat: 0, lng: 0 },
      { id: 'callao-d', name: 'Callao (D)', line: 'D', mode: 'SUBTE' as const, lat: 0, lng: 0 },
    ];

    const result = validateHubConfiguration(stations);
    expect(result.configuredHubCount).toBe(2);
    expect(result.singletonHubIds).toEqual(['hub-solo']);
    expect(result.invalidHubStationIds).toEqual(['bad']);
    expect(stations.find(station => station.id === 'callao-b')?.hub_id).toBeUndefined();
  });

  it('ignores accepted duplicate visible names that are not physical hubs', () => {
    const stations = [
      { id: 'subte_h_caseros', name: 'Caseros', line: 'H', mode: 'SUBTE' as const, lat: 0, lng: 0 },
      { id: 'tren_san_martin_caseros', name: 'Caseros', line: 'San Martin', mode: 'TREN' as const, lat: 0, lng: 0 },
      { id: 'tren_san_martin_devoto', name: 'Devoto', line: 'San Martin', mode: 'TREN' as const, lat: 0, lng: 0 },
      { id: 'tren_urquiza_devoto', name: 'Devoto', line: 'Urquiza', mode: 'TREN' as const, lat: 0, lng: 0 },
      { id: 'subte_b_florida', name: 'Florida', line: 'B', mode: 'SUBTE' as const, lat: 0, lng: 0 },
      { id: 'tren_belgrano_norte_florida', name: 'Florida', line: 'Belgrano Norte', mode: 'TREN' as const, lat: 0, lng: 0 },
      { id: 'tren_mitre_florida', name: 'Florida', line: 'Mitre', mode: 'TREN' as const, lat: 0, lng: 0 },
      { id: 'subte_e_general_urquiza', name: 'General Urquiza', line: 'E', mode: 'SUBTE' as const, lat: 0, lng: 0 },
      { id: 'tren_mitre_general_urquiza', name: 'General Urquiza', line: 'Mitre', mode: 'TREN' as const, lat: 0, lng: 0 },
      { id: 'subte_a_saenz_pena', name: 'Saenz Pena', line: 'A', mode: 'SUBTE' as const, lat: 0, lng: 0 },
      { id: 'tren_san_martin_saenz_pena', name: 'Saenz Pena', line: 'San Martin', mode: 'TREN' as const, lat: 0, lng: 0 },
    ];

    expect(findDuplicateNamesWithoutHub(stations)).toEqual([]);
  });

  it('applies station-hubs definitions to matching real stations', () => {
    const stations = [
      { id: 'subte_c_retiro', name: 'Retiro', line: 'C', mode: 'SUBTE' as const, lat: 0, lng: 0 },
      { id: 'subte_e_retiro', name: 'Retiro', line: 'E', mode: 'SUBTE' as const, lat: 0, lng: 0 },
      { id: 'tren_mitre_retiro', name: 'Retiro', line: 'Mitre', mode: 'TREN' as const, lat: 0, lng: 0 },
      { id: 'tren_san_martin_retiro', name: 'Retiro', line: 'San Martín', mode: 'TREN' as const, lat: 0, lng: 0 },
      { id: 'tren_belgrano_norte_retiro', name: 'Retiro', line: 'Belgrano Norte', mode: 'TREN' as const, lat: 0, lng: 0 },
    ];

    const result = applyConfiguredHubs(stations);
    expect(result.stations.every(station => station.hub_id === 'hub-retiro')).toBeTrue();
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

  it('does not alphabetically sort stations inside a line group', () => {
    const groups = groupStationsByLine([
      { id: 'z', name: 'Zeta', line: 'B', mode: 'SUBTE', lat: 0, lng: 0 },
      { id: 'a', name: 'Alfa', line: 'B', mode: 'SUBTE', lat: 0, lng: 0 },
      { id: 'm', name: 'Medio', line: 'B', mode: 'SUBTE', lat: 0, lng: 0 },
    ]);

    expect(groups[0].stations.map(station => station.id)).toEqual(['z', 'a', 'm']);
  });

  it('marks stations inside CABA as playable', () => {
    const result = classifyPlayableStations([
      { id: 'inside', name: 'Inside', line: 'A', mode: 'SUBTE', lat: -34.6, lng: -58.4, barrio: 'Test' },
    ], testGeneralPazLine(), testRiachueloLine());

    expect(result.stations[0].isInsideCaba).toBeTrue();
    expect(result.stations[0].isPlayable).toBeTrue();
  });

  it('marks a station exactly 1000m from General Paz as playable', () => {
    const lat = 1000 / 111_320;
    const result = classifyPlayableStations([
      { id: 'near', name: 'Near', line: 'Mitre', mode: 'TREN', lat, lng: 0 },
    ], testGeneralPazLine(), testRiachueloLine(), 1000, 1000);

    expect(result.stations[0].distanceToGeneralPazM).toBe(1000);
    expect(result.stations[0].isPlayable).toBeTrue();
  });

  it('marks a station farther than 1000m from General Paz as not playable', () => {
    const lat = 1001 / 111_320;
    const result = classifyPlayableStations([
      { id: 'far', name: 'Far', line: 'Mitre', mode: 'TREN', lat, lng: 0 },
    ], testGeneralPazLine(), testRiachueloLine(), 1000, 1000);

    expect(result.stations[0].isPlayable).toBeFalse();
    expect(result.stations[0].exclusionReason).toBe('TOO_FAR_FROM_CABA_LIMITS');
  });

  it('marks a station near Riachuelo as playable even when far from General Paz', () => {
    const result = classifyPlayableStations([
      { id: 'riachuelo-near', name: 'Riachuelo Near', line: 'Roca', mode: 'TREN', lat: 10, lng: 0 },
    ], testGeneralPazLine(), testRiachueloLine(), 1000, 1000);

    expect(result.stations[0].distanceToGeneralPazM).toBeGreaterThan(1000);
    expect(result.stations[0].distanceToRiachueloM).toBe(0);
    expect(result.stations[0].isPlayable).toBeTrue();
  });

  it('always excludes Belgrano Sur', () => {
    const result = classifyPlayableStations([
      { id: 'bs', name: 'BS', line: 'Belgrano Sur', mode: 'TREN', lat: 0, lng: 0, barrio: 'Test' },
    ], testGeneralPazLine(), testRiachueloLine(), 1000, 1000);

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

function testRiachueloLine() {
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: [[-1, 10], [1, 10]],
        },
      },
    ],
  };
}
