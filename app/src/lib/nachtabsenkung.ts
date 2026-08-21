import { sunHours } from '../theme';

/**
 * Wie stark das Wandpanel gerade abgedunkelt gehört.
 *
 * Ein fest montiertes Tablet im Flur leuchtet nachts wie eine Lampe. Der
 * Panel-Modus hielt den Bildschirm bisher an und schickte ihn nach drei
 * Minuten zur Startseite zurück – nur eben in voller Helligkeit.
 *
 * Ausschalten wäre falsch: Der halbe Sinn eines Wandpanels ist, dass man
 * im Vorbeigehen sieht, ob die Haustür zu ist. Es soll dunkler werden,
 * nicht dunkel – und bei der ersten Berührung sofort wieder hell.
 *
 * Die Helligkeit lässt sich aus einer Web-Seite heraus nicht ändern;
 * darüber liegt deshalb ein schwarzer Schleier. Er lässt Berührungen
 * durch, denn ein Panel, bei dem der erste Tipp nur das Aufwecken ist,
 * ärgert genau die Person, die schnell das Licht ausmachen wollte.
 */

/** Wie dunkel es nachts höchstens wird. Darüber liest man nichts mehr. */
export const MAX_SCHLEIER = 0.62;

/** So lange nach einer Berührung bleibt es hell. */
export const WACH_MS = 60_000;

/**
 * Deckkraft des Schleiers, 0 bis {@link MAX_SCHLEIER} (rein, testbar).
 *
 * Über die letzte halbe Stunde vor dem Dunkelwerden und die halbe Stunde
 * nach Sonnenaufgang wird übergeblendet: Ein Schleier, der um 20:41 Uhr
 * schlagartig auftaucht, sieht nach Fehler aus.
 */
export function schleier(
  jetzt: Date,
  letzteBeruehrung: number,
  panelAn: boolean,
  jetztMs = jetzt.getTime()
): number {
  if (!panelAn) return 0;
  if (jetztMs - letzteBeruehrung < WACH_MS) return 0;
  const sonne = sunHours(jetzt);
  // Polartag oder Polarnacht – hier gibt es das nicht, aber die Funktion
  // soll trotzdem eine Antwort haben statt einer Ausnahme.
  if (!sonne) return 0;
  const stunde = jetzt.getHours() + jetzt.getMinutes() / 60;
  const UEBERGANG = 0.5;

  if (stunde >= sonne.sunset) {
    return MAX_SCHLEIER * Math.min(1, (stunde - sonne.sunset) / UEBERGANG);
  }
  if (stunde <= sonne.sunrise) {
    const bisHell = sonne.sunrise - stunde;
    return MAX_SCHLEIER * Math.min(1, bisHell / UEBERGANG);
  }
  return 0;
}
