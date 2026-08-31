/**
 * Was zu einem Kind gehört – Termine, Stundenplan, das Wöchentliche.
 *
 * Im Personenraster der Familienseite stehen alle mit Namen und Rolle.
 * Das beantwortet «wer gehört dazu», aber nicht die Frage, die man
 * tatsächlich stellt: «Was hat Levin diese Woche?» Die Antwort lag
 * bisher an drei Orten – im Kalender (dort aber zwischen allen anderen
 * Terminen der Familie), auf einem Zettel an der Pinnwand (Stundenplan)
 * und im Kopf (Fussball am Dienstag, Jugi am Freitag).
 *
 * Hier steht rein und testbar, wie aus diesen drei Quellen eine Seite
 * wird. Die beiden wiederkehrenden Listen liegen beim Hub («lessons»
 * und «activities»), weil sie allen gehören: Wer sie im Speicher der App
 * hielte, hätte sie auf dem Wandpanel nie.
 *
 * **Warum nicht einfach alles in den Kalender?** Weil es niemand
 * einträgt. Ein Stundenplan sind vierzig Einträge pro Woche, ein Jahr
 * lang – das tippt kein Mensch, und genau deshalb steht er als Zettel
 * am Kühlschrank statt im Google-Kalender.
 */

/** Ein Eintrag, wie ihn die Familienlisten führen. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Eintrag = Record<string, any>;

/** Die Wochentage, wie sie in den Einträgen stehen. */
export const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
export type Tag = (typeof TAGE)[number];

/** Ausgeschrieben – für Überschriften und für «am Dienstag». */
export const TAG_NAMEN: Record<string, string> = {
  Mo: 'Montag',
  Di: 'Dienstag',
  Mi: 'Mittwoch',
  Do: 'Donnerstag',
  Fr: 'Freitag',
  Sa: 'Samstag',
  So: 'Sonntag',
};

/**
 * Ist das ein Kind? (rein, testbar)
 *
 * Nur wer in den Familienlisten steht und dort als Kind geführt ist.
 * Zugänge zum Hub sind es nie: «bewohner» sagt nichts über das Alter,
 * und das Wandtablet in der Küche ist erst recht kein Kind – es steht
 * mit Namen und Rolle im selben Raster.
 */
export function istKind(mitglied: { role?: string; ohneZugang?: boolean }): boolean {
  return Boolean(mitglied?.ohneZugang) && mitglied?.role !== 'erwachsen';
}

/**
 * Die Wörter eines Textes, klein geschrieben (rein, testbar).
 *
 * Getrennt wird an allem, was kein Buchstabe und keine Ziffer ist.
 * Damit fällt die Zeichensetzung weg, an der ein Vergleich sonst
 * scheitert: «Levin, Zahnarzt» und «Levin: Zahnarzt» sind dasselbe.
 */
