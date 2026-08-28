/**
 * Die Zeile «wann lief dieser Ablauf zuletzt?».
 *
 * Die Liste zeigte, wann ein Ablauf das nächste Mal dran ist. Ob er
 * überhaupt schon einmal gelaufen ist, kostete einen zweiten Aufruf je
 * Ablauf – also fragte niemand, und ein stummer Ablauf blieb unbemerkt,
 * bis jemandem auffiel, dass das Licht nicht mehr angeht.
 *
 * Drei Auskünfte, die man auseinanderhalten muss:
 *
 *  - Er lief.
 *  - Er wurde ausgelöst und übersprungen (eine Bedingung stand im Weg).
 *  - Er wurde nie ausgelöst.
 *
 * Reines Rechnen: hinein der letzte Lauf, heraus der Satz.
 */
import { epochAgo } from './zeit';

export interface LaufEintrag {
  at: number;
  executed?: boolean;
  error?: string | null;
  skipped?: string[];
  /** Von Hand angestossen? Dann sagt die Zeile das auch. */
  test?: boolean;
}

export interface Laufzeile {
  text: string;
  /** 'ok' | 'warn' | 'still' – die App wählt danach die Farbe. */
  ton: 'ok' | 'warn' | 'still';
}

/** Der Satz zum letzten Lauf (rein, testbar). */
export function laufzeile(
  lauf: LaufEintrag | null | undefined,
  jetzt: number = Date.now(),
): Laufzeile {
  if (!lauf) {
    // Nicht dasselbe wie «lief und tat nichts»: Hier kam der Auslöser
    // nie an, und das ist der Anfang der Fehlersuche.
    return { text: 'Noch nie ausgelöst', ton: 'still' };
  }
  const wann = epochAgo(lauf.at, jetzt) || 'gerade eben';
  const probe = lauf.test ? ' (Probe)' : '';
  if (lauf.error) {
    // «Fehlgeschlagen» nur, wenn der Lauf wirklich abgebrochen ist. Ein
    // Ablauf, der sechzig Geräte schaltet, hält für einen hängenden
    // Schritt nicht mehr an (hub/core/automation.py) - und «Türe
    // abgeschlossen, eine Box hing» als «Fehlgeschlagen» zu lesen, ist
    // die falsche Sorge zur falschen Zeit.
    return {
      text: `${lauf.executed === false ? 'Fehlgeschlagen' : 'Mit Fehlern gelaufen'} ${wann}${probe}: ${lauf.error}`,
      ton: 'warn',
    };
  }
  if (lauf.executed === false) {
    const grund = (lauf.skipped ?? []).join(', ');
    return {
      text: grund
        ? `Übersprungen ${wann}: ${grund}`
        : `Übersprungen ${wann}`,
      ton: 'warn',
    };
  }
  // Gelaufen, aber Bedingungen übergangen: Das gibt es nur beim Test.
  const uebergangen = lauf.test && (lauf.skipped ?? []).length > 0;
  return {
    text: uebergangen
      ? `Probe gelaufen ${wann} – im Alltag hätte gestoppt: ${(lauf.skipped ?? []).join(', ')}`
      : `Gelaufen ${wann}${probe}`,
    ton: 'ok',
  };
}
