/**
 * Die reinen Regeln der Anmeldemaske (LoginScreen).
 *
 * Hier statt im Bildschirm, damit sie ohne React Native prüfbar sind -
 * und weil sie Entscheidungen sind, keine Anzeige: Wer darf abschicken,
 * und was fehlt noch?
 */

export type AnmeldeModus = 'login' | 'recover' | 'wechsel';

/** Sieht das nach einer E-Mail-Adresse aus? (rein, testbar)
 *
 *  Bewusst grosszügig: Die richtige Prüfung macht ohnehin erst die
 *  Bestätigungs-E-Mail. Hier geht es nur darum, den Tippfehler zu fangen,
 *  bevor jemand auf eine Antwort wartet. */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

/** Was an der Eingabe noch fehlt – null heisst «kann abgeschickt werden».
 *
 *  Beim Anmelden darf statt der E-Mail auch ein Name stehen: Wer vom
 *  Verwalter ein Initialpasswort bekommen hat, meldet sich mit seinem
 *  Namen direkt beim Hub an – ganz ohne E-Mail-Konto. Nur «Passwort
 *  vergessen» braucht zwingend eine Adresse, dort geht eine Mail raus. */
export function validate(
  mode: AnmeldeModus,
  email: string,
  password: string
): string | null {
  if (mode === 'recover') {
    if (!looksLikeEmail(email)) return 'Bitte eine gültige E-Mail-Adresse eintragen.';
    return null;
  }
  if (!email.trim()) return 'Bitte Name oder E-Mail-Adresse eintragen.';
  if (password.length < 8) return 'Das Passwort braucht mindestens acht Zeichen.';
  return null;
}

/** Taugt das neue Passwort beim erzwungenen Wechsel? (rein, testbar)
 *
 *  Das Initialpasswort kennt auch der Verwalter - deshalb muss das neue
 *  ein anderes sein, sonst wäre der Wechsel nur ein Klick ohne Sinn. */
export function wechselProblem(
  alt: string,
  neu: string,
  wiederholt: string
): string | null {
  if (neu.trim().length < 8) return 'Das neue Passwort braucht mindestens acht Zeichen.';
  if (neu === alt) return 'Das neue Passwort muss ein anderes sein als das Initialpasswort.';
  if (neu !== wiederholt) return 'Die beiden Eingaben stimmen nicht überein.';
  return null;
}
