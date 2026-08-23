/**
 * Der Riegel vor den persönlichen Bereichen.
 *
 * Das Wandtablet im Flur hängt so, dass jeder daran vorbeigeht. Licht,
 * Storen, Alarm – dafür hängt es da. Die Einkaufsliste, der Kalender und
 * die Nachrichten der Familie sind etwas anderes: Sie stünden sonst offen
 * im Flur, auch für den Besuch, der auf den Kaffee wartet.
 *
 * Die Verwaltung setzt darum je Benutzer ein Passwort (Benutzer →
 * «Passwort vor den persönlichen Bereichen»). Wer einen dieser Bereiche
 * öffnet, tippt es einmal ein; danach bleibt es eine Weile offen, sonst
 * tippt man es zwanzigmal am Tag.
 *
 * Bewusst ein Sichtschutz, keine zweite Anmeldung: Was jemand *darf*,
 * hängt weiter an der Rolle, und der Hub prüft das ohnehin. Hier geht es
 * darum, was im Vorbeigehen auf dem Bildschirm steht.
 */
import { Section } from '../components/Rail';

/** Was hinter dem Riegel liegt. Alles andere bleibt frei bedienbar. */
export const PERSOENLICH: readonly Section[] = ['family', 'account'] as const;

/** So lange bleibt es nach dem Eintippen offen (der Hub sagt es auch). */
export const OFFEN_MS = 10 * 60 * 1000;

/** Liegt dieser Bereich hinter dem Riegel? (rein, testbar) */
export function istPersoenlich(section: Section): boolean {
  return PERSOENLICH.includes(section);
}

/**
 * Muss jetzt nach dem Passwort gefragt werden? (rein, testbar)
 *
 * `offenBis` ist der Zeitpunkt, bis zu dem zuletzt aufgeschlossen wurde –
 * 0, wenn noch nie. `jetzt` kommt von aussen, damit der Fall «gerade
 * abgelaufen» prüfbar bleibt.
 */
export function istGesperrt(
  section: Section,
  areaLocked: boolean | undefined,
  offenBis: number,
  jetzt: number
): boolean {
  if (!areaLocked) return false;
  if (!istPersoenlich(section)) return false;
  return jetzt >= offenBis;
}

/** Bis wann es nach einem erfolgreichen Versuch offen bleibt (rein). */
export function offenBis(jetzt: number, sekunden?: number): number {
  const dauer = sekunden && sekunden > 0 ? sekunden * 1000 : OFFEN_MS;
  return jetzt + dauer;
}
