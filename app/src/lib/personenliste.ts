/**
 * Wie sich «Wer dazugehört» ordnet (Punkt 262 der Werkbank).
 *
 * Die Seite war eine Reihe gleich schwerer Karten: Besitzer, Wandtablet,
 * Mitbewohnerin, Babysitter und zwei Kinder, alle im selben Aussehen,
 * jede mit demselben grauen «… · Zugang zur App». Wer nachsehen wollte,
 * welches Kind noch kein Sterne-Ziel hat, musste sechs Zeilen lesen -
 * und das Sterne-Blatt hing als eigene Karte darunter, sichtbar
 * losgelöst von der Person, zu der es gehört.
 *
 * Deshalb hier die Gliederung: Erwachsene, Kinder, Gäste, Geräte. Vier
 * Gruppen, weil vier verschiedene Dinge gemeint sind - ein Babysitter
 * ist kein Haushaltsmitglied, und das Wandtablet im Flur ist überhaupt
 * kein Mensch. Leere Gruppen fallen weg: Eine Überschrift «Gäste» über
 * nichts ist keine Auskunft.
 */

import { istKind } from './kindseite';
import { Mitglied } from './mitglieder';

export type GruppenKey = 'erwachsene' | 'kinder' | 'gaeste' | 'geraete';

export interface PersonenGruppe {
  key: GruppenKey;
  titel: string;
  leute: Mitglied[];
}

/** Die Reihenfolge der Gruppen - von «gehört hierher» nach «ist nur zu Gast». */
const REIHE: { key: GruppenKey; titel: string }[] = [
  { key: 'erwachsene', titel: 'Erwachsene' },
  { key: 'kinder', titel: 'Kinder' },
  { key: 'gaeste', titel: 'Gäste' },
  { key: 'geraete', titel: 'Geräte' },
];

/**
 * In welche Gruppe gehört diese Person? (rein, testbar)
 *
 * Das Gerät zuerst: Das Wandtablet trägt die Rolle «bewohner» und sähe
 * sonst aus wie eine Mitbewohnerin - mit Punkten, offenen Aufgaben und
 * einem Kreuz zum Entfernen. Danach das Kind (lib/kindseite.ts,
 * istKind), denn ein Kind kann sehr wohl einen eigenen Zugang haben.
 */
export function gruppeVon(mitglied: Mitglied): GruppenKey {
  if (mitglied?.shared) return 'geraete';
  if (istKind(mitglied)) return 'kinder';
  if (mitglied?.role === 'gast') return 'gaeste';
  return 'erwachsene';
}

/** Die Reihe in Gruppen, leere weggelassen (rein, testbar). */
export function personenGruppen(reihe: Mitglied[]): PersonenGruppe[] {
  return REIHE.map(({ key, titel }) => ({
    key,
    titel,
    leute: (reihe ?? []).filter((mitglied) => gruppeVon(mitglied) === key),
  })).filter((gruppe) => gruppe.leute.length > 0);
}

/**
 * Die Anfangsbuchstaben fürs Bild (rein, testbar).
 *
 * Zwei Wörter geben zwei Buchstaben: «Oma Meier» wird «OM». In einem
 * Haushalt mit Lina und Levin ist ein einzelnes «L» auf zwei runden
 * Bildern nebeneinander keine Unterscheidung.
 */
export function initialen(name: string): string {
  const teile = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (teile.length === 0) return '?';
  if (teile.length === 1) return teile[0].slice(0, 1).toUpperCase();
  return (teile[0].slice(0, 1) + teile[teile.length - 1].slice(0, 1)).toUpperCase();
}

/**
 * Welche Farbe bekommt dieses Bild? (rein, testbar)
 *
 * Aus dem Namen gerechnet und nicht aus der Position: Sonst wechselte
 * die Farbe einer Person, sobald jemand vor ihr dazukommt - und man
 * erkennt sie in der Reihe am Fleck, bevor man den Namen liest.
 */
export function farbIndex(name: string, anzahl: number): number {
  if (anzahl <= 0) return 0;
  let summe = 0;
  for (const zeichen of String(name ?? '')) summe += zeichen.codePointAt(0) ?? 0;
  return summe % anzahl;
}

/**
 * Was unter dem Namen steht (rein, testbar).
 *
 * Ein einziger Satzteil, der sagt, was dieser Mensch ist. «Zugang zur
 * App» stand vorher an jeder zweiten Zeile ausgeschrieben - sechsmal
 * dasselbe untereinander liest niemand mehr. Gesagt wird deshalb nur
 * noch das Seltenere: dass jemand *keinen* Zugang hat. Wo nichts steht,
 * kann sich die Person anmelden.
 *
 * Beim Kind hängt es hinten an statt es zu ersetzen: «Kind» und «Kind,
 * ohne Zugang» sind beide Kinder, und der Unterschied entscheidet, ob
 * sich jemand am Tablet im Kinderzimmer anmelden kann.
 */
export function rolleZeile(mitglied: Mitglied, rollenWort: string): string {
  if (mitglied?.shared) return 'Wandgerät';
  if (mitglied?.ohneZugang) {
    return mitglied.role === 'erwachsen' ? 'Ohne Zugang' : 'Kind, ohne Zugang';
  }
  return rollenWort || String(mitglied?.role ?? '');
}
