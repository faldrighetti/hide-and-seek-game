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
- `src/assets/general_paz.geojson`: GeoJSON local `LineString` de Avenida General Paz, derivado de vertices del limite oficial de barrios CABA.
- `src/assets/riachuelo.geojson`: GeoJSON local `LineString` derivado de la geometria oficial de barrios CABA.
- `src/assets/stations.json`: archivo de estaciones detectado automaticamente por el script.
- `src/app/data/station-hubs.ts`: definiciones versionadas de hubs logicos.

Salidas generadas:

- `src/assets/stations.processed.json`: estaciones validadas, con `barrio`, `comuna` cuando aplica y `hub_id` configurado.
- `src/assets/barrios_caba.simplified.json`: barrios simplificados para Leaflet.
- `src/assets/map-generator.bounds.json`: bounding box deterministico de navegacion del mapa.

El script reporta IDs duplicados, coordenadas invalidas, estaciones fuera de poligonos, nombres duplicados sin hub, hubs invalidos, hubs unitarios, coordenadas duplicadas y saltos anomalos por linea jugable. El dataset actual tiene 144 estaciones; las estaciones AMBA fuera de barrios CABA se reportan explicitamente.

El orden de estaciones se preserva desde `stations.json` hasta `stations.processed.json`. Los acordeones por linea respetan ese orden relativo y no ordenan alfabeticamente, por lat/lng ni por `id`; si una estacion no es jugable, su ausencia no cambia el orden relativo de las restantes.

La jugabilidad se clasifica con distancia real punto-linea contra `general_paz.geojson` y `riachuelo.geojson`:

- Estacion dentro de CABA: jugable.
- Estacion fuera de CABA y a 1000 m o menos de General Paz: jugable.
- Estacion fuera de CABA y a 1000 m o menos del Riachuelo: jugable.
- Estacion fuera de CABA y a mas de 1000 m de ambos limites: no jugable.
- Belgrano Sur: siempre excluido, independientemente de su ubicacion.

El limite visual del mapa es independiente de la regla de jugabilidad. Se deriva offline a partir del poligono oficial de CABA, la geometria de General Paz, la geometria del Riachuelo y un buffer visual de 2000 m. La salida actual es:

```json
[-58.5533266, -34.7139662, -58.3314934, -34.5118298]
```

