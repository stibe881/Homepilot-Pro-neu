/**
 * Alle Termine und alle Geburtstage – für die zwei Listen hinter den
 * Kacheln auf der Startseite.
 *
 * Die Kacheln zeigen je einen Eintrag: den nächsten Termin, den nächsten
 * Geburtstag. Das beantwortet «was kommt als Nächstes», aber nicht «was
 * kommt diese Woche noch» und nicht «wann hat Levin eigentlich
 * Geburtstag». Beides steht im selben Kalender, war aber in der App
 * nirgends zu sehen.
 *
 * Hier steht rein und testbar, was in diesen Listen steht. Die Anzeige
 * öffnet nur das Fenster.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Eintrag = Record<string, any>;

/** Eine Zeile, wie sie im Fenster steht. */
export interface KalenderZeile {
  key: string;
  titel: string;
  wann: string;
  /** Nur die Uhrzeit («18:00») - null bei ganztägigen Terminen. Für die
   *  Liste mit Tagesüberschriften, wo der Tag schon darüber steht. */
  zeit: string | null;
  ort: string | null;
  /** Das Datum als Zeile darunter («Freitag, 4. September») - bisher
   *  nur bei Geburtstagen, wo «in 5 Tagen» allein zum Nachrechnen zwang. */
  datum?: string | null;
}

/** Den Namen aus dem Geburtstags-Titel lösen (rein, testbar).

 * Der Geburtstags-Kalender schreibt Sätze («Flo hat Geburtstag»,
 * «Geburtstag von Flo», «Flo's birthday») - in einer Liste, über der
 * schon «Geburtstage» steht, ist der Satz Lärm. Bleibt nichts übrig,
 * bleibt der Titel, wie er war.
 */
export function geburtstagsName(summary: unknown): string {
  const roh = String(summary ?? '').trim();
  const name = roh
    .replace(/\s*hat\s+Geburtstag\s*$/i, '')
    .replace(/^Geburtstag\s+von\s+/i, '')
    .replace(/['’]s\s+birthday\s*$/i, '')
    .replace(/\s*[-–·]?\s*Geburtstag\s*$/i, '')
    .trim();
  return name || roh || 'Ohne Titel';
}

/** Ein Tag der Termin-Liste: Überschrift plus seine Zeilen. */
export interface KalenderGruppe {
  titel: string;
  zeilen: KalenderZeile[];
}

/** Ein reines Datum («2026-08-20») auf Mittag setzen (rein, testbar).
 *
 * Sonst verschiebt die Zeitzone die Tageszahl: Ein Geburtstag um
 * Mitternacht UTC ist westlich davon noch der Vortag, und «heute!» stünde
 * einen Tag zu früh da. */
export function alsZeitpunkt(value: unknown): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw;
  const wann = new Date(iso);
  return Number.isNaN(wann.getTime()) ? null : wann;
}

/** Ist das ein Geburtstag? (rein, testbar)
 *
 * Entweder sagt es der Kalender selbst, oder es steht im Titel – viele
 * Kalender kennen kein eigenes Feld dafür. */
export function istGeburtstag(event: Eintrag): boolean {
  return Boolean(event?.birthday) || /geburtstag|birthday/i.test(String(event?.summary ?? ''));
}

/** Volle Tage bis zu einem Datum (rein, testbar). */
export function tageBis(value: unknown, jetzt: Date): number | null {
  const ziel = alsZeitpunkt(value);
  if (ziel === null) return null;
  const a = new Date(ziel).setHours(0, 0, 0, 0);
  const b = new Date(jetzt).setHours(0, 0, 0, 0);
  return Math.round((a - b) / 86_400_000);
}

/** «heute! 🎉», «morgen», «in 12 Tagen» (rein, testbar). */
export function tageBisText(value: unknown, jetzt: Date): string {
  const tage = tageBis(value, jetzt);
  if (tage === null) return '';
  if (tage <= 0) return 'heute! 🎉';
  if (tage === 1) return 'morgen';
  return `in ${tage} Tagen`;
}

/**
 * Wann ein Termin ist – so knapp wie möglich, so genau wie nötig
 * (rein, testbar).
 *
 * Heute und morgen brauchen kein Datum, diese Woche keinen Monat. Erst
 * weiter weg lohnt das volle Datum. In einer langen Liste ist das der
 * Unterschied zwischen Lesen und Suchen.
 */
export function terminWann(event: Eintrag, jetzt: Date): string {
  const wann = alsZeitpunkt(event?.start);
  if (wann === null) return '';
  const tage = tageBis(event?.start, jetzt) ?? 0;
  const uhr = wann.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  const tag =
    tage === 0
      ? 'heute'
      : tage === 1
        ? 'morgen'
        : tage > 1 && tage < 7
          ? wann.toLocaleDateString('de-CH', { weekday: 'short' }).replace('.', '')
          : wann.toLocaleDateString('de-CH', { day: 'numeric', month: 'short' });
  return event?.all_day ? `${tag} · ganztägig` : `${tag}, ${uhr}`;
}

/** Die Überschrift eines Listen-Tages (rein, testbar).
 *
 * «Heute» und «Morgen» sagen mehr als jedes Datum; innerhalb der Woche
 * genügt der Wochentag, danach steht er mit Datum da - so liest sich
 * die Liste als Woche, nicht als Datumssalat.
 */
export function gruppenTitel(start: unknown, jetzt: Date): string {
  const wann = alsZeitpunkt(start);
  if (wann === null) return 'Ohne Datum';
  const tage = tageBis(start, jetzt) ?? 0;
  if (tage <= 0) return 'Heute';
  if (tage === 1) return 'Morgen';
  const wochentag = wann.toLocaleDateString('de-CH', { weekday: 'long' });
  if (tage < 7) return wochentag;
  return `${wochentag}, ${wann.toLocaleDateString('de-CH', { day: 'numeric', month: 'long' })}`;
}

/** Alles, was kein Geburtstag ist – in der Reihenfolge des Kalenders
 *  (rein, testbar). */
export function terminListe(events: Eintrag[] | null, jetzt: Date): KalenderZeile[] {
  return (events ?? [])
    .filter((event) => !istGeburtstag(event))
    .map((event, index) => {
      const wann = alsZeitpunkt(event?.start);
      return {
        key: String(event?.uid ?? event?.id ?? `${event?.start}-${index}`),
        titel: String(event?.summary ?? '').trim() || 'Ohne Titel',
        wann: terminWann(event, jetzt),
        zeit:
          event?.all_day || wann === null
            ? null
            : wann.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }),
        ort: typeof event?.location === 'string' && event.location.trim()
          ? event.location.trim()
          : null,
      };
    });
}

