/**
 * Welches App-Symbol gerade gilt – und wie man es wechselt.
 *
 * Zwei Farbwege: das blaue Haus und dasselbe in Neon-Pink. Was hier
 * steht, ist reine Buchhaltung – das Umschalten selbst hängt an der
 * Plattform und steckt in `symbolwechsel.ts`.
 *
 * Bewusst am Gerät gespeichert und nicht an der Person: Ein App-Symbol
 * ist eine Eigenschaft der Installation. Wer sich auf dem Wandpanel
 * anmeldet, färbt damit nicht das Telefon in der Hosentasche um – und
 * am Wandpanel hätte niemand etwas davon.
 */

/** Kennung des Zweitsymbols, wie sie auch im Plugin und in iOS steht. */
export const PINK = 'Pink';

/** Das mitgelieferte Symbol. `null`, weil iOS das so nennt. */
export type Symbolwahl = null | typeof PINK;

export interface Symboleintrag {
  /** `null` ist das Standardsymbol. */
  wahl: Symbolwahl;
  label: string;
  /** Der Favicon im Web-Bau – Dateiname, nicht Pfad. */
  favicon: string;
  /** Für die Vorschau im Formular. */
  oben: string;
  unten: string;
}

export const SYMBOLE: readonly Symboleintrag[] = [
  { wahl: null, label: 'Blau', favicon: 'favicon.ico', oben: '#4A85FF', unten: '#1B45C8' },
  { wahl: PINK, label: 'Neon-Pink', favicon: 'favicon-pink.png', oben: '#FF4FC3', unten: '#B0117E' },
] as const;

/**
 * Eine gespeicherte Wahl in eine gültige übersetzen (rein, testbar).
 *
 * Alles Unbekannte wird zum Standardsymbol. Wichtig, weil der Wert aus
 * dem Speicher des Geräts kommt: Nach einem Rückbau stünde dort sonst
 * ein Name, den iOS nicht kennt – und `setAlternateAppIcon` wirft
 * darauf.
 */
export function gueltig(wert: unknown): Symbolwahl {
  return wert === PINK ? PINK : null;
}

/** Der Eintrag zu einer Wahl (rein, testbar). */
export function eintrag(wahl: Symbolwahl): Symboleintrag {
  return SYMBOLE.find((s) => s.wahl === gueltig(wahl)) ?? SYMBOLE[0];
}

/** Wie das Symbol heisst (rein, testbar). */
export function label(wahl: Symbolwahl): string {
  return eintrag(wahl).label;
}

/**
 * Der Favicon-Pfad zu einer Wahl (rein, testbar).
 *
 * Ohne führenden Schrägstrich wäre er relativ zur gerade offenen Seite –
 * und die App hat Unterseiten.
 */
export function faviconPfad(wahl: Symbolwahl): string {
  return `/${eintrag(wahl).favicon}`;
}
