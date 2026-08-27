/**
 * Erinnerungen: zu einer Zeit gross auf dem Schirm, bis jemand bestätigt.
 *
 * Der Hub ist nur die geteilte Ablage (Familien-Sammlung «reminders») -
 * ob eine Erinnerung fällig ist, rechnet jedes Gerät selbst aus seiner
 * Uhr. So braucht es keinen Wecker im Hub, und das Wandpanel zeigt das
 * Vollbild auch dann pünktlich, wenn die Verbindung gerade stockte.
 * Bestätigen schreibt `done` in die Ablage; der Hub meldet die Änderung
 * allen offenen Apps, und das Vollbild verschwindet überall.
 */

export interface Erinnerung {
  id: string;
  text?: unknown;
  /** Zielzeitpunkt in Millisekunden seit 1970. */
  at?: unknown;
  /** Bestätigt - taucht nirgends mehr auf. */
  done?: unknown;
  /** Gross auf den Bildschirmen zeigen. Fehlt das Feld, gilt ja -
   *  Einträge von vor den Schaltern kannten nur diesen Weg. */
  anzeigen?: unknown;
  /** Zur Zeit eine Push-Nachricht schicken - verschickt der Hub. */
  push?: unknown;
  /** An wen der Push geht; leer heisst alle im Haushalt. */
  push_an?: unknown;
  /** Wer die Erinnerung nur für sich weggedrückt hat («Erledigt» statt
   *  «Für alle erledigt»). Bei diesen Benutzern bleibt das Vollbild weg,
   *  bei allen anderen steht es weiter - erst `done` räumt überall ab. */
  quittiert?: unknown;
  /** Wiederholung («daily», «weekly», «monthly», «yearly») - dieselben
   *  Schlüssel wie bei den Aufgaben. Fehlt das Feld: einmalig. Beim
   *  Bestätigen wird nicht erledigt, sondern auf den nächsten Termin
   *  weitergestellt. */
  repeat?: unknown;
  /** Vom Hub gesetzt: Der Push zu diesem Termin ist verschickt. Beim
   *  Weiterstellen wird es zurückgenommen, damit der nächste rausgeht. */
  pushed?: unknown;
}

/** Die Wiederholungen, die eine Erinnerung kennt - Schlüssel wie bei
 *  den Aufgaben (REPEAT_OPTIONS), plus jährlich: den Heizungs-Service
 *  gibt es, den täglichen Jahresputz nicht. */
export const WIEDERHOLUNGEN = [
  { key: 'none', label: 'einmalig' },
  { key: 'daily', label: 'täglich' },
  { key: 'weekly', label: 'wöchentlich' },
  { key: 'monthly', label: 'monatlich' },
  { key: 'yearly', label: 'jährlich' },
] as const;

export type Wiederholung = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Die Wiederholung eines Eintrags - oder null für einmalig (rein, testbar). */
export function wiederholungVon(eintrag: Erinnerung): Wiederholung | null {
  const roh = String(eintrag.repeat ?? '');
  return roh === 'daily' || roh === 'weekly' || roh === 'monthly' || roh === 'yearly'
    ? roh
    : null;
}

/** Das deutsche Wort zur Wiederholung - für Listen und Badges. */
export function wiederholungsLabel(wiederholung: Wiederholung): string {
  return (
    WIEDERHOLUNGEN.find((option) => option.key === wiederholung)?.label ?? wiederholung
  );
}

/** Der nächste Termin nach «jetzt» (rein, testbar).
 *
 *  Gerechnet wird im Kalender, nicht in Millisekunden: 7 Uhr bleibt
 *  7 Uhr, auch über die Zeitumstellung hinweg. Monat und Jahr zählen
 *  vom **ursprünglichen** Termin aus - eine Erinnerung vom 31. rutscht
 *  im kurzen Monat auf dessen letzten Tag, kehrt danach aber auf den
 *  31. zurück, statt für immer beim 28. zu bleiben. `null`, wenn kein
 *  Termin gefunden wird (kaputter Zeitpunkt).
 */
