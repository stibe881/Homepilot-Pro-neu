/**
 * Persönliche Einstellungen von überall her – ohne die Schleppe.
 *
 * Die grossen Einstellungen laufen über `usePrefs`: Der Bildschirm lädt
 * sie einmal, hält sie und schreibt sie zurück. Für alles, was tief in
 * einer Kachel sitzt, ist das keine Lösung – die Playlist-Reihenfolge an
 * der Musikkarte oder die Vorlese-Box im Kochbuch müssten sonst als
 * Prop-Paar durch fünf Ebenen gereicht werden.
 *
 * Hier steht der kurze Weg dorthin. Zwei Dinge machen ihn möglich:
 *
 * - Der Hub führt seit Neuestem zusammen, statt zu ersetzen (siehe
 *   core/einstellungen.py). Wer einen Schlüssel setzt, löscht die
 *   anderen nicht mehr – sonst dürfte nur eine Stelle schreiben.
 * - Gelesen wird einmal je Sitzung und danach aus dem Gedächtnis. Ein
 *   Abruf je Kachel wäre bei zwanzig Kacheln zwanzig Abrufe für dieselbe
 *   Antwort.
 *
 * Bewusst nicht im Speicher des Telefons: Genau das ist der Punkt. Was
 * hier liegt, überlebt die Neuinstallation und steht auf dem zweiten
 * Gerät ebenso.
 */
import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';

export type Werte = Record<string, unknown>;

/** Zu welcher Anmeldung das Gedächtnis gehört. Wechselt sie, ist es
 *  wertlos: Der nächste Benutzer hat eigene Einstellungen. */
function kennung(settings: HubSettings): string {
  return `${settings.url}|${settings.token}`;
}

let gedaechtnis: { kennung: string; werte: Werte } | null = null;
let unterwegs: { kennung: string; frage: Promise<Werte> } | null = null;

/** Das Gedächtnis wegwerfen – beim Abmelden und beim Benutzerwechsel. */
export function persoenlichVergessen(): void {
  gedaechtnis = null;
  unterwegs = null;
}

/**
 * Alle persönlichen Einstellungen – beim ersten Mal vom Hub, danach aus
 * dem Gedächtnis.
 *
 * Scheitert der Abruf, kommt ein leeres Objekt zurück und nichts wird
 * gemerkt: Beim nächsten Versuch wird wieder gefragt. Ein gemerktes
 * «leer» wäre schlimmer als kein Gedächtnis – es sähe aus wie eine
 * Antwort und liesse die Einstellungen den Rest der Sitzung verschwunden
 * aussehen.
 */
export async function persoenlichLesen(settings: HubSettings): Promise<Werte> {
  const schluessel = kennung(settings);
  if (gedaechtnis?.kennung === schluessel) return gedaechtnis.werte;
  if (unterwegs?.kennung === schluessel) return unterwegs.frage;
  if (!settings.url || !settings.token) return {};

  const frage = hubClient(settings.url, settings.token)
    .get<{ prefs?: Werte } | null>('/api/prefs', { fallback: null, still: true })
    .then((antwort) => {
      const werte =
        antwort && typeof antwort.prefs === 'object' && antwort.prefs
          ? antwort.prefs
          : {};
      if (antwort) gedaechtnis = { kennung: schluessel, werte };
      return werte;
    })
    .catch(() => ({}) as Werte)
    .finally(() => {
      if (unterwegs?.kennung === schluessel) unterwegs = null;
    });
  unterwegs = { kennung: schluessel, frage };
  return frage;
}

/** Einen Schlüssel lesen – getippt, mit Rückfallwert. */
export async function persoenlichWert<T>(
  settings: HubSettings,
  schluessel: string,
  standard: T
): Promise<T> {
  const werte = await persoenlichLesen(settings);
  const wert = werte[schluessel];
  return wert === undefined || wert === null ? standard : (wert as T);
}

/**
 * Einen Schlüssel setzen. `null` löscht ihn.
 *
 * Geschickt wird nur dieser eine – der Hub lässt den Rest stehen. Das
 * Gedächtnis wird sofort nachgezogen, damit die nächste Kachel nicht den
 * alten Stand liest, während der Zug noch unterwegs ist.
 */
export function persoenlichSetzen(
  settings: HubSettings,
  schluessel: string,
  wert: unknown
): void {
  if (!settings.url || !settings.token) return;
  const kenn = kennung(settings);
  if (gedaechtnis?.kennung === kenn) {
    const werte = { ...gedaechtnis.werte };
    if (wert === null || wert === undefined) delete werte[schluessel];
    else werte[schluessel] = wert;
    gedaechtnis = { kennung: kenn, werte };
  }
  hubClient(settings.url, settings.token).put(
    '/api/prefs',
    { prefs: { [schluessel]: wert === undefined ? null : wert } },
    // Nicht gespeichert heisst: gilt auf diesem Gerät bis zum nächsten
    // Start – kein Grund, die Bedienung mit einer Meldung zu stören.
    { fallback: null, still: true }
  );
}
