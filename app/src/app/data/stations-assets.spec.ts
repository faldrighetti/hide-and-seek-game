import { extractStations, RawStationsFile } from './station-processing';
import { StationsProcessedFile } from '../models/station.model';

describe('station assets', () => {
  it('preserves station order from stations.json to stations.processed.json', async () => {
    const [sourceResponse, processedResponse] = await Promise.all([
      fetch('assets/stations.json'),
      fetch('assets/stations.processed.json'),
    ]);
    const source = await sourceResponse.json() as RawStationsFile;
    const processed = await processedResponse.json() as StationsProcessedFile;

    expect(processed.stations.map(station => station.id)).toEqual(extractStations(source).map(station => station.id));
  });
});
