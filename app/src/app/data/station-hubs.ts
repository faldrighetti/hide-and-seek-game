import { Station } from '../models/station.model';

export interface StationHubDefinition {
  hubId: string;
  members: Array<Pick<Station, 'name' | 'line' | 'mode'>>;
}

export const STATION_HUB_DEFINITIONS: StationHubDefinition[] = [
  {
    hubId: 'hub-retiro',
    members: [
      { name: 'Retiro', line: 'Mitre', mode: 'TREN' },
      { name: 'Retiro', line: 'Belgrano Norte', mode: 'TREN' },
      { name: 'Retiro', line: 'San Martín', mode: 'TREN' },
      { name: 'Retiro', line: 'C', mode: 'SUBTE' },
      { name: 'Retiro', line: 'E', mode: 'SUBTE' },
    ],
  },
  {
    hubId: 'hub-once',
    members: [
      { name: 'Plaza Miserere', line: 'A', mode: 'SUBTE' },
      { name: 'Once', line: 'H', mode: 'SUBTE' },
      { name: 'Once', line: 'Sarmiento', mode: 'TREN' },
    ],
  },
  {
    hubId: 'hub-constitucion',
    members: [
      { name: 'Constitución', line: 'C', mode: 'SUBTE' },
      { name: 'Constitución', line: 'Roca', mode: 'TREN' },
    ],
  },
  {
    hubId: 'hub-ministro-carranza',
    members: [
      { name: 'Ministro Carranza', line: 'D', mode: 'SUBTE' },
      { name: 'Ministro Carranza', line: 'Mitre', mode: 'TREN' },
    ],
  },
  {
    hubId: 'hub-palermo',
    members: [
      { name: 'Palermo', line: 'D', mode: 'SUBTE' },
      { name: 'Palermo', line: 'San Martín', mode: 'TREN' },
    ],
  },
  {
    hubId: 'hub-federico-lacroze',
    members: [
      { name: 'Federico Lacroze', line: 'B', mode: 'SUBTE' },
      { name: 'Federico Lacroze', line: 'Urquiza', mode: 'TREN' },
    ],
  },
  {
    hubId: 'hub-dorrego-villa-crespo',
    members: [
      { name: 'Dorrego', line: 'B', mode: 'SUBTE' },
      { name: 'Villa Crespo', line: 'San Martín', mode: 'TREN' },
    ],
  },
  {
    hubId: 'hub-rosas-general-urquiza',
    members: [
      { name: 'Juan Manuel de Rosas', line: 'B', mode: 'SUBTE' },
      { name: 'General Urquiza', line: 'Mitre', mode: 'TREN' },
    ],
  },
  {
    hubId: 'hub-independencia',
    members: [
      { name: 'Independencia', line: 'C', mode: 'SUBTE' },
      { name: 'Independencia', line: 'E', mode: 'SUBTE' },
    ],
  },
  {
    hubId: 'hub-peru-catedral-bolivar',
    members: [
      { name: 'Perú', line: 'A', mode: 'SUBTE' },
      { name: 'Catedral', line: 'D', mode: 'SUBTE' },
      { name: 'Bolívar', line: 'E', mode: 'SUBTE' },
    ],
  },
  {
    hubId: 'hub-lima-avenida-de-mayo',
    members: [
      { name: 'Lima', line: 'A', mode: 'SUBTE' },
      { name: 'Avenida de Mayo', line: 'C', mode: 'SUBTE' },
    ],
  },
  {
    hubId: 'hub-alem-correo-central',
    members: [
      { name: 'Leandro N. Alem', line: 'B', mode: 'SUBTE' },
      { name: 'Correo Central', line: 'E', mode: 'SUBTE' },
    ],
  },
  {
    hubId: 'hub-obelisco',
    members: [
      { name: 'Carlos Pellegrini', line: 'B', mode: 'SUBTE' },
      { name: 'Diagonal Norte', line: 'C', mode: 'SUBTE' },
      { name: '9 de Julio', line: 'D', mode: 'SUBTE' },
    ],
  },
  {
    hubId: 'hub-pueyrredon-corrientes',
    members: [
      { name: 'Pueyrredón', line: 'B', mode: 'SUBTE' },
      { name: 'Corrientes', line: 'H', mode: 'SUBTE' },
    ],
  },
  {
    hubId: 'hub-pueyrredon-corrientes',
    members: [
      { name: 'Pueyrredón', line: 'B', mode: 'SUBTE' },
      { name: 'Corrientes', line: 'H', mode: 'SUBTE' },
    ],
  },
  {
    hubId: 'hub-pueyrredon-santa-fe',
    members: [
      { name: 'Pueyrredón', line: 'D', mode: 'SUBTE' },
      { name: 'Santa Fe', line: 'H', mode: 'SUBTE' },
    ],
  },
  {
    hubId: 'hub-jujuy-humberto-primo',
    members: [
      { name: 'Jujuy', line: 'E', mode: 'SUBTE' },
      { name: 'Humberto 1°', line: 'H', mode: 'SUBTE' },
    ],
  },
];
