/**
 * Der spontane Gast-Zugang von der Seite «Familie und Freunde» aus.
 *
 * Der Fall: Besuch sitzt auf dem Sofa und will das Licht dimmen können.
 * Bisher hiess das Benutzerverwaltung öffnen, Benutzer anlegen, Rolle
 * wählen, Ablaufdatum tippen - fünf Schritte weit weg von der Person,
 * um die es geht. Auf «Familie und Freunde» steht sie schon, samt der
 * Auskunft, dass sie da ist; dort gehört auch der Zugang hin: Dauer
 * antippen, QR zeigen, fertig.
 *
 * Hier die entscheidbare Hälfte (rein, testbar): Aus der gewählten
 * Dauer wird das Ablaufdatum, wie der Hub es versteht - und der Satz,
 * der dem Gast sagt, wie lange sein Zugang gilt.
 */

/** Die angebotenen Dauern. Kurz und aufzählbar: Ein Datumsfeld wäre für
 *  den Abendbesuch drei Tipps zu viel - wer es genauer will, findet in
 *  der Benutzerverwaltung das freie Feld. */
export const DAUERN = [
  { key: 'heute', label: 'Nur heute' },
  { key: 'morgen', label: 'Bis morgen' },
  { key: 'woche', label: '1 Woche' },
  { key: 'offen', label: 'Ohne Ablauf' },
] as const;

export type Dauer = (typeof DAUERN)[number]['key'];

/**
 * Das Ablaufdatum zur gewählten Dauer (rein, testbar).
 *
 * Der Hub sperrt, sobald das *heutige* Datum nach `expires` liegt
 * (core/users.py: expired) - ein Zugang «bis 2026-09-05» gilt also den
 * ganzen 5. September und endet um Mitternacht. «Nur heute» ist darum
 * das heutige Datum, nicht das morgige. Aus den lokalen Feldern gebaut,
 * nicht über toISOString: Das UTC-Datum ist abends bereits das morgige.
 */
export function ablaufDatum(dauer: Dauer, jetzt: Date): string | null {
  if (dauer === 'offen') return null;
  const tage = dauer === 'heute' ? 0 : dauer === 'morgen' ? 1 : 7;
  const datum = new Date(jetzt);
  datum.setDate(datum.getDate() + tage);
  const monat = String(datum.getMonth() + 1).padStart(2, '0');
  const tag = String(datum.getDate()).padStart(2, '0');
  return `${datum.getFullYear()}-${monat}-${tag}`;
}

/** Was unter dem QR-Code steht (rein, testbar). */
export function ablaufSatz(expires: string | null): string {
  if (!expires) {
    return 'Der Zugang läuft nicht ab – abstellen geht jederzeit in der Benutzerverwaltung.';
  }
  const [, monat, tag] = expires.split('-');
  return `Der Zugang endet am ${Number(tag)}.${Number(monat)}. um Mitternacht von selbst.`;
}
