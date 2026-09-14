/**
 * Der Dokumentsafe kennt ein Ablaufdatum (Punkt 623 der Werkbank).
 *
 * Ein Dokument war Titel plus Freitext: kein «gültig bis», keine
 * Person, keine Erinnerung. Kinderpässe gelten fünf Jahre, ID, Halbtax,
 * Vignette und Impfungen laufen ab - und der abgelaufene Pass fiel am
 * Flughafen auf. Hier steht rein und testbar, wie die App das Datum
 * liest, wie sie es sagt und wie «Erneuert» den Verlauf behält. Der
 * Hub liest dieselben Felder (core/dokumente.py) und meldet 60 und 14
 * Tage vorher.
 */

/** Ein Eintrag der Familienliste «documents», so offen wie gespeichert. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Eintrag = Record<string, any>;

/** Ab so vielen Tagen vor dem Ablauf zählt die Kachel «läuft bald ab» -
 *  dieselbe erste Stufe wie im Hub. */
export const BALD_TAGE = 60;

/** So viele Erneuerungen bleiben im Verlauf. */
export const VERLAUF = 10;

const MONATSENDE = (jahr: number, monat: number) => new Date(jahr, monat, 0).getDate();

/**
 * Eine Eingabe auf «JJJJ-MM-TT» bringen - null, wenn sie kein Datum ist
 * (rein, testbar).
 *
 * Drei Schreibweisen, weil drei Sorten Dokumente: «15.03.2027» für Pass
 * und ID, «03.2027» für Impfung und Vignette (die gelten bis
 * Monatsende), und ISO, wie es der Hub speichert.
 */
export function datumNormal(text: unknown): string | null {
  const roh = String(text ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(roh);
  const schweizer = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(roh);
  const monat = /^(\d{1,2})\.(\d{4})$/.exec(roh);
  let jahr: number;
  let mon: number;
  let tag: number;
  if (iso) {
    [jahr, mon, tag] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (schweizer) {
    [jahr, mon, tag] = [Number(schweizer[3]), Number(schweizer[2]), Number(schweizer[1])];
  } else if (monat) {
    [jahr, mon] = [Number(monat[2]), Number(monat[1])];
    if (mon < 1 || mon > 12) return null;
    tag = MONATSENDE(jahr, mon);
  } else {
    return null;
  }
  if (mon < 1 || mon > 12 || tag < 1 || tag > MONATSENDE(jahr, mon)) return null;
  return `${jahr}-${String(mon).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
}

/** Das Ablaufdatum als Date - null, wenn keines dasteht (rein, testbar). */
export function ablaufDatum(doc: Eintrag | null | undefined): Date | null {
  const iso = datumNormal(doc?.expires);
  if (!iso) return null;
  const [jahr, mon, tag] = iso.split('-').map(Number);
  return new Date(jahr, mon - 1, tag);
}

/** Tage bis zum Ablauf, negativ danach - null ohne Datum (rein, testbar). */
export function ablaufTage(doc: Eintrag | null | undefined, heute: Date): number | null {
  const wann = ablaufDatum(doc);
  if (!wann) return null;
  const start = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate());
  return Math.round((wann.getTime() - start.getTime()) / 86_400_000);
}

/** «gültig bis 15.03.2027» bzw. «gültig bis 03.2027», wie es eingetragen
 *  wurde (rein, testbar). Null ohne Datum. */
export function gueltigBis(doc: Eintrag | null | undefined): string | null {
  const roh = String(doc?.expires ?? '').trim();
  const iso = datumNormal(roh);
  if (!iso) return null;
  if (/^\d{1,2}\.\d{4}$/.test(roh)) {
    const [mon, jahr] = roh.split('.');
    return `gültig bis ${mon.padStart(2, '0')}.${jahr}`;
  }
  const [jahr, mon, tag] = iso.split('-');
  return `gültig bis ${tag}.${mon}.${jahr}`;
}

/** «läuft in 12 Tagen ab», «läuft heute ab», «seit 3 Tagen abgelaufen» -
 *  oder null, wenn es noch weit hin ist (rein, testbar). */
export function ablaufSatz(doc: Eintrag | null | undefined, heute: Date): string | null {
  const tage = ablaufTage(doc, heute);
  if (tage === null || tage > BALD_TAGE) return null;
  if (tage < 0) return tage === -1 ? 'seit gestern abgelaufen' : `seit ${-tage} Tagen abgelaufen`;
  if (tage === 0) return 'läuft heute ab';
  if (tage === 1) return 'läuft morgen ab';
  return `läuft in ${tage} Tagen ab`;
}

/** Was in den nächsten Tagen abläuft oder abgelaufen ist, das Dringendste
 *  zuerst (rein, testbar). */
export function baldAblaufend(
  docs: Eintrag[] | null | undefined,
  heute: Date,
  tage = BALD_TAGE
): Eintrag[] {
  return (docs ?? [])
    .map((doc) => ({ doc, tage: ablaufTage(doc, heute) }))
    .filter((eintrag): eintrag is { doc: Eintrag; tage: number } =>
      eintrag.tage !== null && eintrag.tage <= tage
    )
    .sort((a, b) => a.tage - b.tage)
    .map((eintrag) => eintrag.doc);
}

/** Die Zeile auf der Kachel: «1 läuft bald ab» - oder null (rein, testbar). */
export function kachelSatz(docs: Eintrag[] | null | undefined, heute: Date): string | null {
  const zahl = baldAblaufend(docs, heute).length;
  if (zahl === 0) return null;
  return zahl === 1 ? '1 läuft bald ab' : `${zahl} laufen bald ab`;
}

/**
 * Die Änderung für «Erneuert» (rein, testbar): das neue Datum, und das
 * alte wandert in den Verlauf - dieselbe Bauart wie im Hub
 * (dokumente.erneuern) und wie die Wartung.
 */
export function erneuert(
  doc: Eintrag,
  neuesDatum: string,
  heute: Date,
  wer?: string
): { expires: string; log: Eintrag[] } {
  const verlauf = (Array.isArray(doc?.log) ? doc.log : []).filter(
    (eintrag: unknown) => eintrag && typeof eintrag === 'object'
  );
  const tag = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(
    heute.getDate()
  ).padStart(2, '0')}`;
  return {
    expires: neuesDatum.trim(),
    log: [
      { at: tag, by: wer?.trim() || null, expired: String(doc?.expires ?? '').trim() || null },
      ...verlauf,
    ].slice(0, VERLAUF),
  };
}

/** Die Dokumente einer Person mit Ablaufdatum - für die Kinderseite:
 *  «Pass gültig bis 03.2027» (rein, testbar). */
export function dokumenteVon(
  docs: Eintrag[] | null | undefined,
  name: string
): Eintrag[] {
  return (docs ?? []).filter(
    (doc) => String(doc?.member ?? '').trim() === name && ablaufDatum(doc) !== null
  );
}
