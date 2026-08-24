/**
 * Einladen mit Link und Passwort – was die App dazu sagt.
 *
 * Der Link allein öffnet nichts; erst zusammen mit dem Passwort gibt der
 * Hub den Zugang heraus. Vorher wanderte der Kopplungstext als Nachricht
 * raus, und der *ist* der Schlüssel zum Haus – einmal im Chat, für immer
 * im Chat.
 *
 * Reines Rechnen, damit sich die Grenzfälle prüfen lassen: Was heisst
 * «läuft ab», wenn es schon abgelaufen ist?
 */

/** Kürzestes Passwort, das der Hub annimmt – dieselbe Zahl wie dort. */
export const MIN_LAENGE = 6;

/**
 * «in 3 Stunden», «morgen um 14:20», «heute um 18:05» (rein, testbar).
 *
 * Der Satz steht hinter «Der Link gilt einmal und läuft …», also ohne
 * Grossbuchstaben am Anfang und ohne Punkt am Ende.
 */
export function einladungFrist(expires: unknown, jetzt: Date): string {
  const sekunden = Number(expires);
  if (!Number.isFinite(sekunden) || sekunden <= 0) return 'irgendwann';
  const wann = new Date(sekunden * 1000);
  const minuten = Math.round((wann.getTime() - jetzt.getTime()) / 60000);
  if (minuten <= 0) return 'nicht mehr – er ist abgelaufen';
  if (minuten < 60) return `in ${minuten} Minuten`;
  const uhr = `${String(wann.getHours()).padStart(2, '0')}:${String(
    wann.getMinutes()
  ).padStart(2, '0')}`;
  if (wann.toDateString() === jetzt.toDateString()) return `heute um ${uhr}`;
  const morgen = new Date(jetzt);
  morgen.setDate(morgen.getDate() + 1);
  if (wann.toDateString() === morgen.toDateString()) return `morgen um ${uhr}`;
  return `am ${wann.getDate()}.${wann.getMonth() + 1}. um ${uhr}`;
}

/** Taugt das Passwort? Sonst der Satz, der es erklärt (rein, testbar).
 *
 * Dieselbe Regel wie im Hub – hier nur, damit der Knopf nicht erst nach
 * einer Runde übers Netz sagt, was schon beim Tippen klar war. */
export function passwortHinweis(passwort: string): string {
  const text = String(passwort ?? '');
  if (text.trim().length < MIN_LAENGE) {
    return `Mindestens ${MIN_LAENGE} Zeichen.`;
  }
  if (text !== text.trim()) {
    return 'Kein Leerzeichen am Anfang oder Ende – das vertippt sich.';
  }
  return '';
}

/**
 * Wie lange die Einladung zum Babysitter-Zugang gilt (rein, testbar).
 *
 * So lange wie der Abend, plus eine halbe Stunde Vorlauf: Der Link soll
 * vor dem Klingeln geöffnet werden können und mit dem Zugang enden. Ein
 * Link, der einen Tag länger gilt als die Türe, ist ein zweiter
 * Schlüssel – und genau davon wollten wir weg.
 */
export function babysitterFrist(jetzt: Date, bis: string): number {
  // Auf das Muster prüfen, nicht auf Number(): `Number('')` ist 0 und
  // nicht NaN – ein leeres Feld wurde damit zu «bis Mitternacht».
  const treffer = /^(\d{1,2}):(\d{2})$/.exec(String(bis ?? '').trim());
  if (!treffer) return 60;
  const stunde = Number(treffer[1]);
  const minute = Number(treffer[2]);
  if (stunde > 23 || minute > 59) return 60;
  const ende = new Date(jetzt);
  ende.setHours(stunde, minute, 0, 0);
  // Nach Mitternacht heisst «bis 00:30» der nächste Tag.
  if (ende.getTime() <= jetzt.getTime()) ende.setDate(ende.getDate() + 1);
  const minuten = Math.round((ende.getTime() - jetzt.getTime()) / 60000) + 30;
  return Math.max(30, minuten);
}
