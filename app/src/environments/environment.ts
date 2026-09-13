// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  firebase: {
    apiKey: "AIzaSyA1S1eVQds_HlSXUOLJqHtxEqzWWIzFRYc",
    authDomain: "hide-and-seek-2026.firebaseapp.com",
    projectId: "hide-and-seek-2026",
    appId: "1:63026952241:web:bd9b4c7c451e63e4877d10",
    storageBucket: "hide-and-seek-2026.firebasestorage.app",
    messagingSenderId: "63026952241",
  },
  firebaseEmulators: {
    enabled: false,
    authUrl: 'http://127.0.0.1:9099',
    firestoreHost: '127.0.0.1',
    firestorePort: 8080,
    functionsHost: '127.0.0.1',
    functionsPort: 5001,
  },
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
