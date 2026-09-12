/**
 * Welches Bild ein Grill bekommt - und was daneben steht.
 *
 * Gewünscht im Haus (Punkt 559), mit dem Bild des Raums «Grill» darin:
 * «Hier soll ein Bild von je dem Grill angezeigt werden. Neben dem Bild
 * vom Grill sollen kurz die wichtigsten Infos stehen wie die aktuelle
 * Temperatur und die Zieltemperatur.» Der Smoker ist ein Pit Boss
 * PB1150PS2 (ein liegender Pelletgrill mit Pellettrichter), der
 * Räucherschrank ein PBV4PS2 (ein stehender Schrank mit Glastüre).
 *
 * Kein Foto, sondern eine Zeichnung je Bauart - wie beim Fenster der
 * Storenkachel (components/CoverVisual.tsx). Ein Hersteller-Foto
 * gehört nicht ins Repo, und die Zeichnung kann zeigen, was das Foto
 * nicht kann: dass der Grill gerade läuft.
 */

/** Die zwei Bauarten, die sich im Bild unterscheiden. */
export type Grillbauart = 'fass' | 'schrank';

/**
 * Die Bauart aus der Modellbezeichnung (rein, testbar).
 *
 * Pit Boss nennt seine stehenden Räucherschränke «PBV…» (V für
 * vertical) - PBV4PS2, PBV3P1, PBV5P2. Alles andere ist ein liegender
 * Grill. Ohne Modell bleibt es beim Grill: Das ist der häufigere Fall,
 * und ein Schrank, der als Grill gezeichnet wird, ist ein kleinerer
 * Fehler als umgekehrt.
 */
export function grillBauart(model: unknown): Grillbauart {
  const kennung = String(model ?? '')
    .trim()
    .toUpperCase();
  return kennung.startsWith('PBV') ? 'schrank' : 'fass';
}

/** Wie das Bild heisst - für Vorlesen und für die Probe. */
export function bildName(bauart: Grillbauart): string {
  return bauart === 'schrank' ? 'Bild: Räucherschrank' : 'Bild: Pelletgrill';
}

/**
 * Die Kurzinfo neben dem Bild (rein, testbar): erst die Temperatur,
 * dann das Ziel - die zwei Zahlen, die man beim Grillen wissen will.
 *
 * Ein kalter Grill sagt nur «Aus»; ein Ziel ohne Feuer ist keine
 * Auskunft. Ist der Grill nicht erreichbar, steht das an der Kachel
 * ohnehin («nicht erreichbar», dazu der Grund seit Punkt 552).
 */
export function grillKurzinfo(state: {
  state?: unknown;
  temperature?: unknown;
  target?: unknown;
  unit?: unknown;
}): { gross: string; klein: string | null } {
  const einheit = String(state.unit ?? '°C');
  if (state.state !== 'running') return { gross: 'Aus', klein: null };
  const gross =
    typeof state.temperature === 'number'
      ? `${Math.round(state.temperature)} ${einheit}`
      : 'Läuft';
  const klein =
    typeof state.target === 'number' ? `Ziel ${Math.round(state.target)} ${einheit}` : null;
  return { gross, klein };
}

/** Die Fotos, die es gibt - je Modell eines. Der Schlüssel ist der
 *  Dateiname unter assets/grills; die Datei selbst bindet die Komponente
 *  ein (require kennt nur feste Pfade). */
const FOTOS: Record<string, string> = {
  PB1150PS2: 'pb1150ps2',
};

/**
 * Das Foto zum Modell, wenn es eines gibt (rein, testbar).
 *
 * Gewünscht im Haus (Punkt 564): «Hier soll dieses Foto vom Grill
 * angezeigt werden» - das Bild des Smokers aus dem Haus, freigestellt.
 * Nur wo ein Foto liegt; sonst bleibt die Zeichnung. Der Räucherschrank
 * bekommt seines, sobald eines da ist.
 */
export function grillFoto(model: unknown): string | null {
  const kennung = String(model ?? '')
    .trim()
    .toUpperCase();
  return FOTOS[kennung] ?? null;
}
