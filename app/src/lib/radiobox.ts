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