export function naechsteFaelligkeit(
  atMs: number,
  wiederholung: Wiederholung,
  jetztMs: number
): number | null {
  if (!Number.isFinite(atMs) || atMs <= 0) return null;
  const start = new Date(atMs);
  for (let schritt = 1; schritt <= 5000; schritt++) {
    const wann = new Date(start);
    if (wiederholung === 'daily') {
      wann.setDate(start.getDate() + schritt);
    } else if (wiederholung === 'weekly') {
      wann.setDate(start.getDate() + 7 * schritt);
    } else {
      // Erst auf den Monatsersten, dann den Monat stellen, dann den
      // Tag begrenzen - sonst schöbe der 31. den Monat still weiter.
      wann.setDate(1);
      wann.setMonth(start.getMonth() + (wiederholung === 'monthly' ? schritt : 0));
      if (wiederholung === 'yearly') wann.setFullYear(start.getFullYear() + schritt);
      const tage = new Date(wann.getFullYear(), wann.getMonth() + 1, 0).getDate();
      wann.setDate(Math.min(start.getDate(), tage));
    }
    if (wann.getTime() > jetztMs) return wann.getTime();
  }
  return null;
}

/** Wer diese Erinnerung für sich weggedrückt hat (rein, testbar). */
export function quittiertVon(eintrag: Erinnerung): string[] {
  const namen = eintrag.quittiert;
  if (!Array.isArray(namen)) return [];
  return namen.map((name) => String(name)).filter((name) => name.trim() !== '');
}

/** Gehört dieser Eintrag auf die Bildschirme? (rein, testbar) */
export function zeigtAn(eintrag: Erinnerung): boolean {
  return eintrag.anzeigen !== false;
}

/** Was «Für alle erledigt» in die Ablage schreibt (rein, testbar).
 *
 *  Einmalige Erinnerungen werden erledigt. Wiederkehrende werden auf
 *  den nächsten Termin weitergestellt - und dabei frisch: Niemand hat
 *  die neue schon weggedrückt, kein Push ist für sie verschickt.
 *  Findet sich kein nächster Termin (kaputter Zeitpunkt), wird auch
 *  eine wiederkehrende erledigt - für immer offen stehen darf nichts. */
export function bestaetigung(
  eintrag: Erinnerung,
  jetztMs: number
): Record<string, unknown> {
  const wiederholung = wiederholungVon(eintrag);
  if (wiederholung) {
    const next = naechsteFaelligkeit(Number(eintrag.at), wiederholung, jetztMs);
    if (next !== null) return { at: next, quittiert: [], pushed: false };
  }
  return { done: true };
}

/** «TT.MM.JJJJ» + «HH:MM» → Zeitpunkt in ms (rein, testbar).
 *
 *  `null`, wenn eine der Angaben keine ist - auch für den 31.02.: Ein
 *  Datum, das der Kalender nicht kennt, würde JavaScript stumm in den
 *  März verschieben, und die Erinnerung käme einen Monat zu früh oder
 *  gar nicht. */
export function zeitpunkt(datum: string, zeit: string): number | null {
  const d = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(datum ?? '').trim());
  const z = /^(\d{1,2})[:.](\d{2})$/.exec(String(zeit ?? '').trim());
  if (!d || !z) return null;
  const tag = Number(d[1]);
  const monat = Number(d[2]);
  const jahr = Number(d[3]);
  const stunde = Number(z[1]);
  const minute = Number(z[2]);
  if (stunde > 23 || minute > 59) return null;
  const wann = new Date(jahr, monat - 1, tag, stunde, minute);
  if (
    wann.getFullYear() !== jahr ||
    wann.getMonth() !== monat - 1 ||
    wann.getDate() !== tag
  ) {
    return null;
  }
  return wann.getTime();
}

