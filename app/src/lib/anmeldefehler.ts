/**
 * Der Fehlersatz für die Anmeldemaske (rein, testbar). Punkt 247 der
 * Werkbank.
 *
 * Der Hub-Client übersetzt 401 und 403 bewusst in «Dafür fehlt die
 * Berechtigung – oder die Anmeldung ist abgelaufen.» Für eine laufende
 * Sitzung stimmt das. An der Anmeldemaske ist es irreführend: Dort gibt
 * es noch gar keine Sitzung, die ablaufen könnte – 401 heisst schlicht,
 * dass Name oder Passwort nicht stimmen, und beim erzwungenen
 * Passwort-Wechsel steckt hinter 403 das falsche bisherige Passwort
 * (routes/auth.py). Diese Übersetzung liegt hier statt im Client, weil
 * nur die Maske weiss, dass sie vor der Anmeldung steht.
 *
 * Alle anderen Sätze bleiben, wie der Client sie liefert: Bei 429 und
 * 503 schreibt der Hub fertige deutsche Sätze in `detail` («Zu viele
 * Fehlversuche …»), und «Der Hub antwortet nicht» beim Zeitlimit sagt
 * schon alles.
 */
export function anmeldeFehlerText(
  status: number | null,
  meldung: string,
  schritt: 'anmelden' | 'wechsel'
): string {
  if (status === 401) return 'Name oder Passwort stimmt nicht.';
  if (status === 403) {
    // Beim Wechsel prüft der Hub das bisherige Passwort; beim Anmelden
    // heisst 403 «gesperrt oder nicht freigegeben» - den genauen Grund
    // nennt der Hub zwar in `detail`, aber der Client gibt ihn bei 403
    // nicht heraus, also der ehrliche Sammelsatz.
    return schritt === 'wechsel'
      ? 'Das bisherige Passwort stimmt nicht.'
      : 'Die Anmeldung wurde abgelehnt – dieser Zugang ist gesperrt oder nicht freigegeben.';
  }
  return meldung;
}
