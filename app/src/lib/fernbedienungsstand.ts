/**
 * Die graue Fusszeile der TV-Fernbedienung (rein, testbar).
 *
 * Warum eine Fernbedienung ihre App-Version zeigt: Auf dem iPhone blieb
 * sie stumm – keine Haptik, keine Statuszeile, nichts am Hub –, während
 * dieselbe Fernbedienung im Browser funktionierte. Jede Korrektur kam
 * per OTA, und ob sie das Telefon je erreicht hat, stand nur tief unter
 * System. Die Rückmeldung «reagiert immer noch nicht» konnte also
 * zweierlei heissen: Der Fehler lebt noch, oder die Korrektur läuft dort
 * gar nicht. Nicht unterscheidbar, wochenlang.
 *
 * Deshalb sagt die Fusszeile beides selbst:
 *
 * - **Welcher Stand läuft** («App 1.3.6 · nachgeladen»): Fehlt die Zeile
 *   ganz, führt das Gerät noch alten Code aus – dann ist nicht die
 *   Fernbedienung kaputt, sondern das Update nicht angekommen.
 * - **Ob Berührungen ankommen**: Der Zähler springt beim blossen
 *   Fingerauflegen (onPressIn), vor Haptik, Statuszeile und Senden.
 *   Zählt er, aber es passiert sonst nichts, stirbt der Druck zwischen
 *   Auflegen und Loslassen. Zählt er nicht, erreicht die Berührung die
 *   Taste gar nicht – dann liegt etwas darüber.
 */
export function fusszeile(
  version: string | null,
  nachgeladen: boolean | null,
  beruehrungen: number
): string {
  const stand = `App ${version ?? '?'}`;
  // Im Browser gibt es kein «mitgeliefert oder nachgeladen» – dort fehlt
  // der Teil, statt etwas Falsches zu behaupten.
  const herkunft =
    nachgeladen === null ? '' : nachgeladen ? ' · nachgeladen' : ' · mitgeliefert';
  const zaehler =
    beruehrungen === 0
      ? 'noch keine Berührung'
      : beruehrungen === 1
        ? '1 Berührung'
        : `${beruehrungen} Berührungen`;
  return `${stand}${herkunft} · ${zaehler}`;
}
