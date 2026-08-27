/**
 * Den Geräteverlauf lesbar machen: nach Tagen, mit Dauer.
 *
 * Die Liste zeigte bisher Zeitstempel untereinander. Über eine Nacht
 * hinweg war sie damit nicht zu lesen – «14:19» und «14:19» können
 * derselbe Nachmittag sein oder zwei verschiedene Tage. Und die eigentlich
 * interessante Zahl stand gar nicht da: nicht wann das Licht anging,
 * sondern wie lange es an war.
 *
 * Reines Rechnen: hinein die Ereignisse des Hubs, heraus die Abschnitte
 * für die Liste.
 */

/** Ein Ereignis, wie der Hub es schickt. */
export interface VerlaufEreignis {
  state: string | null;
  at: number;
  source?: { kind?: string | null; label?: string | null };
  /** Was sonst noch dazugehört – die Position einer Store, der Titel
   *  einer Box. Der Hub schickt es mit, wo es etwas erklärt. */
  detail?: string | null;
}

export interface VerlaufZeile extends VerlaufEreignis {
  /** Wie lange dieser Zustand anhielt, in Sekunden – oder null beim
   *  jüngsten Eintrag, der noch andauert. */
  dauer: number | null;
}

export interface VerlaufAbschnitt {
  /** «Heute», «Gestern» oder «Mo, 24. Aug.» */
  titel: string;
  zeilen: VerlaufZeile[];
}

/** Wie ein Zustand auf Deutsch heisst (rein, testbar). */
const ZUSTAND: Record<string, string> = {
  on: 'Eingeschaltet',
  off: 'Ausgeschaltet',
  open: 'Geöffnet',
  opening: 'Fährt auf',
  closed: 'Geschlossen',
  closing: 'Fährt zu',
  locked: 'Abgeschlossen',
  unlocked: 'Aufgeschlossen',
  unlatched: 'Aufgezogen',
  unlocking: 'Schliesst auf',
  locking: 'Schliesst ab',
  running: 'Gestartet',
  idle: 'Fertig',
  cleaning: 'Saugt',
  docked: 'In der Station',
  returning: 'Fährt zurück',
  paused: 'Pausiert',
  playing: 'Spielt',
  buffering: 'Lädt',
  standby: 'Standby',
  heat: 'Heizt',
  cool: 'Kühlt',
  auto: 'Automatik',
  armed: 'Scharf',
  armed_home: 'Scharf (zuhause)',
  armed_away: 'Scharf (abwesend)',
  disarmed: 'Entschärft',
  triggered: 'Ausgelöst',
  home: 'Zuhause',
  away: 'Unterwegs',
  unknown: 'Unbekannt',
};

export function zustandName(state: string | null | undefined): string {
  const wert = String(state ?? '').trim();
  if (!wert) return '–';
  return ZUSTAND[wert] ?? wert;
}

/** «3 Std. 20 Min.», «12 Min.», «40 Sek.» (rein, testbar). */
export function dauerText(sekunden: number | null): string {
  if (sekunden === null || !Number.isFinite(sekunden) || sekunden < 0) return '';
  const ganz = Math.round(sekunden);
  if (ganz < 60) return `${ganz} Sek.`;
  const minuten = Math.round(ganz / 60);
  if (minuten < 60) return `${minuten} Min.`;
  const stunden = Math.floor(minuten / 60);
  const rest = minuten % 60;
  if (stunden < 24) return rest > 0 ? `${stunden} Std. ${rest} Min.` : `${stunden} Std.`;
  const tage = Math.floor(stunden / 24);
  const stundenRest = stunden % 24;
  return stundenRest > 0 ? `${tage} T. ${stundenRest} Std.` : `${tage} T.`;
}

/** Der Tagestitel eines Zeitpunkts (rein, testbar). */
export function tagTitel(at: number, jetzt: number = Date.now()): string {
  const tag = new Date(at * 1000);
  const heute = new Date(jetzt);
  const gleich = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (gleich(tag, heute)) return 'Heute';
  const gestern = new Date(jetzt - 86400000);
  if (gleich(tag, gestern)) return 'Gestern';
  return tag.toLocaleDateString('de-CH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Die Ereignisse in Tagesabschnitte teilen und die Dauer ausrechnen
 * (rein, testbar).
 *
 * Erwartet wird die Reihenfolge des Hubs: jüngstes zuerst. Die Dauer
 * eines Eintrags ist der Abstand zum *nächstjüngeren* – also wie lange
 * dieser Zustand anhielt. Der jüngste hat keine: Er dauert noch an, und
 * eine Zahl dafür wäre eine Behauptung über die Zukunft.
 */
export function verlaufAbschnitte(
  ereignisse: VerlaufEreignis[],
  jetzt: number = Date.now(),
): VerlaufAbschnitt[] {
  const abschnitte: VerlaufAbschnitt[] = [];
  ereignisse.forEach((ereignis, index) => {
    const juenger = ereignisse[index - 1];
    const zeile: VerlaufZeile = {
      ...ereignis,
      dauer: juenger ? Math.max(0, juenger.at - ereignis.at) : null,
    };
    const titel = tagTitel(ereignis.at, jetzt);
    const letzter = abschnitte[abschnitte.length - 1];
    if (letzter && letzter.titel === titel) {
      letzter.zeilen.push(zeile);
    } else {
      abschnitte.push({ titel, zeilen: [zeile] });
    }
  });
  return abschnitte;
}

/**
 * Die Zeile unter dem Zustand: wie lange er hielt, und wer ihn setzte
 * (rein, testbar).
 */
export function zeilenText(zeile: VerlaufZeile, quelle: string): string {
  const teile: string[] = [];
  if (zeile.detail) teile.push(String(zeile.detail));
  const dauer = dauerText(zeile.dauer);
  if (dauer) teile.push(`${dauer} lang`);
  teile.push(quelle);
  return teile.join(' · ');
}
