/**
 * Führt die App denselben Stand aus wie der Hub?
 *
 * Die System-Seite warnt seit je: «Diese App führt nicht ihren eigenen
 * Stand aus, sondern eine über die Luft nachgeladene Fassung – die kann
 * älter sein als das, was TestFlight gerade gebracht hat.» Der Satz
 * stimmt, beantwortet die Frage dahinter aber nicht: *Ist* sie es? Wer
 * ihn liest, weiss danach genau so wenig wie vorher und wischt die App
 * zweimal weg, um es herauszufinden.
 *
 * Die Seite hat die Antwort längst in der Hand. Der Hub nennt seinen
 * Commit («HomePilot 0.2.0 · Stand a1b2c3d»), und seit Punkt 545 nennt
 * die App ihren auch: `deploy/rebuild-hub.sh` schreibt ihn vor dem Bau
 * in die `app.json`, und von dort wandert er in beides - in den
 * iOS-Build und in die OTA-Fassung, weil `eas update` die
 * Konfiguration in sein Manifest legt. Zwei Zahlen, die man nur noch
 * vergleichen muss.
 *
 * Reines Rechnen: hinein die beiden Stände, heraus ein Satz.
 */

/** Was `rebuild-hub.sh` in die `app.json` schreibt, bevor es gebaut hat -
 *  und was darum in jeder Fassung steht, die von Hand entstanden ist. */
export const UNBEKANNT = 'unbekannt';

export interface Staende {
  /** Der Stand, aus dem die laufende App-Fassung gebaut wurde. */
  app: string | null | undefined;
  /** Der Stand, den der Hub ausführt. */
  hub: string | null | undefined;
  /** Läuft eine über die Luft nachgeladene Fassung? */
  nachgeladen: boolean;
}

export interface Standsatz {
  text: string;
  /** In Warnfarbe: Hier ist etwas zu tun. */
  warnt: boolean;
}

/** Einen Stand auf das Vergleichbare bringen (rein, testbar).
 *
 *  Der Hub nennt ihn kurz (`a1b2c3d`), und das tut die App auch - aber
 *  eine der beiden Seiten könnte einmal den langen schicken. Verglichen
 *  wird deshalb über den kürzeren der beiden Anfänge, nicht auf
 *  Gleichheit der Zeichenkette. */
export function kurz(stand: string | null | undefined): string | null {
  const text = String(stand ?? '').trim();
  if (!text || text === UNBEKANNT || text === '?') return null;
  return text;
}

/** Zeigen beide auf denselben Commit? (rein, testbar) */
export function gleicherStand(
  app: string | null | undefined,
  hub: string | null | undefined
): boolean {
  const a = kurz(app);
  const b = kurz(hub);
  if (!a || !b) return false;
  const laenge = Math.min(a.length, b.length);
  return a.slice(0, laenge).toLowerCase() === b.slice(0, laenge).toLowerCase();
}

/**
 * Was auf der System-Seite steht (rein, testbar).
 *
 * `null`, wo sich nichts Belastbares sagen lässt - eine App, die vor
 * Punkt 545 gebaut wurde, kennt ihren Stand nicht, und «unbekannt ≠
 * a1b2c3d» wäre eine Warnung über nichts.
 */
export function standSatz(staende: Staende): Standsatz | null {
  const app = kurz(staende.app);
  const hub = kurz(staende.hub);
  if (!app) return null;
  if (!hub) {
    return { text: `Die App führt Stand ${app} aus.`, warnt: false };
  }
  if (gleicherStand(app, hub)) {
    return { text: `App und Hub führen denselben Stand aus (${app}).`, warnt: false };
  }
  // Der Fall, für den das Ganze da ist. Bewusst ohne «älter» oder
  // «neuer»: Aus zwei Commit-Kennungen lässt sich die Reihenfolge nicht
  // ablesen, und eine geratene Richtung wäre schlimmer als keine.
  const wie = staende.nachgeladen
    ? 'Die nachgeladene Fassung stammt aus einem anderen Stand als der Hub'
    : 'Der App-Build stammt aus einem anderen Stand als der Hub';
  return {
    text:
      `${wie}: App ${app}, Hub ${hub}. Eine Änderung, die nur auf einer ` +
      'der beiden Seiten liegt, fehlt darum auf der anderen.',
    warnt: true,
  };
}
