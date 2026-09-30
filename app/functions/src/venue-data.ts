export interface Venue { name: string; lat: number; lng: number; }

// Copia de los datos de estadios usada solo por Cloud Functions. No se expone
// al cliente al calcular la pista del hider.
const stadiumRows: Array<[string, number, number]> = [
  ['River Plate', -34.545320, -58.449740], ['Vélez Sarsfield', -34.635350, -58.520690],
  ['Boca Juniors', -34.635630, -58.364800], ['Huracán', -34.643480, -58.396520],
  ['San Lorenzo', -34.652080, -58.440100], ['Deportivo Español', -34.657900, -58.464500],
  ['Nueva Chicago', -34.667920, -58.499600], ['Argentinos Juniors', -34.606030, -58.472580],
  ['Ferro Carril Oeste', -34.618670, -58.447830], ['Atlanta', -34.594970, -58.449260],
  ['All Boys', -34.616510, -58.497750], ['Defensores de Belgrano', -34.541210, -58.461850],
  ['Excursionistas', -34.558900, -58.443770], ['Sacachispas', -34.664660, -58.451900],
  ['Barracas Central', -34.647530, -58.396800], ['Comunicaciones', -34.593830, -58.488490],
  ['General Lamadrid', -34.613280, -58.515720], ['Platense', -34.540190, -58.481660],
  ['Independiente', -34.670220, -58.371050], ['Racing Club', -34.667556, -58.368583],
  ['Almagro', -34.614167, -58.535000], ['UAI Urquiza', -34.596010, -58.525470],
];

export const STADIUMS: Venue[] = stadiumRows.map(([name, lat, lng]) => ({name, lat, lng}));
