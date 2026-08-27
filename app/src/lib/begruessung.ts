/**
 * Wie die Startseite begrüsst – in einem Satz.
 *
 * Zwei Zeilen standen dort untereinander: «Hallo Stefan,» und darunter
 * «Guten Abend.» Zweimal begrüsst zu werden ergibt keinen Sinn; so
 * spricht niemand. Wer jemanden abends begrüsst, sagt beides in einem
 * Atemzug: «Guten Abend, Stefan.»
 *
 * Wen die App anspricht, ist die zweite Frage, und sie hat drei
 * Antworten:
 *
 * - **Ein Telefon.** Der Name des angemeldeten Menschen ist die richtige
 *   Anrede.
 * - **Ein Wandpanel.** Vor dem iPad im Flur steht mal die eine, mal der
 *   andere, mal ein Gast. «Guten Abend, Stefan» begrüsst dort den
 *   Falschen, auch wenn Stefans Zugang darin steckt.
 * - **Ein Gemeinschaftsgerät** (`shared`): derselbe Fall, nur vom Hub
 *   her entschieden statt vom Gerät.
 *
 * In beiden letzten Fällen sticht ein selbst gesetzter Name trotzdem:
 * Wer «Küche» hinschreibt, meint es so.
 */

/**
 * Der Gruss zur Stunde (rein, testbar).
 *
 * Mittags kein «Schönen Tag»: Das sagt man beim Hinausgehen, nicht beim
 * Ankommen. Und nach Mitternacht noch «Guten Abend» – wer um zwei Uhr
 * die Storen schliesst, ist nicht früh auf, sondern spät dran.
 */
export function tageszeitGruss(jetzt: Date): string {
  const stunde = jetzt.getHours();
  if (stunde < 5) return 'Guten Abend';
  if (stunde < 11) return 'Guten Morgen';
  if (stunde < 18) return 'Hallo';
  return 'Guten Abend';
}

/** Wen die Startseite anspricht – oder niemanden (rein, testbar). */
export function angesprochen(
  settings: { name?: string; panel?: boolean },
  user: { name: string; shared?: boolean } | null
): string | null {
  const eigener = (settings.name ?? '').trim();
  if (eigener) return eigener;
  // Am Panel und am Gemeinschaftsgerät steht kein einzelner Mensch –
  // der Name des Zugangs ist dort eine Aussage über das Gerät, nicht
  // über den, der davorsteht.
  if (settings.panel || user?.shared) return null;
  return user?.name || null;
}

/** Die eine Zeile über der Startseite (rein, testbar). */
export function begruessung(
  settings: { name?: string; panel?: boolean },
  user: { name: string; shared?: boolean } | null,
  jetzt: Date
): string {
  const gruss = tageszeitGruss(jetzt);
  const wen = angesprochen(settings, user);
  if (wen) return `${gruss}, ${wen}.`;
  // Ein «Hallo.» allein ist keine Begrüssung, sondern ein Räuspern.
  return gruss === 'Hallo' ? 'Willkommen zuhause.' : `${gruss}.`;
}
