/**
 * Was zu melden war, als der Hub nicht zu erreichen war.
 *
 * Der Fall, aus dem das hier entstand: Man kommt nach Hause, das Telefon
 * kreuzt bei 150 Metern die Grenze – und hängt in genau diesem Moment
 * noch am Mobilfunk, während das WLAN erst gleich kommt. Steht der Hub
 * unter einer Adresse im Heimnetz, läuft die Meldung ins Leere. Die alte
 * Fassung fing den Fehler weg und tröstete sich damit, dass «das nächste
 * Ereignis es korrigiert». Beim Ankommen stimmt das nicht: Das nächste
 * Ereignis kommt erst, wenn man wieder weggeht. Bis dahin steht man auf
 * «unterwegs», und jeder Ablauf, der an der Ankunft hängt, läuft nie.
 *
 * **Aufgehoben wird nur die jüngste Meldung, nicht ihr Verlauf.** Das ist
 * eine Entscheidung, keine Sparsamkeit: Eine Position sagt, wo jemand
 * *ist*. Nachträglich drei Zwischenstände einzuspielen hiesse, Abläufe
 * verspätet auszulösen – «Licht an bei Ankunft», zwanzig Minuten nachdem
 * man wieder weg ist, ist kein Dienst, sondern ein Spuk. Denselben Grund
 * nennt `warteschlange.ts` für die Befehle.
 *
 * Kein Verfallsdatum dagegen: Wer drei Stunden ohne Netz zuhause sitzt,
 * bewegt sich nicht – es entsteht also gar keine neuere Messung, und die
 * alte ist immer noch wahr. Dass sie nicht über eine frischere
 * geschrieben wird, entscheidet der Hub am mitgereichten Zeitpunkt.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Wo die zurückgestellte Meldung liegt – auch für die Hintergrund-Aufgabe. */
export const PUFFER_KEY = 'homepilot.ortung.puffer';

/** Eine Standortmeldung, wie sie zum Hub geht. */
export interface Standortmeldung {
  latitude: number;
  longitude: number;
  /** Streuung in Metern. 0 heisst «unbekannt», nicht «exakt». */
  accuracy: number;
  /** Zeitpunkt der Messung in Sekunden seit 1970 – nicht des Sendens. */
  at: number;
  battery?: number | null;
}

/** Ist diese Meldung brauchbar? (rein, testbar) */
export function gueltig(meldung: unknown): meldung is Standortmeldung {
  const kandidat = meldung as Standortmeldung | null;
  if (!kandidat || typeof kandidat !== 'object') return false;
  if (!Number.isFinite(kandidat.latitude) || !Number.isFinite(kandidat.longitude)) {
    return false;
  }
  // 0/0 ist der Atlantik, nicht ein fehlender Wert.
  if (kandidat.latitude === 0 && kandidat.longitude === 0) return false;
  return Number.isFinite(kandidat.at) && kandidat.at > 0;
}

/**
 * Welche der beiden Meldungen gilt (rein, testbar).
 *
 * Die jüngere. Klingt selbstverständlich, ist es aber nicht: Die
 * Hintergrund-Aufgabe und der Bildschirm melden unabhängig voneinander,
 * und ohne diese Regel überschriebe eine gerade zurückgestellte Messung
 * von vorhin eine frischere, die parallel entstanden ist.
 */
export function aufheben(
  alt: Standortmeldung | null,
  neu: Standortmeldung | null
): Standortmeldung | null {
  if (!gueltig(neu)) return gueltig(alt) ? alt : null;
  if (!gueltig(alt)) return neu;
  return neu.at >= alt.at ? neu : alt;
}

/** Die zurückgestellte Meldung – oder nichts. */
export async function pufferLesen(): Promise<Standortmeldung | null> {
  try {
    const roh = await AsyncStorage.getItem(PUFFER_KEY);
    const meldung = roh ? JSON.parse(roh) : null;
    return gueltig(meldung) ? meldung : null;
  } catch {
    return null;
  }
}

/** Zurückstellen – oder den Puffer leeren, wenn nichts mehr wartet. */
export async function pufferSchreiben(meldung: Standortmeldung | null): Promise<void> {
  try {
    if (meldung) await AsyncStorage.setItem(PUFFER_KEY, JSON.stringify(meldung));
    else await AsyncStorage.removeItem(PUFFER_KEY);
  } catch {
    // Ein voller Speicher darf die Ortung nicht anhalten.
  }
}

/** Wohin gemeldet wird. Die Aufgabe liest das aus dem Speicher. */
export interface Ziel {
  url: string;
  token: string;
  zone: string;
}

/**
 * Eine Position zum Hub schicken – und aufheben, was nicht durchkam.
 *
 * Gemeldet wird immer die jüngste bekannte Messung: Liegt eine ältere im
 * Puffer, ist sie mit der neuen bereits überholt. Kommt auch die neue
 * nicht durch, wandert sie in den Puffer und geht beim nächsten Anlass
 * hinaus – bei der nächsten Bewegung, beim nächsten Grenzübertritt oder
 * sobald jemand die App aus dem Hintergrund holt.
 */
export async function positionMelden(
  ziel: Ziel,
  meldung: Standortmeldung
): Promise<boolean> {
  const gilt = aufheben(await pufferLesen(), meldung);
  if (!gilt || !ziel.url || !ziel.token) {
    await pufferSchreiben(gilt);
    return false;
  }
  let antwort: Response | null = null;
  try {
    antwort = await fetch(`${ziel.url}/api/presence/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ziel.token}`,
      },
      body: JSON.stringify({
        latitude: gilt.latitude,
        longitude: gilt.longitude,
        accuracy: gilt.accuracy,
        at: gilt.at,
        ...(gilt.battery === null || gilt.battery === undefined
          ? {}
          : { battery: gilt.battery }),
        ...(ziel.zone ? { zone: ziel.zone } : {}),
      }),
    });
  } catch {
    antwort = null;
  }
  // Ein 4xx ist keine Übertragungsstörung, sondern eine Absage – die
  // Meldung aufzuheben hiesse, sie bei jedem Anlass erneut abweisen zu
  // lassen. Nur bei «gar nicht angekommen» und bei einem Hub, der gerade
  // nicht kann (5xx), wird zurückgestellt.
  const nochmal = !antwort || antwort.status >= 500;
  await pufferSchreiben(nochmal ? gilt : null);
  return !!antwort && antwort.ok;
}
