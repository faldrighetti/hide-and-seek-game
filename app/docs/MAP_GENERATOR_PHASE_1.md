# Map Generator Phase 1

## Estado actual

La app es Ionic Angular con Angular 20, Ionic 8 y NgModules. Las paginas principales se cargan por lazy loading desde `src/app/app-routing.module.ts`. Firebase existe en la raiz y hay Cloud Functions en `functions/src/index.ts`, pero el frontend de partida todavia usa principalmente estado local en `GameFacadeService`.

No habia implementacion cartografica activa antes de esta fase. La feature nueva vive en `/map-generator` y carga su propio modulo lazy.

## Procesamiento de datos

Ejecutar:

```bash
npm run data:process-barrios
```

Entradas:

- `src/assets/barrios_caba.json`: GeoJSON oficial de barrios CABA. No se reemplaza ni se descarga otra fuente.
- `src/assets/general_paz.geojson`: GeoJSON local `LineString` de Avenida General Paz.
- `src/assets/stations.json`: archivo de estaciones detectado automaticamente por el script.

Salidas generadas:

- `src/assets/stations.processed.json`: estaciones validadas, con `barrio`, `comuna` cuando aplica y `hub_id` configurado.
- `src/assets/barrios_caba.simplified.json`: barrios simplificados para Leaflet.

El script reporta IDs duplicados, coordenadas invalidas, estaciones fuera de poligonos, nombres duplicados sin hub y advertencias de hubs ambiguos. El dataset actual tiene 188 estaciones; muchas estaciones de AMBA quedan fuera de barrios CABA y se reportan explicitamente.

La jugabilidad se clasifica con una distancia real punto-linea contra `general_paz.geojson`:

- Estacion dentro de CABA: jugable.
- Estacion fuera de CABA y a 1000 m o menos de General Paz: jugable.
- Estacion fuera de CABA y a mas de 1000 m de General Paz: no jugable.
- Belgrano Sur: siempre excluido, independientemente de su ubicacion.

## Modelo Station

```ts
interface Station {
  id: string;
  name: string;
  line: string;
  lat: number;
  lng: number;
  mode: 'SUBTE' | 'TREN';
  hub_id?: string;
  barrio?: string;
  comuna?: number | string;
  isInsideCaba?: boolean;
  distanceToGeneralPazM?: number;
  isPlayable?: boolean;
  exclusionReason?: string;
}
```

La identidad logica se resuelve con:

```ts
station.hub_id ?? station.id
```

La utilidad esta en `src/app/models/station.model.ts` como `getStationComparisonKey`.

## Hubs configurados

- `hub-retiro`: Retiro Mitre, Belgrano Norte, San Martin, Linea C y Linea E.
- `hub-once`: Plaza Miserere A, Once H y Once Sarmiento.
- `hub-constitucion`: Constitucion C y Roca.
- `hub-ministro-carranza`: Ministro Carranza D y Mitre.
- `hub-palermo`: Palermo D y San Martin.
- `hub-federico-lacroze`: Federico Lacroze B y Urquiza.
- `hub-independencia`: Independencia C y E.

Callao B/D y Pueyrredon B/D permanecen como estaciones separadas sin `hub_id`.

## Duplicados revisados

El procesamiento inicial informo cinco nombres duplicados sin hub. Se revisaron y se aplico solo la correccion inequivoca:

