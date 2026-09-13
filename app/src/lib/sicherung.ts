/**
 * Sicherungen: was die App über eine Datei wissen kann, bevor sie den
 * Hub fragt (Punkt 593 der Werkbank).
 *
 * Der Hub sichert seit Punkt 593 ein Archiv - die Datendatei samt allem,
 * was daneben liegt (Bilder, Gutschein-Dateien, Token, config.yaml).
 * Die alten Einzeldateien bleiben vierzehn Tage lang daneben liegen und
 * sind weiter zurückspielbar. Und es gibt den Rückweg: eine Sicherung
 * vom Rechner hochladen oder aus dem Supabase-Bucket zurückholen.
 *
 * Hier liegt die entscheidbare Hälfte (rein, testbar): welcher Name eine
 * Sicherung ist und was eine Zeile darüber sagt. Die Anzeige wohnt in
 * screens/SystemScreen.tsx (BackupCard).
 */

/** Dieselbe Regel wie im Hub (persistence.SICHERUNGSNAME). */
const SICHERUNGSNAME = /^homepilot-data-[A-Za-z0-9_.-]+\.(json|tar\.gz)$/;

/**
 * Warum diese Datei nicht als Sicherung durchgeht - oder null (rein, testbar).
 *
 * Geprüft wird vor dem Hochladen, damit die Antwort nicht erst nach
 * zwanzig Megabyte kommt. Der Hub prüft denselben Namen noch einmal,
 * er traut der App nicht - das hier ist die Höflichkeit, nicht der Riegel.
 */
export function sicherungsNameProblem(name: string | null | undefined): string | null {
  const sauber = String(name ?? '').trim();
  if (!sauber) return 'Die Datei hat keinen Namen.';
  if (!SICHERUNGSNAME.test(sauber)) {
    return (
      'Das ist keine HomePilot-Sicherung: Der Name muss mit «homepilot-data-» ' +
      'beginnen und auf .tar.gz oder .json enden.'
    );
  }
  return null;
}

/** Was in dieser Sicherung steckt (rein, testbar). */
export function sicherungsArt(name: string): 'archiv' | 'datei' {
  return name.endsWith('.tar.gz') ? 'archiv' : 'datei';
}

/**
 * Das Wort hinter Datum und Grösse in der Liste (rein, testbar).
 *
 * «nur Daten» steht bewusst da: Wer eine alte Einzeldatei zurückspielt,
 * bekommt Benutzer und Abläufe, aber keine Bilder und keine Token - das
 * soll er vorher lesen, nicht nachher merken.
 */
export function sicherungsArtLabel(name: string): string {
  return sicherungsArt(name) === 'archiv' ? 'Archiv' : 'nur Daten';
}

/** Die Zeile einer Sicherung: Datum, Grösse, Art (rein, testbar). */
export function sicherungsZeile(
  entry: { name: string; size: number },
  datum: string
): string {
  const kb = Math.max(1, Math.round(entry.size / 1024));
  const groesse = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} kB`;
  return `${datum} · ${groesse} · ${sicherungsArtLabel(entry.name)}`;
}
