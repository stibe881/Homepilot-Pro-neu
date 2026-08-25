/**
 * «Wer kommt wo an» als Auslöser – und was der Hub daraus liest.
 *
 * Ein Ortsauslöser war bisher zweiwertig: kommt an (`to: home`) oder
 * geht weg (`to: away`). Sobald der Hub die gespeicherten Orte von
 * Life360 kennt – Schule, Grosseltern, Arbeit –, ist das zu wenig: Die
 * Frage lautet nicht mehr nur *ob*, sondern *wo*.
 *
 * Im Hub bleibt es ein gewöhnlicher Zustandswechsel der Zone
 * (`geofence.livia`), deren Zustand der Name des engsten Ortes ist.
 * Diese Datei übersetzt in beide Richtungen und sonst nichts.
 */

/** Kennung des Zuhauses – der einzige Ort, den es überall gibt. */
export const ZUHAUSE = 'home';

/** Die Sammelfrage «ist überhaupt noch jemand da?» (geofence.anyone_home). */
export const SAMMEL_ANWESENHEIT = 'geofence.anyone_home';

/**
 * Meldet diese Entität einen Ort? (rein, testbar)
 *
 * Alle Geofence-Entitäten ausser einer: Die Sammelanwesenheit ist keine
 * Person und war nie an einem Ort. Sie stand trotzdem in der Auswahl
 * unter «Ort», und was dabei herauskam, las sich als «Wenn Jemand
 * zuhause kommt bei Off an» – ein Satz, den niemand so gemeint haben
 * kann. Gespeichert war er richtig; nur Auswahl und Satz behaupteten
 * etwas anderes.
 */
export function istOrtsmelder(entityId: unknown): boolean {
  const id = String(entityId ?? '');
  return id.startsWith('geofence.') && id !== SAMMEL_ANWESENHEIT;
}

/**
 * Die Sammelanwesenheit als Satzteil (rein, testbar).
 *
 * Sie zählt technisch in an/aus. «Jemand zuhause → off» stimmt zwar,
 * beantwortet aber nicht die Frage, die man beim Lesen stellt.
 */
export function anwesenheitSatz(to: unknown): string {
  return String(to ?? '') === 'off' ? 'niemand mehr zuhause ist' : 'jemand zuhause ist';
}

export type Richtung = 'an' | 'weg';

export interface Ortswahl {
  /** Kennung des Ortes, `home` fürs Zuhause. */
  ort: string;
  richtung: Richtung;
}

/** Was ein Ortsauslöser dem Hub sagt (rein, testbar).
 *
 *  Beim Zuhause bleibt es beim alten `to: away` statt `from: home`, und
 *  das ist Absicht: Nur mit einem Zielzustand kann der Hub ein «bleibt
 *  10 Minuten so» nach der Wartezeit noch einmal nachprüfen. Ohne ihn
 *  wäre die Wartezeit bloss eine Verzögerung, und «alles aus, wenn alle
 *  weg» schaltete auch dann, wenn jemand nach zwei Minuten zurückkam.
 *
 *  Bei einem benannten Ort gibt es diesen Zielzustand nicht: Wer die
 *  Schule verlässt, ist danach «unterwegs» oder schon im nächsten Ort –
 *  was davon, weiss man vorher nicht. Darum `from`.
 */
export function zuTrigger(wahl: Ortswahl): { to?: string; from?: string } {
  const ort = wahl.ort || ZUHAUSE;
  if (wahl.richtung === 'an') return { to: ort };
  if (ort === ZUHAUSE) return { to: 'away' };
  return { from: ort };
}

/** Und zurück – damit ein gespeicherter Ablauf wieder richtig dasteht.
 *
 *  (rein, testbar) Alte Abläufe tragen nur `to: home` oder `to: away`;
 *  sie müssen unverändert weiterlaufen und im Editor als «Zuhause»
 *  erscheinen. */
export function ausTrigger(trigger: { to?: unknown; from?: unknown }): Ortswahl {
  const von = String(trigger.from ?? '');
  const nach = String(trigger.to ?? '');
  if (nach === 'away') return { ort: ZUHAUSE, richtung: 'weg' };
  if (nach) return { ort: nach, richtung: 'an' };
  if (von) return { ort: von, richtung: 'weg' };
  return { ort: ZUHAUSE, richtung: 'an' };
}

/** Die Orte zur Auswahl, Zuhause immer zuoberst (rein, testbar).
 *
 *  Die Liste kommt vom Hub und ist nach Radius sortiert – für eine
 *  Auswahl ist das die falsche Ordnung, dort sucht man nach dem Namen.
 *  Nur das Zuhause bleibt vorn: Es ist der Ort, den fast jeder Ablauf
 *  meint. */
export function ortsauswahl(
  orte: { id: string; name?: string }[]
): { key: string; label: string }[] {
  const uebrige = orte
    .filter((ort) => ort.id && ort.id !== ZUHAUSE)
    .map((ort) => ({ key: ort.id, label: ort.name || ort.id }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
  return [{ key: ZUHAUSE, label: 'Zuhause' }, ...uebrige];
}

/** Aus einer Kennung wieder ein lesbares Wort (rein, testbar).
 *
 *  Nur für den Ablauf-Satz: Dort steht die Kennung, weil die Namensliste
 *  des Hubs nicht mitgereicht wird. «schule_zell» → «Schule Zell» ist
 *  näher an dem, was jemand eingetippt hat, als die nackte Kennung. */
export function ortsWort(ort: string): string {
  return String(ort || '')
    .split('_')
    .filter(Boolean)
    .map((teil) => teil.charAt(0).toUpperCase() + teil.slice(1))
    .join(' ');
}

/** Der Ortsauslöser als Satzteil (rein, testbar).
 *
 *  «Stefan kommt heim» statt «geofence.stefan → home». Ohne das stünde
 *  bei einem Auslöser mit `from` sogar «ändert sich» - der Satz zeigte
 *  dann etwas anderes an, als der Ablauf tut. */
export function ortsSatz(wer: string, trigger: { to?: unknown; from?: unknown }): string {
  const wahl = ausTrigger(trigger);
  if (wahl.ort === ZUHAUSE) {
    return wahl.richtung === 'an' ? `${wer} kommt heim` : `${wer} geht weg`;
  }
  const wo = ortsWort(wahl.ort);
  return wahl.richtung === 'an' ? `${wer} kommt bei ${wo} an` : `${wer} verlässt ${wo}`;
}
