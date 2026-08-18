import { Platform } from 'react-native';

/**
 * Welche Hub-Adresse beim ersten Start vorgeschlagen wird.
 *
 * Läuft die Web-Fassung beim Hub selbst – also unter derselben Adresse –,
 * dann kennt sie ihn schon: Der Browser weiss, woher er die Seite geladen
 * hat. Dann eine IP abtippen zu lassen, die man gerade im Adressfeld
 * stehen hat, wäre eine überflüssige Hürde.
 *
 * Überall sonst bleibt es beim Beispiel aus dem eigenen Netz. Das ist kein
 * Fund, sondern ein Platzhalter – aber einer, der die Form zeigt.
 */
export function defaultHubUrl(): string {
  if (Platform.OS !== 'web') return 'http://192.168.1.10:8123';
  const origin = globalThis.location?.origin;
  if (!origin) return 'http://192.168.1.10:8123';
  // Der Entwicklungsserver von Expo läuft auf 8081 und ist nicht der Hub –
  // dort wäre der Vorschlag falsch und würde nur verwirren.
  if (/:(8081|19006)$/.test(origin)) return 'http://192.168.1.10:8123';
  return origin;
}
