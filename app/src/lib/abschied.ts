/**
 * Wer den Haushalt verlässt (Punkt 628 der Werkbank).
 *
 * Löschen rief nur «Benutzer weg». Sitzungen, Telefone, Einstellungen,
 * Ortungsspur, Bild und die Ämtli-Reihen blieben liegen - die Au-pair
 * stand nach dem Auszug weiter «dran». Der Hub räumt das jetzt auf
 * (core/abschied.py) und sagt vorher, was er mitnimmt.
 *
 * Hier die entscheidbare Hälfte (rein, testbar): was das Blatt vor dem
 * Löschen sagt und wann eine Übergabe der Ämtli überhaupt zur Wahl steht.
 * Die Anzeige wohnt in screens/UsersScreen.tsx.
 */

/** Die Antwort von GET /api/users/{name}/abschied. */
export interface Abschied {
  bilanz: Record<string, number>;
  bild: boolean;
  /** Der fertige Satz vom Hub: «Anna entfernen? 2 Geräte, Bild, 3 Ämtli». */
  satz: string;
  /** Wer die Ämtli übernehmen könnte - die anderen im Haus. */
  uebernehmer: string[];
}

/**
 * Steht die Übergabe zur Wahl? (rein, testbar)
 *
 * Nur wenn an dem Namen Ämtli oder offene Aufgaben hängen und es jemanden
 * gibt, der sie nehmen kann. Sonst wäre die Chipreihe eine Frage ohne
 * Anlass - und ohne Antwort.
 */
export function uebergabeMoeglich(abschied: Abschied | null): boolean {
  if (!abschied) return false;
  const offen = (abschied.bilanz.aemtli ?? 0) + (abschied.bilanz.aufgaben ?? 0);
  return offen > 0 && abschied.uebernehmer.length > 0;
}

/**
 * Was der Löschknopf sagt, sobald der Hub geantwortet hat (rein, testbar).
 *
 * Der Satz des Hubs steht bereits im Blatt; der Knopf trägt nur noch die
 * Übergabe, damit man beim Drücken weiss, wohin die Ämtli gehen.
 */
export function loeschKnopf(abschied: Abschied | null, aemtliAn: string | null): string {
  if (!abschied) return 'Wirklich löschen';
  if (uebergabeMoeglich(abschied) && aemtliAn) return `Löschen, Ämtli an ${aemtliAn}`;
  if (uebergabeMoeglich(abschied)) return 'Löschen, Ämtli rücken weiter';
  return 'Wirklich löschen';
}

/**
 * Die Adresse, an die das Löschen geht (rein, testbar) - mit der
 * Übergabe als Parameter, wenn eine gewählt ist.
 */
export function loeschPfad(name: string, aemtliAn: string | null): string {
  const basis = `/api/users/${encodeURIComponent(name)}`;
  return aemtliAn ? `${basis}?aemtli_an=${encodeURIComponent(aemtliAn)}` : basis;
}