export function woerter(text: unknown): string[] {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Steht dieser Name in diesem Text? (rein, testbar)
 *
 * Verglichen wird Wort für Wort und nicht mit «enthält»: «Lina» steckt
 * in «Linalool» und in «Carolina», und ein Zahnarzttermin, der im
 * falschen Kind landet, ist schlimmer als keiner.
 *
 * Der zweite Fall ist der Genitiv: «Levins Fussballmatch» nennt Levin,
 * auch wenn kein Wort exakt «Levin» heisst. «Levin's» zerfällt beim
 * Trennen ohnehin in zwei Wörter.
 */
export function nenntPerson(text: unknown, name: string): boolean {
  const gesucht = String(name ?? '').trim().toLowerCase();
  if (!gesucht) return false;
  return woerter(text).some((wort) => wort === gesucht || wort === `${gesucht}s`);
}

/**
 * Die Termine, die dieses Kind betreffen (rein, testbar).
 *
 * Gesucht wird im Titel und im Ort – mehr liefert der Kalender nicht,
 * und mehr braucht es auch nicht: Wer einen Termin für ein Kind
 * einträgt, schreibt den Namen hinein, sonst wüsste er selbst später
 * nicht, wessen Termin es ist.
 *
 * Vergangenes fällt weg, aber erst ab Mitternacht: Ein Termin von heute
 * Morgen gehört noch auf die Seite – man will wissen, was heute war,
 * bis der Tag um ist.
 */
export function kindTermine(
  events: Eintrag[] | null | undefined,
  name: string,
  jetzt: Date,
  anzahl = 8
): Eintrag[] {
  const grenze = new Date(jetzt).setHours(0, 0, 0, 0);
  return (events ?? [])
    .filter(
      (event) =>
        nenntPerson(event?.summary, name) || nenntPerson(event?.location, name)
    )
    .filter((event) => {
      const wann = zeitpunkt(event?.start);
      return wann !== null && wann.getTime() >= grenze;
    })
    .sort((a, b) => (zeitpunkt(a?.start)?.getTime() ?? 0) - (zeitpunkt(b?.start)?.getTime() ?? 0))
    .slice(0, anzahl);
}

/** Ein Datum aus dem Kalender lesen (rein, testbar).
 *
 *  Reine Datumsangaben («2026-09-04») kommen auf Mittag: Um Mitternacht
 *  UTC ist westlich davon noch der Vortag, und ein ganztägiger Termin
 *  stünde einen Tag zu früh da. */
export function zeitpunkt(value: unknown): Date | null {
  const roh = String(value ?? '').trim();
  if (!roh) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(roh) ? `${roh}T12:00:00` : roh;
  const wann = new Date(iso);
  return Number.isNaN(wann.getTime()) ? null : wann;
}

/** «08:20» als Minuten seit Mitternacht – null, wenn es keine Zeit ist
 *  (rein, testbar). */
export function minuten(zeit: unknown): number | null {
  const treffer = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(String(zeit ?? ''));
  if (!treffer) return null;
  const stunde = Number(treffer[1]);
  const minute = Number(treffer[2]);
  if (stunde > 23 || minute > 59) return null;
  return stunde * 60 + minute;
}

/** Eine eingetippte Zeit auf «08:20» bringen – null, wenn sie keine ist
 *  (rein, testbar).
 *
 *  Wer «8.20» tippt, meint zwanzig nach acht. Das abzulehnen wäre
 *  Pedanterie; es hinzunehmen und ungeordnet zu speichern hiesse, dass
 *  die Sortierung nach Zeit nicht mehr stimmt. */
export function zeitNormal(zeit: unknown): string | null {
  const wert = minuten(zeit);
  if (wert === null) return null;
  const stunde = Math.floor(wert / 60);
  const minute = wert % 60;
  return `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** «08:20–09:05», oder nur der Anfang, wenn kein Ende dasteht (rein). */
export function zeitraum(von: unknown, bis: unknown): string {
  const a = zeitNormal(von);
  const b = zeitNormal(bis);
  if (!a) return '';
  return b ? `${a}–${b}` : a;
}

/** Die Zeilen einer Person, nach Zeit sortiert (rein, testbar). */
export function nachZeit(zeilen: Eintrag[]): Eintrag[] {
  return [...zeilen].sort(
    (a, b) => (minuten(a?.from) ?? 0) - (minuten(b?.from) ?? 0)
  );
}

/** Ein Wochentag mit seinen Zeilen. */
export interface Tagesblock {
  tag: string;
  name: string;
  zeilen: Eintrag[];
}

/**
 * Die Woche einer Person, Tag für Tag (rein, testbar).
 *
 * Leere Tage fallen weg: Ein Stundenplan mit einem leeren Samstag und
 * einem leeren Sonntag ist zwei Bildschirmhöhen lang und sagt nichts.
 */
export function wochenplan(
  zeilen: Eintrag[] | null | undefined,
  name: string
): Tagesblock[] {
  const meine = (zeilen ?? []).filter((zeile) => zeile?.member === name);
  return TAGE.map((tag) => ({
    tag,
    name: TAG_NAMEN[tag],
    zeilen: nachZeit(meine.filter((zeile) => zeile?.day === tag)),
  })).filter((block) => block.zeilen.length > 0);
}

/** Der Wochentag von heute, wie er in den Einträgen steht (rein). */
export function tagVon(jetzt: Date): string {
  return TAGE[(jetzt.getDay() + 6) % 7];
}

/** Was heute ansteht – aus einer der beiden Wochenlisten (rein, testbar). */
export function heute(
  zeilen: Eintrag[] | null | undefined,
  name: string,
  jetzt: Date
): Eintrag[] {
  const tag = tagVon(jetzt);
  return nachZeit(
    (zeilen ?? []).filter((zeile) => zeile?.member === name && zeile?.day === tag)
  );
}

/**
 * «Schule 08:20–15:05» für heute – null an schulfreien Tagen
 * (rein, testbar).
 *
 * Die einzelne Lektion interessiert am Morgen niemanden; die Frage
 * lautet, wann das Kind aus dem Haus muss und wann es zurück ist.
 */
export function schulzeit(
  lektionen: Eintrag[] | null | undefined,
  name: string,
  jetzt: Date
): string | null {
  const heutige = heute(lektionen, name, jetzt);
  if (heutige.length === 0) return null;
  const anfang = zeitNormal(heutige[0]?.from);
  const enden = heutige
    .map((zeile) => minuten(zeile?.to) ?? minuten(zeile?.from))
    .filter((wert): wert is number => wert !== null);
  if (!anfang) return null;
  const ende = enden.length > 0 ? Math.max(...enden) : null;
  const schluss =
    ende === null
      ? null
      : `${String(Math.floor(ende / 60)).padStart(2, '0')}:${String(ende % 60).padStart(2, '0')}`;
  return schluss ? `${anfang}–${schluss}` : anfang;
}

/**
 * Wann dieser wöchentliche Termin das nächste Mal ist (rein, testbar).
 *
 * «Dienstag 17:30» allein zwingt zum Nachrechnen, ob das jetzt heute
 * ist oder in sechs Tagen. Ein Termin, der heute schon vorbei ist,
 * zählt für nächste Woche – sonst stünde am Dienstagabend noch
 * «heute 17:30», was zwar stimmt, aber nichts mehr nützt.
 */
export function naechstesMal(zeile: Eintrag, jetzt: Date): string {
  const tag = String(zeile?.day ?? '');
  const stelle = TAGE.indexOf(tag as Tag);
  const uhr = zeitNormal(zeile?.from);
  if (stelle < 0) return uhr ?? '';
  let abstand = (stelle - ((jetzt.getDay() + 6) % 7) + 7) % 7;
  const start = minuten(zeile?.from);
  if (abstand === 0 && start !== null && start <= jetzt.getHours() * 60 + jetzt.getMinutes()) {
    abstand = 7;
  }
  const wann = abstand === 0 ? 'heute' : abstand === 1 ? 'morgen' : TAG_NAMEN[tag];
  return uhr ? `${wann}, ${uhr}` : wann;
}

/** Die wöchentlichen Termine einer Person, in der Reihenfolge der Woche
 *  (rein, testbar). */
export function wochenliste(
  zeilen: Eintrag[] | null | undefined,
  name: string
): Eintrag[] {
  return (zeilen ?? [])
    .filter((zeile) => zeile?.member === name)
    .sort((a, b) => {
      const tagA = TAGE.indexOf(String(a?.day) as Tag);
      const tagB = TAGE.indexOf(String(b?.day) as Tag);
      if (tagA !== tagB) return tagA - tagB;
      return (minuten(a?.from) ?? 0) - (minuten(b?.from) ?? 0);
    });
}

/**
 * Die Zeile unter dem Namen auf der Kinderkarte (rein, testbar).
 *
 * Sie beantwortet die eine Frage, mit der man die Seite aufmacht: Was
 * ist heute? Steht heute nichts an, sagt sie das – eine leere Zeile
 * sähe aus, als wäre etwas nicht geladen.
 */
export function heuteSatz(
  lektionen: Eintrag[] | null | undefined,
  termine: Eintrag[] | null | undefined,
  name: string,
  jetzt: Date
): string {
  const teile: string[] = [];
  const schule = schulzeit(lektionen, name, jetzt);
  if (schule) teile.push(`Schule ${schule}`);
  for (const termin of heute(termine, name, jetzt)) {
    const uhr = zeitNormal(termin?.from);
    const was = String(termin?.text ?? '').trim();
    if (was) teile.push(uhr ? `${was} ${uhr}` : was);
  }
  return teile.length > 0 ? teile.join(' · ') : 'Heute steht nichts an.';
}

/**
 * Zwei Terminquellen zu einer Liste (rein, testbar).
 *
 * Die Kalender-Entität trägt die nächsten zwölf Termine der ganzen
 * Familie – auf ein einzelnes Kind heruntergefiltert bleiben davon oft
 * null. Deshalb holt die Seite zusätzlich die Monate; beide Quellen
 * überschneiden sich, und derselbe Termin zweimal untereinander sieht
 * aus wie ein Fehler in der Kalender-Anbindung.
 */
export function verschmelze(...quellen: (Eintrag[] | null | undefined)[]): Eintrag[] {
  const gesehen = new Map<string, Eintrag>();
  for (const quelle of quellen) {
    for (const event of quelle ?? []) {
      const schluessel = String(
        event?.uid ?? event?.id ?? `${event?.summary}|${event?.start}`
      );
      if (!gesehen.has(schluessel)) gesehen.set(schluessel, event);
    }
  }
  return [...gesehen.values()];
}
