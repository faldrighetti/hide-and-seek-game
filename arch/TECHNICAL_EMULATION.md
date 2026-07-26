# Emulación técnica de partida

Script: `app/functions/scripts/emulate-turn.js`

Objetivo: validar el flujo técnico con callables reales y Firestore Emulator:
- crear partida,
- unir jugadores,
- iniciar juego,
- forzar ESCAPE con host como hider,
- publicar ubicación privada del hider,
- confirmar estación base,
- pasar a CHASE,
- pregunta -> respuesta -> loot,
- activar endgame por ubicación seeker,
- iniciar captura,
- rechazo del hider,
- ratificación seeker,
- escritura de historial y notificaciones.

## Requisitos

- `npm install` ya ejecutado en `app/functions`.
- Firestore Emulator corriendo.
- Variable `FIRESTORE_EMULATOR_HOST` apuntando al emulador.

Ejemplo:

```bash
firebase emulators:start --only firestore
```

En otra terminal:

```bash
cd app/functions
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run emulate:turn
```

En PowerShell:

```powershell
cd app/functions
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
npm run emulate:turn
```

## Notas

- El script no usa Firebase Auth Emulator; invoca callables con `auth.uid` simulado.
- El script fuerza fases por Admin SDK para evitar esperar timers reales.
- La estación base usada es `subte_a_plaza_de_mayo`.
- La prueba es técnica: valida permisos, estados y escrituras, no deducción gameplay.
