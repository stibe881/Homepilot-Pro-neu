// Tests für die App.
//
// Warum es die überhaupt braucht: 47 exportierte Funktionen tragen im
// Kommentar «rein, testbar». Sie wurden eigens dafür aus den Bildschirmen
// herausgelöst – und dann lief nie eine, weil es keinen Runner gab.
//
// jest-expo statt eines nackten Jest: Die Funktionen wohnen in Dateien,
// die react-native importieren. Ohne die Voreinstellungen von Expo müsste
// man jede davon einzeln nachbilden.
module.exports = {
  preset: 'jest-expo',
  // Nur unsere Tests, nicht die in node_modules.
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  // Was hier steht, wird nach TypeScript übersetzt, bevor Jest es sieht –
  // sonst stolpert es über die Syntax in den Expo-Paketen.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}'],
};