La geometria de General Paz fue refinada para el tramo norte/noroeste usando vertices del limite oficial. Esto hizo jugables estaciones ferroviarias fuera de CABA pero dentro del umbral de 1000 m: Juan B. Justo, Padilla, Miguelete, Lynch y Saenz Pena.

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
  distanceToRiachueloM?: number;
  isPlayable?: boolean;
  exclusionReason?: string;
}
```

La identidad logica se resuelve con:

```ts
station.hub_id ?? station.id
```

La utilidad esta en `src/app/models/station.model.ts` como `getStationComparisonKey`.

## Hubs

`stations.json` es la fuente de verdad para estaciones y coordenadas. `station-hubs.ts` es la fuente de verdad para grupos logicos de hubs.

El procesamiento aplica `hub_id` al JSON procesado segun `STATION_HUB_DEFINITIONS`, sin modificar `stations.json`. Si un miembro de hub no resuelve exactamente una estacion real, queda como warning. Para nombres diferenciados por linea en la fuente, como `Pueyrredon (B)` / `Pueyrredon (D)`, el matching de hubs ignora el sufijo parentetico cuando `line` y `mode` ya desambiguan.

Ultima corrida:

- Hubs configurados: 16.
- Estaciones con `hub_id`: 38.
- Miembros de hub sin resolver: 0.
- Hubs unitarios: 0.
- `hubId` duplicados en `station-hubs.ts`: 0.

## Duplicados aceptados

Los siguientes nombres repetidos no califican para hub porque no estan en ubicaciones cercanas entre si. La validacion los ignora por conjunto exacto de IDs; si aparece otra estacion con el mismo nombre, volvera a reportarse. No se asignan hubs silenciosamente.

| Nombre | IDs / lineas / coordenadas | Clasificacion | Decision |
| --- | --- | --- | --- |
| Caseros | `subte_h_caseros` SUBTE H (-34.6352, -58.3992); `tren_san_martin_caseros` TREN San Martin (-34.6053, -58.573) | Coincidencia de nombre sin combinacion fisica | Duplicado aceptado; sin hub |
| Devoto | `tren_san_martin_devoto` TREN San Martin (-34.6026, -58.5129); `tren_urquiza_devoto` TREN Urquiza (-34.5953, -58.5108) | Coincidencia de nombre sin combinacion fisica; misma zona, no combinacion directa | Duplicado aceptado; sin hub |
| Florida | `subte_b_florida` SUBTE B (-34.6032, -58.3751); `tren_mitre_florida` TREN Mitre (-34.5303, -58.4946); `tren_belgrano_norte_florida` TREN Belgrano Norte (-34.5371, -58.5139) | Coincidencia de nombre sin combinacion fisica | Duplicado aceptado; sin hub |
| General Urquiza | `subte_e_general_urquiza` SUBTE E (-34.6246, -58.4097); `tren_mitre_general_urquiza` TREN Mitre (-34.5747, -58.4879) | Coincidencia de nombre sin combinacion fisica | Duplicado aceptado; sin hub comun; Mitre conserva `hub-rosas-general-urquiza` |
| Saenz Pena | `subte_a_saenz_pena` SUBTE A (-34.6094, -58.3868); `tren_san_martin_saenz_pena` TREN San Martin (-34.603, -58.5274) | Coincidencia de nombre sin combinacion fisica | Duplicado aceptado; sin hub |

## Configuracion fija

`src/app/config/game-config.ts` centraliza:

- `minDisplacementM: 2500`
- `hidingZoneRadiusM: 600`
- `escapePhaseSeconds: 3600` (60 minutos)
- `endgameDwellSeconds: 60`
- `captainFailoverSeconds: 60`
- `endgameVerificationCooldownMinutes: 10`
- `allowedTransportModes: ['SUBTE', 'TREN', 'COLECTIVO', 'CAMINATA']`
- `prohibitedTransportModes: ['UBER', 'TAXI', 'BICICLETA', 'ECOBICI', 'VEHICULO_PARTICULAR', 'EQUIVALENTE']`
- `maxDistanceFromGeneralPazM: 1000`
- `maxDistanceFromRiachueloM: 1000`

La fase de escape dura siempre 60 minutos en todos los runs; no hay extensiones de escape. El radio de zona no es adaptativo. Las anclas validas son estaciones.

## Feature `/map-generator`

Abrir:

```text
/map-generator
```

Tambien hay un boton desde Home.

### Modo Hider

Implementado:

- Mapa Leaflet de CABA.
- `maxBounds` rectangular desde `map-generator.bounds.json`, con `maxBoundsViscosity: 1`.
- `fitBounds` inicial al area visual jugable.
- `minZoom: 11` y `maxZoom: 18`.
- `preferCanvas: true`.
- Poligonos desde `barrios_caba.simplified.json`.
- Marcadores de estaciones desde `stations.processed.json`.
- Seleccion de estacion.
- Circulo exacto de 600m centrado en la estacion.
- Detalle de nombre, linea, transporte, barrio y `hub_id` diagnostico.
- Buscador y acordeones por linea.
- Orden de estaciones por linea preservado segun `stations.json`.

Capas de Leaflet:

- Barrios: capa GeoJSON independiente.
- Estaciones: layer group independiente con marcadores reutilizados por `station.id`.
- Restricciones/zona seleccionada: layer group independiente.

No se dibujan los circulos de 600 m de todas las estaciones; solo se renderiza el circulo de la estacion seleccionada o inspeccionada.

Assets medidos localmente:

| Asset | Tamano |
| --- | ---: |
| `barrios_caba.json` | 763723 bytes |
| `barrios_caba.simplified.json` | 174022 bytes |
| `stations.processed.json` | 62971 bytes |
| `general_paz.geojson` | 1099 bytes |
| `riachuelo.geojson` | 972 bytes |
| `map-generator.bounds.json` | 340 bytes |

Parseo promedio local sobre 100 iteraciones con Node:

| Asset | Parseo promedio |
| --- | ---: |
| `barrios_caba.simplified.json` | 0.394 ms |
| `stations.processed.json` | 0.224 ms |
| `map-generator.bounds.json` | 0.002 ms |

La carga inicial renderiza 134 marcadores jugables, una capa GeoJSON de barrios y una capa vacia para restricciones. La lentitud esperable proviene principalmente de teselas OSM y del render GeoJSON simplificado; el asset nuevo de bounds no aporta costo relevante. Los cambios de seleccion ya no reconstruyen el mapa completo ni recrean todos los marcadores.

No usa GPS del hider y no escribe en Firestore.

### Modo Seeker

Implementado:

- Todas las estaciones como candidatas iniciales.
- Estados `POSSIBLE`, `ELIMINATED`, `UNKNOWN`.
- Seleccion manual multiple.
- Eliminacion y restauracion.
- Descarte manual por circulo con centro desde click en mapa o coordenadas, radio en metros, modo eliminar dentro/fuera y motivo.
- Historial agrupado como "Estaciones eliminadas", por accion, con cantidad, lista expandible, propagacion de hub y activacion/desactivacion.
- Historial con undo/redo.
- Recalculo desde historial.
- Persistencia en `localStorage`.
- Lista de estaciones individuales agrupadas por linea.
- Eliminacion/restauracion por hub como comportamiento predeterminado cuando la estacion tiene `hub_id` en `stations.json`.
- Aviso previo de que estaciones del mismo hub seran afectadas.

Internamente se conserva soporte para operar por estacion concreta para depuracion, pero no se presenta como eleccion habitual.

No se implementa dibujo manual de poligonos.

Modelo actual de circulo manual:

```ts
interface ManualCircleConstraint {
  id: string;
  type: 'MANUAL_CIRCLE';
  center: { lat: number; lng: number };
  radiusM: number;
  mode: 'ELIMINATE_INSIDE' | 'ELIMINATE_OUTSIDE';
  reason?: string;
  questionId?: string;
  enabled: boolean;
}
```

## Motor de restricciones

Implementado:

- Eliminacion manual.
- Restauracion manual.
- Circulo manual.
- Clasificacion geometrica base de Radar con circulos, sin descartar por distancia al centro solamente.

Cada estacion representa una zona circular fija de 600 m. La relacion espacial se clasifica como `FULLY_INSIDE`, `FULLY_OUTSIDE` o `INTERSECTS`.

- `ELIMINATE_INSIDE`: elimina solo estaciones cuya zona de 600 m esta `FULLY_INSIDE`; conserva `INTERSECTS` y `FULLY_OUTSIDE`.
- `ELIMINATE_OUTSIDE`: elimina solo estaciones cuya zona esta `FULLY_OUTSIDE`; conserva `INTERSECTS` y `FULLY_INSIDE`.

Preparado como stubs explicitos:

- Thermometer.
- Measuring.
- Matching.
- Tentacles.

La logica geometrica y de evaluacion vive fuera del componente visual.

## Preguntas CABA

`src/assets/questions/Preguntas_CABA.json` conserva el texto visible de las preguntas restantes y agrega metadata tecnica:

```ts
type ResolutionMode =
  | 'AUTOMATIC'
  | 'MANUAL_STATIONS'
  | 'MANUAL_CIRCLE'
  | 'EXTERNAL_PHOTO';
