/**
 * Was während der Saugerfahrt trotzdem Alarm auslöst.
 *
 * Der Hub blendet Bewegungsmelder und Kameras aus, solange der
 * Saugroboter unterwegs ist – sonst löst er jedes Mal die Anlage aus
 * (hub/integrations/alarm_rules.py). Fenster- und Türkontakte bleiben
 * dabei scharf.
 *
 * Für Kameras gibt es einen dritten Weg: Ein Saugroboter ist keine
 * Person und kein Tier, und eine Kamera mit Erkennung weiss das. Also
 * schweigt nur die blosse Bewegung; wer durchs Bild läuft, löst weiter
 * aus.
 *
 * Hier steht nur das Umschalten der Liste – reine Funktionen, damit sich
 * die Auswahl ohne Hub prüfen lässt.
 */

export interface Durchbruchart {
  /** Wie das Feld beim Hub heisst (``detected_person``). */
  key: string;
  label: string;
}

/**
 * Zur Auswahl stehen die zwei, die in eine Wohnung gehören.
 *
 * Protect erkennt auch Fahrzeuge, Pakete und Kennzeichen – das sind
 * Dinge vor der Haustür. Sie hier anzubieten hiesse, für einen Fall zu
 * fragen, den es drinnen nicht gibt.
 */
export const DURCHBRUCH: Durchbruchart[] = [
  { key: 'person', label: 'Person' },
  { key: 'animal', label: 'Tier' },
];

/** Steht diese Erkennung in der Liste? (rein, testbar) */
export function durchbruchAn(liste: unknown, key: string): boolean {
  return Array.isArray(liste) && liste.map(String).includes(key);
}

/**
 * Eine Erkennung dazunehmen oder herausnehmen (rein, testbar).
 *
 * Fehlt die Liste ganz, gilt die Vorgabe des Hubs (Person und Tier) –
 * ein fehlendes Feld heisst dort «noch nie angefasst» und nicht
 * «nichts ausgewählt».
 */
export function durchbruchUmschalten(liste: unknown, key: string): string[] {
  const jetzt = Array.isArray(liste)
    ? liste.map(String)
    : DURCHBRUCH.map((eintrag) => eintrag.key);
  return jetzt.includes(key)
    ? jetzt.filter((eintrag) => eintrag !== key)
    : [...jetzt, key];
}
