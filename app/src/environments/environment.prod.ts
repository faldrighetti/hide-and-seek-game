export const environment = {
  production: true,
  firebase: {
    apiKey: "AIzaSyA1S1eVQds_HlSXUOLJqHtxEqzWWIzFRYc",
    authDomain: "hide-and-seek-2026.firebaseapp.com",
    projectId: "hide-and-seek-2026",
    appId: "1:63026952241:web:bd9b4c7c451e63e4877d10",
    storageBucket: "hide-and-seek-2026.firebasestorage.app",
    messagingSenderId: "63026952241",
    // Set this to the Web Push certificate key generated in Firebase Console.
    webPushVapidKey: "BNt5YlOggUwTfQhrlFn-2h6E1zHVy4hi5nQZUYEWffiKaGAeIiv8WZv4rEi3mYK5OEWrQWsvFMFQTqEBxFjOkWY",
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
