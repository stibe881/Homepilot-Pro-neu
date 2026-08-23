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
  ort: string | null;
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

/** Alles, was kein Geburtstag ist – in der Reihenfolge des Kalenders
 *  (rein, testbar). */
export function terminListe(events: Eintrag[] | null, jetzt: Date): KalenderZeile[] {
  return (events ?? [])
    .filter((event) => !istGeburtstag(event))
    .map((event, index) => ({
      key: String(event?.uid ?? event?.id ?? `${event?.start}-${index}`),
      titel: String(event?.summary ?? '').trim() || 'Ohne Titel',
      wann: terminWann(event, jetzt),
      ort: typeof event?.location === 'string' && event.location.trim()
        ? event.location.trim()
        : null,
    }));
}

/** Die Geburtstage, der nächste zuerst (rein, testbar).
 *
 * Der Kalender liefert sie in seiner Reihenfolge; hier zählt der Abstand
 * zu heute. Wer nachsieht, wann Levin Geburtstag hat, will nicht
 * scrollen. */
export function geburtstagsListe(events: Eintrag[] | null, jetzt: Date): KalenderZeile[] {
  return (events ?? [])
    .filter(istGeburtstag)
    .map((event, index) => ({
      key: String(event?.uid ?? event?.id ?? `${event?.start}-${index}`),
      titel: String(event?.summary ?? '').trim() || 'Ohne Titel',
      wann: tageBisText(event?.start, jetzt),
      ort: null,
      _tage: tageBis(event?.start, jetzt) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a._tage - b._tage)
    .map(({ _tage, ...zeile }) => zeile);
}
