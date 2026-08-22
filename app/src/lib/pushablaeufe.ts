/**
 * Welche Abläufe eine Push-Nachricht verschicken – und was sie melden.
 *
 * Unter «Abläufe → Push» stehen die eingebauten Wächter-Nachrichten:
 * Wasser gemeldet, Batterie schwach, Frost angekündigt. Wer sich selbst
 * eine Nachricht baute («wenn die Gefriertruhe wärmer als -15 °C wird,
 * melde es»), suchte sie dort vergeblich – sie lag in der Ablauf-Liste
 * unter ihrer Kategorie. Die Frage «was meldet mir das Haus eigentlich?»
 * hatte damit zwei Antworten an zwei Orten.
 *
 * Hier steht rein und testbar, welcher Ablauf meldet und wie sich das in
 * einer Zeile liest. Die Anzeige muss es nicht selbst zusammensuchen.
 */

/** Ein gespeicherter Baustein (Auslöser, Bedingung, Aktion).
 *
 * Bewusst kein Import aus dem Ablauf-Editor: Die Push-Liste braucht von
 * einem Ablauf nur den Namen, den Schalter und die Aktionen – so bleibt
 * diese Datei ohne Anhang testbar. */
type Baustein = Record<string, unknown>;

/** So viel eines Ablaufs, wie die Push-Liste braucht. */
export interface PushAblauf {
  id: string;
  alias: string;
  actions?: Baustein[];
  /** Der sonst-Zweig meldet genauso – er gehört mitgezählt. */
  otherwise?: Baustein[];
  enabled?: boolean;
  editable?: boolean;
}

/** Alle Nachricht-Schritte eines Ablaufs (rein, testbar).
 *
 * Auch die aus dem sonst-Zweig: Eine Nachricht, die nur bei nicht
 * erfüllter Bedingung rausgeht, ist trotzdem eine Nachricht. */
export function pushSchritte(automation: PushAblauf): Baustein[] {
  return [...(automation.actions ?? []), ...(automation.otherwise ?? [])].filter(
    (action) => action && action.type === 'notify'
  );
}

/** Verschickt dieser Ablauf eine Push-Nachricht? (rein, testbar)
 *
 * Eine Durchsage über die Lautsprecher (`broadcast`) zählt nicht: Sie
 * erreicht, wer im Raum steht, nicht das Telefon in der Tasche. */
export function sendetPush(automation: PushAblauf): boolean {
  return pushSchritte(automation).length > 0;
}

/** Die meldenden Abläufe, in der Reihenfolge des Hubs (rein, testbar). */
export function pushAblaeufe<T extends PushAblauf>(automations: T[] | null): T[] {
  return (automations ?? []).filter(sendetPush);
}

/** Eine Zeile, die sich wie die Beschreibung einer eingebauten Regel liest
 *  (rein, testbar).
 *
 * Der Titel der Nachricht ist meist der Grund («Gefriertruhe zu warm»);
 * fehlt er, tut es der Text. Wer die Nachricht ohne beides speichert,
 * bekommt keine leere Zeile, sondern den ehrlichen Hinweis. */
export function pushBeschreibung(automation: PushAblauf): string {
  const schritte = pushSchritte(automation);
  if (schritte.length === 0) return '';
  const erster = schritte[0];
  const text =
    String(erster.title ?? '').trim() || String(erster.body ?? '').trim();
  const to = String(erster.to ?? '').trim();
  const wer = !to || to === 'all' ? 'an alle' : `an ${to}`;
  const bild = erster.camera ? ' · mit Kamerabild' : '';
  const satz = `${text ? `Meldet «${text}»` : 'Meldet eine Nachricht ohne Text'} ${wer}${bild}.`;
  if (schritte.length === 1) return satz;
  const weitere = schritte.length - 1;
  return `${satz} Und ${weitere} weitere Nachricht${weitere === 1 ? '' : 'en'}.`;
}
