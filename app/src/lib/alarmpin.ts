/**
 * Wann vor dem Entschärfen nach der PIN gefragt wird.
 *
 * Der Alarm-Bildschirm hat sein eigenes PIN-Feld – nur führt er über
 * «Einstellungen» und steht deshalb bloss der Besitzerin offen. Ein
 * Bewohner (und das Wandtablet im Flur ist einer) entschärft über die
 * Kachel auf der Startseite, und die schickte bisher ein blosses
 * «toggle». Mit gesetzter PIN lehnte der Hub das ab – berechtigt, aber
 * der Mensch davor stand vor einer Fehlermeldung statt vor einem Feld.
 *
 * Am Gemeinschaftsgerät ist die PIN Pflicht, auch wenn der Hub keine
 * kennt: Dort steht die App immer offen. Ist keine gesetzt, lehnt der Hub
 * mit einem lesbaren Satz ab (siehe integrations/alarm.py).
 */

/** Schaltet dieser Befehl die Anlage aus? (rein, testbar) */
export function entschaerft(
  command: string,
  state: string | undefined
): boolean {
  if (command === 'disarm' || command === 'turn_off') return true;
  // «toggle» entschärft nur, wenn sie gerade scharf ist – sonst schaltet
  // es scharf, und dafür braucht es nie eine PIN.
  return command === 'toggle' && (state ?? 'unscharf') !== 'unscharf';
}

/** Muss jetzt ein PIN-Feld aufgehen? (rein, testbar) */
export function verlangtPin(
  entity: { integration?: string; state?: Record<string, unknown> } | undefined,
  command: string,
  geteiltesGeraet: boolean,
  schonGetippt?: string
): boolean {
  if (!entity || entity.integration !== 'alarm') return false;
  if (schonGetippt) return false;
  if (!entschaerft(command, entity.state?.state as string | undefined)) return false;
  return !!entity.state?.pin_required || geteiltesGeraet;
}
