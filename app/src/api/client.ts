/**
 * Ein Weg zum Hub, statt neunzig.
 *
 * Vorher setzte jeder Aufruf seinen Authorization-Kopf selbst zusammen,
 * behandelte Fehler anders und hatte kein Zeitlimit. Das Ergebnis waren
 * 46 leere `catch`-Blöcke: Schlug etwas fehl, passierte nichts, die App
 * zeigte weiter den alten Stand, und man hielt ihn für den aktuellen.
 *
 * Genau so sah die Einkaufsliste leer aus, obwohl der Server «Methode
 * nicht erlaubt» sagte – die unangenehmste Sorte Fehler, weil sie wie ein
 * gültiges Ergebnis aussieht.
 *
 * Drei Dinge macht dieser Client anders:
 *
 *   - **Zeitlimit.** Ein Hub, der nicht antwortet, lässt einen Aufruf
 *     sonst ewig hängen; die Anzeige bleibt dann für immer beim Ladezustand.
 *   - **Fehler sind Fehler.** Ein 403 oder 500 wirft, statt still ein
 *     leeres Array zu liefern. Wer das nicht will, sagt es ausdrücklich
 *     mit `fallback`.
 *   - **Sichtbar.** Jeder Fehlschlag geht zusätzlich an einen Empfänger,
 *     den die Startseite abonniert und als Einblendung zeigt. Die Stelle,
 *     die den Aufruf macht, muss sich darum nicht kümmern.
 */

/** Nach so langer Zeit gilt ein Aufruf als verloren. */
const TIMEOUT_MS = 15000;

export class HubFehler extends Error {
  /** HTTP-Status, sofern überhaupt einer ankam. */
  readonly status: number | null;
  /** Der angefragte Weg – für die Meldung und zum Suchen im Protokoll. */
  readonly pfad: string;

  constructor(message: string, pfad: string, status: number | null = null) {
    super(message);
    this.name = 'HubFehler';
    this.pfad = pfad;
    this.status = status;
  }
}

/**
 * Aus einer Fehlerlage einen Satz machen, den man lesen kann (rein,
 * testbar).
 *
 * «Failed to fetch» und «403» helfen niemandem. Was hilft: was schiefging
 * und was man dagegen tun kann.
 */
export function fehlerText(status: number | null, pfad: string): string {
  if (status === null) return 'Der Hub antwortet nicht. Ist er erreichbar?';
  if (status === 401 || status === 403) {
    return 'Dafür fehlt die Berechtigung – oder die Anmeldung ist abgelaufen.';
  }
  if (status === 404) return `Der Hub kennt «${pfad}» nicht. Ist er auf dem neusten Stand?`;
  if (status === 405) {
    // Genau der Fall der Einkaufsliste: Der Weg existiert, aber nicht mit
    // dieser Methode. Sieht in der App sonst aus wie ein leeres Ergebnis.
    return `Der Hub kennt «${pfad}» so nicht. Ist er auf dem neusten Stand?`;
  }
  if (status >= 500) return 'Im Hub ist etwas schiefgegangen. Das Protokoll unter System sagt mehr.';
  return `Der Hub hat den Aufruf abgelehnt (${status}).`;
}

// ── Wer von Fehlschlägen erfährt ─────────────────────────────────────────
//
// Bewusst ein schlichter Verteiler auf Modulebene und kein Context: Der
// Client wird auch ausserhalb von React aufgerufen, und ein Fehler soll
// nicht davon abhängen, ob gerade ein Provider darüber steht.

type Zuhoerer = (fehler: HubFehler) => void;
const zuhoerer = new Set<Zuhoerer>();

/** Fehlschläge mithören. Gibt die Abmeldung zurück. */
export function onHubFehler(hoeren: Zuhoerer): () => void {
  zuhoerer.add(hoeren);
  return () => zuhoerer.delete(hoeren);
}

function melden(fehler: HubFehler) {
  for (const hoeren of zuhoerer) {
    try {
      hoeren(fehler);
    } catch {
      // Ein Zuhörer, der selbst stolpert, darf den Aufruf nicht mitreissen.
    }
  }
}

export interface HubClient {
  get<T>(pfad: string, optionen?: Optionen<T>): Promise<T>;
  post<T>(pfad: string, körper?: unknown, optionen?: Optionen<T>): Promise<T>;
  put<T>(pfad: string, körper?: unknown, optionen?: Optionen<T>): Promise<T>;
  del<T>(pfad: string, optionen?: Optionen<T>): Promise<T>;
  /** Rohe Bytes senden – eine Tonaufnahme, ein Bild. Als JSON wären sie
   *  base64-verpackt um ein Drittel grösser, ohne dass der Umweg etwas
   *  brächte, was ein Content-Type nicht auch sagt. */
  roh<T>(pfad: string, daten: Blob, optionen?: Optionen<T>): Promise<T>;
}

interface Optionen<T> {
  /** Was statt eines Fehlers geliefert wird. Damit wird aus «wirft» ein
   *  «liefert das hier» – ausdrücklich und an der Aufrufstelle sichtbar. */
  fallback?: T;
  /** Nicht einblenden. Für Abfragen im Hintergrund, die im Minutentakt
   *  laufen: Eine Einblendung je Minute wäre schlimmer als der Fehler. */
  still?: boolean;
  timeout?: number;
}

export function hubClient(url: string, token: string): HubClient {
  async function ruf<T>(
    methode: string,
    pfad: string,
    körper?: unknown,
    optionen: Optionen<T> = {}
  ): Promise<T> {
    const steuerung = new AbortController();
    const frist = setTimeout(() => steuerung.abort(), optionen.timeout ?? TIMEOUT_MS);
    try {
      // Ein Blob geht so, wie er ist: Sein eigener Typ steht schon in
      // ihm, und `fetch` setzt den Content-Type dann selbst.
      const roh = typeof Blob !== 'undefined' && körper instanceof Blob;
      const antwort = await fetch(`${url}${pfad}`, {
        method: methode,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(körper !== undefined && !roh ? { 'Content-Type': 'application/json' } : {}),
        },
        body:
          körper === undefined ? undefined : roh ? (körper as Blob) : JSON.stringify(körper),
        signal: steuerung.signal,
      });
      if (!antwort.ok) {
        throw new HubFehler(fehlerText(antwort.status, pfad), pfad, antwort.status);
      }
      // 204 und leere Antworten sind gültig – nicht daran scheitern.
      const text = await antwort.text();
      return (text ? JSON.parse(text) : null) as T;
    } catch (err) {
      const fehler =
        err instanceof HubFehler ? err : new HubFehler(fehlerText(null, pfad), pfad, null);
      if (!optionen.still) melden(fehler);
      if ('fallback' in optionen) return optionen.fallback as T;
      throw fehler;
    } finally {
      clearTimeout(frist);
    }
  }

  return {
    get: (pfad, optionen) => ruf('GET', pfad, undefined, optionen),
    post: (pfad, körper, optionen) => ruf('POST', pfad, körper, optionen),
    put: (pfad, körper, optionen) => ruf('PUT', pfad, körper, optionen),
    del: (pfad, optionen) => ruf('DELETE', pfad, undefined, optionen),
    roh: (pfad, daten, optionen) => ruf('POST', pfad, daten, optionen),
  };
}
