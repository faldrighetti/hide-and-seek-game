import { FeatureCollection, Polygon } from 'geojson';
import { Station } from '../models/station.model';
import { evaluatePlayableArea } from './playable-area';

describe('playable area', () => {
  const caba: FeatureCollection<Polygon> = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { nombre: 'Test CABA' },
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

  const outsidePlayableStation: Station = {
    id: 'outside-playable',
    name: 'Outside Playable',
    line: 'Mitre',
    mode: 'TREN',
    lat: 2,
    lng: 2,
    isInsideCaba: false,
    isPlayable: true,
  };

  it('accepts points inside CABA', () => {
    const result = evaluatePlayableArea({ lat: 0.5, lng: 0.5 }, caba, []);

    expect(result.isInsidePlayableArea).toBeTrue();
    expect(result.isInsideCaba).toBeTrue();
    expect(result.isInsidePlayableOutOfCabaStationZone).toBeFalse();
  });

  it('accepts points outside CABA inside a playable outside-CABA station zone', () => {
    const result = evaluatePlayableArea(
      { lat: 2.001, lng: 2 },
      caba,
      [outsidePlayableStation],
      600,
    );

    expect(result.isInsidePlayableArea).toBeTrue();
    expect(result.isInsideCaba).toBeFalse();
    expect(result.isInsidePlayableOutOfCabaStationZone).toBeTrue();
    expect(result.matchedStationId).toBe('outside-playable');
  });

  it('includes the station zone border', () => {
    const borderPoint = { lat: 2.001, lng: 2 };
    const reference = evaluatePlayableArea(
      borderPoint,
      caba,
      [outsidePlayableStation],
      600,
    );

    const result = evaluatePlayableArea(
      borderPoint,
      caba,
      [outsidePlayableStation],
      reference.matchedStationDistanceM ?? 0,
    );

    expect(result.isInsidePlayableArea).toBeTrue();
  });

  it('rejects points outside CABA and outside all playable outside-CABA station zones', () => {
    const result = evaluatePlayableArea(
      { lat: 3, lng: 3 },
      caba,
      [outsidePlayableStation],
      600,
    );

    expect(result.isInsidePlayableArea).toBeFalse();
  });

  it('does not extend the playable area from non-playable outside-CABA stations', () => {
    const result = evaluatePlayableArea(
      { lat: 2.001, lng: 2 },
      caba,
      [{ ...outsidePlayableStation, isPlayable: false }],
      600,
    );

    expect(result.isInsidePlayableArea).toBeFalse();
  });
});
