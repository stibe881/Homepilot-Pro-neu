/**
 * Zählt das Zurückkommen aus dem Hintergrund als «App geöffnet»?
 *
 * Für alles, was beim Öffnen einmal passieren soll – zuerst das Fenster
 * «Was ist neu». Auf dem Telefon wird eine App fast nie beendet: Sie
 * liegt im Hintergrund, und «öffnen» heisst zurückkommen. Wer das nicht
 * mitzählt, zeigt seine Begrüssung genau einmal im Monat.
 *
 * Der kurze Blick woanders hin zählt aber nicht: Wer die Kamera-App
 * aufmacht, um den QR-Code zu scannen, oder in den Kalender schaut,
 * kommt nach ein paar Sekunden zurück – und soll dann nicht wieder
 * dasselbe Fenster wegklicken müssen. Deshalb die Schwelle.
 */

/** Ab so vielen Millisekunden Abwesenheit gilt es als neu geöffnet.
 *
 * Eine halbe Minute: lang genug, dass ein Blick in eine andere App nicht
 * zählt, kurz genug, dass das Telefon aus der Tasche fast immer zählt. */
export const NEU_GEOEFFNET_NACH = 30_000;

/** War die App lange genug weg, dass das Zurückkommen ein Öffnen ist?
 *  (rein, testbar) */
export function giltAlsNeuGeoeffnet(
  weggegangen: number | null,
  jetzt: number,
  schwelle: number = NEU_GEOEFFNET_NACH
): boolean {
  // Ohne bekannten Zeitpunkt lieber nicht: Das kommt vor, wenn der erste
  // Zustandswechsel schon «aktiv» lautet – die App war nie weg.
  if (weggegangen === null) return false;
  return jetzt - weggegangen >= schwelle;
}
