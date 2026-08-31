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
  // Nur was diese Woche gilt: Ein Zweiwochen-Fach der anderen Woche
  // gehört heute nicht in den Satz «Schule 08:00-15:00».
  return fuerWoche(
    nachZeit(
      (zeilen ?? []).filter((zeile) => zeile?.member === name && zeile?.day === tag)
    ),
    wocheVon(jetzt)
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

/** Minuten seit Mitternacht als «08:20» (rein, testbar). */
export function uhrText(wert: number): string {
  const stunde = Math.floor(wert / 60);
  return `${String(stunde).padStart(2, '0')}:${String(wert % 60).padStart(2, '0')}`;
}

/** Eine Zeile des Tagesplans: eine Lektion - oder die Pause dazwischen. */
export type PlanZeile =
  | { art: 'lektion'; eintrag: Eintrag; laeuft: boolean }
  | { art: 'pause'; titel: string; von: string; bis: string; laeuft: boolean };

/** Ab dieser Lücke ist es eine Pause, die man sehen will - kürzer ist
 *  Zimmerwechsel. */
export const PAUSE_AB = 15;
/** Und ab dieser Länge heisst sie «Mittag». */
export const MITTAG_AB = 45;

/** Fällt eine Lektion ohne Ende an - so lange gilt sie als laufend. */
export const LEKTION_STANDARD = 45;

/**
 * Der Tagesplan mit den Pausen dazwischen (rein, testbar).
 *
 * Der Stundenplan zeigte nur die Lektionen - dass zwischen 09:35 und
 * 09:55 die grosse Pause liegt und zwischen 11:30 und 13:25 der Mittag,
 * musste man aus den Zeiten herauslesen. Und wo das Kind gerade steckt,
 * stand nirgends: ``jetztMin`` (Minuten seit Mitternacht, null wenn der
 * gezeigte Tag nicht heute ist) markiert die laufende Lektion oder
 * Pause.
 */
export function tagesplanMitPausen(
  zeilen: Eintrag[],
  jetztMin: number | null
): PlanZeile[] {
  const ergebnis: PlanZeile[] = [];
  let vorigesEnde: number | null = null;
  for (const eintrag of nachZeit(zeilen)) {
    const von = minuten(eintrag?.from);
    const bis = minuten(eintrag?.to) ?? (von === null ? null : von + LEKTION_STANDARD);
    if (vorigesEnde !== null && von !== null && von - vorigesEnde >= PAUSE_AB) {
      ergebnis.push({
        art: 'pause',
        titel: von - vorigesEnde >= MITTAG_AB ? 'Mittag' : 'Grosse Pause',
        von: uhrText(vorigesEnde),
        bis: uhrText(von),
        laeuft: jetztMin !== null && jetztMin >= vorigesEnde && jetztMin < von,
      });
    }
    ergebnis.push({
      art: 'lektion',
      eintrag,
      laeuft:
        jetztMin !== null &&
        von !== null &&
        bis !== null &&
        jetztMin >= von &&
        jetztMin < bis,
    });
    if (bis !== null) vorigesEnde = bis;
  }
  return ergebnis;
}

/**
 * Was sich von einem anderen Tag übernehmen lässt (rein, testbar).
 *
 * Der Dienstag sieht oft aus wie der Montag - statt sechs Lektionen
 * abzutippen, übernimmt man sie. Was am Zieltag schon steht (gleicher
 * Anfang, gleiches Fach), kommt nicht doppelt.
 */
export function zuUebernehmen(quelle: Eintrag[], ziel: Eintrag[]): Eintrag[] {
  const schluessel = (zeile: Eintrag) =>
    `${zeitNormal(zeile?.from) ?? ''}|${String(zeile?.text ?? '')
      .trim()
      .toLowerCase()}|${zeile?.week === 'A' || zeile?.week === 'B' ? zeile.week : ''}`;
  const vorhanden = new Set(ziel.map(schluessel));
  return nachZeit(quelle).filter((zeile) => !vorhanden.has(schluessel(zeile)));
}

/** Ab hier ist «Nachmittag» - wer vorher fertig ist, hat frei. */
export const NACHMITTAG_AB = 13 * 60;

/**
 * «Nachmittag frei · ab 11:30» - oder null (rein, testbar).
 *
 * Frei ist der Nachmittag, wenn der Tag Lektionen hat, aber keine mehr
 * am Nachmittag beginnt. Zurück kommt das Ende der letzten Lektion -
 * die Uhrzeit, ab der das Kind zuhause ist.
 */
export function nachmittagFrei(zeilen: Eintrag[]): string | null {
  const sortiert = nachZeit(zeilen);
  if (sortiert.length === 0) return null;
  const nachmittags = sortiert.some(
    (zeile) => (minuten(zeile?.from) ?? 0) >= NACHMITTAG_AB
  );
  if (nachmittags) return null;
  const enden = sortiert
    .map((zeile) => minuten(zeile?.to) ?? minuten(zeile?.from))
    .filter((wert): wert is number => wert !== null);
  if (enden.length === 0) return null;
  return uhrText(Math.max(...enden));
}

/**
 * Die Höhe eines Stundenplan-Blocks in Punkten (rein, testbar).
 *
 * Wie auf dem Zettel am Kühlschrank: Eine Doppellektion ist doppelt so
 * hoch wie eine einfache, der Mittag höher als der Zimmerwechsel. Ganz
 * proportional geht nicht - ein Zweistunden-Mittag würde den halben
 * Bildschirm füllen, eine Fünf-Minuten-Pause unlesbar dünn.
 */
export function blockHoehe(
  von: unknown,
  bis: unknown,
  mindestens: number,
  hoechstens: number
): number {
  const a = minuten(von);
  const b = minuten(bis);
  const dauer = a !== null && b !== null && b > a ? b - a : 45;
  return Math.max(mindestens, Math.min(hoechstens, Math.round(dauer * 1.1)));
}

// ── Das Zeitraster: der Tag als Stundenplan-Blatt ────────────────────────
//
// Blöcke untereinander sahen immer noch aus wie eine Liste. Ein
// Stundenplan hat eine Zeitachse: links die vollen Stunden, jede Lektion
// sitzt an ihrer wahren Höhe, und eine Lücke IST eine Lücke - sie
// braucht keinen eigenen Kasten, um sichtbar zu sein.

/** Punkte je Minute auf der Zeitachse. 1.2 macht aus einer
 *  45-Minuten-Lektion 54 Punkte - genug für Fach und Zeitzeile. */
export const MINUTE_PUNKTE = 1.2;

export interface Zeitraster {
  /** Obere Kante in Minuten seit Mitternacht - eine volle Stunde. */
  von: number;
  /** Untere Kante, ebenfalls volle Stunde. */
  bis: number;
  /** Gesamthöhe der Achse in Punkten. */
  hoehe: number;
  /** Die vollen Stunden für die Beschriftung links, in Minuten. */
  stunden: number[];
}

/**
 * Das Zeitraster eines Schultags (rein, testbar).
 *
 * Von der vollen Stunde vor der ersten Lektion bis zur vollen Stunde
 * nach der letzten - so beginnt das Blatt nicht mitten in einer Stunde,
 * und die erste Beschriftung steht über dem ersten Block. Ohne
 * lesbare Zeiten gibt es kein Raster (null); dann bleibt die Liste.
 */
export function zeitraster(zeilen: Eintrag[]): Zeitraster | null {
  const anfaenge: number[] = [];
  const enden: number[] = [];
  for (const zeile of zeilen ?? []) {
    const a = minuten(zeile?.from);
    if (a === null) continue;
    anfaenge.push(a);
    enden.push(minuten(zeile?.to) ?? a + LEKTION_STANDARD);
  }
  if (anfaenge.length === 0) return null;
  const von = Math.floor(Math.min(...anfaenge) / 60) * 60;
  const bis = Math.ceil(Math.max(...enden) / 60) * 60;
  const stunden: number[] = [];
  for (let marke = von; marke <= bis; marke += 60) stunden.push(marke);
  return { von, bis, hoehe: (bis - von) * MINUTE_PUNKTE, stunden };
}

/**
 * Wo ein Block auf der Zeitachse sitzt (rein, testbar).
 *
 * Oberkante und Höhe in Punkten, beides aus den wahren Zeiten - eine
 * Doppellektion ist dadurch von selbst doppelt so hoch. Ohne Ende gilt
 * die übliche Lektion (45 Minuten); ohne lesbaren Anfang gibt es keine
 * Lage (null), und die Zeile fällt aus dem Raster in die Liste zurück.
 */
export function rasterLage(
  von: unknown,
  bis: unknown,
  raster: Zeitraster
): { oben: number; hoehe: number } | null {
  const a = minuten(von);
  if (a === null) return null;
  const b = minuten(bis) ?? a + LEKTION_STANDARD;
  return {
    oben: (a - raster.von) * MINUTE_PUNKTE,
    hoehe: Math.max((Math.max(b, a) - a) * MINUTE_PUNKTE, 18),
  };
}

// ── A/B-Wochen: Fächer, die nur alle zwei Wochen stattfinden ─────────────

export type Woche = 'A' | 'B';

/** Die ISO-Kalenderwoche (rein, testbar). Montag beginnt die Woche,
 *  die erste Woche des Jahres ist die mit dem 4. Januar. */
export function kalenderwoche(wann: Date): number {
  const d = new Date(Date.UTC(wann.getFullYear(), wann.getMonth(), wann.getDate()));
  const tag = (d.getUTCDay() + 6) % 7;
  // Auf den Donnerstag derselben Woche stellen - er entscheidet, zu
  // welchem Jahr eine Silvesterwoche gehört.
  d.setUTCDate(d.getUTCDate() - tag + 3);
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const montag1 = new Date(jan4);
  montag1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  return 1 + Math.floor((d.getTime() - montag1.getTime()) / (7 * 86400000));
}

/** Welche Schulwoche gerade läuft (rein, testbar): ungerade
 *  Kalenderwochen sind «A», gerade «B». Am Jahresende kann die Folge
 *  einmal stolpern (KW 53 → KW 1, beide ungerade) - das tun die
 *  A/B-Pläne der Schulen dann auch, und man stellt einmal um. */
export function wocheVon(wann: Date): Woche {
  return kalenderwoche(wann) % 2 === 1 ? 'A' : 'B';
}

export function andereWoche(woche: Woche): Woche {
  return woche === 'A' ? 'B' : 'A';
}

/** Die Zeilen, die in dieser Woche gelten (rein, testbar): ohne
 *  ``week`` jede Woche, sonst nur die passende. */
export function fuerWoche(zeilen: Eintrag[], woche: Woche): Eintrag[] {
  return zeilen.filter(
    (zeile) => zeile?.week !== (woche === 'A' ? 'B' : 'A')
  );
}

/**
 * Was in der anderen Woche an dieser Stelle steht (rein, testbar).
 *
 * «Handarbeit, alle zwei Wochen» beantwortet nur die halbe Frage - die
 * andere Hälfte ist, was nächste Woche zur selben Zeit dran ist. Das
 * Gegenstück ist die Zeile am selben Tag mit demselben Anfang und der
 * anderen Woche; ohne eines ist nächste Woche schlicht frei.
 */
export function naechsteWocheFach(zeile: Eintrag, tagZeilen: Eintrag[]): string | null {
  const woche = zeile?.week;
  if (woche !== 'A' && woche !== 'B') return null;
  const anfang = zeitNormal(zeile?.from);
  const partner = tagZeilen.find(
    (andere) =>
      andere !== zeile &&
      andere?.week === andereWoche(woche) &&
      zeitNormal(andere?.from) === anfang
  );
  return partner ? String(partner.text ?? '').trim() || null : null;
}
