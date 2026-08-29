/**
 * Was in den zugeklappten Abschnitten der Benutzerseite steht.
 *
 * Die Seite hatte elf Blöcke, alle gleichzeitig ausgeklappt, jeder mit
 * drei bis fünf Zeilen Erklärung. Wer sie öffnete, sah eine Wand und
 * musste scrollen, um die Frage zu beantworten, mit der er gekommen war
 * («läuft der Zugang ab?», «ist das Wandtablet?»).
 *
 * Zugeklappt beantwortet der Kopf jetzt genau diese Frage. Deshalb steht
 * das Rechnen hier und nicht im Bildschirm: Es ist die Zusage an den
 * Benutzer, und die gehört geprüft.
 */

/** Die drei Wege, wie jemand in die App kommt. */
export type Weg = 'qr' | 'link' | 'mail';

export const WEGE: readonly { key: Weg; label: string }[] = [
  { key: 'qr', label: 'QR-Code' },
  { key: 'link', label: 'Link' },
  { key: 'mail', label: 'E-Mail' },
] as const;

/**
 * Welcher Weg soll offen stehen? (rein, testbar)
 *
 * Der QR-Code ist der schnellste – aber nur, wenn die Person daneben
 * steht. Ist eine Adresse hinterlegt, war der Weg schon einmal ein
 * anderer, und dann ist er es wieder.
 */
export function ersterWeg(email?: string | null): Weg {
  return email ? 'mail' : 'qr';
}

/** «Läuft der Zugang ab, und wann darf er?» (rein, testbar) */
export function zugangStand(
  expires?: string | null,
  hours?: { from?: string | null; to?: string | null } | null
): string {
  const teile: string[] = [];
  teile.push(expires ? `bis ${expires}` : 'unbegrenzt');
  const von = (hours?.from ?? '').trim();
  const bis = (hours?.to ?? '').trim();
  // Nur wenn beide dastehen: Eine halbe Angabe sperrt nichts, und
  // «ab 07:00 bis nichts» im Kopf wäre eine Auskunft, die nicht stimmt.
  if (von && bis) teile.push(`${von}–${bis}`);
  return teile.join(' · ');
}

/** «Ist das eine Person oder das Wandtablet?» (rein, testbar) */
export function artStand(shared?: boolean): string {
  return shared ? 'Gemeinschaftsgerät' : 'Persönlicher Zugang';
}

/** «Liegt ein Riegel vor den persönlichen Bereichen?» (rein, testbar) */
export function sichtschutzStand(areaLocked?: boolean): string {
  return areaLocked ? 'Passwort gesetzt' : 'kein Riegel';
}

/**
 * «Sieht diese Person die grossen Knöpfe?» (rein, testbar)
 *
 * Die Zahl und nicht die Namen: Bei sieben Räumen wäre die Aufzählung
 * länger als der zugeklappte Abschnitt breit ist, und abgeschnitten
 * sagt sie weniger als «7 Räume».
 */
export function kinderStand(rooms?: string[] | null): string {
  const anzahl = (rooms ?? []).length;
  if (anzahl === 0) return 'aus';
  return anzahl === 1 ? '1 Raum' : `${anzahl} Räume`;
}
