import { getStationComparisonKey, Station } from './station.model';

describe('getStationComparisonKey', () => {
  it('uses hub_id when present', () => {
    const station = { id: 'retiro-c', hub_id: 'hub-retiro' } as Station;
    expect(getStationComparisonKey(station)).toBe('hub-retiro');
  });

  it('falls back to station id', () => {
    const station = { id: 'callao-b' } as Station;
    expect(getStationComparisonKey(station)).toBe('callao-b');
  });
});