```

Cambios aplicados:

- Coincidencias: eliminadas `1.ª division administrativa (provincia)`, `2.ª division administrativa (partido)` y `Comisaria` si aparece.
- Comparaciones: eliminadas `Linea de subte`, `Linea de trenes` y `Rio de la Plata`; se mantienen General Paz y Riachuelo.
- Termometros: nombre visible `Termometros`; distancias normalizadas a `100`, `200`, `500`, `1000` y `2000` metros. La distancia representa el minimo que viajo el seeker, no un radio de zona.
- Radares: opciones cargadas desde JSON y normalizadas a `500`, `1000`, `2000`, `5000` metros o distancia personalizada.
- Tentaculos: se mantienen McDonald's, Estaciones de subte, Museos, Cines y Hospitales; solo Estaciones de subte queda marcado como automatizable con el dataset actual.
- Fotos: resolucion `EXTERNAL_PHOTO`, manejo externo por WhatsApp y metadata solamente (`question`, `timer`, `sentExternally`, `sentAt`, `resolved`). No se almacenan imagenes, URLs ni miniaturas.

No se agregan datasets de POIs, Google Maps, integracion con WhatsApp ni almacenamiento de fotos.

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
- UI dedicada para cargar cartas/preguntas desde `Preguntas_CABA.json`.
- Automatizacion real de Coincidencias, Comparaciones, Termometros y Tentaculos.
- Integracion segura de seleccion de estacion con Firestore.
- Refinar las geometrias de General Paz y Riachuelo si se reemplazan por una fuente GIS oficial de mayor precision.
- Tests de Firebase Emulator.
- UI avanzada para restricciones cartograficas y preguntas.
