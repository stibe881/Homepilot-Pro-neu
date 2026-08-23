/**
 * Wer ist da – und was die App darüber sagen darf.
 *
 * Die Anwesenheit steht heute als Gerätekachel zwischen Lampen und
 * Storen; dabei ist «wer ist zuhause?» die meistgestellte Frage im
 * Haushalt (Punkt 196). Und sobald die App selbst ortet, ändert sich die
 * Frage: nicht «geht das technisch», sondern «weiss jeder, dass es
 * läuft» (Punkt 197).
 *
 * Reines Rechnen: hinein die Zeilen des Hubs, heraus die Sätze, die auf
 * dem Bildschirm stehen.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Person = Record<string, any>;

/** Wie lange eine Pause höchstens dauern darf, damit sie eine Pause ist. */
export const PAUSEN = [
  { key: '2h', label: '2 Stunden', minuten: 120 },
  { key: 'morgen', label: 'bis morgen', minuten: 0 },
] as const;

/** «zuhause», «unterwegs», «Schule» – wie der Zustand heisst (rein).
 *
 * «meldet sich nicht» ist zweideutig: Es kann heissen, dass das Telefon
 * schweigt – oder dass für diese Person nie eine Zone eingerichtet wurde.
 * Der zweite Fall ist kein Ausfall, sondern eine offene Aufgabe, und er
 * gehört benannt. Sonst wartet man auf eine Meldung, die nie kommen
 * kann. */
export function zustandText(person: Person): string {
  const state = String(person?.state ?? 'unknown');
  if (state === 'home') return 'zuhause';
  if (state === 'away') return 'unterwegs';
  if (state === 'unknown') {
    return person?.configured === false ? 'Ortung nicht eingerichtet' : 'meldet sich nicht';
  }
  return String(person?.place_name ?? state);
}

/**
 * «seit 14:20» oder «seit gestern» (rein, testbar).
 *
 * Ohne Meterangaben und ohne Karte: «Sandra zuhause · Stefan unterwegs
 * seit 14:20» beantwortet, was man wissen will.
 */
export function seitText(since: unknown, jetzt: Date): string {
  const sekunden = Number(since);
  if (!Number.isFinite(sekunden) || sekunden <= 0) return '';
  const wann = new Date(sekunden * 1000);
  const minuten = Math.round((jetzt.getTime() - wann.getTime()) / 60000);
  if (minuten < 2) return 'gerade eben';
  if (minuten < 60) return `seit ${minuten} min`;
  if (wann.toDateString() === jetzt.toDateString()) {
    const uhr = `${String(wann.getHours()).padStart(2, '0')}:${String(
      wann.getMinutes()
    ).padStart(2, '0')}`;
    return `seit ${uhr}`;
  }
  if (minuten < 48 * 60) return 'seit gestern';
  return `seit ${wann.getDate()}.${wann.getMonth() + 1}.`;
}

/** Eine Zeile je Person für die Familienseite (rein, testbar). */
export function anwesenheitsZeile(person: Person, jetzt: Date): string {
  const seit = seitText(person?.since, jetzt);
  return [String(person?.name ?? '').trim(), zustandText(person), seit]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Die Übersicht in einem Satz (rein, testbar).
 *
 * Für die Kopfzeile: «Alle zuhause» ist eine Antwort, «3 Einträge» nicht.
 */
export function anwesenheitKurz(people: Person[]): string {
  const echte = (people ?? []).filter((p) => p?.name);
  if (echte.length === 0) return '';
  const zuhause = echte.filter((p) => String(p.state) === 'home');
  const unbekannt = echte.filter((p) => String(p.state) === 'unknown');
  if (zuhause.length === echte.length) return 'Alle zuhause';
  if (zuhause.length === 0 && unbekannt.length === 0) return 'Niemand zuhause';
  const namen = zuhause.map((p) => String(p.name).split(' ')[0]);
  const kopf = namen.length > 0 ? `${namen.join(', ')} zuhause` : 'Niemand zuhause';
  return unbekannt.length > 0 ? `${kopf} · ${unbekannt.length} unbekannt` : kopf;
}

/**
 * Bis wann eine Ortungspause gilt (rein, testbar).
 *
 * «Bis morgen» heisst: bis morgen früh um sechs. Ein Schalter, der «bis
 * morgen» sagt und in Wahrheit 24 Stunden meint, ist eine Falle.
 */
export function pauseBis(key: string, jetzt: Date): Date {
  const eintrag = PAUSEN.find((p) => p.key === key);
  if (eintrag && eintrag.minuten > 0) {
    return new Date(jetzt.getTime() + eintrag.minuten * 60000);
  }
  const morgen = new Date(jetzt);
  morgen.setDate(morgen.getDate() + 1);
  morgen.setHours(6, 0, 0, 0);
  return morgen;
}

/** Läuft eine Pause noch? (rein, testbar) */
export function pausiert(bis: unknown, jetzt: Date): boolean {
  const zeit = Number(bis);
  return Number.isFinite(zeit) && zeit > jetzt.getTime();
}

/**
 * Der Satz für das eigene Profil (rein, testbar).
 *
 * Ein Familiensystem, dem man beim Orten nicht zusehen kann, wird
 * abgeschaltet – zu Recht. Also steht dort, dass es läuft, und wer es
 * sieht.
 */
export function ortungsHinweis(
  aktiv: boolean,
  bis: unknown,
  jetzt: Date,
  wer: string[]
): string {
  if (pausiert(bis, jetzt)) {
    const ende = new Date(Number(bis));
    const uhr = `${String(ende.getHours()).padStart(2, '0')}:${String(
      ende.getMinutes()
    ).padStart(2, '0')}`;
    return `Ortung pausiert bis ${uhr}.`;
  }
  if (!aktiv) return 'Deine Ortung ist aus. Das Haus weiss nicht, wo du bist.';
  const leser = wer.length > 0 ? wer.join(', ') : 'die Familie';
  return `Deine Ortung läuft. Sichtbar für: ${leser}.`;
}
