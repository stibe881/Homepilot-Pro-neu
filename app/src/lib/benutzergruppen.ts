/**
 * Die Benutzer eines Hauses in Gruppen (alle rein, testbar).
 *
 * Die Verwaltung zeigte eine einzige Liste: die Besitzerin, die
 * Mitbewohner, die Kinder, das Wandtablet im Flur und jeder Babysitter,
 * der einmal einen Abend lang hereindurfte - alle untereinander,
 * alphabetisch, in gleich aussehenden Karten. Die Liste wächst nur in
 * eine Richtung, und die Frage, die man hier stellt, ist fast nie «wer
 * heisst wie», sondern «wer kommt eigentlich alles herein?».
 *
 * Vier Gruppen, weil es vier Sorten Zugang gibt und sie verschieden
 * schwer wiegen: Haushalt, Kinder, Gäste - und Geräte, die keine
 * Personen sind. Ein Gemeinschaftsgerät steht bei den Geräten, auch
 * wenn es die Rolle eines Bewohners trägt: Was im Flur an der Wand
 * hängt, ist kein Mensch, und wer eine Liste von Personen liest, soll
 * nicht über ein Tablet stolpern.
 */

/** Was die Einteilung von einem Benutzer wissen muss. */
export interface Zugang {
  name: string;
  role: string;
  shared?: boolean;
  enabled?: boolean;
}

export interface Zugangsgruppe<T extends Zugang> {
  key: 'haushalt' | 'kinder' | 'gaeste' | 'geraete';
  titel: string;
  /** Ein Satz unter der Überschrift - er sagt, was die Gruppe darf. */
  hinweis: string;
  eintraege: T[];
}

const GRUPPEN: { key: Zugangsgruppe<Zugang>['key']; titel: string; hinweis: string }[] = [
  {
    key: 'haushalt',
    titel: 'Haushalt',
    hinweis: 'Bedienen das ganze Haus.',
  },
  {
    key: 'kinder',
    titel: 'Kinder',
    hinweis: 'Sehen die Kinder-Ansicht ihrer Zimmer.',
  },
  {
    key: 'gaeste',
    titel: 'Gäste',
    hinweis: 'Nur die freigegebenen Bereiche - jederzeit sperrbar.',
  },
  {
    key: 'geraete',
    titel: 'Gemeinschaftsgeräte',
    hinweis: 'Wandtablet und Küchendisplay - keine Personen.',
  },
];

/** In welche Gruppe gehört dieser Zugang? (rein, testbar) */
export function gruppeVon(zugang: Zugang): Zugangsgruppe<Zugang>['key'] {
  // Das Gerät vor der Rolle: Das Wandtablet ist als Bewohner angelegt,
  // steht aber im Flur und nicht am Tisch.
  if (zugang.shared) return 'geraete';
  if (zugang.role === 'kind') return 'kinder';
  if (zugang.role === 'gast') return 'gaeste';
  return 'haushalt';
}

/**
 * Die Benutzer nach Gruppen, leere Gruppen fallen weg (rein, testbar).
 *
 * Innerhalb einer Gruppe stehen die gesperrten zuletzt: Ein
 * deaktivierter Zugang ist eine Erinnerung, kein Mitglied - und wer die
 * Liste überfliegt, sucht die, die gerade hereinkommen.
 */
export function gruppiereZugaenge<T extends Zugang>(zugaenge: T[]): Zugangsgruppe<T>[] {
  return GRUPPEN.map((gruppe) => ({
    ...gruppe,
    eintraege: zugaenge
      .filter((zugang) => gruppeVon(zugang) === gruppe.key)
      .sort((a, b) => {
        const aAus = a.enabled === false;
        const bAus = b.enabled === false;
        if (aAus !== bAus) return aAus ? 1 : -1;
        return a.name.localeCompare(b.name);
      }),
  })).filter((gruppe) => gruppe.eintraege.length > 0);
}