/** Der Zeitpunkt eines Eintrags als Zahl - oder null für Unlesbares. */
function wann(eintrag: Erinnerung): number | null {
  const at = Number(eintrag.at);
  return Number.isFinite(at) && at > 0 ? at : null;
}

/** Alle offenen, nach Zeit sortiert (rein, testbar). */
export function offene(liste: Erinnerung[] | undefined): Erinnerung[] {
  return (liste ?? [])
    .filter((eintrag) => !eintrag.done && wann(eintrag) !== null)
    .sort((a, b) => (wann(a) ?? 0) - (wann(b) ?? 0));
}

/** Was jetzt gross auf den Schirm gehört (rein, testbar).
 *
 *  Fällig heisst: Zeitpunkt erreicht und noch nicht bestätigt. Es gibt
 *  keine Verfallszeit - wer das Display erst abends sieht, soll die
 *  Erinnerung von mittags noch vorfinden. Genau dafür ist das
 *  Bestätigen da. */
export function faellige(
  liste: Erinnerung[] | undefined,
  jetztMs: number
): Erinnerung[] {
  return offene(liste).filter((eintrag) => (wann(eintrag) ?? Infinity) <= jetztMs);
}

/** Fällig UND fürs Vollbild bestimmt (rein, testbar).
 *
 *  Ein Eintrag, der nur pusht, gehört nicht auf den Schirm - den
 *  erledigt der Hub nach dem Versand von selbst. Und wer die Erinnerung
 *  schon für sich weggedrückt hat (`benutzer` steht in `quittiert`),
 *  bekommt sie nicht noch einmal - die anderen sehr wohl. */
export function anzuzeigende(
  liste: Erinnerung[] | undefined,
  jetztMs: number,
  benutzer?: string | null
): Erinnerung[] {
  return faellige(liste, jetztMs)
    .filter(zeigtAn)
    .filter(
      (eintrag) => !benutzer || !quittiertVon(eintrag).includes(benutzer)
    );
}

/** Wann das nächste Vollbild ansteht - für den Prüf-Takt (rein, testbar).
 *
 *  `null` heisst: nichts offen, kein Takt nötig. Der Takt selbst bleibt
 *  grob (die App prüft ohnehin regelmässig); diese Zahl sagt nur, ob
 *  sich das Ticken überhaupt lohnt. */
export function naechsteAt(liste: Erinnerung[] | undefined): number | null {
  const erste = offene(liste)[0];
  return erste ? wann(erste) : null;
}

/** Die Wochen eines Monats als Raster (rein, testbar).
 *
 *  Für den Datums-Wähler: Jede Woche eine Zeile Montag-Sonntag, leere
 *  Plätze vor dem Ersten und nach dem Letzten als null. Montag zuerst -
 *  so hängen die Kalender in diesem Haushalt.
 */
export function monatsraster(jahr: number, monat: number): (number | null)[][] {
  const erster = new Date(jahr, monat - 1, 1);
  const tage = new Date(jahr, monat, 0).getDate();
  // getDay(): 0 = Sonntag. Auf Montag = 0 gedreht.
  const versatz = (erster.getDay() + 6) % 7;
  const zellen: (number | null)[] = [
    ...Array.from({ length: versatz }, () => null),
    ...Array.from({ length: tage }, (_, i) => i + 1),
  ];
  while (zellen.length % 7 !== 0) zellen.push(null);
  const wochen: (number | null)[][] = [];
  for (let i = 0; i < zellen.length; i += 7) wochen.push(zellen.slice(i, i + 7));
  return wochen;
}

/** Monat blättern: 13 wird Januar des Folgejahres (rein, testbar). */
export function monatsSprung(
  jahr: number,
  monat: number,
  schritt: number
): { jahr: number; monat: number } {
  const roh = new Date(jahr, monat - 1 + schritt, 1);
  return { jahr: roh.getFullYear(), monat: roh.getMonth() + 1 };
}
