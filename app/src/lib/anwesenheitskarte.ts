/**
 * Die Karte «Wer ist wo» auf der Familienseite – was darauf steht.
 *
 * Sie war eine Textwand: je Person eine Zeile oben, dieselbe Person
 * unten noch einmal mit der ganzen Diagnose als Absatz, und darin
 * Wiederholungen («Meldet sich regelmässig (über Life360). · Quelle:
 * Life360»). Fünf Zeilen Fliesstext für die Frage «ist jemand zuhause».
 *
 * Hier steht, was aus einer Person wird: ein Punkt, ein Ort, eine kurze
 * Zeile darunter, ein Akkustand. Der lange Satz – warum die Ortung
 * gerade so aussieht, wie sie aussieht – bleibt erhalten, wandert aber
 * hinter einen Tipp. Er wird selten gebraucht und drängt sich sonst vor
 * das, was man immer sucht.
 */
import { Person } from './personen';

/** Wie eine Person dasteht – das entscheidet über Punkt und Farbe. */
export type Lage = 'da' | 'weg' | 'unklar';

/**
 * Ist diese Person zuhause, unterwegs, oder weiss es niemand? (rein,
 * testbar)
 *
 * Drei Zustände, nicht zwei: «unklar» ist keine Abwesenheit. Ein leeres
 * Telefon meldet nichts, und daraus «nicht zuhause» zu machen, ist
 * genau der Fehler, an dem ein «alles aus» hängen kann.
 */
export function lage(person: Person): Lage {
  const wo = String(person?.where ?? '').trim();
  if (!wo || wo === 'unbekannt') return 'unklar';
  return wo === 'zuhause' ? 'da' : 'weg';
}

/**
 * Was rechts neben dem Namen steht (rein, testbar).
 *
 * Der Ort und sonst nichts – das ist die Frage, wegen der man hinsieht.
 * «bei Tanners Home» kürzt sich hier zu «Tanners Home»: Das «bei»
 * gehört in einen Satz, nicht in eine Tabellenspalte.
 */
export function ortText(person: Person): string {
  const wo = String(person?.where ?? '').trim();
  if (!wo || wo === 'unbekannt') return 'unbekannt';
  return wo.startsWith('bei ') ? wo.slice(4) : wo;
}

/**
 * Die kleine Zeile darunter: seit wann, und woher der Hub es weiss
 * (rein, testbar).
 *
 * Ohne Wiederholung. Vorher stand «Meldet sich regelmässig (über
 * Life360). · Quelle: Life360» – zweimal dasselbe in einer Zeile, die
 * ohnehin schon zu lang war.
 */
export function unterZeile(person: Person, jetzt: Date): string {
  const teile: string[] = [];
  const seit = uhrzeit(person?.since, jetzt);
  if (seit) teile.push(seit);
  const quelle = String(person?.source ?? '').trim();
  if (!person?.zone) teile.push('keine Ortung');
  else if (quelle === 'life360') teile.push('Life360');
  else if (quelle === 'geofence') teile.push('Telefon');
  else if (quelle === 'none' || !quelle) teile.push('noch keine Meldung');
  return teile.join(' · ');
}

/**
 * «seit 20:07» oder «seit gestern, 22:14» (rein, testbar).
 *
 * Die Uhrzeit und nicht die Dauer: Bei sieben Personen untereinander
 * liest sich «seit 20:07» als Spalte, «seit 3 Std. 12 Min.» als
 * Rechenaufgabe.
 */
export function uhrzeit(since: unknown, jetzt: Date): string {
  const sekunden = Number(since);
  if (!Number.isFinite(sekunden) || sekunden <= 0) return '';
  const wann = new Date(sekunden * 1000);
  if (Number.isNaN(wann.getTime()) || wann.getTime() > jetzt.getTime()) return '';
  const uhr = `${String(wann.getHours()).padStart(2, '0')}:${String(
    wann.getMinutes()
  ).padStart(2, '0')}`;
  if (wann.toDateString() === jetzt.toDateString()) return `seit ${uhr}`;
  const gestern = new Date(jetzt);
  gestern.setDate(gestern.getDate() - 1);
  if (wann.toDateString() === gestern.toDateString()) return `seit gestern, ${uhr}`;
  return `seit ${wann.getDate()}.${wann.getMonth() + 1}.`;
}

/** Ab hier ist der Akku knapp genug, um ihn hervorzuheben. */
export const AKKU_KNAPP = 25;

/**
 * Der Akkustand, wenn es einen gibt (rein, testbar).
 *
 * `knapp` färbt ihn. Vorher stand «Akku 20 %» so grau da wie «Akku 90 %»
 * – und der leere Akku ist die häufigste Ursache dafür, dass eine
 * Ortung stehenbleibt.
 */
export function akku(person: Person): { prozent: number; knapp: boolean } | null {
  const wert = person?.battery;
  if (typeof wert !== 'number' || !Number.isFinite(wert) || wert < 0) return null;
  const prozent = Math.round(wert);
  return { prozent, knapp: prozent <= AKKU_KNAPP };
}

/**
 * Die Überschrift der Karte (rein, testbar).
 *
 * Eine Antwort, keine Zählung. Und über *allen*, die der Hub ortet –
 * vorher rechnete die Überschrift über die Hub-Benutzer und die Liste
 * darunter über die Ortungszonen: Oben stand «Alle zuhause», unten
 * standen sieben Leute, von denen vier woanders waren.
 */
export function kopfzeile(leute: Person[]): string {
  const geortet = (leute ?? []).filter((person) => person?.zone);
  if (geortet.length === 0) return 'Niemand wird geortet';
  const da = geortet.filter((person) => lage(person) === 'da');
  const unklar = geortet.filter((person) => lage(person) === 'unklar');
  if (da.length === geortet.length) return 'Alle zuhause';
  if (da.length === 0) {
    return unklar.length === geortet.length ? 'Niemand meldet sich' : 'Niemand zuhause';
  }
  const namen = da.map((person) => String(person.name).split(' ')[0]);
  const kopf =
    namen.length <= 2
      ? `${namen.join(' und ')} zuhause`
      : `${namen.length} von ${geortet.length} zuhause`;
  return unklar.length > 0 ? `${kopf} · ${unklar.length} unklar` : kopf;
}

/**
 * Wer zuerst steht (rein, testbar).
 *
 * Wer zuhause ist, zuerst – das ist die Antwort auf «wer ist da». Dann
 * die Unterwegsen, zuletzt die, von denen nichts kommt: Die stehen
 * damit dort, wo man beim Suchen nach einem Problem hinsieht, und nicht
 * mitten zwischen den Beruhigenden.
 */
export function reihenfolge(leute: Person[]): Person[] {
  const rang: Record<Lage, number> = { da: 0, weg: 1, unklar: 2 };
  return [...(leute ?? [])]
    .filter((person) => person?.zone)
    .map((person, index) => ({ person, index }))
    .sort(
      (a, b) =>
        rang[lage(a.person)] - rang[lage(b.person)] || a.index - b.index
    )
    .map((eintrag) => eintrag.person);
}
