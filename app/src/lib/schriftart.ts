/**
 * Die Schrift, die der App ein Gesicht gibt.
 *
 * Bis hierher stand alles in der Systemschrift, und darum sah die App
 * aus wie eine Einstellungsseite: sauber, aber ohne Absender. Eine
 * einzige Display-Schrift ändert das mehr als jede Farbe.
 *
 * **Nur die grossen Stellen.** Begrüssung, Raumnamen, die grossen Werte
 * auf den Kacheln – dort, wo drei Wörter stehen und viel Platz ist.
 * Fliesstext, Beschriftungen und alles unter etwa 16 Punkt bleiben
 * System, und das aus zwei Gründen: Die Systemschrift ist für kleine
 * Grade gehintet und auf jedem Gerät die, an die sich das Auge gewöhnt
 * hat – und sie wächst mit der eingestellten Schriftgrösse mit, ohne
 * dass jemand eine zweite Datei nachliefern muss.
 *
 * **Zwei Schnitte, nicht sechs.** Fett für Raumnamen und Kachelwerte,
 * mager für Begrüssung und die grosse Temperatur - beide standen dort
 * schon vorher in diesen Gewichten, und die Schrift soll den Blick
 * verändern, nicht das Layout. Jeder weitere Schnitt wären 55 KB in
 * jedem Update, die nie jemand zu sehen bekommt.
 *
 * **Scheitert das Laden, fehlt nichts.** Dann greift der Rückfall des
 * Systems: Eine Schriftfamilie, die es nicht gibt, wird auf allen drei
 * Plattformen still durch die Standardschrift ersetzt. Genau darum wird
 * hier auch nicht gefragt, ob die Datei da ist - `isLoaded` von
 * expo-font wirft auf dem Web, wenn die Plattform-Brücke die Funktion
 * nicht mitbringt, und eine Prüfung, die im Fehlerfall «nein» sagt,
 * hätte die Schrift überall abgeschaltet. Dass sie vor dem ersten
 * Zeichnen da ist, sorgt App.tsx: Es wartet auf `useFonts`, bevor es
 * überhaupt etwas rendert.
 *
 * Familjen Grotesk, SIL Open Font License 1.1 (assets/fonts/OFL.txt).
 */
import { TextStyle } from 'react-native';

/** Die Namen, unter denen die Schnitte angemeldet sind (siehe App.tsx). */
export const DISPLAY = 'FamiljenGrotesk-Bold';
export const DISPLAY_LEICHT = 'FamiljenGrotesk-Regular';

/**
 * Der Stil für eine grosse Stelle (rein, testbar).
 *
 * Zurück kommt ein Stück `TextStyle`, das man an die vorhandenen Stile
 * anhängt - kein Ersatz für sie.
 *
 * `fontWeight` wird mitgesetzt: Sonst sucht Android in der Familie nach
 * einem Schnitt, den es nicht gibt, und zeichnet ihn künstlich fett
 * nach - dieselbe Schrift sähe dort plumper aus als auf dem iPhone.
 */
export function schrift(gewicht: 'fett' | 'leicht' = 'fett'): TextStyle {
  return gewicht === 'leicht'
    ? { fontFamily: DISPLAY_LEICHT, fontWeight: '400' }
    : { fontFamily: DISPLAY, fontWeight: '700' };
}

/**
 * Ziffern, die nicht wackeln.
 *
 * Für Temperatur, Uhrzeit und Zählstände: Ziffern gleicher Breite,
 * sonst springt die Zeile bei jedem Wechsel von 21,4 auf 21,5 seitlich.
 * Getrennt von `schrift()`, weil es auch für die Systemschrift gilt.
 */
export const ZIFFERN: TextStyle = { fontVariant: ['tabular-nums'] };