/**
 * Die Termine nach Tagen gebündelt (rein, testbar).
 *
 * Die flache Liste wiederholte den Tag in jeder Zeile («Di, 10:00»,
 * «Di, 18:00») - man las Daten statt Termine. Mit Tagesüberschriften
 * trägt jede Zeile nur noch ihre Uhrzeit, und die Woche steht als
 * Woche da.
 */
export function terminGruppen(events: Eintrag[] | null, jetzt: Date): KalenderGruppe[] {
  const gruppen: KalenderGruppe[] = [];
  const nachTitel = new Map<string, KalenderGruppe>();
  const reihen = (events ?? []).filter((event) => !istGeburtstag(event));
  const zeilen = terminListe(events, jetzt);
  reihen.forEach((event, index) => {
    const titel = gruppenTitel(event?.start, jetzt);
    let gruppe = nachTitel.get(titel);
    if (!gruppe) {
      gruppe = { titel, zeilen: [] };
      nachTitel.set(titel, gruppe);
      gruppen.push(gruppe);
    }
    gruppe.zeilen.push(zeilen[index]);
  });
  return gruppen;
}

/** Die Geburtstage, der nächste zuerst (rein, testbar).
 *
 * Der Kalender liefert sie in seiner Reihenfolge; hier zählt der Abstand
 * zu heute. Wer nachsieht, wann Levin Geburtstag hat, will nicht
 * scrollen. */
export function geburtstagsListe(events: Eintrag[] | null, jetzt: Date): KalenderZeile[] {
  return (events ?? [])
    .filter(istGeburtstag)
    .map((event, index) => {
      const wann = alsZeitpunkt(event?.start);
      return {
        key: String(event?.uid ?? event?.id ?? `${event?.start}-${index}`),
        titel: geburtstagsName(event?.summary),
        wann: tageBisText(event?.start, jetzt),
        zeit: null,
        ort: null,
        datum: wann
          ? wann.toLocaleDateString('de-CH', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })
          : null,
        _tage: tageBis(event?.start, jetzt) ?? Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a._tage - b._tage)
    .slice(0, 10)
    .map(({ _tage, ...zeile }) => zeile);
}