| Nombre | IDs / lineas / coordenadas | Clasificacion | Decision |
| --- | --- | --- | --- |
| Caseros | `subte_h_caseros` SUBTE H (-34.6352, -58.4002); `tren_san_martin_caseros` TREN San Martin (-34.6053, -58.573) | Coincidencia de nombre sin combinacion fisica | Sin hub |
| Devoto | `tren_san_martin_devoto` TREN San Martin (-34.6025, -58.5129); `tren_urquiza_devoto` TREN Urquiza (-34.5955, -58.5111) | Coincidencia de nombre sin combinacion fisica; misma zona, no combinacion directa | Sin hub |
| Florida | `subte_b_florida` SUBTE B (-34.6031, -58.375); `tren_mitre_florida` TREN Mitre (-34.5347, -58.4915); `tren_belgrano_norte_florida` TREN Belgrano Norte (-34.5371, -58.5139) | Coincidencia de nombre sin combinacion fisica | Sin hub |
| Independencia | `subte_c_independencia` SUBTE C (-34.6182, -58.3774); `subte_e_independencia` SUBTE E (-34.6179, -58.3812) | Combinacion fisica que deberia tener `hub_id` | Aplicado `hub-independencia` |
| Saenz Pena | `subte_a_saenz_pena` SUBTE A (-34.6095, -58.3871); `tren_san_martin_saenz_pena` TREN San Martin (-34.6029, -58.5279) | Coincidencia de nombre sin combinacion fisica | Sin hub |

## Configuracion fija

`src/app/config/game-config.ts` centraliza:

- `minDisplacementM: 2500`
- `hidingZoneRadiusM: 600`
- `endgameDwellSeconds: 60`
- `captainFailoverSeconds: 60`
- `escapeExtensionMinutes: 10`
- `maxEscapeExtensions: 3`
- `maxDistanceFromGeneralPazM: 1000`

El radio de zona no es adaptativo. Las anclas validas son estaciones.

## Feature `/map-generator`

Abrir:

```text
/map-generator
```

Tambien hay un boton desde Home.

### Modo Hider

Implementado:

- Mapa Leaflet de CABA.
- Poligonos desde `barrios_caba.simplified.json`.
- Marcadores de estaciones desde `stations.processed.json`.
- Seleccion de estacion.
- Circulo exacto de 600m centrado en la estacion.
- Detalle de nombre, linea, transporte, barrio y `hub_id` diagnostico.
- Buscador y acordeones por linea.

No usa GPS del hider y no escribe en Firestore.

### Modo Seeker

Implementado:

- Todas las estaciones como candidatas iniciales.
- Estados `POSSIBLE`, `ELIMINATED`, `UNKNOWN`.
- Seleccion manual multiple.
- Eliminacion y restauracion.
- Historial con undo/redo.
- Recalculo desde historial.
- Persistencia en `localStorage`.
- Lista de estaciones individuales agrupadas por linea.
- Eliminacion/restauracion por hub como comportamiento predeterminado cuando la estacion tiene `hub_id`.
- Aviso previo de que estaciones del mismo hub seran afectadas.

Internamente se conserva soporte para operar por estacion concreta para depuracion, pero no se presenta como eleccion habitual.

## Motor de restricciones

Implementado:

- Eliminacion manual.
- Restauracion manual.
- Clasificacion geometrica base de Radar con circulos, sin descartar por distancia al centro solamente.

Preparado como stubs explicitos:

- Thermometer.
- Measuring.
- Matching.
- Tentacles.

La logica geometrica y de evaluacion vive fuera del componente visual.

## Tarjetas

`CardCatalogService` valida `Tarjetas_CABA.json` y construye el mazo con:

```ts
cards.filter(card => card.enabled)
```

Si una carta no tiene `enabled`, se interpreta como `true` para compatibilidad. El archivo actual declara 24 maldiciones pero contiene 17; se reporta como advertencia, no se completan cartas faltantes.

## Firestore Rules

Las reglas bloquean escrituras directas en la partida, seats, questions y subcolecciones criticas como phase, timers, score, deck, cards, dice, penalties, endgame y captain.

Se permiten escrituras de cliente solo para documentos propios en:

- `games/{gameId}/presence/{uid}`
- `games/{gameId}/locations/{uid}`

No se agregaron tests de emulator en esta fase porque el proyecto no tenia infraestructura existente para eso.

## Pendiente

- Motor completo de Radar aplicado al asistente visual.
- Evaluadores reales de Thermometer, Measuring, Matching y Tentacles.
- Integracion segura de seleccion de estacion con Firestore.
- Refinar la geometria de General Paz si se reemplaza por una fuente GIS oficial de mayor precision.
- Tests de Firebase Emulator.
- UI avanzada para restricciones cartograficas y preguntas.
