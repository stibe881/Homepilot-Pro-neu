/**
 * Eine Symbolsprache statt vieler Wörter für dieselbe Sache.
 *
 * Ionicons hat für jeden Begriff mehrere Zeichen, und über
 * fünfundvierzig Dateien hinweg hat sich jede Stelle ihres ausgesucht.
 * «Bearbeiten» heisst an einer Stelle `create-outline`, an der nächsten
 * `pencil-outline`; «neu laden» einmal `refresh` und einmal
 * `refresh-outline`; «wegtippen» einmal `close-circle` und einmal
 * `close-circle-outline`. Jedes für sich richtig - zusammen lernt man
 * nie, wie ein Knopf aussieht, den man sucht.
 *
 * Deshalb hier eine Liste: je Begriff genau ein Zeichen. Wer ein Symbol
 * braucht, nimmt den Begriff, nicht das Zeichen - dann steht an der
 * Stelle, was gemeint ist («bearbeiten»), und nicht, wie es aussieht.
 *
 * **Die Regel für die Umrissform**: Alles ist `-outline`, ausser was
 * gefüllt eine Aussage macht. Gefüllt heisst «das gilt jetzt»: das
 * gesetzte Häkchen, der aktive Zustand, die Warnung, die nicht zu
 * übersehen ist. Umriss heisst «das kannst du tun». Ohne diese Regel
 * entscheidet sie jeder neu, und dann sieht ein Bildschirm halb
 * angeschaltet aus.
 *
 * Ein Test hält fest, dass für keinen Begriff zwei Zeichen im Umlauf
 * sind (symbole.test.ts). Er liest die Quelldateien, nicht ihre
 * Ausgabe - von Auge findet man das nie, weil jedes einzelne Symbol
 * für sich in Ordnung aussieht.
 */
import type { Ionicons } from '@expo/vector-icons';

export type Symbolname = keyof typeof Ionicons.glyphMap;

/**
 * Je Begriff ein Zeichen.
 *
 * Nach Themen sortiert und nicht alphabetisch: Wer eines sucht, sucht
 * es in seiner Nachbarschaft («irgendwas mit Listen»), nicht unter
 * seinem Anfangsbuchstaben.
 */
export const SYMBOL = {
  // ── Was man mit einem Ding tut ───────────────────────────────────────
  bearbeiten: 'create-outline',
  loeschen: 'trash-outline',
  hinzufuegen: 'add',
  entfernen: 'remove',
  teilen: 'share-outline',
  kopieren: 'copy-outline',
  neuLaden: 'refresh-outline',
  schliessen: 'close',
  /** Das kleine Kreuz im Suchfeld – wegtippen, nicht schliessen. */
  leeren: 'close-circle',
  suchen: 'search',
  einstellen: 'options-outline',
  sortieren: 'swap-vertical',

  // ── Wie es ausgegangen ist ───────────────────────────────────────────
  /** Gesetzt, also gefüllt: «das gilt jetzt». */
  erledigt: 'checkmark-circle',
  /** Noch nicht gesetzt – dieselbe Form, offen. */
  offen: 'ellipse-outline',
  bestaetigt: 'checkmark',
  warnung: 'warning-outline',
  fehler: 'alert-circle-outline',
  nichtErreichbar: 'cloud-offline-outline',

  // ── Wohin es geht ────────────────────────────────────────────────────
  weiter: 'chevron-forward',
  zurueck: 'chevron-back',
  aufklappen: 'chevron-down',
  zuklappen: 'chevron-up',
  mehr: 'ellipsis-horizontal',

  // ── Die Dinge im Haus ────────────────────────────────────────────────
  licht: 'bulb-outline',
  kamera: 'camera-outline',
  ton: 'volume-medium-outline',
  zeit: 'time-outline',
  kalender: 'calendar-outline',
  ort: 'location-outline',
  person: 'person-outline',
  schluessel: 'key-outline',
  wlan: 'wifi-outline',
  strom: 'flash-outline',
  werkzeug: 'construct-outline',
  geschenk: 'gift-outline',
  mikrofon: 'mic-outline',
  anruf: 'call',
  senden: 'paper-plane-outline',
  verweis: 'link-outline',
  strichcode: 'qr-code-outline',
  nachtruhe: 'moon-outline',
  stumm: 'notifications-off-outline',
} as const satisfies Record<string, Symbolname>;

export type Begriff = keyof typeof SYMBOL;

/**
 * Zeichen, die dasselbe meinen wie eines aus der Liste - und deshalb
 * nicht daneben im Umlauf sein sollen (rein, Daten).
 *
 * Jede Zeile ist ein Paar, das im Haus wirklich nebeneinander stand.
 * Der Test unten macht daraus die Zusage, dass es nicht wieder passiert.
 */
export const GLEICHBEDEUTEND: Record<string, Begriff> = {
  'pencil-outline': 'bearbeiten',
  pencil: 'bearbeiten',
  create: 'bearbeiten',
  'trash-bin-outline': 'loeschen',
  trash: 'loeschen',
  'add-outline': 'hinzufuegen',
  'add-circle-outline': 'hinzufuegen',
  'remove-outline': 'entfernen',
  refresh: 'neuLaden',
  'reload-outline': 'neuLaden',
  reload: 'neuLaden',
  'share-social-outline': 'teilen',
  'close-outline': 'schliessen',
  'close-circle-outline': 'leeren',
  'search-outline': 'suchen',
  'checkmark-outline': 'bestaetigt',
  'checkmark-circle-outline': 'erledigt',
  'checkmark-done': 'bestaetigt',
  'alert-outline': 'fehler',
  'alert-circle': 'fehler',
  'warning': 'warnung',
  'settings-outline': 'einstellen',
  'chevron-forward-outline': 'weiter',
  'chevron-back-outline': 'zurueck',
  'ellipsis-horizontal-outline': 'mehr',
  'ellipsis-vertical': 'mehr',
};

/** Das Zeichen zu einem Begriff (rein, testbar). */
export function symbol(begriff: Begriff): Symbolname {
  return SYMBOL[begriff];
}
