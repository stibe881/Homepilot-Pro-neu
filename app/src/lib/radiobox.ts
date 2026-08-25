/**
 * Warum das Radio nirgends hin kann.
 *
 * Herausgelöst aus components/entity/medien.tsx: Dort zieht die Datei
 * die Symbolschriften von Expo mit, und Jest lädt sie deshalb nicht.
 * Dieselbe Lehre wie bei lib/batterien.ts.
 */

/** Warum das Radio nirgends hin kann (rein, testbar).
 *
 * Zwei verschiedene Antworten, weil zwei verschiedene Dinge zu tun sind:
 * Wer gar keine Box hat, braucht eine. Wer welche hat, aber keine, die
 * eine Tonadresse abspielen kann, hat die falschen – Spotify-Connect-
 * Boxen etwa kennt der Hub nur über Spotify, nicht als eigenes Gerät.
 */
export function keineBoxText(mediaPlayers: number): string {
  if (mediaPlayers === 0) {
    return (
      'Keine Box da. Radio braucht einen Lautsprecher, den der Hub selbst ' +
      'kennt – einen Chromecast oder eine Google-Home-Box über die ' +
      'google_cast-Integration.'
    );
  }
  return (
    'Keine der bekannten Boxen kann eine Tonadresse abspielen. Radio ' +
    'braucht dafür ein Cast-Gerät (Chromecast, Google Home); reine ' +
    'Spotify-Connect-Boxen kennt der Hub nur über Spotify.'
  );
}

/** Was in der Senderzeile steht (rein, testbar).
 *
 * Zwei Angaben, die auseinanderzuhalten sind: *welcher* Sender läuft und
 * ob schon etwas zu hören ist. Zwischen dem Antippen und dem ersten Ton
 * liegen bei einem Radiostrom Sekunden – die Box lädt. Ohne dieses Wort
 * stand der Sender da, es kam nichts, und niemand wusste, ob daraus noch
 * etwas wird.
 *
 * Der Name nur, solange wirklich etwas läuft: Nach dem Anhalten wäre er
 * eine Behauptung über die Gegenwart, die nicht mehr stimmt.
 */
export function senderzeile(state: Record<string, unknown>): {
  sender: string | null;
  laedt: boolean;
} {
  const laeuft = state.state === 'playing';
  const sender =
    laeuft && typeof state.station === 'string' && state.station ? state.station : null;
  return { sender, laedt: sender !== null && state.buffering === true };
}
